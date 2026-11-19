// Drain page: a plain page with the Harvey Pocket's blobs on it. Press and drag to pinch the page: the pinch is a drain,
// the origin of the gravity, and pulling further is tipping further. The same drain, melt, colour front and
// recovery rules as firmware/harvey_pocket/harvey_pocket.ino, with the physics from pocket-softbody.mjs.
import { SoftBodyWorld, NODES } from './pocket-softbody.mjs';

const params = new URLSearchParams(location.search);
const num = (k, d) => { const v = parseFloat(params.get(k)); return Number.isFinite(v) ? v : d; };
const hex = (k, d) => { const v = (params.get(k) || d).replace('#', ''); return [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16) / 255); };

// From the firmware: drain rises from TIP_DEAD to fastest at TIP_FULL degrees, emptying a full battery in 3 s.
const TIP_DEAD_DEGREES = 10, TIP_FULL_DEGREES = 60, TIP_FASTEST_SECONDS = 3, TIP_CURVE = 1.5, FIRM_SECONDS = 10;
const SQUISH_IN = .3, SQUISH_OUT = .8, MELT_START = .3, MELT_SECONDS = 4, SUCK_IN = .3, SUCK_OUT = 1.5, SUCK_STRENGTH = 2;
const MAX_PULL = .6;   // g beyond the level zone at a full tip (the firmware's 0.6 g cap, gained back to full force)
// The web's own: a pull of PULL_FULL × the page's short side is a 60° tip (so the 10° dead zone is about 1/20 of it).
// Visitors recover RECOVERY_RATIO × as slowly as they drained (the device uses 60; ?recovery=60 to match).
const PULL_FULL = num('pull', .3), RECOVERY_RATIO = num('recovery', 6), RELEASE_EASE = .3;
// Colour: the device mutes to the colour's own grey and darkens to half on its dark glass; on a light page the
// drained grey recedes toward the page instead (RECEDE of the way).
const COLOUR = hex('colour', 'f47839'), BACKGROUND = hex('bg', 'f4f2ee'), MUTE = 1, RECEDE = num('recede', .45);
const COUNT = Math.round(num('n', 3)), RADIUS = num('r', 75), MAX_BODIES = 7, BINS = 64;

const canvas = document.getElementById('stage'), hud = document.getElementById('hud');
const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false });
if (!gl) { document.body.classList.add('no-webgl'); throw new Error('WebGL2 is needed'); }

let world, unit = 1, dpr = 1;
function layout() {
  dpr = Math.min(devicePixelRatio || 1, 2);
  const w = innerWidth, h = innerHeight;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  unit = Math.min(w, h) / 480;   // css px per device px: the page's short side is the device's 480
  if (!world) world = new SoftBodyWorld({ width: w / unit, height: h / unit, count: COUNT, radius: RADIUS, seed: (Math.random() * 2 ** 32) >>> 0 });
  else world.resize(w / unit, h / unit);
  gl.viewport(0, 0, canvas.width, canvas.height);
}

// ---- input: a held pointer is the device's held button; the pull from the press point is the tip ----
const input = { held: false, pressX: 0, pressY: 0, x: 0, y: 0, taps: [] };
let seconds = 0, meltNow = 0, tipNow = 0, suckW = 0, pinch = 0;
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  Object.assign(input, { held: true, pressX: e.clientX, pressY: e.clientY, x: e.clientX, y: e.clientY });
  meltNow = 0;
  world.drainX = e.clientX / unit; world.drainY = e.clientY / unit;
  // Three presses, each within 0.5 s of the last, reset the drain (as on the device).
  const now = performance.now(); input.taps = input.taps.filter(t => now - t < 1000).concat(now);
  if (input.taps.length >= 3 && input.taps.slice(-3).every((t, i, a) => !i || t - a[i - 1] < 500)) { seconds = 0; input.taps = []; }
});
canvas.addEventListener('pointermove', e => { if (input.held) { input.x = e.clientX; input.y = e.clientY; } });
const release = () => { input.held = false; };
canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release);
addEventListener('keydown', e => { if (e.key === 'r') seconds = 0; if (e.key === 'd') hud.hidden = !hud.hidden; });
addEventListener('resize', layout);

