// Line-by-line JavaScript port of the Harvey Pocket firmware's softbody.cpp and softbody.h as they were before the
// LocoRoco vertex physics (versions/pre-locoroco, 2026-11-05): three blobs that splash into droplets on hard hits and
// flow back together. Same constants and order of operations, in px and seconds on the 480 px round plate.

export const BODY_COUNT = 24, BASE_BODIES = 3, NODES = 16, BODY_RADIUS = 75, CENTER = 240, DISPLAY_RADIUS = 240;
export const DRAINED_ELASTICITY = .12, DRAINED_FRICTION = 9, DRAINED_DRAG = .72;

const STEP = 1 / 190, TAU = 6.2831853, POINT_RADIUS = 1.5, WALL_GAP = 1;
const RESTING_SPEED = 20, PRESSURE = 400, PRESSURE_CAP = 4, GRAVITY_DEAD_ZONE = .2, DEAD_ZONE_GAIN = 1.5;
const REBOUND_EASE = .06, PEEL = 10, CONTACT_LINGER = .25, BOUNCE_MIN = 60, MOVE_DRAIN = .6, SETTLE_AFTER = .4, SETTLE_DAMPING = 30;
const SPLIT_SPEED = 90, SPLIT_FULL = 260, SPLIT_COOLDOWN = .4, SPLIT_MIN_RADIUS = 26, DROP_MIN_RADIUS = 12, GHOST_SECONDS = .16, SPLASH_SECONDS = .35, SPLASH_SPEED_GAIN = 1.6;
const MERGE_AGE = 1.2, MERGE_CONTACT = .3, MERGE_SECONDS = .35, MERGE_PULL = 500, HOME_AFTER = 2.5, HOME_PULL = 70, MAX_RADIUS = BODY_RADIUS * 1.12, SIZE_EASE = .06;
const NEAR_MAX = 16;
const clampf = (x, a, b) => x < a ? a : x > b ? b : x;
const cross = (ax, ay, bx, by) => ax * by - ay * bx;

