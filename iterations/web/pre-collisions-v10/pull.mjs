// Pull page. Left, your own blobs: three light-blue blobs stuck together, drifting slowly. Grab one and pull: the
// others are dragged along by a strong, sticky bond that stretches into a neck, and a fast or far pull snaps it, so
// the blobs bounce apart. Right, the room: three populations merged together, and the moment yours separates on the
// left, your light-blue population breaks away from the rest. The speech bubble rides on your blob and changes its
// status when you pull apart. After a while the blobs find each other again and everything rejoins.
const params = new URLSearchParams(location.search);
const num = (k, d) => { const v = parseFloat(params.get(k)); return Number.isFinite(v) ? v : d; };
const rgb = h => [0, 2, 4].map(i => parseInt(h.slice(i + 1, i + 3), 16) / 255);

const PANEL = rgb('#3f7abb'), PAPER = rgb('#ffffff'), HALO = rgb('#3a3d44');
const PALETTE = [rgb('#b2d8e5'), rgb('#c2e596'), rgb('#3f7abb')];   // your population first
const APART_SECONDS = num('apart', 16);   // how long the blobs keep apart before they find each other again

const CONNECTED_LINES = ['Down for a chat.', 'Kettle’s on, join me?', 'Happy to hang out.', 'Movie night? I’m keen.', 'Tell me about your day.'];
const APART_LINES = ['I just want to be in bed.', 'Talked out for today.', 'Need a quiet night in.', 'Recharging. Back tomorrow.', 'Not much chat left in me.'];

const canvas = document.getElementById('stage'), bubble = document.querySelector('.bubble'), said = document.getElementById('said');
const left = document.querySelector('.mine'), right = document.querySelector('.room');
const gl = canvas.getContext('webgl2', { antialias: false });
if (!gl) { document.body.classList.add('no-webgl'); throw new Error('WebGL2 is needed'); }

// ---- shared helpers ----
const hash = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
// A blob's shape: [[1 + a, b], [b, 1 − a]], so (a, b) = s (cos 2θ, sin 2θ) stretches it by s along θ.
const shapeOf = (vx, vy, s) => { const m2 = vx * vx + vy * vy; return m2 < 1e-9 ? [0, 0] : [s * (vx * vx - vy * vy) / m2, s * 2 * vx * vy / m2]; };
const blob = (x, y, r, colour) => ({ x, y, vx: 0, vy: 0, r, colour, a: 0, b: 0, va: 0, vb: 0, ta: 0, tb: 0 });
function wobble(b, h) {   // the shape springs to its target and overshoots a little: a jelly bounce
  const K = 230, C = 7;
  b.va += ((b.ta - b.a) * K - b.va * C) * h; b.vb += ((b.tb - b.b) * K - b.vb * C) * h;
  b.a += b.va * h; b.b += b.vb * h;
  const s = Math.hypot(b.a, b.b); if (s > .55) { b.a *= .55 / s; b.b *= .55 / s; }
}
function walls(b, w, hgt, k, h) {   // soft walls: a blob may lean on the edge but is pushed back in
  const m = b.r * .95;
  if (b.x < m) b.vx += (m - b.x) * k * h; if (b.x > w - m) b.vx -= (b.x - (w - m)) * k * h;
  if (b.y < m) b.vy += (m - b.y) * k * h; if (b.y > hgt - m) b.vy -= (b.y - (hgt - m)) * k * h;
}

