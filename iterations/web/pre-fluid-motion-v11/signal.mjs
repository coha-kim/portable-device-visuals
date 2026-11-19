// Signal page. Left, the Pocket's blobs up close: three white blobs stuck together, drifting slowly over a wall of
// words. Pull one away: the bond is strong and sticky, stretches into a neck and snaps with a bounce. The further apart
// the blobs are, the greyer each one gets, and the words change with them. Right, the Lounge reduced to two blobs,
// white (yours) and #78E6CA, merged and barely drifting; as yours pull apart on the left they part too, as far as yours
// are apart, and the white one greys with them.

import { SoftBodyWorld, NODES } from './pocket-softbody.mjs';

const params = new URLSearchParams(location.search);
const num = (k, d) => { const v = parseFloat(params.get(k)); return Number.isFinite(v) ? v : d; };
const rgb = h => [0, 2, 4].map(i => parseInt(h.slice(i + 1, i + 3), 16) / 255);

const WHITE = rgb('#ffffff'), GREY = rgb('#9a9da0');
const APART_SECONDS = num('apart', 14);   // how long snapped blobs keep apart before they find each other again
const TEAL = rgb('#78e6ca');
// The words behind the blobs, from together to far apart.
const PHRASES = ['Hold and drain', 'Running low', 'Need a breather', 'Do not disturb'];
const STAGES = [0, .18, .5, .85];
// The bubble: what to do, and what to watch.
const SAY = {
  idle: 'Pull one blob away from the others.',
  holding: 'Now watch the blobs on the right.',
  apart: 'On the right, they’ve drifted apart too.',
  returning: 'Give them a moment to drift back.',
  back: 'Back together, merging again.',
};

const canvas = document.getElementById('mine'), panel = document.querySelector('.left'), said = document.getElementById('said'), bubble = document.querySelector('.bubble');
const lines = [...document.querySelectorAll('.words p')];
const roomCanvas = document.getElementById('room'), roomPanel = document.querySelector('.right');

