import { SETTINGS, MotionReader } from './interaction.mjs';
import { newState, beginHold, endHold, sampleState } from './harvey-link-v1.mjs';
export { MotionReader };
export class Interaction {
  constructor() { this.state = newState(); this.magnitude = 0; this.lastSample = -Infinity; }
  get held() { return this.state.phase === 'holding'; }
  get intensity() { return this.state.intensity; }
  get period() { return this.state.period; }
  hold(value, now = performance.now()) {
    if (value === this.held) return;
    this.state = value ? beginHold(this.state, now) : endHold(this.state, now);
    this.magnitude = 0; this.lastSample = -Infinity;
  }
  sample(magnitude, now) { this.magnitude = Number.isFinite(magnitude) ? Math.max(0, magnitude) : 0; this.lastSample = now; }
  step(dt, now) {
    this.state = sampleState(this.state, now);
    if (!this.held || now - this.lastSample > SETTINGS.staleMs || this.magnitude <= SETTINGS.threshold) return;
    const strength = Math.max(0, Math.min(1, (this.magnitude - SETTINGS.threshold) / (SETTINGS.fullShake - SETTINGS.threshold)));
    this.state.intensity = Math.min(1, this.intensity + strength * SETTINGS.fadeRate * Math.max(0, Math.min(.05, dt)));
  }
  adopt(state, serverNow, now = performance.now()) {
    if (this.held || state.phase === 'holding') return;
    const delta = now - serverNow;
    this.state = { ...state };
    for (const key of ['holdStartedAt', 'releasedAt']) if (Number.isFinite(state[key])) this.state[key] += delta;
    this.state = sampleState(this.state, now);
  }
  get opacity() { return 1 - this.intensity * (1 - SETTINGS.minOpacity); }
  get background() { const t = this.period / SETTINGS.periodSeconds;
    return [236, 234, 219].map((v, i) => Math.round(v + ([226, 221, 177][i] - v) * t)); }
}
