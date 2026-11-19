// X-ray page. The screen is Harvey Lounge: three populations drifting and merging, yours in blue. The Harvey Pocket
// is a round lens that follows the pointer; over your blobs it x-rays the Lounge into the Pocket's own screen (over
// anyone else's it stays clear glass: a Pocket only shows its own population). Hold and drag to tip it: inside, the
// blobs melt and drain exactly as on the device (pocket-softbody.mjs and the firmware's drain rules). Let go and the
// Pocket sends its signal, a pulse out into the Lounge, and your population there stops merging until it recovers.
import { SoftBodyWorld, NODES } from './pocket-softbody.mjs';

const params = new URLSearchParams(location.search);
const num = (k, d) => { const v = parseFloat(params.get(k)); return Number.isFinite(v) ? v : d; };
const rgb = h => [0, 2, 4].map(i => parseInt(h.slice(i + 1, i + 3), 16) / 255);

// The Pocket, from the firmware.
const TIP_DEAD_DEGREES = 10, TIP_FULL_DEGREES = 60, TIP_FASTEST_SECONDS = 3, TIP_CURVE = 1.5, FIRM_SECONDS = 10, MAX_TILT_G = .6;
const SQUISH_IN = .3, SQUISH_OUT = .8, MELT_START = .3, MELT_SECONDS = 4, SUCK_IN = .3, SUCK_OUT = 1.5, SUCK_STRENGTH = 2;
const POCKET_GLASS = rgb('#1c1c1c'), YOURS = rgb('#3f7abb');
// The web's own: a drag of PULL_FULL × the screen's short side tips 60°; the lens is drawn tipped VISUAL_SHARE of that.
const PULL_FULL = num('pull', .3), VISUAL_SHARE = .35, LEVEL_SECONDS = .6, RECOVERY_RATIO = num('recovery', 6), SEND_DELAY = .45;
// The Lounge: yours and two flatmates' populations on white.
const PAPER = rgb('#ffffff'), PALETTE = [YOURS, rgb('#c2e596'), rgb('#b2d8e5')], LOUNGE_MUTE = .8;

const lounge = document.getElementById('lounge'), pocketCanvas = document.getElementById('pocket');
const lens = document.querySelector('.lens'), device = document.querySelector('.device'), pulse = document.querySelector('.pulse'), hint = document.querySelector('.hint');
const glL = lounge.getContext('webgl2', { antialias: false }), glP = pocketCanvas.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: false });
if (!glL || !glP) { document.body.classList.add('no-webgl'); throw new Error('WebGL2 is needed'); }

