// Tray page: the Harvey Pocket's blobs on a recessed plate. Grab the plate anywhere (a corner works best) and drag to
// tip it: the side you grabbed sinks, gravity runs that way, and the further you drag the further it tips. Tipping
// drains the social battery with the firmware's rules (harvey_pocket.ino), the physics is pocket-softbody.mjs, and the
// speech bubble says, in a flatmate's words, where the battery is at.
import { SoftBodyWorld, NODES } from './pocket-softbody.mjs';

const params = new URLSearchParams(location.search);
const num = (k, d) => { const v = parseFloat(params.get(k)); return Number.isFinite(v) ? v : d; };
const rgb = h => [0, 2, 4].map(i => parseInt(h.slice(i + 1, i + 3), 16) / 255);

// From the firmware.
const TIP_DEAD_DEGREES = 10, TIP_FULL_DEGREES = 60, TIP_FASTEST_SECONDS = 3, TIP_CURVE = 1.5, FIRM_SECONDS = 10, MAX_TILT_G = .6;
const SQUISH_IN = .3, SQUISH_OUT = .8, MELT_START = .3, MELT_SECONDS = 4, SUCK_IN = .3, SUCK_OUT = 1.5, SUCK_STRENGTH = 2;
// The web's own. A drag of PULL_FULL × the tray's short side tips it 60°; the plate is drawn tipped VISUAL_SHARE of
// that (60° would hide the tray). Release levels the plate over LEVEL_SECONDS. Recovery: 6× (?recovery=60 matches the device).
const PULL_FULL = num('pull', .45), VISUAL_SHARE = .3, LEVEL_SECONDS = .6, HOVER_LEAN = 1.5, RECOVERY_RATIO = num('recovery', 6);
const COUNT = Math.round(num('n', 3)), RADIUS = num('r', 70), MAX_BODIES = 7, BINS = 64;
const TRAY = rgb('#b2d8e5'), BLUE = rgb('#52a7e4'), MINT = rgb('#b1dbc7'), GREEN = rgb('#acdc71');

// What a flatmate might say at each level of social battery, from full to flat.
const LINES = [
  ['I just want to be in bed.', 'Recharging. Back tomorrow.', 'Door shut, hoodie on.'],
  ['Talked out for today.', 'Heading to my room soon.', 'Not much chat left in me.'],
  ['Same room, own thing?', 'Around, just a bit quiet.', 'Happy to sit, not to talk.'],
  ['Down for a chat.', 'Happy to hang for a bit.', 'Tea? I’ll make it.'],
  ['Who’s up for dinner?', 'Tell me about your day!', 'Movie night? I’m keen.'],
];

const well = document.querySelector('.well'), tray = document.querySelector('.tray'), canvas = document.getElementById('blobs');
const bubble = document.querySelector('.bubble'), said = document.getElementById('said'), hud = document.getElementById('hud');
const gl = canvas.getContext('webgl2', { antialias: false });
if (!gl) { document.body.classList.add('no-webgl'); throw new Error('WebGL2 is needed'); }

let world, unit = 1, dpr = 1, box = { w: 1, h: 1, r: 0 };
function layout() {
  dpr = Math.min(devicePixelRatio || 1, 2);
  const w = well.clientWidth, h = well.clientHeight, r = parseFloat(getComputedStyle(tray).borderTopLeftRadius) || 0;
  box = { w, h, r };
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  unit = Math.min(w, h) / 480;   // css px per device px: the tray's short side is the device's 480
  if (!world) world = new SoftBodyWorld({ width: w / unit, height: h / unit, count: COUNT, radius: RADIUS, cornerRadius: r / unit, seed: (Math.random() * 2 ** 32) >>> 0 });
  else { world.cornerRadius = r / unit; world.resize(w / unit, h / unit); }
  gl.viewport(0, 0, canvas.width, canvas.height);
}

