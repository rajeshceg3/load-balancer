#!/usr/bin/env python3
"""Purpose-fit verification for Load balancer, up close.

Syntax and module-import checks plus a real headless-Chrome render of
the simulation page. Exit 0 and FAILURES=0 mean green.
"""
import http.server
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
CHROME = os.environ.get('CHROME_BIN', '/usr/bin/google-chrome')

checks = []
failures = []


def record(name, ok, detail=''):
    checks.append({'name': name, 'ok': bool(ok), 'detail': detail})
    print(('PASS' if ok else 'FAIL') + ' ' + name + (' :: ' + detail if detail else ''))
    if not ok:
        failures.append(name)


def main():
    record('doctor: node on PATH', shutil.which('node') is not None, shutil.which('node') or 'not found')
    record('doctor: chrome available', os.path.exists(CHROME), CHROME)
    if failures:
        return finish()

    for f in ('player.js', 'concept.js'):
        chk = subprocess.run(['node', '--check', f], cwd=REPO_ROOT, capture_output=True, text=True)
        record('syntax: %s' % f, chk.returncode == 0, chk.stderr.strip()[-200:])

    imp = subprocess.run(['node', '--input-type=module', '-e',
                          "const m = await import('file://' + process.cwd() + '/player.js');"
                          "if (typeof m.TimelinePlayer !== 'function') process.exit(1);"],
                         cwd=REPO_ROOT, capture_output=True, text=True)
    record('player.js imports as a pure module', imp.returncode == 0, imp.stderr.strip()[-200:])

    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        port = s.getsockname()[1]
    server = http.server.ThreadingHTTPServer(('127.0.0.1', port), http.server.SimpleHTTPRequestHandler)
    server.RequestHandlerClass.log_message = lambda *a: None
    os.chdir(REPO_ROOT)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        dom_dir = tempfile.mkdtemp(prefix='verify-load-balancer-dom-')
        dom_path = os.path.join(dom_dir, 'dom.html')
        with open(dom_path, 'w') as dom, open(os.path.join(dom_dir, 'console.log'), 'w') as cons:
            subprocess.run([CHROME, '--headless=new', '--no-sandbox', '--disable-gpu',
                            '--enable-logging=stderr', '--v=0', '--virtual-time-budget=8000',
                            '--dump-dom', 'http://127.0.0.1:%d/' % port],
                           stdout=dom, stderr=cons, timeout=90)
        dom = open(dom_path).read()
        console = open(os.path.join(dom_dir, 'console.log')).read()
    finally:
        server.shutdown()
    record('chrome render: hero and canvas boot', 'Watch a' in dom and '<canvas' in dom,
           'hero + simulation canvas rendered' if 'Watch a' in dom else dom[:200])
    record('chrome render: playback controls rendered',
           'aria-label="Playback"' in dom and 'aria-label="Timeline"' in dom,
           'player region + timeline present')
    errors = [l for l in console.splitlines()
              if re.search(r'console.*(error|uncaught)|failed to load', l, re.I)
              and 'GPU' not in l and 'dbus' not in l.lower()]
    record('chrome render: no console errors', not errors, '; '.join(errors[:3]))
    return finish()


def finish():
    evidence_dir = tempfile.mkdtemp(prefix='verify-load-balancer-')
    with open(os.path.join(evidence_dir, 'evidence.json'), 'w') as f:
        json.dump({'repo': 'load-balancer', 'checks': checks, 'failures': failures}, f, indent=2)
    print('EVIDENCE_DIR=' + evidence_dir)
    print('FAILURES=%d' % len(failures))
    return 0 if not failures else 1


if __name__ == '__main__':
    sys.exit(main())
