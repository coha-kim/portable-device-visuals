// Harvey Pocket on web: the exhibition page. The same physics and drawing as the prototype (app.js),
// without the tuning controls, with inputs a visitor's mouse or phone can give, a faster recovery so
// the whole cycle is seen in one visit, and the population colour fixed to Harvey orange.
import { PalmInteraction, VectorMotionReader } from './interaction-v15.mjs?exhibit-10';
import { SoftBodyWorld, ShakeDrain, CENTER, DISPLAY_RADIUS, FIRM_SECONDS } from './softbody.mjs?exhibit-10';
import { JellyRenderer, FILL } from './renderer.mjs?exhibit-10';
import { Jelly3DRenderer } from './renderer-3d.mjs?exhibit-10';
import { HarveyLink } from './harvey-link-v1.mjs?exhibit-10';
import { GravityInput, G } from './gravity.mjs?exhibit-10';
import { PresenceMirror } from './presence-mirror.mjs?exhibit-10';

// Exhibition recovery: 1 s of shaking takes 6 s to come back (a full 10 s shake, a minute), so a
// visitor sees it refill before walking on. The device itself is far slower.
export const EXHIBIT_RECOVERY_RATIO = 6;
// Mouse shaking: pointer acceleration (canvas px/s²) is read as device acceleration in m/s². A brisk
// 10 cm shake at about 5 Hz comes to ~16 m/s², a full shake for the interaction model.
export const POINTER_PX_PER_MS2 = 6000;
const MAX_SHAKE_G = 2;

const interaction = new PalmInteraction(), reader = new VectorMotionReader();
// The blobs are drawn in 3D on this page (WebGL2), flat as on the device where WebGL2 is missing.
const renderer = Jelly3DRenderer.create(document.querySelector('#scene')) ?? new JellyRenderer(document.querySelector('#scene'));
const canvas = document.querySelector('#scene');
// Bubbles: stiffer shapes (high surface tension, they stay round except where they touch) and sticky
// contacts. Stickiness fades as the battery drains, so a flat battery's bubbles stop merging.
export const BUBBLE_STIFFNESS = 1800, BUBBLE_STICK = 700;
const physics = new SoftBodyWorld({ stick: BUBBLE_STICK }), drain = new ShakeDrain({ recoveryRatio: EXHIBIT_RECOVERY_RATIO });
const gravity = new GravityInput();
physics.set('stiffness', BUBBLE_STIFFNESS);
const shakeButton = document.querySelector('#shake-button'), motionButton = document.querySelector('#motion-button');
const stage = document.querySelector('#stage'), camera = document.querySelector('#camera');
const arcTrack = document.querySelector('#track'), level = document.querySelector('#level');
const leader = document.querySelector('#leader'), node = document.querySelector('#node');
const indicator = document.querySelector('#indicator');

// Camera: the visitor fades as their battery drains. Only on their tap; nothing leaves the browser.
const mirror = new PresenceMirror(document.querySelector('#mirror'));
document.querySelector('#camera-button').addEventListener('click', async () => {
  try { await mirror.start(); camera.classList.add('live'); }
  catch (error) { console.warn('Camera unavailable:', error); document.querySelector('#camera-button').textContent = 'No camera'; }
});

// Ambient display: paired when opened from the bridge (/portable/exhibit.html?room=…). The population
// colour is Harvey orange, sent once per connection; visitors don't choose it.
const link = new HarveyLink({ role: 'portable', onSnapshot() { setAmbient('live'); }, onStatus(value) {
  if (value === 'connected') { link.sendColour(FILL); setAmbient('live'); if (interaction.held) link.send('hold'); }
  else setAmbient(value);
} });
function setAmbient(value) { document.documentElement.dataset.ambient = value; }
setInterval(() => { if (interaction.held) link.send('intensity', interaction.intensity); }, 100);

// Holding: pressing the screen (mouse or touch), the Hold to shake button, or the space bar.
let holder = null; // 'pointer' | 'button' | 'key'
function setHeld(value, by) {
  if (value && holder) return;
  if (!value && holder !== by) return;
  holder = value ? by : null;
  const before = interaction.held; interaction.hold(value);
  canvas.classList.toggle('holding', value && by === 'pointer');
  shakeButton.setAttribute('aria-pressed', String(value && by !== 'pointer'));
  if (before !== value) { if (value) link.send('hold'); else { link.send('intensity', interaction.intensity); link.send('release'); } }
}

