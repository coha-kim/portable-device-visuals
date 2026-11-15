// Portable mapping for the ambient-style orbs, updated in place. Three independent channels:
//   hold duration (period)  -> attraction falls and orbs shrink, so they read as separate smaller blobs
//   shake intensity         -> colours dull toward #729B82
//   wander speed/direction  -> never changed by interaction
// Release keeps the shared recovery protocol (5× hold time, 30–120 s) for both channels.
import {PalmInteraction as PreviousInteraction} from './interaction-v13.mjs';
import {SETTINGS} from './interaction.mjs';
import {BASE_ATTRACTION} from './blobs.mjs';
export {VectorMotionReader} from './interaction-v13.mjs';
export const ATTRACTION_FULL_SECONDS=8;  // held this long, attraction reaches 0 (clean bounce)
export const MIN_RADIUS_SCALE=.5;
const clamp01=x=>Math.max(0,Math.min(1,x));
export class PalmInteraction extends PreviousInteraction {
 step(dt,now){
  super.step(dt,now);
  if(!this.held)return;
  // Live shake strength shows immediately; the base class eases it back down when shaking stops.
  const linear=now-this.sampledAt<=SETTINGS.staleMs?this.rawStrength:0;
  const rotation=now-this.rotationAt<=250?Math.min(1,Math.abs(this.omega)/4):0;
  this.state.intensity=Math.max(this.intensity,linear,rotation);
 }
 get progress(){return clamp01(this.period/ATTRACTION_FULL_SECONDS);}
 get attraction(){return BASE_ATTRACTION*(1-this.progress);}
 get radiusScale(){return 1-(1-MIN_RADIUS_SCALE)*this.progress;}
 get dullness(){return clamp01(this.intensity);}
 get opacity(){return 1;}
}