// ---------------- your blobs: the Pocket's soft bodies ----------------
// Each blob is a ring of 32 points held round by its skin, pressure and a pull to its rest shape (pocket-softbody.mjs,
// the device's physics). Grabbing pinches the points under the pointer and drags them, so the blob stretches like
// dough and the rest of it follows. Bonded blobs pull on each other as a whole and, harder, through their facing
// sides, so a pull stretches both toward each other into a neck; past BREAK the bond lets go and both spring back.
const shapeOf = (vx, vy, s) => { const m2 = vx * vx + vy * vy; return m2 < 1e-9 ? [0, 0] : [s * (vx * vx - vy * vy) / m2, s * 2 * vx * vy / m2]; };
function wobble(b, h) {   // the right-hand blobs' shape springs to its target and overshoots a little
  const K = 230, C = 7;
  b.va += ((b.ta - b.a) * K - b.va * C) * h; b.vb += ((b.tb - b.b) * K - b.vb * C) * h;
  b.a += b.va * h; b.b += b.vb * h;
  const s = Math.hypot(b.a, b.b); if (s > .5) { b.a *= .5 / s; b.b *= .5 / s; }
}
const BLOB_RADIUS = 75;   // device px, as on the Pocket; the page scales the world so a blob is 0.17 × the panel's short side
const BOND_K = 34, BOND_CAP = .5, FACE_K = 70, BREAK = 2.7, PINCH_REACH = .9, PINCH_K = 900, PINCH_DAMP = 30, PACE = 1.3, GRABBED_FIRMNESS = .3, HOLD_GROUND = 3;
const mine = { world: null, unit: 1, w: 1, h: 1, blobs: [], bonds: [], grab: null, apart: false, apartFor: 0, time: 0, anchors: [] };
const LAYOUT = [[.6, -1.15], [-.65, .2], [.65, 1.2]];   // a chain like the reference, in blob radii from the middle
function setup(w, h) {
  const fresh = !mine.world;
  mine.unit = Math.min(w, h) * .17 / BLOB_RADIUS; mine.w = w; mine.h = h;
  const W = w / mine.unit, H = h / mine.unit;
  if (!fresh) { mine.world.resize(W, H); return; }
  const world = new SoftBodyWorld({ width: W, height: H, count: 3, radius: BLOB_RADIUS, seed: (Math.random() * 2 ** 32) >>> 0 });
  world.squish = .05;   // just enough to lift the device's merge time limit: these stay stuck until pulled apart
  world.choosePaths = () => {};
  world.wanderSpot = p => mine.anchors[p] || [world.bodies[p].cx, world.bodies[p].cy];
  world.bodies.forEach((b, i) => {   // move each blob to its place in the chain
    b.centre(); const tx = W * .48 + LAYOUT[i][0] * BLOB_RADIUS, ty = H * .5 + LAYOUT[i][1] * BLOB_RADIUS;
    for (const n of b.nodes) { n.x += tx - b.cx; n.y += ty - b.cy; } b.centre();
  });
  world.bodies.forEach(b => { b.firmness = 1; });
  mine.world = world;
  mine.blobs = world.bodies.map((b, i) => ({ body: b, seed: i, grey: 0, x: 0, y: 0, r: 0 }));
  mine.bonds = [[0, 1], [1, 2]].map(([i, j]) => ({ i, j, rest: (world.bodies[i].radius + world.bodies[j].radius) * .78 }));
}
function step(h) {
  const world = mine.world, B = world.bodies, R = BLOB_RADIUS; mine.time += h;
  for (const b of B) b.centre();
  // Where each blob drifts to: its place in the slowly turning, wandering chain while stuck together; while apart,
  // wherever it is (no pull), and back to the chain once they've had their time apart.
  const t = mine.time, W = world.width, H = world.height, spin = Math.sin(t * .05) * .25;
  const mx = W * .48 + Math.sin(t * .13) * R * .35, my = H * .5 + Math.sin(t * .097 + 1.2) * R * .3;
  const together = !mine.apart || mine.apartFor > APART_SECONDS;
  mine.anchors = B.map((b, i) => {
    if (mine.grab && mine.grab.i === i) return [b.cx, b.cy];
    if (!together) return [b.cx + Math.sin(t * .3 + i) * 4, b.cy + Math.cos(t * .27 + i) * 4];
    const [lx, ly] = LAYOUT[i], c = Math.cos(spin), s = Math.sin(spin);
    return [mx + (lx * c - ly * s) * R, my + (lx * s + ly * c) * R];
  });
  // Bonds.
  const broken = [];
  for (const bd of mine.bonds) {
    const A = B[bd.i], C = B[bd.j], dx = C.cx - A.cx, dy = C.cy - A.cy, d = Math.hypot(dx, dy) || 1e-6, nx = dx / d, ny = dy / d, stretch = d - bd.rest;
    const g = mine.grab && (mine.grab.i === bd.i || mine.grab.i === bd.j) ? mine.grab : null;
    const far = g && Math.hypot(g.x - B[g.i === bd.i ? bd.j : bd.i].cx, g.y - B[g.i === bd.i ? bd.j : bd.i].cy) > (BREAK + .9) * R;
    if (d > BREAK * R || far) { broken.push(bd); continue; }
    if (stretch <= 0) continue;
    // As a whole: grows with the stretch up to a cap, so a slow pull drags the other along and a quick one stretches.
    const whole = BOND_K * Math.min(stretch, BOND_CAP * R) * h;
    A.shift(nx * whole, ny * whole); C.shift(-nx * whole, -ny * whole);
    // Through the facing sides: those points reach for the other blob, so both stretch toward each other.
    const face = FACE_K * Math.min(stretch / R, 1.2) * h;
    for (const [P, Q, sx, sy] of [[A, C, nx, ny], [C, A, -nx, -ny]]) for (const p of P.nodes) {
      const ox = p.x - P.cx, oy = p.y - P.cy, f = (ox * sx + oy * sy) / P.radius;
      if (f > .2) { const k = face * (f - .2) * (f - .2) * 2.5; p.vx += (Q.cx - p.x) * k; p.vy += (Q.cy - p.y) * k; }
    }
  }
  for (const bd of broken) snap(bd);
  // The pinch: the points under the grab follow the pointer on stiff springs, most at the grab, less further out.
  if (mine.grab) {
    const g = mine.grab, P = B[g.i];
    g.points.forEach(({ n, ox, oy, w }) => {
      const p = P.nodes[n], tx = g.x + ox, ty = g.y + oy;
      p.vx += ((tx - p.x) * PINCH_K - p.vx * PINCH_DAMP) * w * h; p.vy += ((ty - p.y) * PINCH_K - p.vy * PINCH_DAMP) * w * h;
    });
  }
  // Apart: low battery, as on the device (gaps, no merging, slower), for a while; then back to full and together.
  if (mine.apart) {
    mine.apartFor += h;
    const target = mine.apartFor > APART_SECONDS ? 0 : 1, rate = target ? 1 / 1.2 : 1 / 3;
    world.drain = target > world.drain ? Math.min(target, world.drain + h * rate) : Math.max(target, world.drain - h * rate);
    if (mine.apartFor > APART_SECONDS) for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
      if (mine.bonds.some(bd => (bd.i === i && bd.j === j) || (bd.i === j && bd.j === i))) continue;
      if (Math.hypot(B[i].cx - B[j].cx, B[i].cy - B[j].cy) < (B[i].radius + B[j].radius) * .95) mine.bonds.push({ i, j, rest: (B[i].radius + B[j].radius) * .78 });
    }
    if (connected()) { mine.apart = false; world.drain = 0; rejoinedAt = clock; }
  }
  // While one is pulled it goes soft like dough, and the others hold their ground, so the pull stretches rather than drags.
  B.forEach((b, i) => {
    const pulled = mine.grab && mine.grab.i === i;
    b.firmness += ((pulled ? GRABBED_FIRMNESS : 1) - b.firmness) * (1 - Math.exp(-h * 8));
    if (mine.grab && !pulled) { const keep = Math.exp(-HOLD_GROUND * h); for (const n of b.nodes) { n.vx *= keep; n.vy *= keep; } }
  });
  world.step(h);
  // For the rest of the page, in css px: where each blob is, and how grey (distance from its nearest neighbour).
  for (const [i, m] of mine.blobs.entries()) {
    const b = B[i]; m.x = b.cx * mine.unit; m.y = b.cy * mine.unit; m.r = b.radius * mine.unit;
    let near = Infinity; for (const o of B) if (o !== b) near = Math.min(near, Math.hypot(o.cx - b.cx, o.cy - b.cy));
    const target = Math.min(1, Math.max(0, (near - b.radius * 1.56) / (R * 1.5)));
    m.grey += (target - m.grey) * (1 - Math.exp(-h * 6));
  }
}
function snap(bd) {   // the bond lets go: both spring back to round and wobble
  mine.bonds = mine.bonds.filter(x => x !== bd);
  const B = mine.world.bodies, A = B[bd.i], C = B[bd.j], dx = C.cx - A.cx, dy = C.cy - A.cy, d = Math.hypot(dx, dy) || 1;
  A.shift(-dx / d * 90, -dy / d * 90); C.shift(dx / d * 90, dy / d * 90);
  if (!connected() && !mine.apart) { mine.apart = true; mine.apartFor = 0; }
}
function connected() {
  const seen = new Set([0]), todo = [0];
  while (todo.length) { const i = todo.pop(); for (const bd of mine.bonds) { const j = bd.i === i ? bd.j : bd.j === i ? bd.i : -1; if (j >= 0 && !seen.has(j)) { seen.add(j); todo.push(j); } } }
  return seen.size === 3;
}