// Pointer on the screen: the press point tips the plate (gravity away from it, as before) and kicks
// the blobs nearby; holding the button down and shaking the mouse is shaking the device.
let pointerId = null, pointer = null, track = null;
function canvasPoint(event) {
  const r = canvas.getBoundingClientRect(), k = 2 * DISPLAY_RADIUS / r.width; // physics px, whatever the canvas resolution
  const x = (event.clientX - r.left) * k, y = (event.clientY - r.top) * k;
  return { x, y, nx: (x - CENTER) / DISPLAY_RADIUS, ny: (y - CENTER) / DISPLAY_RADIUS };
}
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0 || pointerId !== null) return;
  event.preventDefault(); pointerId = event.pointerId;
  try { canvas.setPointerCapture(pointerId); } catch {}
  const p = canvasPoint(event);
  gravity.setPointer(p.nx, p.ny); physics.blast(p.x, p.y);
  pointer = p; track = null; setHeld(true, 'pointer'); markActive();
});
canvas.addEventListener('pointermove', event => { if (event.pointerId === pointerId) pointer = canvasPoint(event); });
function endPointer(event) {
  if (event.pointerId !== pointerId) return;
  pointerId = null; pointer = null; track = null; setHeld(false, 'pointer');
}
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, endPointer);
canvas.addEventListener('contextmenu', event => event.preventDefault());

// Pointer acceleration from one frame to the next, lightly smoothed (mouse events are uneven).
function pointerShake(dt) {
  if (!pointer || dt <= 0) return { x: 0, y: 0 };
  if (!track) { track = { x: pointer.x, y: pointer.y, vx: 0, vy: 0, ax: 0, ay: 0 }; return { x: 0, y: 0 }; }
  const vx = (pointer.x - track.x) / dt, vy = (pointer.y - track.y) / dt, k = 1 - Math.exp(-dt / .03);
  const svx = track.vx + (vx - track.vx) * k, svy = track.vy + (vy - track.vy) * k;
  const ax = (svx - track.vx) / dt, ay = (svy - track.vy) / dt;
  track = { x: pointer.x, y: pointer.y, vx: svx, vy: svy, ax: track.ax + (ax - track.ax) * k, ay: track.ay + (ay - track.ay) * k };
  return { x: track.ax / POINTER_PX_PER_MS2, y: track.ay / POINTER_PX_PER_MS2 };
}

