// The Harvey Pocket's screen in the browser: a port of firmware/harvey_pocket/harvey_pocket.ino's input and drawing
// on top of board-softbody.mjs (its physics). Same tipping, drain, melt, recovery, wax field, colour ramps, sucked-out
// colour front and send ring. What stands in for hardware:
// - the motion sensor: drag on the screen to tip it (the drag's direction is downhill; 216 px is 60°); let go and it
//   settles level, like putting the board down;
// - the button: hold Space, or the round button beside the screen; three quick presses reset;
// - the relay: a release of 0.4 s or more always counts as sent (white ring); nothing goes to the Lounge.
// Not ported: the colour wheel (long-press a blob), sleep after ten minutes, the 16-bit panel and its dither.
import { SoftBodyWorld, BODY_COUNT, NODES } from './softbody.mjs';

const params = new URLSearchParams(location.search);
const SIZE = 480, HALF = SIZE / 2, HALF_STRIDE = HALF + 1, HALF_ROWS = HALF + 1, SAMPLES = 2;
const COARSE = 64, ANGLES = 256, REACH = 90, FIELD_STEPS = 128, LEVELS = 256, FIELD_ONE = 4096;
const CENTER_LIGHTEN = .2, CENTER_LIGHT_RATE = 1.1, FIELD_ISO = .2, FIELD_EDGE = .1, EDGE_SHARE = .553, KERNEL_SQUARED = 1 / EDGE_SHARE, KERNEL = 1.345, DRAINED_MUTE = .8;
const HALF_MASK = 0x0FF3FCFF, BACK_R = 24, BACK_G = 24, BACK_B = 24;
const BASELINE_COLOUR = 0x3BD7;   // #3F7ABB as RGB565, as the firmware holds it
const FIRM_SECONDS = 10, RECOVERY_RATIO = Number(params.get('recovery')) || 60;
const TIP_DEAD_DEGREES = 10, TIP_FULL_DEGREES = 60, TIP_FASTEST_SECONDS = 3, TIP_CURVE = 1.5, MAX_TILT_G = .6;
const RING_SECONDS = 1.5, RING_FADE_SECONDS = .4, RING_RADIUS = 234, RING_THICKNESS = 3, MIN_HOLD_SECONDS = .4, TRIPLE_SECONDS = .5;
const DRAG_FOR_60 = 216, TIP_FOLLOW = .06, SETTLE_SECONDS = .5;   // web only: how the drag tips the virtual board
const RAD = Math.PI / 180;

// Tables, as buildTables().
const turn = (y, x) => {
  const ax = Math.abs(x), ay = Math.abs(y), a = Math.min(ax, ay) / (Math.max(ax, ay) + 1e-6); let t = a * (.785398 + .273 * (1 - a)) / 6.2831853;
  if (ay > ax) t = .25 - t;
  if (x < 0) t = .5 - t;
  if (y < 0) t = 1 - t;
  return t;
};
const smooth = a => a <= 0 ? 0 : a >= 1 ? 1 : a * a * (3 - 2 * a);
const fieldOf = new Uint16Array(FIELD_STEPS), coverOf = new Uint16Array(LEVELS + 1), glowOf = new Uint8Array(LEVELS + 1);
const AW = REACH * 2 + 1, angleOf = new Uint8Array(AW * AW);
for (let k = 0; k < FIELD_STEPS; k++) { const falloff = 1 - k / FIELD_STEPS; fieldOf[k] = falloff * falloff * FIELD_ONE; }
for (let k = 0; k <= LEVELS; k++) {
  const field = k / LEVELS;
  coverOf[k] = smooth((field - (FIELD_ISO - FIELD_EDGE)) / (FIELD_EDGE * 2)) * 256;
  glowOf[k] = field > FIELD_ISO ? CENTER_LIGHTEN * (1 - Math.exp(-(field - FIELD_ISO) * CENTER_LIGHT_RATE)) * 255 : 0;
}
for (let y = -REACH; y <= REACH; y++) for (let x = -REACH; x <= REACH; x++) angleOf[(y + REACH) * AW + x + REACH] = Math.trunc(turn(y, x) * ANGLES + .5) % ANGLES;