// ---- input: a held pointer is the held button; the drag from the grab is the tip, toward the side you grabbed ----
const input = { held: false, grabX: 0, grabY: 0, x: 0, y: 0, hoverX: 0, hoverY: 0, hovering: false, taps: [] };
let seconds = 0, meltNow = 0, tipNow = 0, suckW = 0;
const tilt = { x: 0, y: 0, deg: 0 };   // low side direction (screen) and how far the plate is tipped
const local = e => { const r = well.getBoundingClientRect(); return [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2]; };
well.addEventListener('pointerdown', e => {
  well.setPointerCapture(e.pointerId);
  const [x, y] = local(e); Object.assign(input, { held: true, grabX: x, grabY: y, x, y });
  meltNow = 0; document.body.classList.add('holding');
  const now = performance.now(); input.taps = input.taps.filter(t => now - t < 1000).concat(now);
  if (input.taps.length >= 3 && input.taps.slice(-3).every((t, i, a) => !i || t - a[i - 1] < 500)) { seconds = 0; input.taps = []; }
});
well.addEventListener('pointermove', e => {
  const [x, y] = local(e);
  if (input.held) { input.x = x; input.y = y; } else { input.hoverX = x; input.hoverY = y; input.hovering = true; }
});
well.addEventListener('pointerleave', () => { input.hovering = false; });
const release = () => { input.held = false; document.body.classList.remove('holding'); };
well.addEventListener('pointerup', release); well.addEventListener('pointercancel', release);
addEventListener('keydown', e => { if (e.key === 'r') seconds = 0; if (e.key === 'd') hud.hidden = !hud.hidden; });
addEventListener('resize', layout);

function update(dt) {
  const short = Math.min(box.w, box.h);
  if (input.held) {
    // The low side: toward where you grabbed, turned by the way you drag. Grabbed near the middle, the drag alone says.
    const gx = input.grabX / (box.w / 2), gy = input.grabY / (box.h / 2), dx = (input.x - input.grabX) / (PULL_FULL * short), dy = (input.y - input.grabY) / (PULL_FULL * short);
    const grabbed = Math.min(1, Math.hypot(gx, gy) / .25), lx = gx * grabbed + dx * .6, ly = gy * grabbed + dy * .6, l = Math.hypot(lx, ly);
    if (l > 1e-3) { tilt.x = lx / l; tilt.y = ly / l; }
    tilt.deg = Math.min(75, Math.hypot(dx, dy) * TIP_FULL_DEGREES);
  } else {
    tilt.deg = Math.max(0, tilt.deg - dt * 75 / LEVEL_SECONDS);   // the plate settles level, no bounce
  }
  const tip = input.held ? Math.min(1, Math.max(0, (tilt.deg - TIP_DEAD_DEGREES) / (TIP_FULL_DEGREES - TIP_DEAD_DEGREES))) : 0;
  tipNow = tip;
  const g = Math.min(MAX_TILT_G, Math.sin(tilt.deg * Math.PI / 180));
  world.gravityX = tilt.x * g; world.gravityY = tilt.y * g;
  if (input.held) {
    meltNow = Math.min(1, meltNow + tip * dt / MELT_SECONDS);
    seconds = Math.min(FIRM_SECONDS, seconds + dt * tip ** TIP_CURVE * FIRM_SECONDS / TIP_FASTEST_SECONDS);
  } else seconds = Math.max(0, seconds - dt / RECOVERY_RATIO);
  world.drain = seconds / FIRM_SECONDS;
  const target = input.held ? Math.max(MELT_START, meltNow) : 0;
  world.squish = world.squish < target ? Math.min(target, world.squish + dt / SQUISH_IN) : Math.max(target, world.squish - dt / SQUISH_OUT);
  suckW = input.held ? Math.min(1, suckW + dt / SUCK_IN) : Math.max(0, suckW - dt / SUCK_OUT);
  pose(dt);
  bubble.style.setProperty('--energy', (1 - world.drain).toFixed(3));
  speak();
}