const hash = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// ---------------- the Lounge ----------------
const room = { w: 1, h: 1, r: 1, blobs: [], time: 0, drain: 0 };
function setupRoom() {
  const w = innerWidth, h = innerHeight, fresh = !room.blobs.length, sx = w / room.w, sy = h / room.h;
  Object.assign(room, { w, h, r: Math.min(w, h) * .075 });
  if (!fresh) { for (const b of room.blobs) { b.x *= sx; b.y *= sy; b.r = room.r * b.size; } return; }
  let k = 0;
  for (let pop = 0; pop < 3; pop++) for (let n = 0; n < 3; n++, k++) {
    const size = .8 + hash(k) * .4, [ax, ay] = anchorOf(pop), a = hash(k + 20) * Math.PI * 2;
    room.blobs.push({ x: ax + Math.cos(a) * room.r, y: ay + Math.sin(a) * room.r, vx: 0, vy: 0, r: room.r * size, size, pop, seed: k });
  }
}
function anchorOf(pop) {   // the populations circle slowly around the middle; a low battery takes yours out to the side
  const S = Math.min(room.w, room.h), t = room.time * .045, a = t + pop * Math.PI * 2 / 3, d = pop === 0 ? room.drain : 0;
  const spread = .13 + .2 * d;
  return [room.w / 2 + Math.cos(a) * spread * S * 1.25, room.h / 2 + Math.sin(a) * spread * S];
}
function stepRoom(h) {
  room.time += h; const B = room.blobs, d = room.drain;
  for (const b of B) {
    const [ax, ay] = anchorOf(b.pop), t = room.time, s = b.seed, mine = b.pop === 0, calm = mine ? 1 - .55 * d : 1;
    b.fx = (ax - b.x) * 2.2 + 38 * calm * Math.sin(t * .4 * calm + s * 1.9); b.fy = (ay - b.y) * 2.2 + 38 * calm * Math.cos(t * .33 * calm + s * 2.7);
  }
  // Blobs overlap and merge; with a low battery yours keep a gap, from each other and from everyone else.
  for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
    const P = B[i], Q = B[j], dx = Q.x - P.x, dy = Q.y - P.y, dist = Math.hypot(dx, dy) || 1e-6, nx = dx / dist, ny = dy / dist;
    const involved = P.pop === 0 || Q.pop === 0, between = (P.pop === 0) !== (Q.pop === 0);
    const keep = (P.r + Q.r) * (.62 + (involved ? (between ? .75 : .45) * d : 0));
    if (dist < keep) { const f = (300 + 700 * (involved ? d : 0)) * (1 - dist / keep); P.fx -= nx * f; P.fy -= ny * f; Q.fx += nx * f; Q.fy += ny * f; }
  }
  for (const b of B) {
    const damping = b.pop === 0 ? 1.8 + 2 * d : 1.8;
    b.vx = (b.vx + b.fx * h) * Math.exp(-damping * h); b.vy = (b.vy + b.fy * h) * Math.exp(-damping * h);
    b.x += b.vx * h; b.y += b.vy * h;
  }
}
function yourCentre() { let x = 0, y = 0, n = 0; for (const b of room.blobs) if (b.pop === 0) { x += b.x; y += b.y; n++; } return [x / n, y / n]; }

