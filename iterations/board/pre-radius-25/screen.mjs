// The Harvey Pocket's screen in the browser, as it was before the bigger blobs (versions/pre-radius-25,
// 2026-11-05): a port of that harvey_pocket.ino's input and drawing on top of softbody.mjs (its physics). Fifty
// soft-edged orange blobs with a slight highlight on #CCCCCC, hollowing to outlines as the drain rises.
// What stands in for hardware:
// - the motion sensor: drag on the screen to tip it (the drag's direction is downhill; 216 px is 60°); let go and it
//   settles level, like putting the board down;
// - shaking: with the button held, dragging moves the board instead, and the pointer's acceleration is the shake;
// - the button: hold Space, or the round button beside the screen; three quick presses reset.
// Not ported: the colour wheel (long-press a blob), sleep after ten minutes, the 16-bit panel and its dither.
import { SoftBodyWorld, BODY_COUNT, NODES, outlineWidth } from './softbody.mjs';

const params = new URLSearchParams(location.search);
const SIZE = 480, SAMPLES = 3, HALF = SIZE / 2, HALF_STRIDE = HALF + 1, HALF_ROWS = HALF + 1, ANGLES = 64, REACH = 40, STEPS = 64;
const SOFT_EDGE = 4.5, MIN_SOFT_EDGE = 2, RIM_LIGHTEN = .22, CENTER_LIGHTEN = .3, CENTER_LIGHT_RATE = 1.1, FIELD_ISO = .2, EDGE_SHARE = .553;
const HALF_BACKGROUND = (204 << 20 | 204 << 10 | 204) >>> 0, HALF_MASK = 0x0FF3FCFF;
const FILL_HUE = 20.2;   // #F47839
// The hue at #F47839's saturation and lightness, as RGB565 (colour_edit.h's colourFor).
function colourFor(hue) {
  const S = .895, L = .590, h = ((hue % 360) + 360) % 360, c = (1 - Math.abs(2 * L - 1)) * S, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = L - c / 2;
  let r, g, b;
  if (h < 60) { r = c; g = x; b = 0; } else if (h < 120) { r = x; g = c; b = 0; } else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; } else if (h < 300) { r = x; g = 0; b = c; } else { r = c; g = 0; b = x; }
  return Math.trunc((r + m) * 31 + .5) << 11 | Math.trunc((g + m) * 63 + .5) << 5 | Math.trunc((b + m) * 31 + .5);
}
const BASELINE_COLOUR = colourFor(FILL_HUE);
const SHAKE_THRESHOLD = 1.4, SHAKE_FULL = 16, SHAKE_MIN = .12, FIRM_SECONDS = 10, RECOVERY_RATIO = Number(params.get('recovery')) || 60, G = 9.80665;
const MAX_TILT_G = .3, MOVE_DEAD_G = .15, MOVE_SMOOTH_SECONDS = .02, TRIPLE_SECONDS = .5;
const DRAG_FOR_60 = 216, TIP_FOLLOW = .06, SETTLE_SECONDS = .5, SHAKE_PX_PER_MS2 = 6000;   // web only
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
const coverOf = new Uint16Array(STEPS + 1), lightOf = new Uint8Array(STEPS + 1), AW = REACH * 2 + 1, angleOf = new Uint8Array(AW * AW);
for (let k = 0; k <= STEPS; k++) coverOf[k] = Math.trunc(smooth(k / STEPS) * 256);
for (let k = 0; k <= STEPS; k++) {
  const falloff = 1 - EDGE_SHARE * k / STEPS, field = falloff * falloff;
  lightOf[k] = Math.trunc((RIM_LIGHTEN + (field > FIELD_ISO ? CENTER_LIGHTEN * (1 - Math.exp(-(field - FIELD_ISO) * CENTER_LIGHT_RATE)) : 0)) * 255);
}
for (let y = -REACH; y <= REACH; y++) for (let x = -REACH; x <= REACH; x++) angleOf[(y + REACH) * AW + x + REACH] = Math.trunc(turn(y, x) * ANGLES + .5) % ANGLES;
// rampFor(): blob colour by depth, 8 bits in each 10-bit field.
const ramp = new Uint32Array(STEPS + 1);
{
  const c = BASELINE_COLOUR, red = (c >> 8 & 0xF8) | c >> 13, green = (c >> 3 & 0xFC) | (c >> 9 & 3), blue = (c << 3 & 0xF8) | (c >> 2 & 7);
  for (let n = 0; n <= STEPS; n++) {
    const glow = lightOf[n], r = red + ((255 - red) * glow >> 8), g = green + ((255 - green) * glow >> 8), b = blue + ((255 - blue) * glow >> 8);
    ramp[n] = (r << 20 | g << 10 | b) >>> 0;
  }
}

