// v3: hold-only laptop testing by default; input=shake keeps phone input available.
import { Interaction as ShakeInteraction, MotionReader } from './interaction-v1.mjs';
import { SETTINGS } from './interaction.mjs';
export { MotionReader };
export class Interaction extends ShakeInteraction {
  constructor({ inputMode = 'hold' } = {}) {
    super(); this.inputMode = inputMode; this.holdStartIntensity = 0;
  }
  hold(value, now = performance.now()) {
    if (value && !this.held) {
      super.hold(true, now); this.holdStartIntensity = this.intensity; return;
    }
    if (!value && this.held && this.inputMode === 'hold') this.step(0, now);
    super.hold(value, now);
  }
  step(dt, now) {
    if (this.inputMode === 'shake') { super.step(dt, now); return; }
    // Absolute elapsed hold time makes mouse/keyboard holds frame-rate independent.
    super.step(0, now);
    if (this.held) this.state.intensity = Math.min(1, this.holdStartIntensity + this.state.holdDurationSeconds * SETTINGS.fadeRate);
  }
}