// ---- left: your blobs ----
const mine = { w: 1, h: 1, R: 1, blobs: [], bonds: [], grab: null, apart: false, apartFor: 0, time: 0 };
function setupMine(w, h) {
  const fresh = !mine.blobs.length, sx = w / mine.w, sy = h / mine.h;
  Object.assign(mine, { w, h, R: Math.min(w, h) * .15 });
  if (!fresh) { for (const b of mine.blobs) { b.x *= sx; b.y *= sy; b.r = mine.R * b.size; } return; }
  const R = mine.R, cx = w * .52, cy = h * .5;
  // A chain like the reference: top right, middle left, bottom right.
  [[.65, -1.25, 1.0], [-.6, .1, 1.05], [.75, 1.2, .92]].forEach(([dx, dy, size], i) => {
    const b = blob(cx + dx * R, cy + dy * R, R * size, 0); b.size = size; b.seed = i; mine.blobs.push(b);
  });
  mine.bonds = [[0, 1], [1, 2]].map(([i, j]) => bond(i, j));
}
const bond = (i, j) => { const a = mine.blobs[i], b = mine.blobs[j]; return { i, j, rest: (a.r + b.r) * .78 }; };
const BOND_K = 26, BOND_CAP = .45, BREAK = 2.8, DRAG = 5, GRAB_K = 340, NOISE = 55;
function stepMine(h) {
  const { blobs, R } = mine; mine.time += h;
  for (const b of blobs) { b.fx = 0; b.fy = 0; b.ta = 0; b.tb = 0; }
  // Bonds: strong and sticky. The pull grows with the stretch up to a cap, so a slow pull drags the others along and a
  // quick one stretches the neck until it snaps.
  const broken = [];
  for (const bd of mine.bonds) {
    const A = blobs[bd.i], B = blobs[bd.j], dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 1e-6, nx = dx / d, ny = dy / d;
    const stretch = d - bd.rest;
    // Snaps when stretched past BREAK radii, or when the pointer has gone that far even if the edge holds the blob back.
    const g = mine.grab && (mine.grab.i === bd.i || mine.grab.i === bd.j) ? mine.grab : null, other = g && blobs[g.i === bd.i ? bd.j : bd.i];
    if (d > BREAK * R || (g && Math.hypot(g.x - g.ox - other.x, g.y - g.oy - other.y) > BREAK * 1.2 * R)) { broken.push(bd); continue; }
    const f = BOND_K * Math.sign(stretch) * Math.min(Math.abs(stretch), BOND_CAP * R) + (stretch > 0 ? 0 : BOND_K * stretch * .6);
    A.fx += nx * f; A.fy += ny * f; B.fx -= nx * f; B.fy -= ny * f;
    const rv = (B.vx - A.vx) * nx + (B.vy - A.vy) * ny; A.fx += nx * rv * 1.5; A.fy += ny * rv * 1.5; B.fx -= nx * rv * 1.5; B.fy -= ny * rv * 1.5;
    // Each end stretches toward the other while pulled: the sticky neck.
    if (stretch > 0) { const s = Math.min(.24, stretch / R * .2), [a, b] = shapeOf(nx, ny, s); A.ta += a; A.tb += b; B.ta += a; B.tb += b; }
  }
  for (const bd of broken) snap(bd);
  // Apart: they keep a gap for a while, then find each other again (magnetism) and stick on contact.
  if (mine.apart) {
    mine.apartFor += h;
    const back = mine.apartFor > APART_SECONDS;
    for (let i = 0; i < blobs.length; i++) for (let j = i + 1; j < blobs.length; j++) {
      if (mine.bonds.some(bd => (bd.i === i && bd.j === j) || (bd.i === j && bd.j === i))) continue;
      const A = blobs[i], B = blobs[j], dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 1e-6, nx = dx / d, ny = dy / d, reach = (A.r + B.r);
      if (!back && d < reach * 1.5) { const f = 260 * (1 - d / (reach * 1.5)); A.fx -= nx * f; A.fy -= ny * f; B.fx += nx * f; B.fy += ny * f; }
      if (back) { const f = 120 + 260 * Math.max(0, 1 - d / (reach * 2.2)); A.fx += nx * f; A.fy += ny * f; B.fx -= nx * f; B.fy -= ny * f; }
      const grabbedIn = mine.grab && (mine.grab.i === i || mine.grab.i === j) && mine.apartFor > 1.2;
      if ((back || grabbedIn) && d < reach * .8) mine.bonds.push(bond(i, j));   // touching: stuck again
    }
    if (connected()) rejoin();
  }
  // Idle drift: each blob wanders slowly; the whole cluster is kept loosely in the middle of the panel.
  let mx = 0, my = 0; for (const b of blobs) { mx += b.x; my += b.y; } mx /= blobs.length; my /= blobs.length;
  for (const b of blobs) {
    const t = mine.time, s = b.seed;
    b.fx += NOISE * Math.sin(t * .31 + s * 2.1) + NOISE * .6 * Math.sin(t * .17 + s * 5.3) + (mine.w * .5 - mx) * .25;
    b.fy += NOISE * Math.cos(t * .23 + s * 1.3) + NOISE * .6 * Math.cos(t * .13 + s * 3.7) + (mine.h * .5 - my) * .25;
  }
  // The grabbed blob follows the pointer on a stiff spring, and stretches toward it.
  if (mine.grab) {
    const b = blobs[mine.grab.i], gx = Math.max(b.r * .9, Math.min(mine.w - b.r * .9, mine.grab.x - mine.grab.ox)), gy = Math.max(b.r * .9, Math.min(mine.h - b.r * .9, mine.grab.y - mine.grab.oy));
    const dx = gx - b.x, dy = gy - b.y;
    b.fx += dx * GRAB_K - b.vx * 2 * Math.sqrt(GRAB_K); b.fy += dy * GRAB_K - b.vy * 2 * Math.sqrt(GRAB_K);
    const [a, bb] = shapeOf(dx, dy, Math.min(.16, Math.hypot(dx, dy) / R * .4)); b.ta += a; b.tb += bb;
  }
  for (const b of blobs) {
    const drag = mine.grab && blobs[mine.grab.i] === b ? 0 : DRAG;
    b.vx = (b.vx + b.fx * h) * Math.exp(-drag * h); b.vy = (b.vy + b.fy * h) * Math.exp(-drag * h);
    walls(b, mine.w, mine.h, 900, h);
    b.x += b.vx * h; b.y += b.vy * h;
    const [a, bb] = shapeOf(b.vx, b.vy, Math.min(.2, Math.hypot(b.vx, b.vy) / 4000)); b.ta += a; b.tb += bb;
    wobble(b, h);
  }
}
function snap(bd) {   // the neck lets go: both ends spring back, squash and bounce
  mine.bonds = mine.bonds.filter(x => x !== bd);
  const A = mine.blobs[bd.i], B = mine.blobs[bd.j], dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 1, nx = dx / d, ny = dy / d;
  A.vx -= nx * 240; A.vy -= ny * 240; B.vx += nx * 240; B.vy += ny * 240;
  for (const b of [A, B]) { const [a, bb] = shapeOf(nx, ny, -.32); b.a += a; b.b += bb; b.va += a * 8; b.vb += bb * 8; }
  if (!connected() && !mine.apart) separate();
}
function connected() {   // one group, through the bonds
  const seen = new Set([0]), todo = [0];
  while (todo.length) { const i = todo.pop(); for (const bd of mine.bonds) { const j = bd.i === i ? bd.j : bd.j === i ? bd.i : -1; if (j >= 0 && !seen.has(j)) { seen.add(j); todo.push(j); } } }
  return seen.size === mine.blobs.length;
}