// ---------------- input ----------------
const toWorld = e => { const r = panel.getBoundingClientRect(); return [(e.clientX - r.left) / mine.unit, (e.clientY - r.top) / mine.unit]; };
function inside(x, y, b) {   // point in the blob's outline
  let c = false; const N = b.nodes;
  for (let i = 0, j = N.length - 1; i < N.length; j = i++) if ((N[i].y > y) !== (N[j].y > y) && x < (N[j].x - N[i].x) * (y - N[i].y) / (N[j].y - N[i].y) + N[i].x) c = !c;
  return c;
}
const hit = (x, y) => mine.world.bodies.findIndex(b => inside(x, y, b) || Math.hypot(x - b.cx, y - b.cy) < b.radius * .9);
panel.addEventListener('pointerdown', e => {
  const [x, y] = toWorld(e), i = hit(x, y);
  if (i < 0) return;
  panel.setPointerCapture(e.pointerId);
  startGrab(i, x, y);
});
function startGrab(i, x, y) {
  const P = mine.world.bodies[i], reach = P.radius * PINCH_REACH, points = [];
  P.nodes.forEach((p, n) => {   // the pinch takes the points nearest the grab, the nearest most
    const d = Math.hypot(p.x - x, p.y - y), w = Math.max(0, 1 - d / reach);
    if (w > 0) points.push({ n, ox: p.x - x, oy: p.y - y, w: w * w });
  });
  if (!points.length) { let best = 0, bd = Infinity; P.nodes.forEach((p, n) => { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = n; } }); points.push({ n: best, ox: P.nodes[best].x - x, oy: P.nodes[best].y - y, w: 1 }); }
  mine.grab = { i, x, y, points }; document.body.classList.add('holding');
}
panel.addEventListener('pointermove', e => {
  const [x, y] = toWorld(e);
  if (mine.grab) { mine.grab.x = Math.max(0, Math.min(mine.world.width, x)); mine.grab.y = Math.max(0, Math.min(mine.world.height, y)); return; }
  panel.classList.toggle('over', hit(x, y) >= 0);
});
const letGo = () => { mine.grab = null; document.body.classList.remove('holding'); };
panel.addEventListener('pointerup', letGo); panel.addEventListener('pointercancel', letGo);

