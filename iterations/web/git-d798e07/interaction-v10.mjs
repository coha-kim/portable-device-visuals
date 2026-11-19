// v10: strength controls collision squash; full held duration controls fade/bounce.
import { Interaction as PreviousInteraction } from './interaction-v1.mjs';
import { SETTINGS } from './interaction.mjs';
import { sampleState } from './harvey-link-v1.mjs';
export class PalmInteraction extends PreviousInteraction {
  constructor() { super(); this.vector = { x: 0, y: 0 }; this.sampledAt = -Infinity; this.rawStrength = 0; }
  hold(value, now = performance.now()) {
    if (value === this.held) return;
    if (!value) this.step(0, now);
    super.hold(value, now);
    this.vector = { x: 0, y: 0 }; this.sampledAt = -Infinity; this.rawStrength = 0;
  }
  sampleVector(x, y, z, now) {
    if (!this.held || ![x,y,z,now].every(Number.isFinite)) return false;
    const magnitude = Math.hypot(x,y,z);
    const limit = magnitude > 35 ? 35 / magnitude : 1;
    this.vector = { x: x * limit, y: y * limit };
    this.rawStrength = Math.max(0,Math.min(1,(magnitude-SETTINGS.threshold)/(SETTINGS.fullShake-SETTINGS.threshold)));
    this.sampledAt = now; return true;
  }
  step(dt, now) {
    this.state = sampleState(this.state, now);
    if (!this.held) return;
    const target = now-this.sampledAt <= SETTINGS.staleMs ? this.rawStrength : 0;
    const blend = 1-Math.exp(-Math.max(0,Math.min(.1,dt))/(target > this.intensity ? .10 : .35));
    this.state.intensity += (target-this.intensity)*blend;
  }
  acceleration(now) {
    return this.held && now-this.sampledAt <= SETTINGS.staleMs && this.rawStrength > 0
      ? this.vector : {x:0,y:0};
  }
  get opacity() { return 1-Math.min(1,this.period/20)*(1-SETTINGS.minOpacity); }
  get repulsion() { return Math.max(0,Math.min(1,this.period/12)); }
  get deformation() { return this.intensity*Math.min(1,this.repulsion*3); }
}
// Screen coordinates: +x right, +y down. Reject gravity and seed the fallback
// filter before accepting any sample, so resting devices do not register shakes.
export class VectorMotionReader {
  constructor() { this.gravity = null; this.lastTime = null; }
  read(event, now, angle = 0) {
    const valid = v => v && [v.x,v.y,v.z].every(Number.isFinite);
    let a;
    if (valid(event.acceleration)) a = {...event.acceleration};
    else if (valid(event.accelerationIncludingGravity)) {
      const raw = event.accelerationIncludingGravity;
      if (!this.gravity || now-this.lastTime > 500) { this.gravity={...raw}; this.lastTime=now; return {x:0,y:0,z:0}; }
      const blend=1-Math.exp(-Math.max(0,Math.min(.1,(now-this.lastTime)/1000))/.25);
      a={}; for(const k of ['x','y','z']) { this.gravity[k]+=(raw[k]-this.gravity[k])*blend; a[k]=raw[k]-this.gravity[k]; }
      this.lastTime=now;
    } else return null;
    const radians=angle*Math.PI/180, c=Math.cos(radians), s=Math.sin(radians);
    return {x:(a.x*c-a.y*s)||0,y:-(a.x*s+a.y*c)||0,z:a.z};
  }
}
