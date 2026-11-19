// Line-by-line JavaScript port of firmware/harvey_pocket/softbody.cpp and softbody.h, as flashed to the Harvey Pocket
// (free wander paths, baseline wobble, merge limit only while tilted). Same constants, same order of operations, in
// px and seconds on the 480 px round plate. The comments that explain each rule are in the C++; keep the two in step.

export const BODY_COUNT = 3, NODES = 32, BODY_RADIUS = 75, CENTER = 240, DISPLAY_RADIUS = 240;
export const DRAINED_ELASTICITY = .05, DRAINED_FRICTION = 1, DRAINED_DRAG = 1.2, DRAINED_STIFFNESS = 45, DRAINED_DAMPING = 10;

const STEP = 1 / 240, TAU = 6.2831853, POINT_RADIUS = 1.5, WALL_GAP = 1;
const RESTING_SPEED = 20, PRESSURE = 3000, PRESSURE_CAP = 4, GRAVITY_DEAD_ZONE = .2, DEAD_ZONE_GAIN = 1.5;
const REBOUND_EASE = .06, PEEL = 10, CONTACT_LINGER = .25, BOUNCE_MIN = 60, MOVE_DRAIN = .55, SETTLE_AFTER = .4, SETTLE_DAMPING = 12;
const SKIN_STIFFNESS = 1500, BEND = 1200, SKIN_VISCOSITY = 25, MAX_PUSH = 1.5, STRETCH = .28;
const WANDER_PULL = 2, WANDER_DAMPING = 3, WANDER_ORBIT = 140, WANDER_SWAY = 15, WANDER_SWING = .7, WANDER_FADE = .1;
const WANDER_RATE = [.083, .061, .047];
const STICK = 70, STICK_RANGE = 16, MERGE_OVERLAP = 34, MIN_GAP = 2, AVOID_RANGE = 10, REPEL = 500, REPEL_RANGE = 70, PART_PUSH = 70, BREAK_SPEED = 240, PAIR_ELASTICITY = .05, PAIR_FRICTION = 4;
export const BASELINE_PACE = 1.4;
const SHAKE_FORCE = 2600, SHAKE_MAX = 7000, SHAKE_SQUASH = .7, STIR_PACE = .5, STIR_SPEED = .8;
const MERGE_LIMIT = 1.5, INTERACTION_SECONDS = 10, MERGED_GAP = 12, PART_GAP = 30, PART_FORCE = 2600, PART_GROWTH = 9000, PART_FORCE_MAX = 12000, PART_LEAD = .25, PART_EASE = .1;
const NEAR_MAX = 16;
const clampf = (x, a, b) => x < a ? a : x > b ? b : x;
const cross = (ax, ay, bx, by) => ax * by - ay * bx;

