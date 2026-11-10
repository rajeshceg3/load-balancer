// Load balancer, up close — deterministic simulation.
// Every request's full life is computed once at load, so rendering is a pure
// function of time: the timeline can scrub to any point and redraw exactly.

import { TimelinePlayer, wireThemeToggle, revealScene } from "./player.js";

const steps = [
  { t: 0,  label: "One client, one server: every request goes to the same place" },
  { t: 4,  label: "Five clients arrive at once; the one server queues, then drops" },
  { t: 9,  label: "A load balancer steps in and deals requests round-robin" },
  { t: 14, label: "Least-connections sends each request to the least busy server" },
  { t: 19, label: "Server two stops answering; health checks route around it" },
  { t: 24, label: "Done: work spread, failure absorbed, still answering" },
];
const duration = 26;

// ---- world ----------------------------------------------------------------
const CLIENTS = 5, SERVERS = 3;
const CLIENT_X = 0.10, LB_X = 0.46, SERVER_X = 0.86;
// Vertical spread keeps clear of the hint at top and the player dock at bottom.
const clientY = (i) => 0.20 + (0.48 * i) / (CLIENTS - 1);
const serverY = (i) => 0.22 + (0.44 * i) / (SERVERS - 1);

const PHASES = [
  { start: 0,  end: 4,  clients: [0],             via: "direct", servers: [0],     algo: "rr", every: 1.30, service: { 0: 0.9 },               dropAfter: Infinity },
  { start: 4,  end: 9,  clients: [0, 1, 2, 3, 4], via: "direct", servers: [0],     algo: "rr", every: 0.55, service: { 0: 1.1 },               dropAfter: 4 },
  { start: 9,  end: 14, clients: [0, 1, 2, 3, 4], via: "lb",     servers: [0, 1, 2], algo: "rr", every: 0.55, service: { 0: 0.9, 1: 0.9, 2: 0.9 }, dropAfter: Infinity },
  { start: 14, end: 19, clients: [0, 1, 2, 3, 4], via: "lb",     servers: [0, 1, 2], algo: "lc", every: 0.55, service: { 0: 0.7, 1: 1.1, 2: 1.5 }, dropAfter: Infinity },
  { start: 19, end: 24, clients: [0, 1, 2, 3, 4], via: "lb",     servers: [0, 1, 2], algo: "rr", every: 0.60, service: { 0: 0.9, 1: 0.9, 2: 0.9 }, dropAfter: Infinity, downAt: 20, downServer: 1 },
  { start: 24, end: 26, clients: [0, 2, 4],       via: "lb",     servers: [0, 2],   algo: "rr", every: 1.20, service: { 0: 0.9, 2: 0.9 },        dropAfter: Infinity },
];

const jitter = (k) => (((k * 2654435761) % 1000) / 1000) * 0.18;

// Build the full request schedule once.
const requests = [];
{
  let rr = 0;
  for (const ph of PHASES) {
    const ends = {}; // server id -> array of endService for in-flight counting
    const avail = {}; // server id -> next free time
    ph.servers.forEach((s) => { ends[s] = []; avail[s] = ph.start; });
    const n = ph.clients.length;
    for (let k = 0; ; k++) {
      const spawn = ph.start + 0.25 + k * ph.every + jitter(k);
      if (spawn >= ph.end - 0.25) break;
      const client = ph.clients[k % n];
      let pool = ph.servers.slice();
      if (ph.downAt != null && spawn >= ph.downAt) pool = pool.filter((s) => s !== ph.downServer);
      if (pool.length === 0) continue;
      let server;
      if (ph.algo === "rr") {
        server = pool[rr % pool.length];
        rr++;
      } else {
        server = pool.reduce((best, s) =>
          ends[s].filter((e) => e > spawn).length < ends[best].filter((e) => e > spawn).length ? s : best, pool[0]);
      }
      const leg1 = 0.45, leg2 = 0.45, direct = 0.7;
      const travel = ph.via === "lb" ? leg1 + leg2 : direct;
      const arriveServer = spawn + travel;
      const startService = Math.max(arriveServer, avail[server]);
      const waitingAhead = ends[server].filter((e) => e > arriveServer).length;
      const dropped = waitingAhead >= ph.dropAfter;
      const service = ph.service[server] ?? 0.9;
      const endService = dropped ? startService : startService + service;
      if (!dropped) avail[server] = endService;
      ends[server].push(endService);
      requests.push({ phase: ph, client, server, spawn, arriveServer, startService, endService, dropped, via: ph.via });
    }
  }
}