// ---- the plate: tipped in 3D so the low side sinks, with its shadows following ----
let leanX = 0, leanY = 0;
function pose(dt) {
  let vx = tilt.x * tilt.deg * VISUAL_SHARE, vy = tilt.y * tilt.deg * VISUAL_SHARE;
  if (!input.held && input.hovering && tilt.deg < 1) {   // a slight give under the pointer, so the plate reads as loose
    const hx = input.hoverX / (box.w / 2), hy = input.hoverY / (box.h / 2);
    vx = hx * HOVER_LEAN; vy = hy * HOVER_LEAN;
  }
  const k = 1 - Math.exp(-dt * 14); leanX += (vx - leanX) * k; leanY += (vy - leanY) * k;
  tray.style.transform = `rotateX(${-leanY}deg) rotateY(${leanX}deg)`;
  const depth = Math.min(1, Math.hypot(leanX, leanY) / 18), ang = Math.atan2(leanY, leanX) * 180 / Math.PI + 90;
  tray.style.setProperty('--deep', depth.toFixed(3));
  tray.style.setProperty('--deep-angle', `${ang.toFixed(1)}deg`);
  tray.style.setProperty('--wall-x', `${(-leanX * 1.4).toFixed(1)}px`);
  tray.style.setProperty('--wall-y', `${(-leanY * 1.4).toFixed(1)}px`);
}

// ---- the bubble: a line for the level the battery is at, with a little pop when it changes ----
let level = -1, line = '', spokeAt = -1e9;
const MIN_LINE_SECONDS = .7;
function speak() {
  const energy = 1 - world.drain, at = Math.min(4, Math.floor(energy * 5 - 1e-6));
  if (level >= 0 && Math.abs(energy * 5 - (level + .5)) < .6) return;   // hysteresis: hold the line near a boundary
  if (at === level || performance.now() - spokeAt < MIN_LINE_SECONDS * 1000) return;
  level = at; spokeAt = performance.now();
  const options = LINES[at].filter(l => l !== line); line = options[Math.floor(Math.random() * options.length)];
  said.textContent = line;
  bubble.classList.remove('pop'); void bubble.offsetWidth; bubble.classList.add('pop');
}

// ---- outline radius by angle per blob (the firmware's table) ----
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

// ---- WebGL: the plate's colour and the blobs as one shared field (the Lounge's wax, as on the Pocket) ----
const VERT = `#version 300 es
in vec2 p; void main() { gl_Position = vec4(p, 0, 1); }`;
const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform float uScale; uniform int uCount; uniform vec2 uCentre[${MAX_BODIES}]; uniform float uRadius[${MAX_BODIES}];
uniform highp sampler2D uTable;
uniform float uMerge, uDrain, uSuck, uLo, uHi; uniform vec2 uAway;
uniform vec3 uTray, uBlue, uMint, uGreen;
out vec4 outColour;
const float TAU = 6.2831853, KERNEL_SQUARED = 1.0 / 0.553, ISO = 0.2, EDGE = 0.07;
const float CENTER_LIGHTEN = 0.2, CENTER_LIGHT_RATE = 1.1, MUTE = 1.0, DIM = 0.78, RIM = 0.62;
const vec2 SHADE = vec2(0.91, 0.41);   // blue at the upper left of each blob, green at the lower right
float radiusAt(int i, float a) {
  float f = a / TAU * ${BINS}.0, i0 = floor(f), t = f - i0; int lo = int(i0) % ${BINS}, hi = (lo + 1) % ${BINS};
  return mix(texelFetch(uTable, ivec2(lo, i), 0).r, texelFetch(uTable, ivec2(hi, i), 0).r, t);
}
vec3 spend(vec3 c, float drain) {   // the firmware's ramp: saturation down to the colour's own grey, then dimmer
  c = mix(c, vec3(dot(c, vec3(77, 151, 28) / 256.0)), drain * MUTE);
  return c * (1.0 - drain * (1.0 - DIM));
}
void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uScale;
  float sum = 0.0, top = 0.0, shadeSum = 0.0;
  for (int i = 0; i < ${MAX_BODIES}; i++) {
    if (i >= uCount) break;
    vec2 d = p - uCentre[i]; float a = atan(d.y, d.x); if (a < 0.0) a += TAU;
    float e = radiusAt(i, a), x = dot(d, d) / (KERNEL_SQUARED * e * e);
    if (x < 1.0) { float f = (1.0 - x) * (1.0 - x); sum += f; top = max(top, f); shadeSum += f * dot(d, SHADE) / uRadius[i]; }
  }
  float field = top + (sum - top) * uMerge;
  if (field <= ISO - EDGE) { outColour = vec4(uTray, 1); return; }
  // Blue to mint to green across each blob, a lighter middle, and a darker soft rim, as on the Pocket's screen.
  float t = sum > 0.0 ? shadeSum / sum : 0.0;
  vec3 c = mix(mix(uBlue, uMint, smoothstep(-0.75, 0.0, t)), uGreen, smoothstep(-0.1, 0.6, t));
  float drain = uDrain;
  if (uSuck > 0.005) {   // sucked out: the far side greys first, the grey creeping toward the low side
    float u = clamp((dot(p, uAway) - uLo) / max(uHi - uLo, 1.0), 0.0, 1.0);
    float own = clamp(uDrain * (1.0 + uSuck) - uSuck * (1.0 - u), 0.0, 1.0);
    drain = mix(own, own * own * (3.0 - 2.0 * own), clamp(uSuck, 0.0, 1.0));
  }
  c = spend(c, drain);
  c = mix(c, vec3(1), CENTER_LIGHTEN * (1.0 - exp(-max(field - ISO, 0.0) * CENTER_LIGHT_RATE)) * 1.6);
  c = mix(c, c * RIM, 1.0 - smoothstep(ISO - EDGE, ISO + 0.1, field));
  float cover = smoothstep(ISO - EDGE, ISO + EDGE, field);
  outColour = vec4(mix(uTray, c, cover), 1);
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
const u = Object.fromEntries(['uRes', 'uScale', 'uCount', 'uCentre', 'uRadius', 'uTable', 'uMerge', 'uDrain', 'uSuck', 'uLo', 'uHi', 'uAway', 'uTray', 'uBlue', 'uMint', 'uGreen'].map(n => [n, gl.getUniformLocation(program, n)]));
gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, BINS, MAX_BODIES, 0, gl.RED, gl.FLOAT, table);
gl.uniform1i(u.uTable, 0);
gl.uniform3fv(u.uTray, TRAY); gl.uniform3fv(u.uBlue, BLUE); gl.uniform3fv(u.uMint, MINT); gl.uniform3fv(u.uGreen, GREEN);
const centres = new Float32Array(MAX_BODIES * 2), radii = new Float32Array(MAX_BODIES);
let awayX = 0, awayY = -1;