class Body {
  constructor() {
    this.baseRadius = 0; this.radius = 0; this.cx = 0; this.cy = 0; this.reach = 0; this.lastTouch = -1e9; this.touchingSince = -1;
    this.edgeLength = new Float64Array(NODES); this.turnCos = 1; this.turnSin = 0;
    this.nodes = Array.from({ length: NODES }, () => ({ x: 0, y: 0, vx: 0, vy: 0 }));
    this.rest = Array.from({ length: NODES }, () => ({ x: 0, y: 0 }));
    this.mvx = 0; this.mvy = 0;   // velocity(): the mean node velocity
  }
  centre() {
    let x = 0, y = 0;
    for (const n of this.nodes) { x += n.x; y += n.y; }
    this.cx = x / NODES; this.cy = y / NODES;
    let r2 = 0;
    for (const n of this.nodes) { const dx = n.x - this.cx, dy = n.y - this.cy, d = dx * dx + dy * dy; if (d > r2) r2 = d; }
    this.reach = Math.sqrt(r2);
  }
  velocity() {
    let x = 0, y = 0;
    for (const n of this.nodes) { x += n.vx; y += n.vy; }
    this.mvx = x / NODES; this.mvy = y / NODES;
  }
  shift(dvx, dvy) { for (const n of this.nodes) { n.vx += dvx; n.vy += dvy; } }
  shapeMatch(h, stiffness, blend, stretch) {
    this.centre(); this.velocity();
    const vx = this.mvx, vy = this.mvy, cx = this.cx, cy = this.cy;
    let A = 0, B = 0, I = 0, L = 0;
    for (let i = 0; i < NODES; i++) {
      const n = this.nodes[i], q = this.rest[i], rx = n.x - cx, ry = n.y - cy;
      A += rx * q.x + ry * q.y; B += cross(rx, ry, q.x, q.y);
      I += rx * rx + ry * ry; L += cross(rx, ry, n.vx - vx, n.vy - vy);
    }
    const m = Math.sqrt(A * A + B * B), cosA = m > 1e-9 ? A / m : 1, sinA = m > 1e-9 ? -B / m : 0;
    this.turnCos = cosA; this.turnSin = sinA;
    const omega = I > 1e-9 ? L / I : 0, speed = Math.sqrt(vx * vx + vy * vy), ux = speed > 1e-3 ? vx / speed : 1, uy = speed > 1e-3 ? vy / speed : 0, squeeze = 1 / (1 + stretch) - 1;
    for (let i = 0; i < NODES; i++) {
      const n = this.nodes[i], q = this.rest[i];
      const ox = q.x * cosA - q.y * sinA, oy = q.x * sinA + q.y * cosA;
      let along = ox * ux + oy * uy, across = oy * ux - ox * uy;
      along *= stretch; across *= squeeze;
      const tx = cx + ox + along * ux - across * uy, ty = cy + oy + along * uy + across * ux;
      n.vx += stiffness * (tx - n.x) * h; n.vy += stiffness * (ty - n.y) * h;
      const rx = n.x - cx, ry = n.y - cy, rvx = vx - omega * ry, rvy = vy + omega * rx;
      n.vx += (rvx - n.vx) * blend; n.vy += (rvy - n.vy) * blend;
    }
    this.pressurise(h);
  }
  skin(h, strength) {
    const nodes = this.nodes;
    for (let i = 0; i < NODES; i++) {
      const a = nodes[i], b = nodes[(i + 1) % NODES], dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) + 1e-6, f = strength * (d - this.edgeLength[i]) / d * h;
      a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
    }
    const keepIn = BEND * h, share = 1 - Math.exp(-SKIN_VISCOSITY * h);
    for (let i = 0; i < NODES; i++) {
      const p = nodes[(i + NODES - 1) % NODES], q = nodes[(i + 1) % NODES], n = nodes[i];
      MX[i] = (p.x + q.x) / 2 - n.x; MY[i] = (p.y + q.y) / 2 - n.y; UX[i] = (p.vx + q.vx) / 2 - n.vx; UY[i] = (p.vy + q.vy) / 2 - n.vy;
    }
    for (let i = 0; i < NODES; i++) { nodes[i].vx += MX[i] * keepIn + UX[i] * share; nodes[i].vy += MY[i] * keepIn + UY[i] * share; }
  }
  pressurise(h) {
    const restArea = polygonArea(this, true), current = polygonArea(this, false), sign = restArea < 0 ? -1 : 1;
    let denom = current * sign; if (denom < 1e-6) denom = 1e-6;
    const ratio = clampf(Math.abs(restArea) / denom, 0, PRESSURE_CAP), p = PRESSURE * (ratio - 1) * .5 * h;
    if (p <= 0) return;
    for (let i = 0; i < NODES; i++) {
      const a = this.nodes[i], b = this.nodes[(i + 1) % NODES], nx = (b.y - a.y) * sign, ny = -(b.x - a.x) * sign;
      a.vx += nx * p; a.vy += ny * p; b.vx += nx * p; b.vy += ny * p;
    }
  }
}
const MX = new Float64Array(NODES), MY = new Float64Array(NODES), UX = new Float64Array(NODES), UY = new Float64Array(NODES);