// ---------------- the Lounge: two blobs, merged until yours part ----------------
const room = { w: 1, h: 1, R: 1, sep: 0, time: 0, blobs: [] };
function setupRoom(w, h) {
  const fresh = !room.blobs.length, sx = w / room.w, sy = h / room.h;
  Object.assign(room, { w, h, R: Math.min(w, h) * .17 });
  if (!fresh) { for (const b of room.blobs) { b.x *= sx; b.y *= sy; b.r = room.R * b.size; } return; }
  [[1.0, WHITE], [.92, TEAL]].forEach(([size, colour], i) => room.blobs.push({
    x: w / 2 + (i ? .4 : -.4) * room.R, y: h / 2, vx: 0, vy: 0, r: room.R * size, size, colour, a: 0, b: 0, va: 0, vb: 0, ta: 0, tb: 0,
  }));
}
function stepRoom(h) {
  room.time += h; const t = room.time, R = room.R;
  // How far apart: as far as your blobs are (the greyest one's distance), eased so the parting reads as one movement.
  const target = Math.max(...mine.blobs.map(b => b.grey));
  room.sep += (target - room.sep) * (1 - Math.exp(-h * 3));
  // A tiny drift: the pair's middle wanders a little and slowly turns.
  const cx = room.w / 2 + Math.sin(t * .11) * R * .18, cy = room.h / 2 + Math.sin(t * .083 + 1.3) * R * .22;
  const turn = -.35 + Math.sin(t * .05) * .3 + room.sep * .5, apart = R * (.66 + 2.4 * room.sep);
  const dx = Math.cos(turn) * apart / 2, dy = Math.sin(turn) * apart / 2;
  room.blobs.forEach((b, i) => {
    const tx = i ? cx + dx : cx - dx, ty = i ? cy + dy : cy - dy;
    b.vx = (b.vx + ((tx - b.x) * 9 + Math.sin(t * .4 + i * 2) * 6) * h) * Math.exp(-3.2 * h);
    b.vy = (b.vy + ((ty - b.y) * 9 + Math.cos(t * .31 + i * 3) * 6) * h) * Math.exp(-3.2 * h);
    b.x += b.vx * h; b.y += b.vy * h;
    [b.ta, b.tb] = shapeOf(b.vx, b.vy, Math.min(.22, Math.hypot(b.vx, b.vy) / 1200));
    wobble(b, h);
  });
}

