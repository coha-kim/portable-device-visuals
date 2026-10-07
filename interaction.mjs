// Only these two accumulated values affect appearance. Motion never changes drift.
export const SETTINGS = Object.freeze({ threshold: 1.4, fullShake: 16, fadeRate: 0.16, minOpacity: 0.12, periodSeconds: 20, staleMs: 180 });
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export class Interaction {
  constructor() { this.intensity = 0; this.period = 0; this.held = false; this.magnitude = 0; this.lastSample = -Infinity; }
  hold(value) { this.held = value; this.magnitude = 0; this.lastSample = -Infinity; }
  sample(magnitude, now) {
    this.magnitude = Number.isFinite(magnitude) ? Math.max(0, magnitude) : 0;
    this.lastSample = now;
  }
  step(dt, now) {
    // Never accumulate hidden-tab time or a stale sensor reading.
    dt = clamp(dt, 0, 0.05);
    if (!this.held || now - this.lastSample > SETTINGS.staleMs || this.magnitude <= SETTINGS.threshold) return;
    const strength = clamp((this.magnitude - SETTINGS.threshold) / (SETTINGS.fullShake - SETTINGS.threshold), 0, 1);
    this.intensity = clamp(this.intensity + strength * SETTINGS.fadeRate * dt, 0, 1);
    this.period = clamp(this.period + dt, 0, SETTINGS.periodSeconds);
  }
  get opacity() { return 1 - this.intensity * (1 - SETTINGS.minOpacity); }
  get background() {
    const t = this.period / SETTINGS.periodSeconds;
    return [236, 234, 219].map((v, i) => Math.round(v + ([226, 221, 177][i] - v) * t));
  }
  get values() { return { intensity: this.intensity, period: this.period, opacity: this.opacity }; }
}
// Fallback for devices exposing only accelerationIncludingGravity. The first
// sample seeds gravity; a resting phone never registers its 9.81 m/s² as a shake.
export class MotionReader {
  constructor() { this.gravity = null; this.lastTime = null; }
  read(event, now) {
    const finite = v => v && [v.x, v.y, v.z].every(Number.isFinite);
    if (finite(event.acceleration)) return Math.hypot(event.acceleration.x, event.acceleration.y, event.acceleration.z);
    if (!finite(event.accelerationIncludingGravity)) return null;
    const a = event.accelerationIncludingGravity;
    if (!this.gravity || now - this.lastTime > 500) { this.gravity = { ...a }; this.lastTime = now; return 0; }
    const dt = clamp((now - this.lastTime) / 1000, 0, 0.1);
    const blend = 1 - Math.exp(-dt / 0.25);
    for (const axis of ['x','y','z']) this.gravity[axis] += (a[axis] - this.gravity[axis]) * blend;
    this.lastTime = now;
    return Math.hypot(a.x - this.gravity.x, a.y - this.gravity.y, a.z - this.gravity.z);
  }
}