function polygonArea(b, rest) {
  const pts = rest ? b.rest : b.nodes; let a = 0;
  for (let i = 0; i < NODES; i++) { const j = (i + 1) % NODES; a += pts[i].x * pts[j].y - pts[j].x * pts[i].y; }
  return a / 2;
}

// atan2 to about 0.3°, in 0..2π: as the C++, so the same edge is chosen.
function fastAngle(y, x) {
  const ax = Math.abs(x), ay = Math.abs(y), lo = ax < ay ? ax : ay, hi = ax < ay ? ay : ax, t = hi > 1e-9 ? lo / hi : 0, z = t * t;
  let a = t * (.99538 + z * (-.28869 + z * .07917));
  if (ay > ax) a = 1.5707963 - a;
  if (x < 0) a = 3.1415927 - a;
  return y < 0 ? TAU - a : a;
}
function bodyCollision(p, body, index, r2, sink) {
  const ox = p.x - body.cx, oy = p.y - body.cy, d2 = ox * ox + oy * oy;
  if (d2 > r2) return null;
  let d = Math.sqrt(d2), ux = 1, uy = 0;
  if (d > 1e-6) { ux = ox / d; uy = oy / d; } else d = 1e-6;
  let bestS = -1, bestT = 0, best = -1;
  const tryEdge = i => {
    const j = i + 1 === NODES ? 0 : i + 1;
    const ax = body.nodes[i].x - body.cx, ay = body.nodes[i].y - body.cy, bx = body.nodes[j].x - body.cx, by = body.nodes[j].y - body.cy;
    const sideA = cross(ux, uy, ax, ay), sideB = cross(ux, uy, bx, by);
    if ((sideA <= 0) === (sideB <= 0)) return;
    const t = sideA / (sideA - sideB), s = (ax + (bx - ax) * t) * ux + (ay + (by - ay) * t) * uy;
    if (s > 0 && s > bestS) { best = i; bestS = s; bestT = t; }
  };
  const rx = ux * body.turnCos + uy * body.turnSin, ry = uy * body.turnCos - ux * body.turnSin;
  const edge = Math.floor(fastAngle(ry, rx) * (NODES / TAU));
  for (let k = -1; k <= 1; k++) tryEdge((edge + k + 2 * NODES) % NODES);
  if (best < 0) for (let i = 0; i < NODES; i++) tryEdge(i);
  if (best < 0 || bestS - d <= sink) return null;
  return { nx: ux, ny: uy, depth: bestS - d - sink, body: index, a: body.nodes[best], b: body.nodes[best + 1 === NODES ? 0 : best + 1], t: bestT };
}
function resolve(p, c, elasticity, keep) {
  const nx = c.nx, ny = c.ny;
  if (c.body < 0) {
    p.x += nx * c.depth; p.y += ny * c.depth;
    const vn = p.vx * nx + p.vy * ny; if (vn >= 0) return;
    const tx = p.vx - nx * vn, ty = p.vy - ny * vn;
    p.vx = tx * keep; p.vy = ty * keep; return;
  }
  const a = c.a, b = c.b, wa = 1 - c.t, wb = c.t, w = 1 + wa * wa + wb * wb, move = c.depth / w;
  p.x += nx * move; p.y += ny * move; a.x -= nx * move * wa; a.y -= ny * move * wa; b.x -= nx * move * wb; b.y -= ny * move * wb;
  const rvx = p.vx - (a.vx * wa + b.vx * wb), rvy = p.vy - (a.vy * wa + b.vy * wb), vn = rvx * nx + rvy * ny;
  if (vn >= 0) return; if (-vn < RESTING_SPEED) elasticity = 0;
  const tx = rvx - nx * vn, ty = rvy - ny * vn;
  const dx = (tx * keep - nx * vn * elasticity - rvx) / w, dy = (ty * keep - ny * vn * elasticity - rvy) / w;
  p.vx += dx; p.vy += dy; a.vx -= dx * wa; a.vy -= dy * wa; b.vx -= dx * wb; b.vy -= dy * wb;
}