// The same smooth outline as tracePath: quadratic curves between edge midpoints, sampled into the edge table.
const edge = Array.from({ length: BODY_COUNT }, () => new Float32Array(ANGLES)), edgeScale = Array.from({ length: BODY_COUNT }, () => new Float32Array(ANGLES));
const lightScale = Array.from({ length: BODY_COUNT }, () => new Float32Array(ANGLES));
const bodyReach = new Float32Array(BODY_COUNT), bodyWidth = new Float32Array(BODY_COUNT);
function traceEdge(nodes, cx, cy, soft, i) {
  const table = edge[i], scale = edgeScale[i], light = lightScale[i]; table.fill(0); let reach = 0;
  for (let n = 0; n < NODES; n++) {
    const c = nodes[n], p = nodes[(n + NODES - 1) % NODES], q = nodes[(n + 1) % NODES];
    const sx = (p.x + c.x) / 2, sy = (p.y + c.y) / 2, ex = (c.x + q.x) / 2, ey = (c.y + q.y) / 2;
    for (let k = 0; k < SAMPLES; k++) {
      const t = k / SAMPLES, m = 1 - t, x = m * m * sx + 2 * m * t * c.x + t * t * ex - cx, y = m * m * sy + 2 * m * t * c.y + t * t * ey - cy;
      const d = Math.sqrt(x * x + y * y), bin = Math.trunc(turn(y, x) * ANGLES + .5) % ANGLES;
      if (d > table[bin]) table[bin] = d;
      if (d > reach) reach = d;
    }
  }
  bodyReach[i] = reach;
  let start = 0; while (start < ANGLES && table[start] === 0) start++;
  if (start === ANGLES) return;
  for (let done = 0, a = start; done < ANGLES;) {
    let gap = 1; while (gap < ANGLES && table[(a + gap) % ANGLES] === 0) gap++;
    const from = table[a], to = table[(a + gap) % ANGLES];
    for (let k = 1; k < gap; k++) table[(a + k) % ANGLES] = from + (to - from) * k / gap;
    a = (a + gap) % ANGLES; done += gap;
  }
  for (let a = 0; a < ANGLES; a++) { const e = Math.max(table[a], 1); scale[a] = STEPS / (soft * 2 * e); light[a] = STEPS / (e * e); }
}
const softness = (width, radius) => width < radius ? Math.min(SOFT_EDGE, Math.max(MIN_SOFT_EDGE, width * .8)) : SOFT_EDGE;