// Hold to shake: the button or space bar shakes the device for you (trackpads, keyboards).
let buttonTime = 0;
shakeButton.addEventListener('pointerdown', event => {
  if (event.button !== 0) return; event.preventDefault();
  try { shakeButton.setPointerCapture(event.pointerId); } catch {}
  setHeld(true, 'button'); markActive();
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) shakeButton.addEventListener(name, () => setHeld(false, 'button'));
addEventListener('keydown', event => {
  if (event.code !== 'Space' || event.repeat || event.target.closest?.('a')) return;
  event.preventDefault(); setHeld(true, 'key'); markActive();
});
addEventListener('keyup', event => { if (event.code === 'Space') setHeld(false, 'key'); });
addEventListener('blur', () => { if (holder) setHeld(false, holder); pointerId = null; pointer = null; });
document.addEventListener('visibilitychange', () => { if (holder) setHeld(false, holder); last = performance.now(); });

// Phone: the motion sensor tilts the plate and, while the screen is held, its shaking drains it.
function screenAngle() { return screen.orientation?.angle ?? window.orientation ?? 0; }
let listening = false;
function onMotion(event) {
  const now = performance.now(), angle = screenAngle();
  gravity.reading(event.accelerationIncludingGravity, angle, now);
  const vector = reader.read(event, now, angle), omega = reader.rotation(event);
  if (vector && holder === 'pointer') interaction.sampleVector(vector.x, vector.y, vector.z, now);
  if (omega !== null && holder === 'pointer') interaction.sampleRotation(omega, now);
}
async function enableMotion() {
  if (!window.isSecureContext) { motionButton.title = 'Phone motion needs the HTTPS address.'; return; }
  try {
    const permission = typeof DeviceMotionEvent.requestPermission === 'function' ? await DeviceMotionEvent.requestPermission() : 'granted';
    if (permission !== 'granted') { motionButton.hidden = true; return; }
    if (!listening) { addEventListener('devicemotion', onMotion); listening = true; }
    motionButton.hidden = true;
  } catch { motionButton.hidden = true; }
}
if (typeof DeviceMotionEvent !== 'undefined' && matchMedia('(pointer: coarse)').matches) {
  motionButton.hidden = false;
  // Android grants motion without asking; iOS needs the tap.
  if (typeof DeviceMotionEvent.requestPermission !== 'function') enableMotion();
}
motionButton.addEventListener('click', enableMotion);

// After a minute without anyone, the plate levels again for the next visitor.
const IDLE_LEVEL_SECONDS = 60;
let lastActive = performance.now();
function markActive() { lastActive = performance.now(); }

// Battery indicator: a semicircle on the screen's right, full from bottom to top at the baseline. As the
// battery drains its end slides down the arc, and the camera rides along at the end of a level line, so
// the line from the indicator always meets the camera.
const GAP = 14; // px between the screen's edge and the arc
let layout = null, shownLevel = -1;
function measure() {
  const s = stage.getBoundingClientRect(), c = canvas.getBoundingClientRect();
  indicator.setAttribute('viewBox', `0 0 ${s.width} ${s.height}`);
  const cx = c.left - s.left + c.width / 2, cy = c.top - s.top + c.height / 2, r = c.width / 2 + GAP;
  arcTrack.setAttribute('d', `M ${cx} ${cy - r} A ${r} ${r} 0 0 1 ${cx} ${cy + r}`);
  camera.style.transform = 'none';
  const cam = camera.getBoundingClientRect();
  shownLevel = -1;
  const pad = parseFloat(getComputedStyle(stage).paddingTop) || 0;
  layout = { cx, cy, r, camLeft: cam.left - s.left, camTop: cam.top - s.top, camHeight: cam.height, shown: cam.width > 0, minTop: pad, maxTop: s.height - pad - cam.height };
}
addEventListener('resize', measure);
new ResizeObserver(measure).observe(stage);
function showIndicator() {
  if (!layout) measure();
  const left = 1 - drain.level;
  if (Math.abs(left - shownLevel) < 1e-4) return; shownLevel = left;
  const { cx, cy, r } = layout, a = Math.PI / 2 - Math.PI * left;   // angle of the end: π/2 bottom, −π/2 top
  const ex = cx + Math.cos(a) * r, ey = cy + Math.sin(a) * r;
  level.setAttribute('d', left > 1e-3 ? `M ${cx} ${cy + r} A ${r} ${r} 0 0 0 ${ex} ${ey}` : '');
  node.setAttribute('cx', ex); node.setAttribute('cy', ey);
  if (!layout.shown) { leader.setAttribute('x1', ex); leader.setAttribute('x2', ex); return; }
  // Camera centred on the end's height, kept inside the stage.
  const top = Math.max(layout.minTop, Math.min(layout.maxTop, ey - layout.camHeight / 2));
  camera.style.transform = `translateY(${(top - layout.camTop).toFixed(1)}px)`;
  leader.setAttribute('x1', ex); leader.setAttribute('y1', ey); leader.setAttribute('x2', layout.camLeft); leader.setAttribute('y2', ey);
}

let last = performance.now(), simulationTime = 0;
function frame(now) {
  const dt = Math.max(0, Math.min(.05, (now - last) / 1000)); last = now;
  if (!document.hidden) {
    simulationTime += dt;
    let push = { x: 0, y: 0 };
    if (holder === 'pointer' && !listening) {
      // Mouse shake: the plate moves with the pointer, so the blobs feel the opposite acceleration.
      const a = pointerShake(dt);
      interaction.sampleVector(a.x, a.y, 0, now); interaction.sampleRotation(0, now);
      const m = Math.hypot(a.x, a.y) / G, k = m > MAX_SHAKE_G ? MAX_SHAKE_G / m : 1;
      push = { x: -a.x / G * k, y: -a.y / G * k };
      if (m > .3) markActive();
    } else if (holder === 'button' || holder === 'key') {
      const amplitude = .65 * 22, sx = Math.sin(simulationTime * 19) * amplitude, sy = Math.cos(simulationTime * 14) * amplitude * .8;
      interaction.sampleVector(sx, sy, 0, now); interaction.sampleRotation(0, now);
      push = { x: -sx / G, y: -sy / G }; markActive();
    }
    if (!holder && now - lastActive > IDLE_LEVEL_SECONDS * 1000 && !gravity.usingSensor) gravity.level();
    const g = gravity.step(dt, now, push); physics.setGravity(g.x, g.y);
    interaction.step(dt, now);
    physics.setDrain(drain.step(dt, { held: interaction.held, intensity: interaction.intensity }));
    physics.stick = BUBBLE_STICK * (1 - drain.level);
    physics.advance(dt);
    renderer.draw(physics.bodies, drain.seconds);
    showIndicator();
    mirror.draw(1 - drain.level, now);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// For checks in the browser console.
window.harveyExhibit = { physics, drain, interaction, gravity, link, renderer, mirror, FIRM_SECONDS };
