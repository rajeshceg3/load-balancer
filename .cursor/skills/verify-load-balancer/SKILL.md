---
name: verify-load-balancer
description: Verifies Load balancer, up close - syntax and module checks plus a real headless-Chrome render of the simulation page - with machine-readable evidence.
---

# Verify Load balancer, up close

## Launch

```bash
python3 .cursor/skills/verify-load-balancer/verify.py
```

Exit 0 and `FAILURES=0` mean green. Static app; no services needed.
Chrome location can be overridden with `CHROME_BIN`.

## Doctor

Gates on `node` and a Chrome/Chromium binary.

## Drive

1. `node --check` on `player.js` and `concept.js`.
2. Module smoke: `player.js` imports standalone and exports
   `TimelinePlayer` (it is simulation-agnostic by design).
3. Headless-Chrome render against a throwaway local server on a free
   port: hero and simulation canvas boot, the playback region and
   timeline render, and the console stays clean.

## Evidence

Each run writes a fresh `EVIDENCE_DIR` with `evidence.json`.
`FAILURES=n` is the last line; the exit code mirrors it.

## Cleanup

The static server is a daemon thread on an ephemeral port, shut down at
the end of the run, pass or fail.

## Maintenance

When the simulation gains controls or the page structure changes,
extend the render assertions in the same commit.

## Known boundaries

- The render check proves boot and control presence; frame-by-frame
  canvas output (pixels) is not asserted.
- The simulation is a fixed-arrivals teaching model, not production
  traffic (per the page's own honesty note).