// ---------------- words and bubble ----------------
let clock = 0, rejoinedAt = -1e9, stage = -1, mood = '';
function drive() {
  const grey = Math.max(...mine.blobs.map(b => b.grey));
  // The words follow the distance.
  let at = 0; STAGES.forEach((s, i) => { if (grey >= s) at = i; });
  if (at !== stage) {
    stage = at;
    lines.forEach((p, i) => setTimeout(() => { p.textContent = PHRASES[at]; p.classList.remove('flip'); void p.offsetWidth; p.classList.add('flip'); }, i * 45));
  }
  // The bubble says what to do, or what to watch.
  const now = mine.grab && !mine.apart ? 'holding' : mine.apart ? (mine.apartFor > APART_SECONDS ? 'returning' : 'apart')
    : clock - rejoinedAt < 6 ? 'back' : 'idle';
  if (now !== mood) { mood = now; said.textContent = SAY[now]; bubble.classList.remove('pop'); void bubble.offsetWidth; bubble.classList.add('pop'); }
}

// ---------------- drawing: one soft field per panel, each blob with its own colour ----------------
const FRAG = `#version 300 es
precision highp float;
uniform vec2 uSize; uniform float uDpr; uniform int uCount; uniform vec4 uBlob[3]; uniform vec2 uShape[3]; uniform vec3 uColour[3];
uniform int uNecks; uniform vec4 uNeck[3]; uniform float uNeckW[3]; uniform vec3 uNeckColour[3];
out vec4 outColour;
const float KERNEL_SQUARED = 1.0 / 0.553, ISO = 0.2;
void main() {
  vec2 p = vec2(gl_FragCoord.x, uSize.y * uDpr - gl_FragCoord.y) / uDpr;
  float field = 0.0; vec3 mixed = vec3(0);
  for (int i = 0; i < 3; i++) {
    if (i >= uCount) break;
    vec4 b = uBlob[i]; vec2 s = uShape[i], d = p - b.xy;
    float det = max((1.0 + s.x) * (1.0 - s.x) - s.y * s.y, 0.2);
    vec2 q = vec2((1.0 - s.x) * d.x - s.y * d.y, -s.y * d.x + (1.0 + s.x) * d.y) / det;
    float x = dot(q, q) / (KERNEL_SQUARED * b.z * b.z);
    if (x < 1.0) { float f = (1.0 - x) * (1.0 - x); field += f; mixed += f * uColour[i]; }
  }
  for (int i = 0; i < 3; i++) {   // necks: the sticky bridge along a stretched bond
    if (i >= uNecks) break;
    vec2 a = uNeck[i].xy, c = uNeck[i].zw, ac = c - a; float t = clamp(dot(p - a, ac) / max(dot(ac, ac), 1e-3), 0.0, 1.0);
    float mid = 1.0 - pow(abs(t - 0.5) * 2.0, 3.0), w = max(uNeckW[i] * (0.55 + 0.45 * mid), 1e-3);
    vec2 off = p - a - ac * t; float x = dot(off, off) / (KERNEL_SQUARED * w * w);
    if (x < 1.0) { float f = (1.0 - x) * (1.0 - x) * mid; field += f; mixed += f * uNeckColour[i]; }
  }
  // A wide soft edge: the colour fades into the ground behind it, as on the reference.
  float alpha = smoothstep(ISO - 0.15, ISO + 0.07, field);
  vec3 c = field > 0.0 ? mixed / field : vec3(1);
  outColour = vec4(c * alpha, alpha);
}`;
const VERT = `#version 300 es
in vec2 p; void main() { gl_Position = vec4(p, 0, 1); }`;
function fieldRenderer(cv) {
  const gl = cv.getContext('webgl2', { antialias: false, premultipliedAlpha: true });
  if (!gl) { document.body.classList.add('no-webgl'); throw new Error('WebGL2 is needed'); }
  const prog = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]]) {
    const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    gl.attachShader(prog, sh);
  }
  gl.linkProgram(prog); gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = Object.fromEntries(['uSize', 'uDpr', 'uCount', 'uBlob', 'uShape', 'uColour', 'uNecks', 'uNeck', 'uNeckW', 'uNeckColour'].map(n => [n, gl.getUniformLocation(prog, n)]));
  const blobData = new Float32Array(12), shapeData = new Float32Array(6), colourData = new Float32Array(9), neckData = new Float32Array(12), neckW = new Float32Array(3), neckColour = new Float32Array(9);
  // blobs: { x, y, r, a, b, colour }; necks: [ax, ay, bx, by, width, colour]
  return (w, h, blobs, necks) => {
    blobs.forEach((b, i) => { blobData.set([b.x, b.y, b.r, 0], i * 4); shapeData.set([b.a, b.b], i * 2); colourData.set(b.colour, i * 3); });
    necks.forEach((n, i) => { neckData.set(n.slice(0, 4), i * 4); neckW[i] = n[4]; neckColour.set(n[5], i * 3); });
    gl.viewport(0, 0, cv.width, cv.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(U.uSize, w, h); gl.uniform1f(U.uDpr, dpr);
    gl.uniform1i(U.uCount, blobs.length); gl.uniform4fv(U.uBlob, blobData); gl.uniform2fv(U.uShape, shapeData); gl.uniform3fv(U.uColour, colourData);
    gl.uniform1i(U.uNecks, necks.length); gl.uniform4fv(U.uNeck, neckData); gl.uniform1fv(U.uNeckW, neckW); gl.uniform3fv(U.uNeckColour, neckColour);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
}
const greyed = (c, g) => c.map((v, k) => v + (GREY[k] - v) * g);
const drawRoom = fieldRenderer(roomCanvas);
// Your blobs: the Pocket's field, from each outline's radius by angle (64 bins, smoothed, as in the firmware), so the
// drawn shape is the soft body's own outline.
const BINS = 64;
const SOFT_FRAG = `#version 300 es
precision highp float;
uniform vec2 uSize; uniform float uDpr, uUnit; uniform vec2 uCentre[3]; uniform vec3 uColour[3]; uniform highp sampler2D uTable;
out vec4 outColour;
const float TAU = 6.2831853, KERNEL_SQUARED = 1.0 / 0.553, ISO = 0.2;
float radiusAt(int i, float a) {
  float f = a / TAU * ${BINS}.0, i0 = floor(f), t = f - i0; int lo = int(i0) % ${BINS}, hi = (lo + 1) % ${BINS};
  return mix(texelFetch(uTable, ivec2(lo, i), 0).r, texelFetch(uTable, ivec2(hi, i), 0).r, t);
}
void main() {
  vec2 p = vec2(gl_FragCoord.x, uSize.y * uDpr - gl_FragCoord.y) / uDpr / uUnit;
  float field = 0.0; vec3 mixed = vec3(0);
  for (int i = 0; i < 3; i++) {
    vec2 d = p - uCentre[i]; float a = atan(d.y, d.x); if (a < 0.0) a += TAU;
    float e = radiusAt(i, a), x = dot(d, d) / (KERNEL_SQUARED * e * e);
    if (x < 1.0) { float f = (1.0 - x) * (1.0 - x); field += f; mixed += f * uColour[i]; }
  }
  float alpha = smoothstep(ISO - 0.15, ISO + 0.07, field);
  vec3 c = field > 0.0 ? mixed / field : vec3(1);
  outColour = vec4(c * alpha, alpha);
}`;
const drawMine = (() => {
  const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: true });
  if (!gl) { document.body.classList.add('no-webgl'); throw new Error('WebGL2 is needed'); }
  const prog = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, SOFT_FRAG]]) {
    const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    gl.attachShader(prog, sh);
  }
  gl.linkProgram(prog); gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = Object.fromEntries(['uSize', 'uDpr', 'uUnit', 'uCentre', 'uColour', 'uTable'].map(n => [n, gl.getUniformLocation(prog, n)]));
  const table = new Float32Array(BINS * 3), coarse = new Float32Array(BINS), smoothed = new Float32Array(BINS), centres = new Float32Array(6), colours = new Float32Array(9);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, BINS, 3, 0, gl.RED, gl.FLOAT, table);
  gl.uniform1i(U.uTable, 0);
  return () => {
    mine.world.bodies.forEach((b, k) => {
      coarse.fill(0);
      for (let i = 0; i < NODES; i++) {
        const p = b.nodes[i], q = b.nodes[(i + 1) % NODES];
        for (let s = 0; s < 4; s++) {
          const x = p.x + (q.x - p.x) * s / 4 - b.cx, y = p.y + (q.y - p.y) * s / 4 - b.cy;
          let a = Math.atan2(y, x); if (a < 0) a += Math.PI * 2;
          const bin = Math.round(a / (Math.PI * 2) * BINS) % BINS, d = Math.hypot(x, y);
          if (d > coarse[bin]) coarse[bin] = d;
        }
      }
      let start = 0; while (start < BINS && coarse[start] === 0) start++;
      for (let done = 0, a = start; start < BINS && done < BINS;) {
        let gap = 1; while (gap < BINS && coarse[(a + gap) % BINS] === 0) gap++;
        const from = coarse[a], to = coarse[(a + gap) % BINS];
        for (let s = 1; s < gap; s++) coarse[(a + s) % BINS] = from + (to - from) * s / gap;
        a = (a + gap) % BINS; done += gap;
      }
      for (let pass = 0; pass < 2; pass++) {
        for (let a = 0; a < BINS; a++) smoothed[a] = (coarse[(a + BINS - 1) % BINS] + 2 * coarse[a] + coarse[(a + 1) % BINS]) / 4;
        coarse.set(smoothed);
      }
      for (let a = 0; a < BINS; a++) table[k * BINS + a] = Math.max(coarse[a], 1);
      centres.set([b.cx, b.cy], k * 2); colours.set(greyed(WHITE, mine.blobs[k].grey), k * 3);
    });
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BINS, 3, gl.RED, gl.FLOAT, table);
    gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(U.uSize, mine.w, mine.h); gl.uniform1f(U.uDpr, dpr); gl.uniform1f(U.uUnit, mine.unit);
    gl.uniform2fv(U.uCentre, centres); gl.uniform3fv(U.uColour, colours);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
})();
let dpr = 1;
function draw() {
  drawMine();
  // On the right, the white blob greys with yours.
  drawRoom(room.w, room.h, room.blobs.map((b, i) => ({ ...b, colour: i ? b.colour : greyed(WHITE, room.sep) })), []);
}

function layout() {
  dpr = Math.min(devicePixelRatio || 1, 2);
  const w = panel.clientWidth, h = panel.clientHeight, rw = roomPanel.clientWidth, rh = roomPanel.clientHeight;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  roomCanvas.width = Math.round(rw * dpr); roomCanvas.height = Math.round(rh * dpr);
  setup(w, h); setupRoom(rw, rh);
}
addEventListener('resize', layout);

let last = performance.now(), acc = 0;
function frame(now) {
  const dt = Math.min(.1, (now - last) / 1000); last = now; clock += dt; acc += dt;
  while (acc >= 1 / 240) { step(1 / 240 * PACE); stepRoom(1 / 240); acc -= 1 / 240; }
  drive();
  draw();
  requestAnimationFrame(frame);
}
layout();
requestAnimationFrame(frame);
window.harveySignal = { mine, room, step, startGrab, letGo };