const ORDERS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

export class SoftBodyWorld {
  constructor() {
    this.bodies = Array.from({ length: BODY_COUNT }, () => new Body());
    this.time = 0; this.accumulator = 0; this.drain = 0; this.gravityX = 0; this.gravityY = 0;
    this.stiffness = 260; this.damping = 5; this.gravity = 1100; this.maxSpeed = 700; this.drag = .25; this.push = 500; this.pushRadius = 220; this.elasticity = .55; this.friction = .2;
    this.shakeX = 0; this.shakeY = 0; this.stir = 0;
    this.seed_ = 1; this.liveContacts_ = []; this.contacts_ = [];
    this.mergedFor_ = new Float64Array(BODY_COUNT); this.parting_ = new Float64Array(BODY_COUNT);
    this.path_ = [0, 1, 2]; this.pathsChosen_ = -1e9;
  }
  // The C++ LCG; uint32 → float rounds to 24 bits before the division, so Math.fround keeps the same sequence.
  random() { this.seed_ = (Math.imul(this.seed_, 1664525) + 1013904223) >>> 0; return Math.fround(this.seed_) / 4294967296; }
  init(seed) {
    this.seed_ = seed >>> 0; this.liveContacts_ = [];
    this.contacts_ = Array.from({ length: BODY_COUNT }, () => Array.from({ length: BODY_COUNT + 1 }, () => ({ approach: 0, start: 0, last: 0, toppedUp: false, live: false, easing: 0, easeRate: 0 })));
    for (let k = 0; k < BODY_COUNT; k++) {
      const r = BODY_RADIUS * (.9 + this.random() * .2); let x = CENTER, y = CENTER, room = -1e9;
      for (let attempt = 0; attempt < 300; attempt++) {
        const a = this.random() * TAU, d = Math.sqrt(this.random()) * (DISPLAY_RADIUS - r - 4), px = CENTER + Math.cos(a) * d, py = CENTER + Math.sin(a) * d;
        let gap = DISPLAY_RADIUS - r - d;
        for (let j = 0; j < k; j++) { const g = Math.hypot(this.bodies[j].cx - px, this.bodies[j].cy - py) - this.bodies[j].reach - r; if (g < gap) gap = g; }
        if (gap > room) { room = gap; x = px; y = py; }
        if (room > 8) break;
      }
      const b = this.bodies[k]; b.baseRadius = b.radius = r; b.lastTouch = -1e9; b.touchingSince = -1;
      const p2 = this.random() * TAU, p3 = this.random() * TAU;
      for (let i = 0; i < NODES; i++) {
        const a = i * TAU / NODES, s = r * (1 + .02 * Math.cos(2 * a + p2) + .01 * Math.cos(3 * a + p3));
        b.rest[i].x = Math.cos(a) * s; b.rest[i].y = Math.sin(a) * s;
        Object.assign(b.nodes[i], { x: x + b.rest[i].x, y: y + b.rest[i].y, vx: 0, vy: 0 });
      }
      for (let i = 0; i < NODES; i++) { const p = b.rest[i], q = b.rest[(i + 1) % NODES]; b.edgeLength[i] = Math.hypot(q.x - p.x, q.y - p.y); }
      b.centre();
    }
  }
  touch(a, b) {
    const lo = b < 0 || a < b ? a : b, hi = b < 0 ? BODY_COUNT : a < b ? b : a;
    const c = this.contacts_[lo][hi];
    if (c.live) { c.last = this.time; return; }
    Object.assign(c, { approach: 0, start: this.time, last: this.time, toppedUp: false, live: true, easing: 0, easeRate: 0 });
    this.liveContacts_.push(lo * (BODY_COUNT + 1) + hi);
  }
  wanderSpot(path) {
    const at = path * TAU / BODY_COUNT + WANDER_SWING * Math.sin(WANDER_RATE[path] * this.time + path * 1.7), orbit = WANDER_ORBIT + WANDER_SWAY * Math.sin(this.time * .17 + path * 2.1);
    return [CENTER + Math.cos(at) * orbit, CENTER + Math.sin(at) * orbit];
  }
  choosePaths() {
    const spots = [0, 1, 2].map(p => this.wanderSpot(p)); let best = 1e18; this.pathsChosen_ = this.time;
    for (const order of ORDERS) {
      let cost = 0, current = true;
      for (let i = 0; i < BODY_COUNT; i++) { const dx = spots[order[i]][0] - this.bodies[i].cx, dy = spots[order[i]][1] - this.bodies[i].cy; cost += dx * dx + dy * dy; current = current && order[i] === this.path_[i]; }
      if (current) cost *= .8;
      if (cost < best) { best = cost; for (let i = 0; i < BODY_COUNT; i++) this.path_[i] = order[i]; }
    }
  }
  cohere(merge, tilted, h) {
    const sink = MERGE_OVERLAP * merge - MIN_GAP * (1 - merge), drain = 1 - merge, pace = (BASELINE_PACE + (1 - BASELINE_PACE) * drain) * (1 + STIR_PACE * this.stir);
    for (let i = 0; i < BODY_COUNT; i++) for (let j = i + 1; j < BODY_COUNT; j++) {
      const a = this.bodies[i], b = this.bodies[j], dx = b.cx - a.cx, dy = b.cy - a.cy, d = Math.sqrt(dx * dx + dy * dy) + 1e-6, gap = d - a.radius - b.radius;
      const pair = i + j - 1;
      if (this.parting_[pair] > 0) {
        if (gap > PART_GAP) { this.parting_[pair] = this.mergedFor_[pair] = 0; }
        else {
          const effort = (.2 + .8 * tilted) * (1 - .8 * drain), push = Math.min(PART_FORCE + PART_GROWTH * this.parting_[pair], PART_FORCE_MAX) * effort * clampf(this.parting_[pair] / PART_EASE, .05, 1) * h;
          a.shift(-dx / d * push, -dy / d * push); b.shift(dx / d * push, dy / d * push);
          this.parting_[pair] += h / pace;
          continue;
        }
      }
      if (gap < MERGED_GAP && gap < sink + MERGED_GAP * merge) { this.mergedFor_[pair] += h / pace; if (this.mergedFor_[pair] > Math.max(MERGE_LIMIT / (1 + INTERACTION_SECONDS * drain) - PART_LEAD * (2 - tilted), .02)) this.parting_[pair] = 1e-4; }
      else this.mergedFor_[pair] = 0;
      if (gap > STICK_RANGE && gap > REPEL_RANGE) continue;
      const nx = dx / d, ny = dy / d; a.velocity(); b.velocity(); const avx = a.mvx, avy = a.mvy, bvx = b.mvx, bvy = b.mvy;
      if (gap < -sink) { const push = PART_PUSH * (-gap - sink) * h; a.shift(-nx * push, -ny * push); b.shift(nx * push, ny * push); continue; }
      if (gap < REPEL_RANGE) { const near = 1 - Math.max(gap, 0) / REPEL_RANGE, push = REPEL * drain * drain * near * near * h; a.shift(-nx * push, -ny * push); b.shift(nx * push, ny * push); }
      if (gap > STICK_RANGE) continue;
      const closing = (avx - bvx) * nx + (avy - bvy) * ny;
      if (gap < AVOID_RANGE && closing > 0) { const take = closing * drain / 2; a.shift(-nx * take, -ny * take); b.shift(nx * take, ny * take); }
      if (merge <= 0 || (bvx - avx) * nx + (bvy - avy) * ny > BREAK_SPEED) continue;
      const pull = STICK * merge * (gap > 0 ? 1 - gap / STICK_RANGE : 1 + gap / Math.max(sink, 1)) * h;
      for (const p of a.nodes) { const f = ((p.x - a.cx) * nx + (p.y - a.cy) * ny) / a.radius; if (f > 0) { p.vx += nx * pull * f * 2; p.vy += ny * pull * f * 2; } }
      for (const p of b.nodes) { const f = -((p.x - b.cx) * nx + (p.y - b.cy) * ny) / b.radius; if (f > 0) { p.vx -= nx * pull * f * 2; p.vy -= ny * pull * f * 2; } }
    }
  }
  restitution(wallE, pairE, h) {
    const live = this.liveContacts_;
    for (let k = 0; k < live.length;) {
      const lo = Math.floor(live[k] / (BODY_COUNT + 1)), hi = live[k] % (BODY_COUNT + 1), c = this.contacts_[lo][hi];
      if (this.time - c.last > CONTACT_LINGER) { c.live = false; live[k] = live[live.length - 1]; live.pop(); continue; }
      k++;
      const A = this.bodies[lo], B = hi === BODY_COUNT ? null : this.bodies[hi], e = B ? pairE : wallE;
      A.velocity(); const vax = A.mvx, vay = A.mvy; let nx, ny, speed;
      if (!B) { const dx = A.cx - CENTER, dy = A.cy - CENTER; let d = Math.sqrt(dx * dx + dy * dy); if (d < 1e-6) d = 1e-6; nx = dx / d; ny = dy / d; speed = vax * nx + vay * ny; }
      else { B.velocity(); const dx = B.cx - A.cx, dy = B.cy - A.cy; let d = Math.sqrt(dx * dx + dy * dy); if (d < 1e-6) d = 1e-6; nx = dx / d; ny = dy / d; speed = (vax - B.mvx) * nx + (vay - B.mvy) * ny; }
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
    this.accumulator += clampf(dt, 0, .05) * (BASELINE_PACE + (1 - BASELINE_PACE) * this.drain) * (1 + STIR_PACE * this.stir); let steps = 0;
    while (this.accumulator >= STEP) { this.step(STEP); this.accumulator -= STEP; steps++; }
    return steps;
  }
  step(h) {
    this.time += h;
    const drain = this.drain, stir = this.stir, bodies = this.bodies;
    const merge = 1 - drain, sink = MERGE_OVERLAP * merge - MIN_GAP * (1 - merge), movement = 1 - MOVE_DRAIN * drain * (1 - stir), e = this.elasticity + (DRAINED_ELASTICITY - this.elasticity) * drain;
    const pairE = PAIR_ELASTICITY;
    const liveFriction = this.friction + (DRAINED_FRICTION - this.friction) * drain, liveDrag = this.drag + (DRAINED_DRAG - this.drag) * drain, dragKeep = Math.exp(-liveDrag * h);
    const m = Math.hypot(this.gravityX, this.gravityY); let gx = 0, gy = 0;
    if (m > GRAVITY_DEAD_ZONE) { const k = (m - GRAVITY_DEAD_ZONE) * DEAD_ZONE_GAIN / m * this.gravity * movement; gx = this.gravityX * k; gy = this.gravityY * k; }
    const level = (1 - clampf((m - GRAVITY_DEAD_ZONE) / WANDER_FADE, 0, 1)) * (1 - stir), shake = Math.hypot(this.shakeX, this.shakeY), jolt = Math.min(shake * SHAKE_FORCE, SHAKE_MAX), joltX = shake > 1e-3 ? this.shakeX / shake : 0, joltY = shake > 1e-3 ? this.shakeY / shake : 0;
    if (level > 0 && this.time - this.pathsChosen_ > 1) this.choosePaths();
    for (let i = 0; i < BODY_COUNT; i++) {
      let wx = 0, wy = 0;
      const b = bodies[i];
      if (level > 0) {
        const k = level * movement; b.velocity(); const [tx, ty] = this.wanderSpot(this.path_[i]);
        wx = (WANDER_PULL * (tx - b.cx) - WANDER_DAMPING * b.mvx) * k; wy = (WANDER_PULL * (ty - b.cy) - WANDER_DAMPING * b.mvy) * k;
      }
      for (const n of b.nodes) {
        const push = jolt > 0 ? jolt * (1 + SHAKE_SQUASH * ((n.x - b.cx) * joltX + (n.y - b.cy) * joltY) / b.radius) : 0;
        n.vx = (n.vx + (gx + wx + joltX * push) * h) * dragKeep; n.vy = (n.vy + (gy + wy + joltY * push) * h) * dragKeep;
        n.x += n.vx * h; n.y += n.vy * h;
      }
    }
    for (const b of bodies) b.centre();
    const r2 = bodies.map(b => { const r = b.reach + 2; return r * r; });
    const keep = Math.exp(-liveFriction * h), pairKeep = Math.exp(-(liveFriction + PAIR_FRICTION * merge) * h), resolveE = e < 1 ? e : 1, wallLimit = DISPLAY_RADIUS - WALL_GAP - POINT_RADIUS;
    for (let i = 0; i < BODY_COUNT; i++) {
      const bi = bodies[i], near = [];
      for (let j = 0; j < BODY_COUNT && near.length < NEAR_MAX; j++) {
        if (j === i) continue;
        const dx = bodies[j].cx - bi.cx, dy = bodies[j].cy - bi.cy, reach = bi.reach + bodies[j].reach + POINT_RADIUS * 2;
        if (dx * dx + dy * dy < reach * reach) near.push(j);
      }
      const wx = bi.cx - CENTER, wy = bi.cy - CENTER, wallPossible = Math.sqrt(wx * wx + wy * wy) + bi.reach + 3 > wallLimit;
      if (!near.length && !wallPossible) continue;
      for (const p of bi.nodes) {
        const dx = p.x - CENTER, dy = p.y - CENTER; let d = Math.sqrt(dx * dx + dy * dy); if (d < 1e-6) d = 1e-6;
        let hit = { nx: -dx / d, ny: -dy / d, depth: d - wallLimit, body: -1, a: null, b: null, t: 0 };
        for (const j of near) { const other = bodyCollision(p, bodies[j], j, r2[j], sink); if (other && other.depth > hit.depth) hit = other; }
        if (hit.depth <= 0) continue;
        if (hit.body < 0) resolve(p, hit, resolveE, keep); else { if (hit.depth > MAX_PUSH) hit.depth = MAX_PUSH; resolve(p, hit, pairE, pairKeep); }
        this.touch(i, hit.body);
        bi.lastTouch = this.time; if (bi.touchingSince < 0) bi.touchingSince = this.time;
      }
    }
    this.cohere(merge, 1 - level, h);
    const liveStiffness = this.stiffness + (DRAINED_STIFFNESS - this.stiffness) * drain, liveDamping = this.damping + (DRAINED_DAMPING - this.damping) * drain;
    const blend = 1 - Math.exp(-liveDamping * h), restingBlend = 1 - Math.exp(-(liveDamping > SETTLE_DAMPING ? liveDamping : SETTLE_DAMPING) * h);
    for (const b of bodies) {
      if (this.time - b.lastTouch > CONTACT_LINGER) b.touchingSince = -1;
      const resting = b.touchingSince >= 0 && this.time - b.touchingSince > SETTLE_AFTER;
      b.velocity(); const speed = Math.sqrt(b.mvx * b.mvx + b.mvy * b.mvy);
      b.shapeMatch(h, liveStiffness, resting ? restingBlend : blend, STRETCH * clampf(speed / this.maxSpeed, 0, 1));
      b.skin(h, SKIN_STIFFNESS);
    }
    this.restitution(e, pairE, h);
    const top = this.maxSpeed * movement * (1 + STIR_SPEED * stir);
    for (const b of bodies) { b.velocity(); const s = Math.sqrt(b.mvx * b.mvx + b.mvy * b.mvy); if (s > top) b.shift(b.mvx * (top / s - 1), b.mvy * (top / s - 1)); }
  }
}