function buildRamp(out, c, drain) {
  let red = (c >> 8 & 0xF8) | c >> 13, green = (c >> 3 & 0xFC) | (c >> 9 & 3), blue = (c << 3 & 0xF8) | (c >> 2 & 7);
  const grey = (red * 77 + green * 151 + blue * 28) >> 8, mute = Math.trunc(drain * DRAINED_MUTE * 256);
  red += (grey - red) * mute >> 8; green += (grey - green) * mute >> 8; blue += (grey - blue) * mute >> 8;
  for (let k = 0; k <= LEVELS; k++) {
    const glow = glowOf[k], cover = coverOf[k];
    let r = red + ((255 - red) * glow >> 8), g = green + ((255 - green) * glow >> 8), b = blue + ((255 - blue) * glow >> 8);
    r = BACK_R + ((r - BACK_R) * cover >> 8); g = BACK_G + ((g - BACK_G) * cover >> 8); b = BACK_B + ((b - BACK_B) * cover >> 8);
    out[k] = (Math.min(r, 248) << 20 | Math.min(g, 252) << 10 | Math.min(b, 248)) >>> 0;
  }
}

// One blob's outline as its edge distance by angle, as traceEdge().
const lightScale = Array.from({ length: BODY_COUNT }, () => new Float32Array(ANGLES)), bodyReach = new Float32Array(BODY_COUNT);
const table = new Float32Array(COARSE), smoothed = new Float32Array(COARSE);
function traceEdge(nodes, cx, cy, light, i) {
  table.fill(0);
  for (let n = 0; n < NODES; n++) {
    const c = nodes[n], p = nodes[(n + NODES - 1) % NODES], q = nodes[(n + 1) % NODES];
    const sx = (p.x + c.x) / 2, sy = (p.y + c.y) / 2, ex = (c.x + q.x) / 2, ey = (c.y + q.y) / 2;
    for (let k = 0; k < SAMPLES; k++) {
      const t = k / SAMPLES, m = 1 - t, x = m * m * sx + 2 * m * t * c.x + t * t * ex - cx, y = m * m * sy + 2 * m * t * c.y + t * t * ey - cy;
      const d = Math.sqrt(x * x + y * y), bin = Math.trunc(turn(y, x) * COARSE + .5) % COARSE;
      if (d > table[bin]) table[bin] = d;
    }
  }
  let start = 0; while (start < COARSE && table[start] === 0) start++;
  if (start === COARSE) return;
  for (let done = 0, a = start; done < COARSE;) {
    let gap = 1; while (gap < COARSE && table[(a + gap) % COARSE] === 0) gap++;
    const from = table[a], to = table[(a + gap) % COARSE];
    for (let k = 1; k < gap; k++) table[(a + k) % COARSE] = from + (to - from) * k / gap;
    a = (a + gap) % COARSE; done += gap;
  }
  for (let pass = 0; pass < 3; pass++) {
    for (let a = 0; a < COARSE; a++) smoothed[a] = (table[(a + COARSE - 1) % COARSE] + 2 * table[a] + table[(a + 1) % COARSE]) / 4;
    table.set(smoothed);
  }
  let reach = 0;
  for (let a = 0; a < ANGLES; a++) {
    const k = Math.trunc(a * COARSE / ANGLES), t = (a * COARSE % ANGLES) / ANGLES, e = Math.max(table[k] + (table[(k + 1) % COARSE] - table[k]) * t, 1);
    light[a] = FIELD_STEPS / (KERNEL_SQUARED * e * e); if (e > reach) reach = e;
  }
  bodyReach[i] = reach;
}

