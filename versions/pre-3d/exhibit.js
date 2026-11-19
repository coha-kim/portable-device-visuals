// Harvey Pocket on web: the exhibition page. The same physics and drawing as the prototype (app.js),
// without the tuning controls, with inputs a visitor's mouse or phone can give, a faster recovery so
// the whole cycle is seen in one visit, and the population colour fixed to Harvey orange.
import { PalmInteraction, VectorMotionReader } from './interaction-v15.mjs?exhibit-1';
import { SoftBodyWorld, ShakeDrain, CENTER, DISPLAY_RADIUS, FIRM_SECONDS } from './softbody.mjs?exhibit-1';
import { JellyRenderer, FILL } from './renderer.mjs?exhibit-1';
import { HarveyLink } from './harvey-link-v1.mjs?exhibit-1';
import { GravityInput, G } from './gravity.mjs?exhibit-1';

// Exhibition recovery: 1 s of shaking takes 6 s to come back (a full 10 s shake, a minute), so a
// visitor sees it refill before walking on. The device itself is far slower.
export const EXHIBIT_RECOVERY_RATIO = 6;
// Mouse shaking: pointer acceleration (canvas px/s²) is read as device acceleration in m/s². A brisk
// 10 cm shake at about 5 Hz comes to ~16 m/s², a full shake for the interaction model.
export const POINTER_PX_PER_MS2 = 6000;
const MAX_SHAKE_G = 2;

const interaction = new PalmInteraction(), reader = new VectorMotionReader();
const canvas = document.querySelector('#scene'), renderer = new JellyRenderer(canvas);
const physics = new SoftBodyWorld(), drain = new ShakeDrain({ recoveryRatio: EXHIBIT_RECOVERY_RATIO });
const gravity = new GravityInput();
const battery = document.querySelector('#battery'), arcStatus = document.querySelector('#arc-status');
const ambientStatus = document.querySelector('#ambient-status'), motionStatus = document.querySelector('#motion-status');
const shakeButton = document.querySelector('#shake-button'), motionButton = document.querySelector('#motion-button');

// Dial ticks on the bezel, like an 80s instrument face.
const ticks = document.querySelector('#ticks');
for (let i = 0; i < 60; i++) {
  const a = i / 60 * Math.PI * 2, r0 = i % 5 ? 289 : 284, r1 = 294;
  if (Math.abs(Math.sin(a)) < .55 && Math.cos(a) > 0) continue; // leave room for the arc text at the bottom
  if (Math.abs(Math.sin(a)) < .62 && Math.cos(a) < 0) continue; // and at the top
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  // a = 0 points down the screen (bottom), so text sits at a = 0 and a = π.
  line.setAttribute('x1', 300 + Math.sin(a) * r0); line.setAttribute('y1', 300 + Math.cos(a) * r0);
  line.setAttribute('x2', 300 + Math.sin(a) * r1); line.setAttribute('y2', 300 + Math.cos(a) * r1);
  ticks.append(line);
}
function showScale() {
  // The panel is 53.28 mm across; on a 96 dpi CSS pixel the screen's drawn size gives the ratio.
  const mm = canvas.getBoundingClientRect().width * 25.4 / 96;
  document.querySelector('#scale-ratio').textContent = (mm / 53.28).toFixed(1).replace(/\.0$/, '');
}
addEventListener('resize', showScale); showScale();

// Ambient display: paired when opened from the bridge (/portable/exhibit.html?room=…). The population
// colour is Harvey orange, sent once per connection; visitors don't choose it.
const link = new HarveyLink({ role: 'portable', onSnapshot() { setAmbient('live'); }, onStatus(value) {
  if (value === 'connected') { link.sendColour(FILL); setAmbient('live'); if (interaction.held) link.send('hold'); }
  else setAmbient(value);
} });
function setAmbient(value) {
  document.documentElement.dataset.ambient = value;
  ambientStatus.textContent = {
    live: 'Connected, sharing this population', connecting: 'Connecting…', disconnected: 'Reconnecting…',
    standalone: 'Not paired (this screen only)', 'population-busy': 'Connected; another visitor is holding'
  }[value] ?? 'Connected';
}
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
  const r = canvas.getBoundingClientRect(), k = canvas.width / r.width;
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
  if (!window.isSecureContext) { motionStatus.textContent = 'Phone motion needs the HTTPS address.'; return; }
  try {
    const permission = typeof DeviceMotionEvent.requestPermission === 'function' ? await DeviceMotionEvent.requestPermission() : 'granted';
    if (permission !== 'granted') { motionStatus.textContent = 'Motion was not allowed. Pressing the screen still tips it.'; return; }
    if (!listening) { addEventListener('devicemotion', onMotion); listening = true; }
    motionButton.hidden = true;
    motionStatus.textContent = 'Tilt the phone to tip the blobs. Hold the screen while shaking to drain them.';
  } catch { motionStatus.textContent = 'Motion could not start. Pressing the screen still tips it.'; }
}
if (typeof DeviceMotionEvent !== 'undefined' && matchMedia('(pointer: coarse)').matches) {
  motionButton.hidden = false;
  motionStatus.textContent = 'Tap Use phone motion, then tilt and shake your phone.';
  // Android grants motion without asking; iOS needs the tap.
  if (typeof DeviceMotionEvent.requestPermission !== 'function') enableMotion();
}
motionButton.addEventListener('click', enableMotion);

// After a minute without anyone, the plate levels again for the next visitor.
const IDLE_LEVEL_SECONDS = 60;
let lastActive = performance.now();
function markActive() { lastActive = performance.now(); }

// Bezel readout: the battery ring (full = solid) and the line of text under the screen.
let lastText = '';
function showBattery() {
  const left = 1 - drain.level;
  battery.style.strokeDasharray = `${(left * 100).toFixed(2)} 100`;
  let text;
  if (interaction.held && interaction.intensity > .12) text = 'Draining…';
  else if (interaction.held) text = 'Holding · shake to drain';
  else if (drain.seconds > 0) text = `Back in [${Math.max(1, Math.ceil(drain.remaining))}] sec`;
  else text = 'Press · hold · shake';
  if (text !== lastText) { arcStatus.textContent = text; lastText = text; }
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
    physics.advance(dt);
    renderer.draw(physics.bodies, drain.seconds);
    showBattery();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// For checks in the browser console.
window.harveyExhibit = { physics, drain, interaction, gravity, link, FIRM_SECONDS };