function updateDrain(dt) {
  const pulled = Math.hypot(input.x - input.pressX, input.y - input.pressY), short = Math.min(innerWidth, innerHeight);
  const degrees = pulled / (PULL_FULL * short) * TIP_FULL_DEGREES;
  const tip = Math.min(1, Math.max(0, (degrees - TIP_DEAD_DEGREES) / (TIP_FULL_DEGREES - TIP_DEAD_DEGREES)));
  tipNow = input.held ? tip : 0;
  if (input.held) {
    meltNow = Math.min(1, meltNow + tip * dt / MELT_SECONDS);
    seconds = Math.min(FIRM_SECONDS, seconds + dt * tip ** TIP_CURVE * FIRM_SECONDS / TIP_FASTEST_SECONDS);
    world.pull = tip * MAX_PULL;
  } else {
    seconds = Math.max(0, seconds - dt / RECOVERY_RATIO);
    world.pull = Math.max(0, world.pull - dt * MAX_PULL / RELEASE_EASE);   // the page levels out after release
  }
  world.drain = seconds / FIRM_SECONDS;
  const target = input.held ? Math.max(MELT_START, meltNow) : 0;
  world.squish = world.squish < target ? Math.min(target, world.squish + dt / SQUISH_IN) : Math.max(target, world.squish - dt / SQUISH_OUT);
  suckW = input.held ? Math.min(1, suckW + dt / SUCK_IN) : Math.max(0, suckW - dt / SUCK_OUT);
  // The pinch shows a little on the press and deepens with the tip; it smooths out after release.
  const pinchTarget = input.held ? .35 + .65 * tip : 0, rate = input.held ? 8 : 3;
  pinch += (pinchTarget - pinch) * (1 - Math.exp(-rate * dt));
}

// ---- outline radius by angle, per blob (the firmware's lightScale table, as radii) ----
const table = new Float32Array(BINS * MAX_BODIES), coarse = new Float32Array(BINS), smoothed = new Float32Array(BINS);
function outlineTables() {
  world.bodies.forEach((b, k) => {
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
    for (let pass = 0; pass < 3; pass++) {
      for (let a = 0; a < BINS; a++) smoothed[a] = (coarse[(a + BINS - 1) % BINS] + 2 * coarse[a] + coarse[(a + 1) % BINS]) / 4;
      coarse.set(smoothed);
    }
    for (let a = 0; a < BINS; a++) table[k * BINS + a] = Math.max(coarse[a], 1);
  });
}

