// JavaScript port of firmware/harvey_pocket/softbody.cpp (the Harvey Pocket's current physics), for the drain page.
// Same rules, constants and units (px of the device's 480 px design, seconds). Three differences, all for the web:
// - the glass is a rectangle of any size, with optional rounded corners (cornerRadius), not the round 480 px plate;
// - gravity is either the device's tilt (gravityX, gravityY in g, the firmware's level zone and gain), or, for the
//   drain page, a pull with an origin: each point is pulled toward drainX, drainY as hard as the same tilt would pull;
// - any number of blobs (each takes its own wander path), and no shake input (the device's held shaking is gone too).
const STEP = 1 / 240, TAU = Math.PI * 2, POINT_RADIUS = 1.5, WALL_GAP = 1;
const RESTING_SPEED = 20, PRESSURE = 3000, PRESSURE_CAP = 4, GRAVITY_DEAD_ZONE = .2, DEAD_ZONE_GAIN = 1.5;
const REBOUND_EASE = .06, PEEL = 10, CONTACT_LINGER = .25, BOUNCE_MIN = 60, MOVE_DRAIN = .55, SETTLE_AFTER = .4, SETTLE_DAMPING = 12;
const SKIN_STIFFNESS = 1500, BEND = 1200, SKIN_VISCOSITY = 25, MAX_PUSH = 1.5, STRETCH = .28;
// The device's orbit is 140 px on a 240 px plate radius; here it's the same share of each half of the page.
const WANDER_PULL = 2, WANDER_DAMPING = 3, WANDER_ORBIT = 140 / 240, WANDER_SWAY = 15, WANDER_SWING = .7, WANDER_FADE = .1;
const WANDER_RATE = [.083, .061, .047, .071, .053, .039, .067, .043];
const STICK = 70, STICK_RANGE = 16, MERGE_OVERLAP = 34, MIN_GAP = 2, AVOID_RANGE = 10, REPEL = 500, REPEL_RANGE = 70, PART_PUSH = 70, BREAK_SPEED = 240, PAIR_ELASTICITY = .05, PAIR_FRICTION = 4;
const BASELINE_PACE = 1.6;
const MERGE_LIMIT = 1.5, INTERACTION_SECONDS = 10, MERGED_GAP = 12, PART_GAP = 30, PART_SPEED = 90, PART_STEER = 6000, PART_LEAD = .25, PART_EASE = .25;
const SQUISH_STIFFNESS = 0, SQUISH_SKIN = .3, SQUISH_DAMPING = .3, SQUISH_GRAVITY = 1.5, SQUISH_BEND = 1;
// Inside this distance of the drain point its pull eases off, so the pile settles on the point instead of jittering over it.
const PULL_SOFT = 24;
export const NODES = 32;
export const DRAINED = { elasticity: .05, friction: 1, drag: 1.2, stiffness: 45, damping: 10 };

const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const cross = (ax, ay, bx, by) => ax * by - ay * bx;
const mx = new Float32Array(NODES), my = new Float32Array(NODES), ux = new Float32Array(NODES), uy = new Float32Array(NODES);