// ---- right: the room ----
const room = { w: 1, h: 1, r: 1, blobs: [], apart: false, time: 0 };
function setupRoom(w, h) {
  const fresh = !room.blobs.length, sx = w / room.w, sy = h / room.h;
  Object.assign(room, { w, h, r: Math.min(w, h) * .095 });
  if (!fresh) { for (const b of room.blobs) { b.x *= sx; b.y *= sy; b.r = room.r * b.size; } return; }
  let k = 0;
  for (let pop = 0; pop < 3; pop++) for (let n = 0; n < 3; n++, k++) {
    const size = .78 + hash(k) * .45, a = hash(k + 20) * Math.PI * 2, d = hash(k + 40) * room.r;
    const b = blob(w / 2 + Math.cos(a) * d, h / 2 + Math.sin(a) * d, room.r * size, pop); b.size = size; b.seed = k; room.blobs.push(b);
  }
}
function anchorOf(pop) {   // where each population gathers: around the middle together, or yours off on its own
  const t = room.time * .05, S = Math.min(room.w, room.h), a = t + pop * Math.PI * 2 / 3;
  if (pop === 0 && room.apart) return [room.w / 2 + .3 * S * Math.cos(1.1), room.h / 2 + .3 * S * Math.sin(1.1) + .05 * S];
  const spread = room.apart ? .1 : .12, lift = room.apart ? -.1 * S : 0;
  return [room.w / 2 + Math.cos(a) * spread * S - (room.apart ? .06 * S : 0), room.h / 2 + Math.sin(a) * spread * S + lift];
}
function stepRoom(h) {
  room.time += h; const B = room.blobs;
  for (const b of B) {
    const [ax, ay] = anchorOf(b.colour), t = room.time, s = b.seed;
    b.fx = (ax - b.x) * 2.4 + 40 * Math.sin(t * .4 + s * 1.9); b.fy = (ay - b.y) * 2.4 + 40 * Math.cos(t * .33 + s * 2.7);
    b.ta = 0; b.tb = 0;
  }
  for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
    const P = B[i], Q = B[j], dx = Q.x - P.x, dy = Q.y - P.y, d = Math.hypot(dx, dy) || 1e-6, nx = dx / d, ny = dy / d;
    const split = room.apart && (P.colour === 0) !== (Q.colour === 0), keep = split ? (P.r + Q.r) * 1.45 : (P.r + Q.r) * .62;
    if (d < keep) { const f = (split ? 900 : 300) * (1 - d / keep); P.fx -= nx * f; P.fy -= ny * f; Q.fx += nx * f; Q.fy += ny * f; }
  }
  for (const b of B) {
    b.vx = (b.vx + b.fx * h) * Math.exp(-1.8 * h); b.vy = (b.vy + b.fy * h) * Math.exp(-1.8 * h);
    walls(b, room.w, room.h, 600, h);
    b.x += b.vx * h; b.y += b.vy * h;
    const [a, bb] = shapeOf(b.vx, b.vy, Math.min(.25, Math.hypot(b.vx, b.vy) / 2500)); b.ta += a; b.tb += bb;
    wobble(b, h);
  }
}