const phaseAt = (t) => PHASES.find((p) => t >= p.start && t < p.end) || PHASES[PHASES.length - 1];

// ---- rendering --------------------------------------------------------------
const canvas = document.querySelector(".scene");
const ctx = canvas.getContext("2d");
let firstFrame = true;

const INK = "#23201c", MUTED = "#6d665c", ACCENT = "#2f5fb3", ALERT = "#b9522c", LINE = "rgba(35,32,28,0.16)";

let player = null;

function fit() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, canvas.clientWidth * dpr);
  canvas.height = Math.max(1, canvas.clientHeight * dpr);
  // Resizing clears the canvas; redraw the current time immediately so a
  // paused or finished scene never goes blank.
  if (player) player.render(); else drawScene(0);
}
new ResizeObserver(fit).observe(canvas);
fit();

const ease = (p) => p * p * (3 - 2 * p);

function drawScene(t) {
  const W = canvas.width, H = canvas.height;
  const u = Math.min(W, H) / 100; // unit for sizes
  ctx.clearRect(0, 0, W, H);
  const ph = phaseAt(t);
  const lbAlpha = t < 9 ? 0 : Math.min(1, (t - 9) / 0.5);
  const downVisible = t >= 20;

  const P = {
    client: (i) => [CLIENT_X * W, clientY(i) * H],
    lb: () => [LB_X * W, 0.45 * H],
    server: (i) => [SERVER_X * W, serverY(i) * H],
  };

  // connection lines
  ctx.strokeStyle = LINE;
  ctx.lineWidth = Math.max(1, u * 0.18);
  ctx.setLineDash([]);
  for (const c of ph.clients) {
    const [cx, cy] = P.client(c);
    if (ph.via === "lb" && lbAlpha > 0) {
      const [lx, ly] = P.lb();
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(lx, ly); ctx.stroke();
    } else {
      const [sx, sy] = P.server(ph.servers[0]);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(sx, sy); ctx.stroke();
    }
  }
  if (ph.via === "lb" && lbAlpha > 0) {
    const [lx, ly] = P.lb();
    for (const s of ph.servers) {
      const [sx, sy] = P.server(s);
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(sx, sy); ctx.stroke();
    }
  }

  // clients
  for (let i = 0; i < CLIENTS; i++) {
    const [x, y] = P.client(i);
    const active = ph.clients.includes(i);
    ctx.beginPath();
    ctx.arc(x, y, u * 1.5, 0, Math.PI * 2);
    if (active) { ctx.fillStyle = INK; ctx.fill(); }
    else { ctx.strokeStyle = MUTED; ctx.lineWidth = Math.max(1, u * 0.18); ctx.stroke(); }
  }
  label("clients", CLIENT_X * W, clientY(0) * H - u * 4.5, u);

  // load balancer
  if (lbAlpha > 0) {
    const [x, y] = P.lb();
    ctx.save();
    ctx.globalAlpha = lbAlpha;
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = INK;
    const s = u * 2.4;
    roundRect(-s / 2, -s / 2, s, s, u * 0.5);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = lbAlpha;
    label("load balancer", x, 0.45 * H - u * 4.2, u);
    ctx.restore();
  }

  // servers
  for (let s = 0; s < SERVERS; s++) {
    const inUse = ph.servers.includes(s);
    const isDown = downVisible && s === 1;
    const [x, y] = P.server(s);
    const bw = u * 16, bh = u * 9;
    ctx.save();
    ctx.globalAlpha = inUse ? 1 : 0.35;
    if (isDown) ctx.setLineDash([u * 0.8, u * 0.6]);
    ctx.strokeStyle = isDown ? MUTED : INK;
    ctx.lineWidth = Math.max(1, u * 0.22);
    ctx.fillStyle = "rgba(255,253,249,0.65)";
    roundRect(x - bw / 2, y - bh / 2, bw, bh, u * 1.2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    // load meter
    if (inUse && !isDown) {
      const inflight = requests.filter((r) => r.phase === ph && r.server === s && r.arriveServer <= t && t < r.endService).length;
      const cap = 5;
      const frac = Math.min(1, inflight / cap);
      ctx.fillStyle = frac >= 0.8 ? ALERT : ACCENT;
      const mw = bw - u * 2, mh = u * 1.1;
      roundRect(x - mw / 2, y + bh / 2 - mh - u, mw * frac, mh, mh / 2);
      ctx.fill();
    }
    ctx.restore();
    label(isDown ? "server 2 · down" : `server ${s + 1}`, x, y - bh / 2 - u * 1.6, u, isDown ? ALERT : MUTED);
  }

  // requests in flight
  const active = requests.filter((r) => r.phase === ph && r.spawn <= t && t < r.endService + 0.35);
  // queue slots per server among waiting requests
  const waiting = {};
  for (const r of active) {
    if (!r.dropped && r.arriveServer <= t && t < r.startService) (waiting[r.server] = waiting[r.server] || []).push(r);
  }
  for (const s in waiting) waiting[s].sort((a, b) => a.arriveServer - b.arriveServer);

  for (const r of active) {
    let x, y, alpha = 1, color = ACCENT;
    const [cx, cy] = P.client(r.client);
    const [sx, sy] = P.server(r.server);
    if (t < r.arriveServer) {
      if (r.via === "lb") {
        const [lx, ly] = P.lb();
        const leg1End = r.spawn + 0.45;
        if (t < leg1End) { const p = ease((t - r.spawn) / 0.45); x = cx + (lx - cx) * p; y = cy + (ly - cy) * p; }
        else { const p = ease((t - leg1End) / 0.45); x = lx + (sx - lx) * p; y = ly + (sy - ly) * p; }
      } else {
        const p = ease((t - r.spawn) / 0.7);
        x = cx + (sx - cx) * p; y = cy + (sy - cy) * p;
      }
    } else if (r.dropped) {
      const p = Math.min(1, (t - r.arriveServer) / 0.6);
      x = sx - u * 9; y = sy + p * u * 12;
      alpha = 1 - p; color = ALERT;
    } else if (t < r.startService) {
      const slot = waiting[r.server].indexOf(r);
      x = sx - u * (9 + slot * 3.2); y = sy;
      color = phaseAt(t).dropAfter !== Infinity ? ALERT : ACCENT;
    } else if (t < r.endService) {
      x = sx - u * 4; y = sy + Math.sin(t * 6 + r.spawn * 10) * u * 0.8;
    } else {
      const p = (t - r.endService) / 0.35;
      x = sx - u * 4 + p * u * 3; y = sy;
      alpha = 1 - p;
    }
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, u * 1.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  if (firstFrame) { firstFrame = false; revealScene(); }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function label(text, x, y, u, color = MUTED) {
  ctx.fillStyle = color;
  ctx.font = `600 ${Math.max(10, u * 2.1)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(text, x, y);
}

// ---- wire up ------------------------------------------------------------------
player = new TimelinePlayer({ steps, duration, onFrame: drawScene });
wireThemeToggle();
if (!matchMedia("(prefers-reduced-motion: reduce)").matches) player.play();