// The whole frame's half-resolution field: sum << 16 | strongest, then packed colours (10 bits a channel).
const half = new Uint32Array(HALF_ROWS * HALF_STRIDE);
function shade(i, cx, cy) {
  const lights = lightScale[i], reach = Math.min(bodyReach[i] * KERNEL + 1, REACH * 2 - 2), reach2 = reach * reach;
  for (let row = 0; row < HALF_ROWS; row++) {
    const dy = row * 2 + .5 - cy, dy2 = dy * dy;
    if (dy2 >= reach2) continue;
    const chord = Math.sqrt(reach2 - dy2); let first = Math.ceil((cx - chord - .5) / 2), last = Math.floor((cx + chord - .5) / 2);
    if (first < 0) first = 0; if (last > HALF) last = HALF;
    const iy = Math.trunc(dy / 2 + REACH + .5), angles = iy * AW, base = row * HALF_STRIDE;
    let ix = Math.trunc((first * 2 + .5 - cx) / 2 + REACH + .5), dx = first * 2 + .5 - cx;
    for (let j = first; j <= last; j++, dx += 2, ix++) {
      const depth = Math.trunc((dx * dx + dy2) * lights[angleOf[angles + ix]]);
      if (depth >= FIELD_STEPS) continue;
      const field = fieldOf[depth], v = half[base + j], sum = (v >>> 16) + field, top = v & 0xFFFF;
      half[base + j] = (sum << 16 | (field > top ? field : top)) >>> 0;
    }
  }
}
const ramp = new Uint32Array(LEVELS + 1);
function colourRows(merge) {
  for (let row = 0; row < HALF_ROWS; row++) {
    const base = row * HALF_STRIDE;
    for (let j = 0; j <= HALF; j++) {
      const v = half[base + j], top = v & 0xFFFF, field = top + (((v >>> 16) - top) * merge >> 8); let level = field >> 4; if (level > LEVELS) level = LEVELS;
      const colours = ramp;
      half[base + j] = colours[level];
    }
  }
}
// Scale up as enlarge(): even rows from one half row, odd rows between two; odd columns between neighbours.
const between = (a, b) => ((a + b) >>> 1 & HALF_MASK) >>> 0;
const toPixel = v => (0xFF000000 | (v & 1023) << 16 | (v >>> 10 & 1023) << 8 | (v >>> 20 & 1023)) >>> 0;
function enlarge(out) {
  for (let r = 0; r < SIZE; r++) {
    const a = (r >> 1) * HALF_STRIDE, b = a + HALF_STRIDE, o = r * SIZE;
    let v = r & 1 ? between(half[a], half[b]) : half[a];
    for (let j = 0; j < HALF; j++) {
      const next = r & 1 ? between(half[a + j + 1], half[b + j + 1]) : half[a + j + 1];
      out[o + 2 * j] = toPixel(v); out[o + 2 * j + 1] = toPixel(between(v, next)); v = next;
    }
  }
}

// The page.
const canvas = document.getElementById('screen'), ctx = canvas.getContext('2d'), image = ctx.createImageData(SIZE, SIZE), pixels = new Uint32Array(image.data.buffer);
const buttonEl = document.getElementById('button'), readout = document.getElementById('readout');
const world = new SoftBodyWorld(); world.init(Number(params.get('seed')) || (Math.random() * 2 ** 32) >>> 0);

// The virtual board: its facing (screen x right, y down, z out), following the drag.
const up = { x: 0, y: 0, z: 1 }, aim = { x: 0, y: 0, z: 1 };
let dragging = null, released = true;
function aimFrom(dx, dy) {
  const d = Math.hypot(dx, dy), angle = Math.min(d / DRAG_FOR_60 * 60, 90) * RAD, s = Math.sin(angle);
  aim.x = d > 0 ? dx / d * s : 0; aim.y = d > 0 ? dy / d * s : 0; aim.z = Math.cos(angle);
}
const toCanvas = e => { const box = canvas.getBoundingClientRect(); return [(e.clientX - box.left) * SIZE / box.width, (e.clientY - box.top) * SIZE / box.height]; };
canvas.addEventListener('pointerdown', e => { if (e.target !== canvas) return; canvas.setPointerCapture(e.pointerId); dragging = { id: e.pointerId, start: toCanvas(e) }; released = false; });
canvas.addEventListener('pointermove', e => { if (!dragging || e.pointerId !== dragging.id) return; const [x, y] = toCanvas(e); aimFrom(x - dragging.start[0], y - dragging.start[1]); });
const letGo = e => { if (!dragging || e.pointerId !== dragging.id) return; dragging = null; released = true; aim.x = aim.y = 0; aim.z = 1; };
canvas.addEventListener('pointerup', letGo); canvas.addEventListener('pointercancel', letGo);