function draw() {
  outlineTables();
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BINS, MAX_BODIES, gl.RED, gl.FLOAT, table);
  world.bodies.forEach((b, i) => { centres[i * 2] = b.cx; centres[i * 2 + 1] = b.cy; radii[i] = b.radius; });
  const gm = Math.hypot(world.gravityX, world.gravityY);
  if (gm > .05) { awayX = -world.gravityX / gm; awayY = -world.gravityY / gm; }
  let lo = Infinity, hi = -Infinity;
  for (const b of world.bodies) for (const n of b.nodes) { const d = n.x * awayX + n.y * awayY; lo = Math.min(lo, d); hi = Math.max(hi, d); }
  gl.uniform2f(u.uRes, canvas.width, canvas.height); gl.uniform1f(u.uScale, unit * dpr);
  gl.uniform1i(u.uCount, world.count); gl.uniform2fv(u.uCentre, centres); gl.uniform1fv(u.uRadius, radii);
  gl.uniform1f(u.uMerge, 1 - world.drain * (1 - world.squish));
  gl.uniform1f(u.uDrain, world.drain); gl.uniform1f(u.uSuck, suckW * SUCK_STRENGTH);
  gl.uniform1f(u.uLo, lo); gl.uniform1f(u.uHi, hi); gl.uniform2f(u.uAway, awayX, awayY);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(.1, (now - last) / 1000); last = now;
  update(dt);
  world.advance(dt);
  draw();
  if (!hud.hidden) hud.textContent = `tip ${tilt.deg.toFixed(0)}°  drain ${(world.drain * 10).toFixed(1)} s  squish ${world.squish.toFixed(2)}  recovery ×${RECOVERY_RATIO}`;
  requestAnimationFrame(frame);
}
layout();
speak();
requestAnimationFrame(frame);
window.harveyTray = { get world() { return world; }, get drainSeconds() { return seconds; }, set drainSeconds(v) { seconds = v; } };