class Body {
  constructor() {
    this.nodes = Array.from({ length: NODES }, () => ({ x: 0, y: 0, vx: 0, vy: 0 }));
    this.rest = Array.from({ length: NODES }, () => ({ x: 0, y: 0 }));
    this.edgeLength = new Float32Array(NODES);
    this.turnCos = 1; this.turnSin = 0; this.lastTouch = -1e9; this.touchingSince = -1;
    this.cx = 0; this.cy = 0; this.reach = 0; this.radius = 0; this.vx = 0; this.vy = 0; this.wallNX = 0; this.wallNY = 0;
  }
  centre() {
    let x = 0, y = 0;
    for (const n of this.nodes) { x += n.x; y += n.y; }
    this.cx = x / NODES; this.cy = y / NODES;
    let r2 = 0;
    for (const n of this.nodes) { const dx = n.x - this.cx, dy = n.y - this.cy, d = dx * dx + dy * dy; if (d > r2) r2 = d; }
    this.reach = Math.sqrt(r2);
  }
  velocity() {   // into this.vx, this.vy
    let x = 0, y = 0;
    for (const n of this.nodes) { x += n.vx; y += n.vy; }
    this.vx = x / NODES; this.vy = y / NODES;
  }
  shift(dvx, dvy) { for (const n of this.nodes) { n.vx += dvx; n.vy += dvy; } }
  area(rest) {
    const p = rest ? this.rest : this.nodes; let a = 0;
    for (let i = 0; i < NODES; i++) { const j = (i + 1) % NODES; a += p[i].x * p[j].y - p[j].x * p[i].y; }
    return a / 2;
  }
  shapeMatch(h, stiffness, blend, stretch) {
    this.centre(); this.velocity();
    const { cx, cy, vx, vy } = this; let A = 0, B = 0, I = 0, L = 0;
    for (let i = 0; i < NODES; i++) {
      const n = this.nodes[i], q = this.rest[i], rx = n.x - cx, ry = n.y - cy;
      A += rx * q.x + ry * q.y; B += cross(rx, ry, q.x, q.y);
      I += rx * rx + ry * ry; L += cross(rx, ry, n.vx - vx, n.vy - vy);
    }
    const m = Math.hypot(A, B), cosA = m > 1e-9 ? A / m : 1, sinA = m > 1e-9 ? -B / m : 0;
    this.turnCos = cosA; this.turnSin = sinA;
    const omega = I > 1e-9 ? L / I : 0, speed = Math.hypot(vx, vy), dx = speed > 1e-3 ? vx / speed : 1, dy = speed > 1e-3 ? vy / speed : 0, squeeze = 1 / (1 + stretch) - 1;
    for (let i = 0; i < NODES; i++) {
      const n = this.nodes[i], q = this.rest[i];
      const ox = q.x * cosA - q.y * sinA, oy = q.x * sinA + q.y * cosA, along = (ox * dx + oy * dy) * stretch, across = (oy * dx - ox * dy) * squeeze;
      const tx = cx + ox + along * dx - across * dy, ty = cy + oy + along * dy + across * dx;
      n.vx += stiffness * (tx - n.x) * h; n.vy += stiffness * (ty - n.y) * h;
      const rx = n.x - cx, ry = n.y - cy, rvx = vx - omega * ry, rvy = vy + omega * rx;
      n.vx += (rvx - n.vx) * blend; n.vy += (rvy - n.vy) * blend;
    }
    this.pressurise(h);
  }
  skin(h, strength, bend = 1) {
    const N = this.nodes;
    for (let i = 0; i < NODES; i++) {
      const a = N[i], b = N[(i + 1) % NODES], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) + 1e-6, f = strength * (d - this.edgeLength[i]) / d * h;
      a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
    }
    const keepIn = BEND * bend * h, share = 1 - Math.exp(-SKIN_VISCOSITY * h);
    for (let i = 0; i < NODES; i++) {
      const p = N[(i + NODES - 1) % NODES], q = N[(i + 1) % NODES], n = N[i];
      mx[i] = (p.x + q.x) / 2 - n.x; my[i] = (p.y + q.y) / 2 - n.y; ux[i] = (p.vx + q.vx) / 2 - n.vx; uy[i] = (p.vy + q.vy) / 2 - n.vy;
    }
    for (let i = 0; i < NODES; i++) { N[i].vx += mx[i] * keepIn + ux[i] * share; N[i].vy += my[i] * keepIn + uy[i] * share; }
  }
  pressurise(h) {
    const restArea = this.area(true), current = this.area(false), sign = restArea < 0 ? -1 : 1;
    const denom = Math.max(current * sign, 1e-6), ratio = clamp(Math.abs(restArea) / denom, 0, PRESSURE_CAP), p = PRESSURE * (ratio - 1) * .5 * h;
    if (p <= 0) return;
    const N = this.nodes;
    for (let i = 0; i < NODES; i++) {
      const a = N[i], b = N[(i + 1) % NODES], nx = (b.y - a.y) * sign, ny = -(b.x - a.x) * sign;
      a.vx += nx * p; a.vy += ny * p; b.vx += nx * p; b.vy += ny * p;
    }
  }
}

function permutations(n) {
  const out = [], a = [...Array(n).keys()];
  const go = k => { if (k === n) { out.push(a.slice()); return; } for (let i = k; i < n; i++) { [a[k], a[i]] = [a[i], a[k]]; go(k + 1); [a[k], a[i]] = [a[i], a[k]]; } };
  go(0); return out;
}

