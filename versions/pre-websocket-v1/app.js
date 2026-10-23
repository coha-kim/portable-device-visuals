import { Interaction, MotionReader } from './interaction.mjs';
import { MetaballRenderer } from './renderer.mjs';
const interaction = new Interaction();
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
let w = innerWidth, h = innerHeight, radius = 34;
let pointer = null, keyboard = false, listening = false, sensorSeen = false, watchdog;
let last = performance.now(), time = 0;
let lastBackground = '';
// Independent slow paths and gentle breathing yield continuous lava-lamp motion.
// The renderer merges a small scalar field; motion is unchanged.
const blobs = Array.from({ length: 8 }, (_, i) => {
  return { radius: 34, x: .5 + .28 * Math.sin(i * 2.4), y: .15 + .7 * (i / 7), seed: Math.random() * 100, phase: i * 1.7 };
});
function resize() {
  w = document.documentElement.clientWidth; h = document.documentElement.clientHeight;
  radius = Math.max(22, Math.min(52, Math.min(w, h) * .085));
  renderer.resize(w, h);
}
addEventListener('resize', resize); resize();
function setHeld(value) {
  interaction.hold(value);
  hold.setAttribute('aria-pressed', String(value));
  if (value) hint.classList.add('hidden');
}
function release() {
  const id = pointer; pointer = null; keyboard = false; setHeld(false);
  if (id !== null && hold.hasPointerCapture(id)) hold.releasePointerCapture(id);
}
hold.addEventListener('pointerdown', event => {
  if (event.button !== 0 || pointer !== null) return;
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
  if (!sensorSeen) hint.textContent = 'Hold the corner button and shake.';
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
      const marginX = Math.min(.3, (radius * 1.5) / w), marginY = Math.min(.3, (radius * 1.5) / h);
      const vx = Math.sin(time * .19 + b.seed) + .45 * Math.sin(time * .37 + b.phase);
      const vy = Math.cos(time * .16 + b.seed * 2) + .35 * Math.cos(time * .29 + b.phase);
      const steerX = b.x < marginX ? (marginX - b.x) * 12 : b.x > 1-marginX ? (1-marginX-b.x) * 12 : 0;
      const steerY = b.y < marginY ? (marginY - b.y) * 12 : b.y > 1-marginY ? (1-marginY-b.y) * 12 : 0;
      b.x = Math.max(marginX*.7, Math.min(1-marginX*.7, b.x + (vx + steerX) * dt * 13 / w));
      b.y = Math.max(marginY*.7, Math.min(1-marginY*.7, b.y + (vy + steerY) * dt * 16 / h));
      b.radius = radius * pulse;
    }
    renderer.draw(blobs, interaction.opacity, background);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
