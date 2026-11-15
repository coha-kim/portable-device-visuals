import { Interaction, MotionReader } from './interaction-v3.mjs';
import { HarveyLink } from './harvey-link-v1.mjs';
import { MetaballRenderer } from './renderer.mjs?v=round-8';
const inputMode = new URLSearchParams(location.search).get('input') === 'shake' ? 'shake' : 'hold';
const interaction = new Interaction({ inputMode });
const reader = new MotionReader();
const scene = document.querySelector('#scene');
const renderer = new MetaballRenderer(scene);
const hold = document.querySelector('#hold');
const welcome = document.querySelector('#welcome');
const status = document.querySelector('#status');
const enable = document.querySelector('#enable');
const retry = document.querySelector('#retry');
const hint = document.querySelector('#hint');
const theme = document.querySelector('meta[name="theme-color"]');
document.documentElement.dataset.harveyInput = inputMode;
welcome.hidden = inputMode !== 'shake';
if (inputMode === 'hold') {
  hold.setAttribute('aria-label', 'Hold to create more space');
  hint.textContent = 'Hold the button. Hold longer to create more space.';
  retry.hidden = true;
} else {
  hold.setAttribute('aria-label', 'Hold while shaking');
  hint.textContent = 'Hold the button and shake.';
}
// v8: device pixels stay fixed regardless of browser viewport or Retina density.
const DISPLAY_DIAMETER = 480;
let w = DISPLAY_DIAMETER, h = DISPLAY_DIAMETER, radius = 51;
let pointer = null, keyboard = false, listening = false, sensorSeen = false, watchdog;
let last = performance.now(), time = 0;
let lastBackground = '';
const link = new HarveyLink({ role: 'portable', onSnapshot(message) {
  interaction.adopt(message.states[link.population], message.serverNow);
}, onStatus(value) {
  document.documentElement.dataset.harveyConnection = value;
  if (value === 'disconnected' || value === 'population-busy') release();
} });
// Publish hold progress at 10 Hz, independently of sensor availability.
setInterval(() => { if (interaction.held) link.send('intensity', interaction.intensity); }, 100);
// Independent slow paths and gentle breathing yield continuous lava-lamp motion.
// The renderer merges a small scalar field; motion is unchanged.
const blobs = Array.from({ length: 8 }, (_, i) => {
  return { radius: 42.5, x: .5 + .28 * Math.sin(i * 2.4), y: .15 + .7 * (i / 7), seed: Math.random() * 100, phase: i * 1.7 };
});
renderer.resize(w, h, { nativeResolution: true });
function containInDisplay(blob) {
  const dx = (blob.x - .5) * w, dy = (blob.y - .5) * h;
  const distance = Math.hypot(dx, dy);
  const limit = w / 2 - blob.radius - 2;
  if (distance > limit) {
    blob.x = .5 + dx / distance * limit / w;
    blob.y = .5 + dy / distance * limit / h;
  }
}
function setHeld(value) {
  const wasHeld = interaction.held;
  interaction.hold(value);
  if (wasHeld !== value) {
    if (value) link.send('hold');
    else { link.send('intensity', interaction.intensity); link.send('release'); }
  }
  hold.setAttribute('aria-pressed', String(value));
  if (value) hint.classList.add('hidden');
}
function release() {
  const id = pointer; pointer = null; keyboard = false; setHeld(false);
  if (id !== null && hold.hasPointerCapture(id)) hold.releasePointerCapture(id);
}
hold.addEventListener('pointerdown', event => {
  if (event.button !== 0 || pointer !== null || keyboard) return;
  event.preventDefault(); pointer = event.pointerId;
  hold.setPointerCapture(pointer); setHeld(true);
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  hold.addEventListener(name, event => { if (event.pointerId === pointer) release(); });
}
hold.addEventListener('keydown', event => {
  if (![' ', 'Enter'].includes(event.key)) return;
  event.preventDefault();
  if (!event.repeat && pointer === null) { keyboard = true; setHeld(true); }
});
hold.addEventListener('keyup', event => {
  if (keyboard && [' ', 'Enter'].includes(event.key)) { event.preventDefault(); release(); }
});
hold.addEventListener('blur', release);
hold.addEventListener('contextmenu', event => event.preventDefault());
addEventListener('blur', release);
document.addEventListener('visibilitychange', () => { release(); last = performance.now(); });
function onMotion(event) {
  const now = performance.now();
  const magnitude = reader.read(event, now);
  if (magnitude === null) return;
  if (!sensorSeen) hint.textContent = 'Hold the button and shake.';
  sensorSeen = true; clearTimeout(watchdog); retry.hidden = true;
  interaction.sample(magnitude, now);
}
async function enableMotion() {
  status.textContent = '';
  if (!window.isSecureContext) { status.textContent = 'Open the HTTPS link on your phone to enable motion.'; return; }
  if (typeof DeviceMotionEvent === 'undefined') { status.textContent = 'This browser has no motion sensor. You can still view the visuals.'; return; }
  try {
    // Must be invoked directly from this real button gesture, before any await.
    const permission = typeof DeviceMotionEvent.requestPermission === 'function'
      ? await DeviceMotionEvent.requestPermission() : 'granted';
    if (permission !== 'granted') { status.textContent = 'Motion access was not allowed. You can try again or just view the visuals.'; return; }
    if (!listening) { addEventListener('devicemotion', onMotion); listening = true; }
    welcome.hidden = true; retry.hidden = true;
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      if (!sensorSeen) { hint.textContent = 'No motion readings yet. Check motion access on your phone.'; hint.classList.remove('hidden'); retry.hidden = false; }
    }, 4000);
  } catch { status.textContent = 'Motion could not start. Check sensor permissions in your browser and try again.'; }
}
enable.addEventListener('click', enableMotion);
retry.addEventListener('click', () => { release(); welcome.hidden = false; });
document.querySelector('#view').addEventListener('click', () => { welcome.hidden = true; retry.hidden = sensorSeen; });
function frame(now) {
  const dt = Math.min(.05, Math.max(0, (now - last) / 1000)); last = now;
  if (!document.hidden) {
    time += dt;
    interaction.step(dt, now);
    const background = interaction.background;
    const rgb = `rgb(${background.join(',')})`;
    if (rgb !== lastBackground) {
      document.documentElement.style.setProperty('--paper', rgb);
      theme.content = rgb; lastBackground = rgb;
    }
    for (const b of blobs) {
      const pulse = 1 + .055 * Math.sin(time * .7 + b.phase);
      b.radius = radius * pulse;
      const dx = (b.x - .5) * w, dy = (b.y - .5) * h;
      const distance = Math.max(.001, Math.hypot(dx, dy));
      const softLimit = w / 2 - b.radius - 27;
      const steer = Math.max(0, (distance - softLimit) / 25);
      const vx = Math.sin(time * .19 + b.seed) + .45 * Math.sin(time * .37 + b.phase);
      const vy = Math.cos(time * .16 + b.seed * 2) + .35 * Math.cos(time * .29 + b.phase);
      b.x += (vx - dx / distance * steer) * dt * 13 / w;
      b.y += (vy - dy / distance * steer) * dt * 16 / h;
      containInDisplay(b);
    }
    renderer.draw(blobs, interaction.opacity, background);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
