// The Harvey Pocket's screen in the browser, as it was before the soft look (versions/pre-soft-look,
// 2026-11-05): a port of that harvey_pocket.ino's input and drawing on top of softbody.mjs (its physics). Fifty
// flat orange blobs on #CCCCCC with crisp edges, hollowing to outlines as the drain rises.
// What stands in for hardware:
// - the motion sensor: drag on the screen to tip it (the drag's direction is downhill; 216 px is 60°); let go and it
//   settles level, like putting the board down;
// - shaking: with the button held, dragging moves the board instead, and the pointer's acceleration is the shake;
// - the button: hold Space, or the round button beside the screen; three quick presses reset.
// Not ported: the colour wheel (long-press a blob), sleep after ten minutes, the 16-bit panel and its dither.
import { SoftBodyWorld, BODY_COUNT, NODES, outlineWidth } from './softbody.mjs';

const params = new URLSearchParams(location.search);
const SIZE = 480, SAMPLES = 3, OUTLINE_POINTS = NODES * SAMPLES, MAX_CROSSINGS = 12;
const BACKGROUND = 0xCE59;   // #CCCCCC as RGB565
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


// The panel's RGB565 as the 8-bit colour it shows.
const expand = c => [(c >> 8 & 0xF8) | c >> 13, (c >> 3 & 0xFC) | (c >> 9 & 3), (c << 3 & 0xF8) | (c >> 2 & 7)];
const pixelOf = c => { const [r, g, b] = expand(c); return (0xFF000000 | b << 16 | g << 8 | r) >>> 0; };
const BACKGROUND_PIXEL = pixelOf(BACKGROUND), FILL_PIXEL = pixelOf(BASELINE_COLOUR);

// The same smooth outline as tracePath: quadratic curves between edge midpoints, sampled. With `inset` every node is
// first moved that far toward the centre (the hole of an outlined body).
const outerX = new Float32Array(OUTLINE_POINTS), outerY = new Float32Array(OUTLINE_POINTS), innerX = new Float32Array(OUTLINE_POINTS), innerY = new Float32Array(OUTLINE_POINTS);
const px = new Float32Array(NODES), py = new Float32Array(NODES);
function outline(nodes, cx, cy, inset, xs, ys) {
  for (let i = 0; i < NODES; i++) {
    const dx = nodes[i].x - cx, dy = nodes[i].y - cy; let k = 1;
    if (inset > 0) { let d = Math.sqrt(dx * dx + dy * dy); if (d < 1e-3) d = 1e-3; k = (d > inset ? d - inset : 0) / d; }
    px[i] = cx + dx * k; py[i] = cy + dy * k;
  }
  let o = 0;
  for (let i = 0; i < NODES; i++) {
    const a = (i + NODES - 1) % NODES, b = (i + 1) % NODES;
    const sx = (px[a] + px[i]) / 2, sy = (py[a] + py[i]) / 2, ex = (px[i] + px[b]) / 2, ey = (py[i] + py[b]) / 2;
    for (let k = 0; k < SAMPLES; k++) {
      const t = k / SAMPLES, m = 1 - t;
      xs[o] = m * m * sx + 2 * m * t * px[i] + t * t * ex; ys[o] = m * m * sy + 2 * m * t * py[i] + t * t * ey; o++;
    }
  }
}
// Scan conversion: the outline's crossings on each row, sorted, filled in pairs (even-odd, so an inset second contour
// makes the hole).
const crossings = Array.from({ length: SIZE }, () => new Float32Array(MAX_CROSSINGS)), crossingCount = new Uint8Array(SIZE);
function addContour(xs, ys) {
  for (let i = 0; i < OUTLINE_POINTS; i++) {
    const j = i + 1 === OUTLINE_POINTS ? 0 : i + 1; let x0 = xs[i], y0 = ys[i], x1 = xs[j], y1 = ys[j];
    if (y0 > y1) { let t = x0; x0 = x1; x1 = t; t = y0; y0 = y1; y1 = t; }
    let first = Math.ceil(y0 - .5), last = Math.ceil(y1 - .5) - 1;
    if (first < 0) first = 0; if (last >= SIZE) last = SIZE - 1;
    if (first > last) continue;
    const slope = (x1 - x0) / (y1 - y0); let x = x0 + (first + .5 - y0) * slope;
    for (let y = first; y <= last; y++, x += slope) if (crossingCount[y] < MAX_CROSSINGS) crossings[y][crossingCount[y]++] = x;
  }
}
function fillRows(out, colour) {
  for (let r = 0; r < SIZE; r++) {
    const n = crossingCount[r]; if (!n) continue;
    const c = crossings[r]; crossingCount[r] = 0;
    for (let a = 1; a < n; a++) { const v = c[a]; let b = a - 1; while (b >= 0 && c[b] > v) { c[b + 1] = c[b]; b--; } c[b + 1] = v; }
    for (let k = 0; k + 1 < n; k += 2) {
      let x0 = Math.ceil(c[k] - .5), x1 = Math.ceil(c[k + 1] - .5);
      if (x0 < 0) x0 = 0; if (x1 > SIZE) x1 = SIZE;
      if (x1 <= x0) continue;
      out.fill(colour, r * SIZE + x0, r * SIZE + x1);
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
  pixels.fill(BACKGROUND_PIXEL);
  for (const b of world.bodies) {
    const width = outlineWidth(b.radius, seconds);
    outline(b.nodes, b.cx, b.cy, 0, outerX, outerY); addContour(outerX, outerY);
    if (width < b.radius) { outline(b.nodes, b.cx, b.cy, width, innerX, innerY); addContour(innerX, innerY); }
    fillRows(pixels, FILL_PIXEL);
  }
  ctx.putImageData(image, 0, 0);
  frames++; if (now - fpsAt > 1) { fps = frames / (now - fpsAt); frames = 0; fpsAt = now; }
  readout.textContent = `tilt ${Math.hypot(tiltX, tiltY).toFixed(2)} g · shake ${shakeNow.toFixed(2)} · drain ${seconds.toFixed(1)} s of 10 · ${button.held ? 'held' : 'released'} · ${fps.toFixed(0)} fps`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.pocket = { world, get seconds() { return seconds; }, set seconds(v) { seconds = v; }, up, aim, buttonDown, buttonUp, clock };