// ---- state changes ----
let line = '';
function say(lines) {
  const options = lines.filter(l => l !== line); line = options[Math.floor(Math.random() * options.length)];
  said.textContent = line;
  bubble.classList.remove('pop'); void bubble.offsetWidth; bubble.classList.add('pop');
}
function separate() {
  mine.apart = true; mine.apartFor = 0; room.apart = true;
  // Yours breaks away from the room at once.
  const S = Math.min(room.w, room.h);
  for (const b of room.blobs) if (b.colour === 0) { b.vx += Math.cos(1.1) * .9 * S; b.vy += Math.sin(1.1) * .9 * S; }
  document.body.classList.add('apart'); say(APART_LINES);
}
function rejoin() { mine.apart = false; room.apart = false; document.body.classList.remove('apart'); say(CONNECTED_LINES); }

// ---- input ----
const pos = (e, el) => { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
function fieldAt(x, y, b) { const d2 = ((x - b.x) ** 2 + (y - b.y) ** 2) / (b.r * b.r * 1.808); return d2 < 1 ? (1 - d2) ** 2 : 0; }
left.addEventListener('pointerdown', e => {
  const [x, y] = pos(e, left); let best = -1, top = .12;
  mine.blobs.forEach((b, i) => { const f = fieldAt(x, y, b); if (f > top) { top = f; best = i; } });
  if (best < 0) return;
  left.setPointerCapture(e.pointerId); const b = mine.blobs[best];
  mine.grab = { i: best, x, y, ox: x - b.x, oy: y - b.y }; document.body.classList.add('holding');
});
left.addEventListener('pointermove', e => {
  const [x, y] = pos(e, left);
  if (mine.grab) { mine.grab.x = x; mine.grab.y = y; return; }
  left.classList.toggle('over', mine.blobs.some(b => fieldAt(x, y, b) > .12));
});
const letGo = () => { mine.grab = null; document.body.classList.remove('holding'); };
left.addEventListener('pointerup', letGo); left.addEventListener('pointercancel', letGo);

// ---- the bubble rides on the top blob, a little behind it ----
const follow = { x: 0, y: 0, vx: 0, vy: 0, ready: false };
function placeBubble(h) {
  const b = mine.blobs[0], lr = left.getBoundingClientRect();
  const tx = lr.left + b.x - b.r * .2, ty = lr.top + b.y - b.r * .82;   // the tail's tip, on the blob's upper left
  if (!follow.ready) Object.assign(follow, { x: tx, y: ty, ready: true });
  const K = 90, C = 13;
  follow.vx += ((tx - follow.x) * K - follow.vx * C) * h; follow.vy += ((ty - follow.y) * K - follow.vy * C) * h;
  follow.x += follow.vx * h; follow.y += follow.vy * h;
  const w = bubble.offsetWidth, hh = bubble.offsetHeight;
  // The tail's tip is at the bubble's lower right (798, 214 of 800 × 236).
  const x = Math.max(8, Math.min(innerWidth - w - 8, follow.x - w * .9975)), y = Math.max(8, follow.y - hh * .907);
  bubble.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
}

// ---- WebGL: one shader for both panels. Blobs add to a shared field; colour mixes where populations meet. ----
const MAX = 12;
const FRAG = `#version 300 es
precision highp float;
uniform vec2 uOrigin; uniform float uDpr; uniform float uPanelH;
uniform int uCount; uniform vec4 uBlob[${MAX}]; uniform vec2 uShape[${MAX}];
uniform int uNecks; uniform vec4 uNeck[4]; uniform float uNeckW[4];
uniform vec3 uPalette[3], uBg, uHalo;
uniform float uHaloAmount, uRim, uGlow;
out vec4 outColour;
const float KERNEL_SQUARED = 1.0 / 0.553, ISO = 0.2;
void main() {
  vec2 p = vec2(gl_FragCoord.x / uDpr - uOrigin.x, uPanelH - gl_FragCoord.y / uDpr);
  float field = 0.0; vec3 mixed = vec3(0);
  for (int i = 0; i < ${MAX}; i++) {
    if (i >= uCount) break;
    vec4 b = uBlob[i]; vec2 s = uShape[i], d = p - b.xy;
    float det = max((1.0 + s.x) * (1.0 - s.x) - s.y * s.y, 0.2);
    vec2 q = vec2((1.0 - s.x) * d.x - s.y * d.y, -s.y * d.x + (1.0 + s.x) * d.y) / det;
    float x = dot(q, q) / (KERNEL_SQUARED * b.z * b.z);
    if (x < 1.0) { float f = (1.0 - x) * (1.0 - x); field += f; mixed += f * uPalette[int(b.w)]; }
  }
  for (int i = 0; i < 4; i++) {   // necks: the sticky bridge along a stretched bond
    if (i >= uNecks) break;
    vec2 a = uNeck[i].xy, c = uNeck[i].zw, ac = c - a; float t = clamp(dot(p - a, ac) / max(dot(ac, ac), 1e-3), 0.0, 1.0);
    float mid = 1.0 - pow(abs(t - 0.5) * 2.0, 3.0), w = uNeckW[i] * (0.55 + 0.45 * mid);
    float x = dot(p - a - ac * t, p - a - ac * t) / (KERNEL_SQUARED * w * w);
    if (x < 1.0) { float f = (1.0 - x) * (1.0 - x) * mid; field += f; mixed += f * uPalette[0]; }
  }
  vec3 bg = uBg;
  // A soft dark halo just outside the edge (the Pocket's blur over its dark glass), then the blob.
  float halo = smoothstep(ISO - 0.17, ISO - 0.01, field), cover = smoothstep(ISO - 0.03, ISO + 0.05, field);
  bg = mix(bg, uHalo, halo * uHaloAmount * (1.0 - cover));
  vec3 c = field > 0.0 ? mixed / field : uPalette[0];
  c = mix(c, vec3(1), uGlow * (1.0 - exp(-max(field - ISO, 0.0) * 1.4)));
  c = mix(c, c * 0.55, uRim * (1.0 - smoothstep(ISO, ISO + 0.14, field)));
  outColour = vec4(mix(bg, c, cover), 1);
}`;
function program(vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}
const prog = program(`#version 300 es
in vec2 p; void main() { gl_Position = vec4(p, 0, 1); }`, FRAG);
gl.useProgram(prog);
gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
const at = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(at); gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
const U = Object.fromEntries(['uOrigin', 'uDpr', 'uPanelH', 'uCount', 'uBlob', 'uShape', 'uNecks', 'uNeck', 'uNeckW', 'uPalette', 'uBg', 'uHalo', 'uHaloAmount', 'uRim', 'uGlow'].map(n => [n, gl.getUniformLocation(prog, n)]));
gl.uniform3fv(U.uPalette, PALETTE.flat()); gl.uniform3fv(U.uHalo, HALO);
gl.enable(gl.SCISSOR_TEST);
const blobData = new Float32Array(MAX * 4), shapeData = new Float32Array(MAX * 2), neckData = new Float32Array(16), neckW = new Float32Array(4);

let dpr = 1;
function drawPanel(el, blobs, necks, style) {
  const r = el.getBoundingClientRect(), x = Math.round(r.left * dpr), y = Math.round((innerHeight - r.bottom) * dpr), w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  gl.viewport(0, 0, canvas.width, canvas.height); gl.scissor(x, y, w, h);
  blobs.forEach((b, i) => { blobData.set([b.x, b.y, b.r, b.colour], i * 4); shapeData.set([b.a, b.b], i * 2); });
  necks.forEach((n, i) => { neckData.set(n.slice(0, 4), i * 4); neckW[i] = n[4]; });
  gl.uniform2f(U.uOrigin, r.left, 0); gl.uniform1f(U.uDpr, dpr); gl.uniform1f(U.uPanelH, innerHeight - r.top);
  gl.uniform1i(U.uCount, blobs.length); gl.uniform4fv(U.uBlob, blobData); gl.uniform2fv(U.uShape, shapeData);
  gl.uniform1i(U.uNecks, necks.length); gl.uniform4fv(U.uNeck, neckData); gl.uniform1fv(U.uNeckW, neckW);
  gl.uniform3fv(U.uBg, style.bg); gl.uniform1f(U.uHaloAmount, style.halo); gl.uniform1f(U.uRim, style.rim); gl.uniform1f(U.uGlow, style.glow);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
function necks() {   // a bridge for every bond stretched past touching, thinning as it stretches
  return mine.bonds.map(bd => {
    const A = mine.blobs[bd.i], B = mine.blobs[bd.j], d = Math.hypot(B.x - A.x, B.y - A.y), R = mine.R;
    const t = Math.min(1, Math.max(0, (d - bd.rest) / (bd.rest * .25))), show = t * t * (3 - 2 * t);
    return [A.x, A.y, B.x, B.y, R * Math.max(.14, .36 * Math.pow(bd.rest / Math.max(d, 1), 1.1)) * show];
  });
}

function layout() {
  dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
  setupMine(left.clientWidth, left.clientHeight); setupRoom(right.clientWidth, right.clientHeight);
}
addEventListener('resize', layout);

let last = performance.now(), acc = 0;
function frame(now) {
  const dt = Math.min(.1, (now - last) / 1000); last = now; acc += dt;
  const STEP = 1 / 240;
  while (acc >= STEP) { stepMine(STEP); stepRoom(STEP); acc -= STEP; }
  // Panel origins are in page px; the shader works in each panel's own px.
  drawPanel(left, mine.blobs, necks(), { bg: PANEL, halo: .85, rim: 0, glow: .25 });
  drawPanel(right, room.blobs, [], { bg: PAPER, halo: 0, rim: 1, glow: .3 });
  placeBubble(dt);
  requestAnimationFrame(frame);
}
layout();
say(CONNECTED_LINES);
requestAnimationFrame(frame);
window.harveyPull = { mine, room, separate, rejoin, stepMine };