class Body {
  constructor() {
    this.baseRadius = 0; this.radius = 0; this.cx = 0; this.cy = 0; this.reach = 0; this.lastTouch = 0; this.touchingSince = 0;
    this.turnCos = 1; this.turnSin = 0; this.alive = false;
    this.target = 0; this.born = -1e9; this.splitAt = -1e9; this.ghostUntil = -1e9; this.family = 0; this.absorbInto = -1;
    this.nodes = Array.from({ length: NODES }, () => ({ x: 0, y: 0, vx: 0, vy: 0 }));
    this.rest = Array.from({ length: NODES }, () => ({ x: 0, y: 0 }));
    this.mvx = 0; this.mvy = 0;
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
  shapeMatch(h, stiffness, blend) {
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
    const omega = I > 1e-9 ? L / I : 0;
    for (let i = 0; i < NODES; i++) {
      const n = this.nodes[i], q = this.rest[i];
      const tx = cx + q.x * cosA - q.y * sinA, ty = cy + q.x * sinA + q.y * cosA;
      n.vx += stiffness * (tx - n.x) * h; n.vy += stiffness * (ty - n.y) * h;
      const rx = n.x - cx, ry = n.y - cy, rvx = vx - omega * ry, rvy = vy + omega * rx;
      n.vx += (rvx - n.vx) * blend; n.vy += (rvy - n.vy) * blend;
    }
    this.pressurise(h);
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
function polygonArea(b, rest) {
  const pts = rest ? b.rest : b.nodes; let a = 0;
  for (let i = 0; i < NODES; i++) { const j = (i + 1) % NODES; a += pts[i].x * pts[j].y - pts[j].x * pts[i].y; }
  return a / 2;
}
function fastAngle(y, x) {
  const ax = Math.abs(x), ay = Math.abs(y), lo = ax < ay ? ax : ay, hi = ax < ay ? ay : ax, t = hi > 1e-9 ? lo / hi : 0, z = t * t;
  let a = t * (.99538 + z * (-.28869 + z * .07917));
  if (ay > ax) a = 1.5707963 - a;
  if (x < 0) a = 3.1415927 - a;
  return y < 0 ? TAU - a : a;
}
function bodyCollision(p, body, index, r2) {
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
  if (best < 0 || bestS <= d) return null;
  return { nx: ux, ny: uy, depth: bestS - d, body: index, a: body.nodes[best], b: body.nodes[best + 1 === NODES ? 0 : best + 1], t: bestT };
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

export class SoftBodyWorld {
  constructor() {
    this.bodies = Array.from({ length: BODY_COUNT }, () => new Body());
    this.time = 0; this.accumulator = 0; this.drain = 0; this.gravityX = 0; this.gravityY = 0; this.liveBodies = 0;
    this.stiffness = 1500; this.damping = 10; this.gravity = 1002; this.maxSpeed = 300; this.drag = .6; this.push = 500; this.pushRadius = 220; this.elasticity = .99; this.friction = .2;
    this.seed_ = 1; this.liveContacts_ = []; this.contacts_ = []; this.impacts_ = []; this.nextFamily_ = 1;
  }
  random() { this.seed_ = (Math.imul(this.seed_, 1664525) + 1013904223) >>> 0; return Math.fround(this.seed_) / 4294967296; }
  init(seed) {
    this.seed_ = seed >>> 0; this.liveContacts_ = [];
    this.contacts_ = Array.from({ length: BODY_COUNT }, () => Array.from({ length: BODY_COUNT + 1 }, () => ({ approach: 0, start: 0, last: 0, toppedUp: false, live: false, easing: 0, easeRate: 0 })));
    for (let k = 0; k < BASE_BODIES; k++) {
      const r = BODY_RADIUS * (.9 + this.random() * .2); let x = CENTER, y = CENTER, room = -1e9;
      for (let attempt = 0; attempt < 300; attempt++) {
        const a = this.random() * TAU, d = Math.sqrt(this.random()) * (DISPLAY_RADIUS - r - 4), px = CENTER + Math.cos(a) * d, py = CENTER + Math.sin(a) * d;
        let gap = DISPLAY_RADIUS - r - d;
        for (let j = 0; j < k; j++) { const g = Math.hypot(this.bodies[j].cx - px, this.bodies[j].cy - py) - this.bodies[j].reach - r; if (g < gap) gap = g; }
        if (gap > room) { room = gap; x = px; y = py; }
        if (room > 8) break;
      }
      const b = this.bodies[k]; this.shape(b, r);
      for (let i = 0; i < NODES; i++) Object.assign(b.nodes[i], { x: x + b.rest[i].x, y: y + b.rest[i].y, vx: 0, vy: 0 });
      b.centre();
    }
    this.liveBodies = BASE_BODIES;
  }
  shape(b, radius) {
    b.alive = true; b.baseRadius = b.radius = b.target = radius; b.lastTouch = -1e9; b.touchingSince = -1; b.absorbInto = -1; b.turnCos = 1; b.turnSin = 0;
    b.born = this.time; b.splitAt = b.ghostUntil = -1e9; b.family = this.nextFamily_++;
    const p2 = this.random() * TAU, p3 = this.random() * TAU;
    for (let i = 0; i < NODES; i++) {
      const a = i * TAU / NODES, r = radius * (1 + .07 * Math.cos(2 * a + p2) + .035 * Math.cos(3 * a + p3));
      b.rest[i].x = Math.cos(a) * r; b.rest[i].y = Math.sin(a) * r;
    }
  }
  impact(body, nx, ny, speed) { if (this.impacts_.length < 8) this.impacts_.push({ body, nx, ny, speed }); }
  splash(hit) {
    const b = this.bodies[hit.body], time = this.time;
    if (!b.alive || b.absorbInto >= 0 || b.target < SPLIT_MIN_RADIUS || time - b.splitAt < SPLIT_COOLDOWN || time - b.born < SPLIT_COOLDOWN) return;
    const strength = clampf((hit.speed - SPLIT_SPEED) / (SPLIT_FULL - SPLIT_SPEED), 0, 1), area = b.target * b.target, taken = area * (.18 + .32 * strength);
    let count = 2 + Math.trunc(strength * 3 + this.random()); const free = BODY_COUNT - this.liveBodies, fit = Math.trunc(taken / (DROP_MIN_RADIUS * DROP_MIN_RADIUS));
    if (count > free) count = free; if (count > fit) count = fit;
    if (count < 1) return;
    const weights = []; let total = 0; for (let k = 0; k < count; k++) { weights[k] = .35 + this.random(); total += weights[k]; }
    b.velocity(); const vx = b.mvx, vy = b.mvy, along = vx * hit.nx + vy * hit.ny, tvx = vx - hit.nx * along, tvy = vy - hit.ny * along; let used = 0;
    const family = b.family; let slot = 0;
    for (let k = 0; k < count; k++) {
      while (this.bodies[slot].alive) slot++;
      const drop = weights[k] / total * taken, r = Math.sqrt(drop); if (r < DROP_MIN_RADIUS) continue;
      const side = k % 2 ? 1 : -1;
      const at = side * (.9 + this.random() * .7), ac = Math.cos(at), as = Math.sin(at), px = hit.nx * ac - hit.ny * as, py = hit.nx * as + hit.ny * ac; let out = b.reach - r * .8; if (out < 0) out = 0;
      const go = side * -(.6 + this.random() * .8), gc = Math.cos(go), gs = Math.sin(go), dx = -hit.nx * gc + hit.ny * gs, dy = -hit.nx * gs - hit.ny * gc, speed = hit.speed * (.7 + this.random() * .7);
      const d = this.bodies[slot]; this.shape(d, r); d.family = family; d.ghostUntil = time + GHOST_SECONDS; used += drop; this.liveBodies++;
      for (let i = 0; i < NODES; i++) {
        const qx = d.rest[i].x, qy = d.rest[i].y; let u = qx * dx + qy * dy, w = qy * dx - qx * dy;
        u *= 1.45; w *= .72;
        Object.assign(d.nodes[i], { x: b.cx + px * out + u * dx - w * dy, y: b.cy + py * out + u * dy + w * dx, vx: tvx + dx * speed, vy: tvy + dy * speed });
      }
      d.centre();
    }
    if (used <= 0) return;
    b.target = Math.sqrt(area - used); b.splitAt = time; b.ghostUntil = time + GHOST_SECONDS;
  }
  remove(body) {
    this.bodies[body].alive = false; this.liveBodies--;
    for (const b of this.bodies) if (b.absorbInto === body) b.absorbInto = -1;
    const live = this.liveContacts_;
    for (let k = 0; k < live.length;) {
      const lo = Math.floor(live[k] / (BODY_COUNT + 1)), hi = live[k] % (BODY_COUNT + 1);
      if (lo === body || hi === body) { this.contacts_[lo][hi].live = false; live[k] = live[live.length - 1]; live.pop(); } else k++;
    }
  }
  coalesce(h) {
    const time = this.time, live = this.liveContacts_;
    for (let k = 0; k < live.length && this.liveBodies > BASE_BODIES; k++) {
      const lo = Math.floor(live[k] / (BODY_COUNT + 1)), hi = live[k] % (BODY_COUNT + 1); if (hi === BODY_COUNT) continue;
      const a = this.bodies[lo], b = this.bodies[hi], c = this.contacts_[lo][hi];
      if (a.absorbInto >= 0 || b.absorbInto >= 0 || time - c.start < MERGE_CONTACT || time - c.last > .05 || time - a.born < MERGE_AGE || time - b.born < MERGE_AGE) continue;
      if (a.target * a.target + b.target * b.target > MAX_RADIUS * MAX_RADIUS) continue;
      if (a.target < b.target) a.absorbInto = hi; else b.absorbInto = lo;
    }
    for (let i = 0; i < BODY_COUNT; i++) {
      const b = this.bodies[i]; if (!b.alive) continue;
      if (b.absorbInto >= 0) {
        const to = this.bodies[b.absorbInto], dx = to.cx - b.cx, dy = to.cy - b.cy, d = Math.sqrt(dx * dx + dy * dy) + 1e-6;
        b.shift(dx / d * MERGE_PULL * h, dy / d * MERGE_PULL * h);
        const area = b.target * b.target; let flow = Math.max(area, DROP_MIN_RADIUS * DROP_MIN_RADIUS * 4) * h / MERGE_SECONDS; if (flow > area) flow = area;
        b.target = Math.sqrt(area - flow); to.target = Math.sqrt(to.target * to.target + flow);
        if (b.target < 4) { to.target = Math.sqrt(to.target * to.target + b.target * b.target); this.remove(i); continue; }
      } else if (this.liveBodies > BASE_BODIES && time - b.born > HOME_AFTER && b.target < BODY_RADIUS * .75) {
        let best = 1e9, gx = 0, gy = 0;
        for (const o of this.bodies) {
          if (!o.alive || o === b || o.target < b.target || o.target * o.target + b.target * b.target > MAX_RADIUS * MAX_RADIUS) continue;
          const dx = o.cx - b.cx, dy = o.cy - b.cy, d = dx * dx + dy * dy; if (d < best) { best = d; gx = dx; gy = dy; }
        }
        if (best < 1e9) { const d = Math.sqrt(best) + 1e-6; b.shift(gx / d * HOME_PULL * h, gy / d * HOME_PULL * h); }
      }
      if (Math.abs(b.target - b.radius) > .01) {
        const next = b.radius + (b.target - b.radius) * (1 - Math.exp(-h / SIZE_EASE)), k = next / b.radius;
        for (const q of b.rest) { q.x *= k; q.y *= k; }
        b.radius = b.baseRadius = next;
      }
    }
  }
  touch(a, b) {
    const lo = b < 0 || a < b ? a : b, hi = b < 0 ? BODY_COUNT : a < b ? b : a;
    const c = this.contacts_[lo][hi];
    if (c.live) { c.last = this.time; return; }
    Object.assign(c, { approach: 0, start: this.time, last: this.time, toppedUp: false, live: true, easing: 0, easeRate: 0 });
    this.liveContacts_.push(lo * (BODY_COUNT + 1) + hi);
  }
  restitution(e, h) {
    const live = this.liveContacts_;
    for (let k = 0; k < live.length;) {
      const lo = Math.floor(live[k] / (BODY_COUNT + 1)), hi = live[k] % (BODY_COUNT + 1), c = this.contacts_[lo][hi];
      if (this.time - c.last > CONTACT_LINGER) { c.live = false; live[k] = live[live.length - 1]; live.pop(); continue; }
      k++;
      const A = this.bodies[lo], B = hi === BODY_COUNT ? null : this.bodies[hi];
      A.velocity(); const vax = A.mvx, vay = A.mvy; let nx, ny, speed;
      if (!B) { const dx = A.cx - CENTER, dy = A.cy - CENTER; let d = Math.sqrt(dx * dx + dy * dy); if (d < 1e-6) d = 1e-6; nx = dx / d; ny = dy / d; speed = vax * nx + vay * ny; }
      else { B.velocity(); const dx = B.cx - A.cx, dy = B.cy - A.cy; let d = Math.sqrt(dx * dx + dy * dy); if (d < 1e-6) d = 1e-6; nx = dx / d; ny = dy / d; speed = (vax - B.mvx) * nx + (vay - B.mvy) * ny; }
      if (speed > c.approach) c.approach = speed;
      if (speed < 0 && !c.toppedUp && c.approach >= BOUNCE_MIN) {
        c.toppedUp = true; const extra = e * c.approach + speed;
        if (c.approach >= SPLIT_SPEED) { this.impact(lo, nx, ny, c.approach); if (B) this.impact(hi, -nx, -ny, c.approach); }
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
    this.accumulator += clampf(dt, 0, .05); let steps = 0;
    while (this.accumulator >= STEP) { this.step(STEP); this.accumulator -= STEP; steps++; }
    return steps;
  }
  step(h) {
    this.time += h;
    const drain = this.drain, bodies = this.bodies, time = this.time;
    const movement = 1 - MOVE_DRAIN * drain, e = this.elasticity + (DRAINED_ELASTICITY - this.elasticity) * drain;
    const liveFriction = this.friction + (DRAINED_FRICTION - this.friction) * drain, liveDrag = this.drag + (DRAINED_DRAG - this.drag) * drain, dragKeep = Math.exp(-liveDrag * h);
    const m = Math.hypot(this.gravityX, this.gravityY); let gx = 0, gy = 0;
    if (m > GRAVITY_DEAD_ZONE) { const k = (m - GRAVITY_DEAD_ZONE) * DEAD_ZONE_GAIN / m * this.gravity; gx = this.gravityX * k; gy = this.gravityY * k; }
    for (const b of bodies) if (b.alive) for (const n of b.nodes) {
      n.vx = (n.vx + gx * h) * dragKeep; n.vy = (n.vy + gy * h) * dragKeep;
      n.x += n.vx * h; n.y += n.vy * h;
    }
    for (const b of bodies) if (b.alive) b.centre();
    const r2 = bodies.map(b => { const r = b.reach + 2; return r * r; });
    const keep = Math.exp(-liveFriction * h), resolveE = e < 1 ? e : 1, wallLimit = DISPLAY_RADIUS - WALL_GAP - POINT_RADIUS;
    for (let i = 0; i < BODY_COUNT; i++) {
      const bi = bodies[i], near = [];
      if (!bi.alive) continue;
      for (let j = 0; j < BODY_COUNT && near.length < NEAR_MAX; j++) {
        const bj = bodies[j];
        if (j === i || !bj.alive || bi.absorbInto === j || bj.absorbInto === i) continue;
        if (bi.family === bj.family && (time < bi.ghostUntil || time < bj.ghostUntil)) continue;
        const dx = bj.cx - bi.cx, dy = bj.cy - bi.cy, reach = bi.reach + bj.reach + POINT_RADIUS * 2;
        if (dx * dx + dy * dy < reach * reach) near.push(j);
      }
      const wx = bi.cx - CENTER, wy = bi.cy - CENTER, wallPossible = Math.sqrt(wx * wx + wy * wy) + bi.reach + 3 > wallLimit;
      if (!near.length && !wallPossible) continue;
      for (const p of bi.nodes) {
        const dx = p.x - CENTER, dy = p.y - CENTER; let d = Math.sqrt(dx * dx + dy * dy); if (d < 1e-6) d = 1e-6;
        let hit = { nx: -dx / d, ny: -dy / d, depth: d - wallLimit, body: -1, a: null, b: null, t: 0 };
        for (const j of near) { const other = bodyCollision(p, bodies[j], j, r2[j]); if (other && other.depth > hit.depth) hit = other; }
        if (hit.depth <= 0) continue;
        resolve(p, hit, resolveE, keep);
        this.touch(i, hit.body);
        bi.lastTouch = time; if (bi.touchingSince < 0) bi.touchingSince = time;
      }
    }
    const blend = 1 - Math.exp(-this.damping * h), restingBlend = 1 - Math.exp(-(this.damping > SETTLE_DAMPING ? this.damping : SETTLE_DAMPING) * h);
    for (const b of bodies) {
      if (!b.alive) continue;
      if (time - b.lastTouch > CONTACT_LINGER) b.touchingSince = -1;
      const resting = b.touchingSince >= 0 && time - b.touchingSince > SETTLE_AFTER;
      b.shapeMatch(h, this.stiffness, resting ? restingBlend : blend);
    }
    this.restitution(e, h);
    for (const hit of this.impacts_) this.splash(hit);
    this.impacts_.length = 0;
    this.coalesce(h);
    for (const b of bodies) {
      if (!b.alive) continue;
      const top = this.maxSpeed * movement * (time - b.born < SPLASH_SECONDS ? SPLASH_SPEED_GAIN : 1); b.velocity(); const s = Math.sqrt(b.mvx * b.mvx + b.mvy * b.mvy);
      if (s > top) b.shift(b.mvx * (top / s - 1), b.mvy * (top / s - 1));
    }
  }
  blast(x, y, spare = -1) {
    for (let i = 0; i < BODY_COUNT; i++) {
      if (i === spare || !this.bodies[i].alive) continue;
      const b = this.bodies[i]; b.centre(); let dx = b.cx - x, dy = b.cy - y, d = Math.hypot(dx, dy); const k = 1 - d / this.pushRadius;
      if (k <= 0) continue;
      const f = k * k * this.push;
      if (d < 1e-3) { dx = CENTER - x; dy = CENTER - y; d = Math.hypot(dx, dy); if (d < 1e-3) { dx = 0; dy = 1; d = 1; } }
      b.shift(dx / d * f, dy / d * f);
    }
  }
}
export function outlineWidth(radius, seconds) {
  const t = seconds > 0 ? seconds : 0, w = radius / (1 + t), floorW = radius < 1.5 ? radius : 1.5;
  return w > floorW ? w : floorW;
}
