// v11: held acceleration, tilt and gyro; independent strength/duration mapping.
import { Interaction as PreviousInteraction } from './interaction-v1.mjs';
import { SETTINGS } from './interaction.mjs';
import { VectorMotionReader as PreviousMotionReader } from './interaction-v10.mjs';
import { sampleState } from './harvey-link-v1.mjs';
export class PalmInteraction extends PreviousInteraction {
  constructor() { super(); this.vector = { x: 0, y: 0 }; this.sampledAt = -Infinity; this.rawStrength = 0; this.tilt={x:0,y:0}; this.tiltAt=-Infinity; this.omega=0; this.rotationAt=-Infinity; }
  hold(value, now = performance.now()) {
    if (value === this.held) return;
    if (!value) this.step(0, now);
    super.hold(value, now);
    this.vector = { x: 0, y: 0 }; this.sampledAt = -Infinity; this.rawStrength = 0; this.omega=0; this.rotationAt=-Infinity;
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
    const linear=now-this.sampledAt<=SETTINGS.staleMs?this.rawStrength:0;
    const rotation=now-this.rotationAt<=250?Math.min(1,Math.abs(this.omega)/4):0;
    const target=Math.max(linear,rotation);
    const blend = 1-Math.exp(-Math.max(0,Math.min(.1,dt))/(target > this.intensity ? .10 : .35));
    this.state.intensity += (target-this.intensity)*blend;
  }
  acceleration(now) {
    return this.held && now-this.sampledAt <= SETTINGS.staleMs && this.rawStrength > 0
      ? this.vector : {x:0,y:0};
  }
  sampleTilt(x,y,now) {
    if(![x,y,now].every(Number.isFinite))return false;
    this.tilt={x:Math.max(-9.81,Math.min(9.81,x)),y:Math.max(-9.81,Math.min(9.81,y))};this.tiltAt=now;return true;
  }
  sampleRotation(omega,now) {
    if(!this.held||![omega,now].every(Number.isFinite))return false;
    this.omega=Math.max(-4,Math.min(4,omega));this.rotationAt=now;return true;
  }
  motion(now) {
    const a=this.acceleration(now),freshTilt=this.held&&now-this.tiltAt<=800;
    return {...a,tiltX:freshTilt?this.tilt.x:0,tiltY:freshTilt?this.tilt.y:0,
      omega:this.held&&now-this.rotationAt<=250?this.omega:0};
  }
  get opacity() { return 1-Math.min(1,this.period/20)*(1-SETTINGS.minOpacity); }
  get repulsion() { return Math.max(0,Math.min(1,this.period/12)); }
  get deformation() { return this.intensity*Math.min(1,this.repulsion*3); }
}

export class VectorMotionReader extends PreviousMotionReader {
  orientation(event,angle=0) {
    if(![event.beta,event.gamma,angle].every(Number.isFinite))return null;
    const beta=event.beta*Math.PI/180,gamma=event.gamma*Math.PI/180;
    const x=9.81*Math.sin(gamma)*Math.cos(beta),y=9.81*Math.sin(beta);
    const a=angle*Math.PI/180;
    return {x:(x*Math.cos(a)+y*Math.sin(a))||0,y:(-x*Math.sin(a)+y*Math.cos(a))||0};
  }
  rotation(event) {
    // W3C rotationRate.alpha is rotation around the screen-normal Z axis,
    // in degrees/sec; convert to radians/sec in screen coordinates (+y down).
    return Number.isFinite(event.rotationRate?.alpha)?-event.rotationRate.alpha*Math.PI/180:null;
  }
}