const VERT = `#version 300 es
in vec2 p; void main() { gl_Position = vec4(p, 0, 1); }`;
function program(gl, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  gl.useProgram(p);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const at = gl.getAttribLocation(p, 'p'); gl.enableVertexAttribArray(at); gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
  return name => gl.getUniformLocation(p, name);
}
// Your population merges with nothing as its battery drops: its own field joins at mergeYours, and against everyone
// else's the two fields only add at mergeYours too. Colour: blended where they meet, yours muted 80% at the lowest.
const LOUNGE_FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform float uDpr; uniform int uCount; uniform vec4 uBlob[9];
uniform vec3 uPalette[3], uBg; uniform float uMergeYours, uMute;
out vec4 outColour;
const float KERNEL_SQUARED = 1.0 / 0.553, ISO = 0.2;
void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  float ySum = 0.0, yTop = 0.0, oSum = 0.0; vec3 oCol = vec3(0);
  for (int i = 0; i < 9; i++) {
    if (i >= uCount) break;
    vec4 b = uBlob[i]; vec2 d = p - b.xy; float x = dot(d, d) / (KERNEL_SQUARED * b.z * b.z);
    if (x < 1.0) { float f = (1.0 - x) * (1.0 - x); if (b.w < 0.5) { ySum += f; yTop = max(yTop, f); } else { oSum += f; oCol += f * uPalette[int(b.w)]; } }
  }
  float yours = yTop + (ySum - yTop) * uMergeYours;
  float field = max(yours, oSum) + min(yours, oSum) * uMergeYours;
  vec3 mine = mix(uPalette[0], vec3(dot(uPalette[0], vec3(.299, .587, .114))), uMute);
  vec3 c = (yours * mine + oCol) / max(yours + oSum, 1e-5);
  if (yours > oSum && uMergeYours < 0.5) c = mix(c, mine, 1.0 - 2.0 * uMergeYours);
  c = mix(c, vec3(1), 0.28 * (1.0 - exp(-max(field - ISO, 0.0) * 1.4)));
  c = mix(c, c * 0.6, 1.0 - smoothstep(ISO, ISO + 0.13, field));
  float cover = smoothstep(ISO - 0.035, ISO + 0.045, field);
  outColour = vec4(mix(uBg, c, cover), 1);
}`;
const UL = program(glL, LOUNGE_FRAG);
glL.uniform3fv(UL('uPalette'), PALETTE.flat()); glL.uniform3fv(UL('uBg'), PAPER);
const loungeData = new Float32Array(9 * 4);
function drawLounge() {
  room.blobs.forEach((b, i) => loungeData.set([b.x, b.y, b.r, b.pop], i * 4));
  glL.viewport(0, 0, lounge.width, lounge.height);
  glL.uniform2f(UL('uRes'), lounge.width, lounge.height); glL.uniform1f(UL('uDpr'), dpr);
  glL.uniform1i(UL('uCount'), room.blobs.length); glL.uniform4fv(UL('uBlob'), loungeData);
  glL.uniform1f(UL('uMergeYours'), 1 - room.drain); glL.uniform1f(UL('uMute'), LOUNGE_MUTE * room.drain);
  glL.drawArrays(glL.TRIANGLES, 0, 3);
}

// ---------------- the Pocket ----------------
const pocket = new SoftBodyWorld({ width: 480, height: 480, count: 3, radius: 75, cornerRadius: 240, seed: (Math.random() * 2 ** 32) >>> 0 });
let seconds = 0, meltNow = 0, suckW = 0;
const BINS = 64, table = new Float32Array(BINS * 3), coarse = new Float32Array(BINS), smoothed = new Float32Array(BINS);
function outlineTables() {   // outline radius by angle per blob, as in the firmware
  pocket.bodies.forEach((b, k) => {
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
// The Pocket's screen: its wax on dark glass (soft edge, lighter middle), muting to grey and dimming to half as it drains,
// the colour sucked out from the far side toward the tipped side while held.
const POCKET_FRAG = `#version 300 es
precision highp float;
uniform float uSize; uniform vec2 uCentre[3]; uniform highp sampler2D uTable;
uniform float uMerge, uDrain, uSuck, uLo, uHi; uniform vec2 uAway; uniform vec3 uGlass, uColour;
out vec4 outColour;
const float TAU = 6.2831853, KERNEL_SQUARED = 1.0 / 0.553, ISO = 0.2, EDGE = 0.1;
float radiusAt(int i, float a) {
  float f = a / TAU * ${BINS}.0, i0 = floor(f), t = f - i0; int lo = int(i0) % ${BINS}, hi = (lo + 1) % ${BINS};
  return mix(texelFetch(uTable, ivec2(lo, i), 0).r, texelFetch(uTable, ivec2(hi, i), 0).r, t);
}
void main() {
  vec2 p = vec2(gl_FragCoord.x, uSize - gl_FragCoord.y) / uSize * 480.0;
  float sum = 0.0, top = 0.0;
  for (int i = 0; i < 3; i++) {
    vec2 d = p - uCentre[i]; float a = atan(d.y, d.x); if (a < 0.0) a += TAU;
    float e = radiusAt(i, a), x = dot(d, d) / (KERNEL_SQUARED * e * e);
    if (x < 1.0) { float f = (1.0 - x) * (1.0 - x); sum += f; top = max(top, f); }
  }
  float field = top + (sum - top) * uMerge, drain = uDrain;
  if (uSuck > 0.005) {
    float u = clamp((dot(p, uAway) - uLo) / max(uHi - uLo, 1.0), 0.0, 1.0), own = clamp(uDrain * (1.0 + uSuck) - uSuck * (1.0 - u), 0.0, 1.0);
    drain = mix(own, own * own * (3.0 - 2.0 * own), clamp(uSuck, 0.0, 1.0));
  }
  vec3 c = mix(uColour, vec3(dot(uColour, vec3(77, 151, 28) / 256.0)), drain);
  c *= 1.0 - drain * 0.5;
  c = mix(c, vec3(1), 0.2 * (1.0 - exp(-max(field - ISO, 0.0) * 1.1)));
  float cover = smoothstep(ISO - EDGE, ISO + EDGE, field);
  outColour = vec4(mix(uGlass, c, cover), 1);
}`;
const UP = program(glP, POCKET_FRAG);
glP.bindTexture(glP.TEXTURE_2D, glP.createTexture());
glP.texParameteri(glP.TEXTURE_2D, glP.TEXTURE_MIN_FILTER, glP.NEAREST); glP.texParameteri(glP.TEXTURE_2D, glP.TEXTURE_MAG_FILTER, glP.NEAREST);
glP.texImage2D(glP.TEXTURE_2D, 0, glP.R32F, BINS, 3, 0, glP.RED, glP.FLOAT, table);
glP.uniform1i(UP('uTable'), 0); glP.uniform3fv(UP('uGlass'), POCKET_GLASS); glP.uniform3fv(UP('uColour'), YOURS);
const pocketCentres = new Float32Array(6);
let awayX = 0, awayY = -1;
function drawPocket() {
  outlineTables();
  glP.texSubImage2D(glP.TEXTURE_2D, 0, 0, 0, BINS, 3, glP.RED, glP.FLOAT, table);
  pocket.bodies.forEach((b, i) => pocketCentres.set([b.cx, b.cy], i * 2));
  const gm = Math.hypot(pocket.gravityX, pocket.gravityY); if (gm > .05) { awayX = -pocket.gravityX / gm; awayY = -pocket.gravityY / gm; }
  let lo = Infinity, hi = -Infinity;
  for (const b of pocket.bodies) for (const n of b.nodes) { const d = n.x * awayX + n.y * awayY; lo = Math.min(lo, d); hi = Math.max(hi, d); }
  glP.viewport(0, 0, pocketCanvas.width, pocketCanvas.height);
  glP.uniform1f(UP('uSize'), pocketCanvas.width); glP.uniform2fv(UP('uCentre'), pocketCentres);
  glP.uniform1f(UP('uMerge'), 1 - pocket.drain * (1 - pocket.squish)); glP.uniform1f(UP('uDrain'), pocket.drain);
  glP.uniform1f(UP('uSuck'), suckW * SUCK_STRENGTH); glP.uniform1f(UP('uLo'), lo); glP.uniform1f(UP('uHi'), hi); glP.uniform2f(UP('uAway'), awayX, awayY);
  glP.drawArrays(glP.TRIANGLES, 0, 3);
}

// ---------------- the lens: following, x-raying, held and tipped ----------------
const pointer = { x: innerWidth * .78, y: innerHeight * .72, seen: false };
const hold = { on: false, x: 0, y: 0, px: 0, py: 0 };
const lensPos = { x: pointer.x, y: pointer.y, vx: 0, vy: 0 };
const tilt = { x: 0, y: 1, deg: 0 };
let xray = 0, lensR = 1, sendAt = -1, clock = 0, usedOnce = false;
addEventListener('pointermove', e => {
  pointer.x = e.clientX; pointer.y = e.clientY; pointer.seen = true;
  if (hold.on) { hold.px = e.clientX; hold.py = e.clientY; }
});
addEventListener('pointerdown', e => {
  pointer.x = e.clientX; pointer.y = e.clientY;
  if (xray < .5) { lens.classList.remove('nope'); void lens.offsetWidth; lens.classList.add('nope'); return; }   // not over your blobs
  Object.assign(hold, { on: true, x: e.clientX, y: e.clientY, px: e.clientX, py: e.clientY });
  meltNow = 0; document.body.classList.add('holding');
  if (!usedOnce) { usedOnce = true; hint.classList.add('gone'); }
});
const release = () => {
  if (!hold.on) return;
  hold.on = false; document.body.classList.remove('holding');
  sendAt = clock + SEND_DELAY;   // the signal goes out on release, as on the device
  pulse.style.left = `${lensPos.x}px`; pulse.style.top = `${lensPos.y}px`;
  pulse.classList.remove('go'); void pulse.offsetWidth; pulse.classList.add('go');
};
addEventListener('pointerup', release); addEventListener('pointercancel', release);
addEventListener('keydown', e => { if (e.key === 'r') { seconds = 0; room.drain = 0; } });

function update(dt) {
  clock += dt;
  // The lens trails the pointer; while held it stays put.
  if (!hold.on) {
    const K = 60, C = 13;
    lensPos.vx += ((pointer.x - lensPos.x) * K - lensPos.vx * C) * dt; lensPos.vy += ((pointer.y - lensPos.y) * K - lensPos.vy * C) * dt;
    lensPos.x += lensPos.vx * dt; lensPos.y += lensPos.vy * dt;
  }
  // X-ray: how squarely the lens sits over your population.
  const [cx, cy] = yourCentre(), off = Math.hypot(cx - lensPos.x, cy - lensPos.y);
  const target = hold.on ? 1 : 1 - clamp((off - lensR * .45) / (lensR * .9), 0, 1);
  xray += (target - xray) * (1 - Math.exp(-dt * 10));
  // Tipping: the drag from the press tips the Pocket that way.
  let tip = 0;
  if (hold.on) {
    const dx = hold.px - hold.x, dy = hold.py - hold.y, len = Math.hypot(dx, dy), short = Math.min(innerWidth, innerHeight);
    if (len > 2) { tilt.x = dx / len; tilt.y = dy / len; }
    tilt.deg = Math.min(75, len / (PULL_FULL * short) * TIP_FULL_DEGREES);
    tip = clamp((tilt.deg - TIP_DEAD_DEGREES) / (TIP_FULL_DEGREES - TIP_DEAD_DEGREES), 0, 1);
  } else tilt.deg = Math.max(0, tilt.deg - dt * 75 / LEVEL_SECONDS);
  const g = Math.min(MAX_TILT_G, Math.sin(tilt.deg * Math.PI / 180));
  pocket.gravityX = tilt.x * g; pocket.gravityY = tilt.y * g;
  if (hold.on) {
    meltNow = Math.min(1, meltNow + tip * dt / MELT_SECONDS);
    seconds = Math.min(FIRM_SECONDS, seconds + dt * tip ** TIP_CURVE * FIRM_SECONDS / TIP_FASTEST_SECONDS);
  } else seconds = Math.max(0, seconds - dt / RECOVERY_RATIO);
  pocket.drain = seconds / FIRM_SECONDS;
  const melt = hold.on ? Math.max(MELT_START, meltNow) : 0;
  pocket.squish = pocket.squish < melt ? Math.min(melt, pocket.squish + dt / SQUISH_IN) : Math.max(melt, pocket.squish - dt / SQUISH_OUT);
  suckW = hold.on ? Math.min(1, suckW + dt / SUCK_IN) : Math.max(0, suckW - dt / SUCK_OUT);
  // The Lounge hears about it only once the pulse arrives; after that it recovers along with the Pocket.
  if (sendAt > 0 && clock >= sendAt) sendAt = 0;
  if (sendAt === 0 && !hold.on) room.drain = pocket.drain;
  // Place and pose the lens.
  lens.style.transform = `translate(${lensPos.x.toFixed(1)}px, ${lensPos.y.toFixed(1)}px)`;
  const v = tilt.deg * VISUAL_SHARE;
  device.style.transform = `rotateX(${(-tilt.y * v).toFixed(2)}deg) rotateY(${(tilt.x * v).toFixed(2)}deg)`;
  device.style.setProperty('--xray', xray.toFixed(3));
  device.style.setProperty('--deep', Math.min(1, v / 18).toFixed(3));
  device.style.setProperty('--deep-angle', `${(Math.atan2(tilt.y, tilt.x) * 180 / Math.PI + 90).toFixed(1)}deg`);
}

let dpr = 1;
function layout() {
  dpr = Math.min(devicePixelRatio || 1, 2);
  lounge.width = Math.round(innerWidth * dpr); lounge.height = Math.round(innerHeight * dpr);
  lensR = lens.querySelector('.glass').offsetWidth / 2;
  const px = Math.round(lensR * 2 * dpr); pocketCanvas.width = px; pocketCanvas.height = px;
  setupRoom();
}
addEventListener('resize', layout);

let last = performance.now();
function frame(now) {
  const dt = Math.min(.1, (now - last) / 1000); last = now;
  update(dt);
  pocket.advance(dt);
  for (let k = 0; k < 4; k++) stepRoom(dt / 4);
  drawLounge(); drawPocket();
  requestAnimationFrame(frame);
}
layout();
requestAnimationFrame(frame);
window.harveyXray = { pocket, room, get drainSeconds() { return seconds; }, set drainSeconds(v) { seconds = v; }, lensPos, hold, pointer, yourCentre };