export class SoftBodyWorld {
  constructor({ width = 768, height = 480, count = 3, radius = 75, seed = 1, cornerRadius = 0 } = {}) {
    this.width = width; this.height = height; this.cornerRadius = cornerRadius; this.count = Math.min(count, 7); this.baseRadius = radius;
    this.stiffness = 260; this.damping = 5; this.gravity = 1100; this.maxSpeed = 700; this.drag = .25; this.elasticity = .55; this.friction = .2;
    this.time = 0; this.accumulator = 0; this.drain = 0; this.squish = 0;
    // The drain's pull, in g beyond the device's level zone (already gained, like the firmware's k): 0 is level, 0.6 a
    // full 0.6 g tilt. drainX, drainY: where it pulls to.
    this.pull = 0; this.drainX = width / 2; this.drainY = height / 2; this.gravityX = 0; this.gravityY = 0;
    this.orders = permutations(this.count); this.pathsChosen = -1e9;
    this.init(seed);
  }
  resize(width, height) {   // keeps the blobs, clamped inside the new page
    const sx = width / this.width, sy = height / this.height;
    this.width = width; this.height = height;
    for (const b of this.bodies) { b.centre(); const nx = clamp(b.cx * sx, b.reach + 4, Math.max(b.reach + 4, width - b.reach - 4)), ny = clamp(b.cy * sy, b.reach + 4, Math.max(b.reach + 4, height - b.reach - 4)); for (const n of b.nodes) { n.x += nx - b.cx; n.y += ny - b.cy; } b.centre(); }
  }
  random() { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }
  init(seed) {
    this.seed = seed >>> 0; const n = this.count, W = this.width, H = this.height;
    this.bodies = []; this.path = [...Array(n).keys()];
    this.contacts = Array.from({ length: n }, () => Array.from({ length: n + 1 }, () => ({ approach: 0, start: 0, last: 0, toppedUp: false, live: false, easing: 0, easeRate: 0 })));
    this.live = []; this.mergedFor = new Float32Array(n * n); this.parting = new Float32Array(n * n);
    for (let k = 0; k < n; k++) {
      const r = this.baseRadius * (.9 + this.random() * .2); let x = W / 2, y = H / 2, room = -1e9;
      for (let attempt = 0; attempt < 300; attempt++) {
        const px = r + 4 + this.random() * (W - 2 * r - 8), py = r + 4 + this.random() * (H - 2 * r - 8);
        let gap = Math.min(px, W - px, py, H - py) - r;
        for (let j = 0; j < k; j++) { const g = Math.hypot(this.bodies[j].cx - px, this.bodies[j].cy - py) - this.bodies[j].reach - r; if (g < gap) gap = g; }
        if (gap > room) { room = gap; x = px; y = py; }
        if (room > 40) break;
      }
      const b = new Body(); b.radius = r;
      const p2 = this.random() * TAU, p3 = this.random() * TAU;
      for (let i = 0; i < NODES; i++) {
        const a = i * TAU / NODES, s = r * (1 + .02 * Math.cos(2 * a + p2) + .01 * Math.cos(3 * a + p3));
        b.rest[i].x = Math.cos(a) * s; b.rest[i].y = Math.sin(a) * s;
        Object.assign(b.nodes[i], { x: x + b.rest[i].x, y: y + b.rest[i].y, vx: 0, vy: 0 });
      }
      for (let i = 0; i < NODES; i++) { const p = b.rest[i], q = b.rest[(i + 1) % NODES]; b.edgeLength[i] = Math.hypot(q.x - p.x, q.y - p.y); }
      b.centre(); this.bodies.push(b);
    }
  }
  touch(a, b) {
    const n = this.count, lo = b < 0 || a < b ? a : b, hi = b < 0 ? n : a < b ? b : a, c = this.contacts[lo][hi];
    if (c.live) { c.last = this.time; return; }
    Object.assign(c, { approach: 0, start: this.time, last: this.time, toppedUp: false, live: true, easing: 0, easeRate: 0 });
    this.live.push([lo, hi]);
  }
  wanderSpot(path) {
    const n = this.count, t = this.time;
    const at = path * TAU / n + WANDER_SWING * Math.sin(WANDER_RATE[path] * t + path * 1.7), sway = WANDER_SWAY * Math.sin(t * .17 + path * 2.1);
    return [this.width / 2 + Math.cos(at) * (this.width / 2 * WANDER_ORBIT + sway), this.height / 2 + Math.sin(at) * (this.height / 2 * WANDER_ORBIT + sway)];
  }
  choosePaths() {
    const spots = this.path.map((_, p) => this.wanderSpot(p)); let best = Infinity; this.pathsChosen = this.time;
    for (const order of this.orders) {
      let cost = 0, current = true;
      for (let i = 0; i < this.count; i++) { const dx = spots[order[i]][0] - this.bodies[i].cx, dy = spots[order[i]][1] - this.bodies[i].cy; cost += dx * dx + dy * dy; current = current && order[i] === this.path[i]; }
      if (current) cost *= .8;
      if (cost < best) { best = cost; this.path = order.slice(); }
    }
  }
  cohere(merge, tilted, h) {
    const n = this.count, squish = this.squish, apart = 1 - squish, sink = MERGE_OVERLAP * merge - MIN_GAP * (1 - merge) * apart, drain = 1 - merge, pace = BASELINE_PACE + (1 - BASELINE_PACE) * drain;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = this.bodies[i], b = this.bodies[j], dx = b.cx - a.cx, dy = b.cy - a.cy, d = Math.hypot(dx, dy) + 1e-6, gap = d - a.radius - b.radius, pair = i * n + j;
      if (squish > 0) { this.mergedFor[pair] = this.parting[pair] = 0; }
      if (this.parting[pair] > 0) {
        if (gap > PART_GAP) { this.parting[pair] = this.mergedFor[pair] = 0; }
        else {
          const nx = dx / d, ny = dy / d; a.velocity(); b.velocity();
          const missing = PART_SPEED - ((b.vx - a.vx) * nx + (b.vy - a.vy) * ny), steer = PART_STEER * (.2 + .8 * tilted) * clamp(this.parting[pair] / PART_EASE, .05, 1) * h;
          if (missing > 0) { const turn = Math.min(missing, steer) / 2; a.shift(-nx * turn, -ny * turn); b.shift(nx * turn, ny * turn); }
          this.parting[pair] += h / pace;
          continue;
        }
      }
      if (gap < MERGED_GAP && gap < sink + MERGED_GAP * merge) { this.mergedFor[pair] += h / pace; if (this.mergedFor[pair] > Math.max(MERGE_LIMIT / (1 + INTERACTION_SECONDS * drain) - PART_LEAD * (2 - tilted), .02)) this.parting[pair] = 1e-4; }
      else this.mergedFor[pair] = 0;
      if (gap > STICK_RANGE && gap > REPEL_RANGE) continue;
      const nx = dx / d, ny = dy / d; a.velocity(); b.velocity();
      if (gap < -sink) { const push = PART_PUSH * (-gap - sink) * h; a.shift(-nx * push, -ny * push); b.shift(nx * push, ny * push); continue; }
      if (gap < REPEL_RANGE) { const near = 1 - Math.max(gap, 0) / REPEL_RANGE, push = REPEL * drain * drain * apart * near * near * h; a.shift(-nx * push, -ny * push); b.shift(nx * push, ny * push); }
      if (gap > STICK_RANGE) continue;
      const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (gap < AVOID_RANGE && closing > 0) { const take = closing * drain * apart / 2; a.shift(-nx * take, -ny * take); b.shift(nx * take, ny * take); }
      if (merge <= 0 || (b.vx - a.vx) * nx + (b.vy - a.vy) * ny > BREAK_SPEED) continue;
      const pull = STICK * merge * (gap > 0 ? 1 - gap / STICK_RANGE : 1 + gap / Math.max(sink, 1)) * h;
      for (const p of a.nodes) { const f = ((p.x - a.cx) * nx + (p.y - a.cy) * ny) / a.radius; if (f > 0) { p.vx += nx * pull * f * 2; p.vy += ny * pull * f * 2; } }
      for (const p of b.nodes) { const f = -((p.x - b.cx) * nx + (p.y - b.cy) * ny) / b.radius; if (f > 0) { p.vx -= nx * pull * f * 2; p.vy -= ny * pull * f * 2; } }
    }
  }
  restitution(wallE, pairE, h) {
    const n = this.count;
    for (let k = 0; k < this.live.length;) {
      const [lo, hi] = this.live[k], c = this.contacts[lo][hi];
      if (this.time - c.last > CONTACT_LINGER) { c.live = false; this.live[k] = this.live[this.live.length - 1]; this.live.pop(); continue; }
      k++;
      const A = this.bodies[lo], B = hi === n ? null : this.bodies[hi], e = B ? pairE : wallE; let nx, ny, speed;
      A.velocity();
      if (!B) { nx = A.wallNX; ny = A.wallNY; speed = A.vx * nx + A.vy * ny; }
      else { B.velocity(); const dx = B.cx - A.cx, dy = B.cy - A.cy, d = Math.max(Math.hypot(dx, dy), 1e-6); nx = dx / d; ny = dy / d; speed = (A.vx - B.vx) * nx + (A.vy - B.vy) * ny; }
      if (speed > c.approach) c.approach = speed;
      if (speed < 0 && !c.toppedUp && c.approach >= BOUNCE_MIN) {
        c.toppedUp = true; const extra = e * c.approach + speed;
        if (extra > 0) { c.easing = REBOUND_EASE; c.easeRate = extra / REBOUND_EASE; }
      }
      if (c.easing > 0) {
        c.easing -= h; const missing = e * c.approach + speed; let slice = c.easeRate * h; if (slice > missing) slice = missing;
        if (missing <= 0) c.easing = 0;
        else { if (!B) A.shift(-nx * slice, -ny * slice); else { A.shift(-nx * slice / 2, -ny * slice / 2); B.shift(nx * slice / 2, ny * slice / 2); } continue; }
      }
      const excess = -speed - e * c.approach - PEEL * (this.time - c.start); if (excess <= 0) continue;
      if (!B) { A.shift(nx * excess, ny * excess); continue; }
      A.shift(nx * excess / 2, ny * excess / 2); B.shift(-nx * excess / 2, -ny * excess / 2);
    }
  }
  advance(dt) {
    this.accumulator += clamp(dt, 0, .05) * (BASELINE_PACE + (1 - BASELINE_PACE) * this.drain); let steps = 0;
    while (this.accumulator >= STEP) { this.step(STEP); this.accumulator -= STEP; steps++; }
    return steps;
  }
  step(h) {
    this.time += h;
    const n = this.count, drain = this.drain, squish = this.squish;
    const merge = 1 - drain * (1 - squish), sink = MERGE_OVERLAP * merge - MIN_GAP * (1 - merge) * (1 - squish), movement = 1 - MOVE_DRAIN * drain, e = this.elasticity + (DRAINED.elasticity - this.elasticity) * drain;
    const pairE = PAIR_ELASTICITY, liveFriction = this.friction + (DRAINED.friction - this.friction) * drain, liveDrag = this.drag + (DRAINED.drag - this.drag) * drain, dragKeep = Math.exp(-liveDrag * h);
    // The device's gravity, given an origin: every point is pulled toward the drain as hard as a tilt of the same size pulls.
    const pullK = this.pull * this.gravity * movement * (1 + SQUISH_GRAVITY * squish);
    // The device's tilt: a reading under the level zone counts as level; the gain brings a 0.6 g tilt back to full force.
    const m = Math.hypot(this.gravityX, this.gravityY), tiltK = m > GRAVITY_DEAD_ZONE ? (m - GRAVITY_DEAD_ZONE) * DEAD_ZONE_GAIN / m * this.gravity * movement * (1 + SQUISH_GRAVITY * squish) : 0;
    const tgx = this.gravityX * tiltK, tgy = this.gravityY * tiltK;
    const level = 1 - clamp(Math.max(m - GRAVITY_DEAD_ZONE, this.pull / DEAD_ZONE_GAIN) / WANDER_FADE, 0, 1);
    if (level > 0 && this.time - this.pathsChosen > 1) this.choosePaths();
    for (let i = 0; i < n; i++) {
      const b = this.bodies[i]; let wx = 0, wy = 0;
      if (level > 0) {
        const k = level * movement, [tx, ty] = this.wanderSpot(this.path[i]); b.velocity();
        wx = (WANDER_PULL * (tx - b.cx) - WANDER_DAMPING * b.vx) * k; wy = (WANDER_PULL * (ty - b.cy) - WANDER_DAMPING * b.vy) * k;
      }
      for (const p of b.nodes) {
        let gx = tgx, gy = tgy;
        if (pullK > 0) { const dx = this.drainX - p.x, dy = this.drainY - p.y, s = pullK / Math.max(Math.hypot(dx, dy), PULL_SOFT); gx += dx * s; gy += dy * s; }
        p.vx = (p.vx + (gx + wx) * h) * dragKeep; p.vy = (p.vy + (gy + wy) * h) * dragKeep;
        p.x += p.vx * h; p.y += p.vy * h;
      }
    }
    for (const b of this.bodies) b.centre();
    const r2 = this.bodies.map(b => (b.reach + 2) ** 2);
    const keep = Math.exp(-liveFriction * h), pairKeep = Math.exp(-(liveFriction + PAIR_FRICTION * merge) * h), resolveE = Math.min(e, 1);
    const inset = WALL_GAP + POINT_RADIUS, hw = this.width / 2 - inset, hh = this.height / 2 - inset, cr = Math.max(0, Math.min(this.cornerRadius - inset, hw, hh)), hit = {}, other = {};
    // Signed distance to the glass (a rounded rectangle), positive outside, and its outward normal.
    const wall = (x, y) => {
      const px = x - this.width / 2, py = y - this.height / 2, qx = Math.abs(px) - (hw - cr), qy = Math.abs(py) - (hh - cr);
      if (qx > 0 && qy > 0) { const d = Math.hypot(qx, qy) || 1e-6; return [d - cr, Math.sign(px) * qx / d, Math.sign(py) * qy / d]; }
      return qx > qy ? [qx - cr, Math.sign(px), 0] : [qy - cr, 0, Math.sign(py)];
    };
    for (let i = 0; i < n; i++) {
      const bi = this.bodies[i], near = [];
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const bj = this.bodies[j], dx = bj.cx - bi.cx, dy = bj.cy - bi.cy, reach = bi.reach + bj.reach + POINT_RADIUS * 2;
        if (dx * dx + dy * dy < reach * reach) near.push(j);
      }
      const wallPossible = wall(bi.cx, bi.cy)[0] + bi.reach + 3 > 0;
      if (!near.length && !wallPossible) continue;
      for (const p of bi.nodes) {
        // How far past the glass, with the inward normal; negative depth while inside.
        const [depth, ox, oy] = wall(p.x, p.y);
        Object.assign(hit, { nx: -ox, ny: -oy, depth, body: -1 });
        for (const k of near) if (bodyCollision(p, this.bodies[k], k, r2[k], sink, other) && other.depth > hit.depth) Object.assign(hit, other);
        if (hit.depth <= 0) continue;
        if (hit.body < 0) { resolve(p, hit, resolveE, keep); bi.wallNX = -hit.nx; bi.wallNY = -hit.ny; }
        else { if (hit.depth > MAX_PUSH) hit.depth = MAX_PUSH; resolve(p, hit, pairE, pairKeep); }
        this.touch(i, hit.body);
        bi.lastTouch = this.time; if (bi.touchingSince < 0) bi.touchingSince = this.time;
      }
    }
    this.cohere(merge, 1 - level, h);
    const soft = 1 - squish, liveStiffness = (this.stiffness + (DRAINED.stiffness - this.stiffness) * drain) * (soft + SQUISH_STIFFNESS * squish);
    const liveDamping = (this.damping + (DRAINED.damping - this.damping) * drain) * (soft + SQUISH_DAMPING * squish), skinStrength = SKIN_STIFFNESS * (soft + SQUISH_SKIN * squish);
    const blend = 1 - Math.exp(-liveDamping * h), settle = SETTLE_DAMPING * (soft + SQUISH_DAMPING * squish), restingBlend = 1 - Math.exp(-Math.max(liveDamping, settle) * h);
    for (const b of this.bodies) {
      if (this.time - b.lastTouch > CONTACT_LINGER) b.touchingSince = -1;
      const resting = b.touchingSince >= 0 && this.time - b.touchingSince > SETTLE_AFTER;
      b.velocity();
      // firmness (default 1) softens one body on its own: the signal page's grabbed blob, stretched like dough.
      const firm = b.firmness ?? 1;
      b.shapeMatch(h, liveStiffness * firm, resting ? restingBlend : blend, STRETCH * clamp(Math.hypot(b.vx, b.vy) / this.maxSpeed, 0, 1));
      b.skin(h, skinStrength * (.4 + .6 * firm), 1 - (1 - SQUISH_BEND) * squish);
    }
    this.restitution(e, pairE, h);
    const top = this.maxSpeed * movement;
    for (const b of this.bodies) { b.velocity(); const s = Math.hypot(b.vx, b.vy); if (s > top) b.shift(b.vx * (top / s - 1), b.vy * (top / s - 1)); }
  }
}