// One blob into the half-resolution frame. A half pixel j sits on panel pixel 2j.
const half = new Uint32Array(HALF_ROWS * HALF_STRIDE), holeSq = new Float32Array(ANGLES), holeScale = new Float32Array(ANGLES);
function shade(i, cx, cy, radius) {
  const table = edge[i], scale = edgeScale[i], lights = lightScale[i], width = bodyWidth[i];
  const reach = Math.min(bodyReach[i] + SOFT_EDGE / 2 + 1, REACH - 1), reach2 = reach * reach, hollow = width < radius;
  if (hollow) {
    const soft = softness(width, radius);
    for (let a = 0; a < ANGLES; a++) { const e = table[a] - width; holeSq[a] = e > 1 ? e * e : -1e6; holeScale[a] = e > 1 ? STEPS / (soft * 2 * e) : 1; }
  }
  for (let row = 0; row < HALF_ROWS; row++) {
    const dy = row * 2 + .5 - cy, dy2 = dy * dy;
    if (dy2 >= reach2) continue;
    const chord = Math.sqrt(reach2 - dy2); let first = Math.ceil((cx - chord - .5) / 2), last = Math.floor((cx + chord - .5) / 2);
    if (first < 0) first = 0; if (last > HALF) last = HALF;
    const iy = Math.trunc(dy + REACH + .5), angles = iy * AW, base = row * HALF_STRIDE;
    let ix = Math.trunc(first * 2 + .5 - cx + REACH + .5), dx = first * 2 + .5 - cx;
    for (let j = first; j <= last; j++, dx += 2, ix += 2) {
      const dist2 = dx * dx + dy2, a = angleOf[angles + ix];
      const e = table[a], step = (e * e - dist2) * scale[a] + STEPS / 2;
      if (step <= 0) continue;
      let cover = step >= STEPS ? 256 : coverOf[Math.trunc(step)];
      if (hollow) {
        const hole = (dist2 - holeSq[a]) * holeScale[a] + STEPS / 2;
        if (hole <= 0) continue;
        if (hole < STEPS) cover = cover * coverOf[Math.trunc(hole)] >> 8;
      }
      const depth = dist2 * lights[a]; let colour = ramp[depth >= STEPS ? STEPS : Math.trunc(depth)];
      if (cover < 256) {
        const v = half[base + j], r0 = v >>> 20, g0 = v >>> 10 & 255, b0 = v & 255, r = colour >>> 20, g = colour >>> 10 & 255, b = colour & 255;
        colour = ((r0 + ((r - r0) * cover >> 8)) << 20 | (g0 + ((g - g0) * cover >> 8)) << 10 | (b0 + ((b - b0) * cover >> 8))) >>> 0;
      }
      half[base + j] = colour;
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
const pointer = { x: 0, y: 0 };
canvas.addEventListener('pointerdown', e => { if (e.target !== canvas) return; canvas.setPointerCapture(e.pointerId); dragging = { id: e.pointerId, start: toCanvas(e) }; released = false; [pointer.x, pointer.y] = toCanvas(e); });
canvas.addEventListener('pointermove', e => {
  if (!dragging || e.pointerId !== dragging.id) return; const [x, y] = toCanvas(e);
  if (!button.held) aimFrom(x - dragging.start[0], y - dragging.start[1]);
  pointer.x = x; pointer.y = y;
});
const letGo = e => { if (!dragging || e.pointerId !== dragging.id) return; dragging = null; released = true; aim.x = aim.y = 0; aim.z = 1; };
canvas.addEventListener('pointerup', letGo); canvas.addEventListener('pointercancel', letGo);

// The button, as PocketButton: pressing is holding; three presses each within 0.5 s of the last reset.
const button = { down: false, held: false, presses: 0, lastPress: -1e9 };
let seconds = 0, shakeNow = 0;
function buttonDown(now) {
  if (button.down) return; button.down = true; buttonEl.classList.add('down');
  button.presses = button.presses && now - button.lastPress <= TRIPLE_SECONDS ? button.presses + 1 : 1; button.lastPress = now;
  if (button.presses === 3) { button.presses = 0; seconds = 0; return; }
  button.held = true;
}
function buttonUp() { if (!button.down) return; button.down = false; button.held = false; buttonEl.classList.remove('down'); }
const clock = () => performance.now() / 1000;
addEventListener('keydown', e => { if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) buttonDown(clock()); } });
addEventListener('keyup', e => { if (e.code === 'Space') { e.preventDefault(); buttonUp(); } });
addEventListener('blur', buttonUp);
buttonEl.addEventListener('pointerdown', e => { e.preventDefault(); buttonEl.setPointerCapture(e.pointerId); buttonDown(clock()); });
buttonEl.addEventListener('pointerup', buttonUp);
buttonEl.addEventListener('pointercancel', buttonUp);

let moveX = 0, moveY = 0, intensity = 0, lastX = null, lastY = 0, lastVX = 0, lastVY = 0;
let last = clock(), frames = 0, fpsAt = last, fps = 0;
function frame() {
  const now = clock(), dt = Math.min(now - last, .05); last = now;
  const k = 1 - Math.exp(-dt / (released ? SETTLE_SECONDS / 3 : TIP_FOLLOW));
  up.x += (aim.x - up.x) * k; up.y += (aim.y - up.y) * k; up.z += (aim.z - up.z) * k;
  const n = Math.hypot(up.x, up.y, up.z); up.x /= n; up.y /= n; up.z /= n;
  // inputTask: tilt capped low; movement sloshes the blobs and is the shake; shaking while held drains.
  let tiltX = up.x, tiltY = up.y; const tilt = Math.hypot(tiltX, tiltY);
  if (tilt > MAX_TILT_G) { tiltX *= MAX_TILT_G / tilt; tiltY *= MAX_TILT_G / tilt; }
  let ax = 0, ay = 0;
  if (button.held && dragging && dt > 0) {
    if (lastX === null) { lastX = pointer.x; lastY = pointer.y; }
    const vx = (pointer.x - lastX) / dt, vy = (pointer.y - lastY) / dt; ax = -(vx - lastVX) / dt / SHAKE_PX_PER_MS2 / G; ay = -(vy - lastVY) / dt / SHAKE_PX_PER_MS2 / G;
    lastX = pointer.x; lastY = pointer.y; lastVX = vx; lastVY = vy;
  } else { lastX = null; lastVX = lastVY = 0; }
  const shakeG = Math.hypot(ax, ay), keep = shakeG > MOVE_DEAD_G ? (shakeG - MOVE_DEAD_G) / shakeG : 0, m = 1 - Math.exp(-dt / MOVE_SMOOTH_SECONDS);
  moveX += (ax * keep - moveX) * m; moveY += (ay * keep - moveY) * m;
  tiltX += moveX; tiltY += moveY;
  const strength = Math.min(1, Math.max(0, (shakeG * G - SHAKE_THRESHOLD) / (SHAKE_FULL - SHAKE_THRESHOLD)));
  intensity = strength > intensity ? strength : intensity * Math.exp(-dt / .25); shakeNow = intensity;
  if (button.held && intensity > SHAKE_MIN) seconds = Math.min(FIRM_SECONDS, seconds + dt);
  else if (!button.held) seconds = Math.max(0, seconds - dt / RECOVERY_RATIO);
  // physicsTask.
  world.gravityX = tiltX; world.gravityY = tiltY; world.drain = seconds / FIRM_SECONDS;
  world.advance(dt);
  // prepareFrame and drawFrame.
  half.fill(HALF_BACKGROUND);
  world.bodies.forEach((b, i) => {
    bodyWidth[i] = outlineWidth(b.radius, seconds);
    traceEdge(b.nodes, b.cx, b.cy, softness(bodyWidth[i], b.radius), i);
    shade(i, b.cx, b.cy, b.radius);
  });
  enlarge(pixels);
  ctx.putImageData(image, 0, 0);
  frames++; if (now - fpsAt > 1) { fps = frames / (now - fpsAt); frames = 0; fpsAt = now; }
  readout.textContent = `tilt ${Math.hypot(tiltX, tiltY).toFixed(2)} g · shake ${shakeNow.toFixed(2)} · drain ${seconds.toFixed(1)} s of 10 · ${button.held ? 'held' : 'released'} · ${fps.toFixed(0)} fps`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.pocket = { world, get seconds() { return seconds; }, set seconds(v) { seconds = v; }, up, aim, buttonDown, buttonUp, clock };