// The button, as PocketButton: pressing is holding; three presses each within 0.5 s of the last reset.
const button = { down: false, held: false, presses: 0, lastPress: -1e9, heldFrom: 0 };
const press = { x: 0, y: 0, z: 1 };
let seconds = 0, tipNow = 0, ringStarted = -1e9, ringColour = '#ffffff';
function buttonDown(now) {
  if (button.down) return; button.down = true;
  button.presses = button.presses && now - button.lastPress <= TRIPLE_SECONDS ? button.presses + 1 : 1; button.lastPress = now;
  if (button.presses === 3) { button.presses = 0; seconds = 0; ringStarted = now; ringColour = '#ffffff'; return; }
  button.held = true; button.heldFrom = now; press.x = up.x; press.y = up.y; press.z = up.z;
  buttonEl.classList.add('down');
}
function buttonUp(now) {
  if (!button.down) return; button.down = false; buttonEl.classList.remove('down');
  if (!button.held) return; button.held = false;
  if (now - button.heldFrom >= MIN_HOLD_SECONDS) { ringStarted = now; ringColour = '#ffffff'; }   // no relay here: always "sent"
}
const clock = () => performance.now() / 1000;
addEventListener('keydown', e => { if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) buttonDown(clock()); } });
addEventListener('keyup', e => { if (e.code === 'Space') { e.preventDefault(); buttonUp(clock()); } });
addEventListener('blur', () => buttonUp(clock()));
buttonEl.addEventListener('pointerdown', e => { e.preventDefault(); buttonEl.setPointerCapture(e.pointerId); buttonDown(clock()); });
buttonEl.addEventListener('pointerup', () => buttonUp(clock()));
buttonEl.addEventListener('pointercancel', () => buttonUp(clock()));

let last = clock(), frames = 0, fpsAt = last, fps = 0;
function frame() {
  const now = clock(), dt = Math.min(now - last, .05); last = now;
  // The board's facing follows the hand; let go, it settles level.
  const k = 1 - Math.exp(-dt / (released ? SETTLE_SECONDS / 3 : TIP_FOLLOW));
  up.x += (aim.x - up.x) * k; up.y += (aim.y - up.y) * k; up.z += (aim.z - up.z) * k;
  const n = Math.hypot(up.x, up.y, up.z); up.x /= n; up.y /= n; up.z /= n;
  // inputTask: gravity capped at 0.6 g; tipping from the press; melt; drain and recovery.
  let tiltX = up.x, tiltY = up.y; const tilt = Math.hypot(tiltX, tiltY);
  if (tilt > MAX_TILT_G) { tiltX *= MAX_TILT_G / tilt; tiltY *= MAX_TILT_G / tilt; }
  const facing = up.x * press.x + up.y * press.y + up.z * press.z, tipped = Math.acos(Math.max(-1, Math.min(1, facing))) / RAD;
  const tip = Math.min(1, Math.max(0, (tipped - TIP_DEAD_DEGREES) / (TIP_FULL_DEGREES - TIP_DEAD_DEGREES)));
  tipNow = button.held ? tip : 0;
  if (button.held) seconds = Math.min(FIRM_SECONDS, seconds + dt * tip ** TIP_CURVE * FIRM_SECONDS / TIP_FASTEST_SECONDS);
  else seconds = Math.max(0, seconds - dt / RECOVERY_RATIO);
  const drain = seconds / FIRM_SECONDS;
  // physicsTask.
  world.gravityX = tiltX; world.gravityY = tiltY; world.drain = drain;
  world.advance(dt);
  // drawFrame.
  const merge = Math.trunc((1 - drain) * 256);
  buildRamp(ramp, BASELINE_COLOUR, drain);
  half.fill(0);
  world.bodies.forEach((b, i) => { traceEdge(b.nodes, b.cx, b.cy, lightScale[i], i); shade(i, b.cx, b.cy); });
  colourRows(merge);
  enlarge(pixels);
  ctx.putImageData(image, 0, 0);
  const ringAge = now - ringStarted, ringAlpha = ringAge < RING_SECONDS ? Math.min(1, (RING_SECONDS - ringAge) / RING_FADE_SECONDS) : 0;
  if (ringAlpha > 0) { ctx.globalAlpha = ringAlpha; ctx.strokeStyle = ringColour; ctx.lineWidth = RING_THICKNESS; ctx.beginPath(); ctx.arc(240, 240, RING_RADIUS, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; }
  frames++; if (now - fpsAt > 1) { fps = frames / (now - fpsAt); frames = 0; fpsAt = now; }
  readout.textContent = `tilt ${Math.hypot(tiltX, tiltY).toFixed(2)} g · tip ${tipNow.toFixed(2)} · drain ${seconds.toFixed(1)} s of 10 · ${button.held ? 'held' : 'released'} · ${fps.toFixed(0)} fps`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.pocket = { world, get seconds() { return seconds; }, set seconds(v) { seconds = v; }, up, aim, buttonDown, buttonUp, clock };