// atan2 to about 0.3°, in 0..2π.
function fastAngle(y, x) {
  const ax = Math.abs(x), ay = Math.abs(y), lo = Math.min(ax, ay), hi = Math.max(ax, ay), t = hi > 1e-9 ? lo / hi : 0, z = t * t;
  let a = t * (.99538 + z * (-.28869 + z * .07917));
  if (ay > ax) a = 1.5707963 - a;
  if (x < 0) a = 3.1415927 - a;
  return y < 0 ? TAU - a : a;
}
function bodyCollision(p, body, index, r2, sink, out) {
  const ox = p.x - body.cx, oy = p.y - body.cy, d2 = ox * ox + oy * oy;
  if (d2 > r2) return false;
  let d = Math.sqrt(d2), dx = 1, dy = 0;
  if (d > 1e-6) { dx = ox / d; dy = oy / d; } else d = 1e-6;
  let bestS = -1, bestT = 0, best = -1; const N = body.nodes;
  const tryEdge = i => {
    const j = i + 1 === NODES ? 0 : i + 1;
    const ax = N[i].x - body.cx, ay = N[i].y - body.cy, bx = N[j].x - body.cx, by = N[j].y - body.cy;
    const sideA = cross(dx, dy, ax, ay), sideB = cross(dx, dy, bx, by);
    if ((sideA <= 0) === (sideB <= 0)) return;
    const t = sideA / (sideA - sideB), s = (ax + (bx - ax) * t) * dx + (ay + (by - ay) * t) * dy;
    if (s > 0 && s > bestS) { best = i; bestS = s; bestT = t; }
  };
  const rx = dx * body.turnCos + dy * body.turnSin, ry = dy * body.turnCos - dx * body.turnSin;
  const edge = Math.floor(fastAngle(ry, rx) * (NODES / TAU));
  for (let k = -1; k <= 1; k++) tryEdge((edge + k + 2 * NODES) % NODES);
  if (best < 0) for (let i = 0; i < NODES; i++) tryEdge(i);
  if (best < 0 || bestS - d <= sink) return false;
  out.nx = dx; out.ny = dy; out.depth = bestS - d - sink; out.body = index; out.a = N[best]; out.b = N[best + 1 === NODES ? 0 : best + 1]; out.t = bestT;
  return true;
}
function resolve(p, c, elasticity, keep) {
  const nx = c.nx, ny = c.ny;
  if (c.body < 0) {
    p.x += nx * c.depth; p.y += ny * c.depth;
    const vn = p.vx * nx + p.vy * ny; if (vn >= 0) return;
    p.vx = (p.vx - nx * vn) * keep; p.vy = (p.vy - ny * vn) * keep; return;
  }
  const a = c.a, b = c.b, wa = 1 - c.t, wb = c.t, w = 1 + wa * wa + wb * wb, move = c.depth / w;
  p.x += nx * move; p.y += ny * move; a.x -= nx * move * wa; a.y -= ny * move * wa; b.x -= nx * move * wb; b.y -= ny * move * wb;
  const rvx = p.vx - (a.vx * wa + b.vx * wb), rvy = p.vy - (a.vy * wa + b.vy * wb), vn = rvx * nx + rvy * ny;
  if (vn >= 0) return; if (-vn < RESTING_SPEED) elasticity = 0;
  const tx = rvx - nx * vn, ty = rvy - ny * vn;
  const ddx = (tx * keep - nx * vn * elasticity - rvx) / w, ddy = (ty * keep - ny * vn * elasticity - rvy) / w;
  p.vx += ddx; p.vy += ddy; a.vx -= ddx * wa; a.vy -= ddy * wa; b.vx -= ddx * wb; b.vy -= ddy * wb;
}