// ---- WebGL: one full-screen pass. Background with the pinch, then the shared field of the blobs (Harvey Lounge's wax). ----
const VERT = `#version 300 es
in vec2 p; void main() { gl_Position = vec4(p, 0, 1); }`;
const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform float uScale; uniform int uCount; uniform vec2 uCentre[${MAX_BODIES}];
uniform highp sampler2D uTable;
uniform float uMerge, uDrain, uSuck, uLo, uHi, uPinch; uniform vec2 uDrainPt, uPress, uCursor;
uniform vec3 uColour, uBg;
out vec4 outColour;
const float TAU = 6.2831853, KERNEL_SQUARED = 1.0 / 0.553, ISO = 0.2;
float radiusAt(int i, float a) {
  float f = a / TAU * ${BINS}.0, i0 = floor(f), t = f - i0; int lo = int(i0) % ${BINS}, hi = (lo + 1) % ${BINS};
  return mix(texelFetch(uTable, ivec2(lo, i), 0).r, texelFetch(uTable, ivec2(hi, i), 0).r, t);
}
// The pinch: a funnel at the press, pulled out toward the pointer, with soft folds running into it like gathered cloth.
float height(vec2 p) {
  vec2 q = p - uPress, pull = uCursor - uPress; float len = length(pull); vec2 dir = len > 1e-3 ? pull / len : vec2(1, 0);
  float sigma = 46.0 + 40.0 * uPinch, along = dot(q, dir), across = dot(q, vec2(-dir.y, dir.x));
  if (along > 0.0) along /= 1.0 + 0.9 * len / (len + 120.0);
  float r2 = (along * along + across * across) / (sigma * sigma), funnel = 1.0 / (1.0 + r2);
  float folds = 1.0 + 0.14 * cos(7.0 * atan(across, along)) * smoothstep(0.05, 0.6, r2) * funnel;
  return -26.0 * uPinch * funnel * folds;
}
void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uScale;
  vec3 bg = uBg;
  if (uPinch > 0.002) {
    float e = 0.75, hx = height(p + vec2(e, 0)) - height(p - vec2(e, 0)), hy = height(p + vec2(0, e)) - height(p - vec2(0, e));
    vec3 n = normalize(vec3(-hx / (2.0 * e), -hy / (2.0 * e), 1)), light = normalize(vec3(-0.45, -0.65, 1));
    float shade = dot(n, light) - light.z, hollow = -height(p) / 26.0;
    bg *= 1.0 + 0.55 * shade - 0.06 * hollow;
  }
  float sum = 0.0, top = 0.0;
  for (int i = 0; i < ${MAX_BODIES}; i++) {
    if (i >= uCount) break;
    vec2 d = p - uCentre[i]; float a = atan(d.y, d.x); if (a < 0.0) a += TAU;
    float e = radiusAt(i, a), x = dot(d, d) / (KERNEL_SQUARED * e * e);
    if (x < 1.0) { float f = (1.0 - x) * (1.0 - x); sum += f; top = max(top, f); }
  }
  float field = top + (sum - top) * uMerge, cover = clamp((field - ISO) / max(fwidth(field), 1e-5) + 0.5, 0.0, 1.0);
  // Sucked out: each pixel's drain is drain × (1 + w) − w × (1 − u), u from 0 nearest the drain to 1 furthest.
  float drain = uDrain;
  if (uSuck > 0.005) {
    float u = clamp((distance(p, uDrainPt) - uLo) / max(uHi - uLo, 1.0), 0.0, 1.0);
    float own = clamp(uDrain * (1.0 + uSuck) - uSuck * (1.0 - u), 0.0, 1.0);
    drain = mix(own, own * own * (3.0 - 2.0 * own), clamp(uSuck, 0.0, 1.0));
  }
  vec3 c = mix(uColour, vec3(dot(uColour, vec3(77, 151, 28) / 256.0)), drain * ${MUTE.toFixed(3)});
  c = mix(c, uBg, drain * ${RECEDE.toFixed(3)});
  outColour = vec4(mix(bg, c, cover), 1);
}`;
function shader(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
const program = gl.createProgram();
gl.attachShader(program, shader(gl.VERTEX_SHADER, VERT)); gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(program);
if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
gl.useProgram(program);
gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
const at = gl.getAttribLocation(program, 'p'); gl.enableVertexAttribArray(at); gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
const U = name => gl.getUniformLocation(program, name);
const u = Object.fromEntries(['uRes', 'uScale', 'uCount', 'uCentre', 'uTable', 'uMerge', 'uDrain', 'uSuck', 'uLo', 'uHi', 'uPinch', 'uDrainPt', 'uPress', 'uCursor', 'uColour', 'uBg'].map(n => [n, U(n)]));
const texture = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, texture);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, BINS, MAX_BODIES, 0, gl.RED, gl.FLOAT, table);
gl.uniform1i(u.uTable, 0); gl.uniform3fv(u.uColour, COLOUR); gl.uniform3fv(u.uBg, BACKGROUND);
const centres = new Float32Array(MAX_BODIES * 2);

function draw() {
  outlineTables();
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BINS, MAX_BODIES, gl.RED, gl.FLOAT, table);
  world.bodies.forEach((b, i) => { centres[i * 2] = b.cx; centres[i * 2 + 1] = b.cy; });
  // The wax's extent from the drain, for the colour front.
  let lo = Infinity, hi = -Infinity;
  for (const b of world.bodies) for (const n of b.nodes) { const d = Math.hypot(n.x - world.drainX, n.y - world.drainY); lo = Math.min(lo, d); hi = Math.max(hi, d); }
  gl.uniform2f(u.uRes, canvas.width, canvas.height); gl.uniform1f(u.uScale, unit * dpr);
  gl.uniform1i(u.uCount, world.count); gl.uniform2fv(u.uCentre, centres);
  gl.uniform1f(u.uMerge, 1 - world.drain * (1 - world.squish));
  gl.uniform1f(u.uDrain, world.drain); gl.uniform1f(u.uSuck, suckW * SUCK_STRENGTH); gl.uniform1f(u.uLo, lo); gl.uniform1f(u.uHi, hi);
  gl.uniform2f(u.uDrainPt, world.drainX, world.drainY);
  gl.uniform1f(u.uPinch, pinch); gl.uniform2f(u.uPress, input.pressX / unit, input.pressY / unit); gl.uniform2f(u.uCursor, input.x / unit, input.y / unit);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(.1, (now - last) / 1000); last = now;
  updateDrain(dt);
  world.advance(dt);
  draw();
  if (!hud.hidden) hud.textContent = `tip ${tipNow.toFixed(2)}  drain ${(world.drain * 10).toFixed(1)} s  squish ${world.squish.toFixed(2)}  pull ${world.pull.toFixed(2)} g  recovery ×${RECOVERY_RATIO}`;
  requestAnimationFrame(frame);
}
layout();
requestAnimationFrame(frame);
// For tests and tuning from the console.
window.harveyDrain = { get world() { return world; }, get drainSeconds() { return seconds; }, set drainSeconds(v) { seconds = v; } };
