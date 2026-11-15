// Portable hold/shake state, updated in place. app.js maps its intensity to this portable's colour
// attraction in the copied ambient sketch (as ambient-link-v1.mjs does on the ambient display); it also
// drives the shared WebSocket protocol (intensity, hold, release, 5× hold recovery) for ambient.
import {PalmInteraction as PreviousInteraction} from './interaction-v13.mjs';
import {SETTINGS} from './interaction.mjs';
export {VectorMotionReader} from './interaction-v13.mjs';
export class PalmInteraction extends PreviousInteraction {
 step(dt,now){
  super.step(dt,now);
  if(!this.held)return;
  // Live shake strength shows immediately; the base class eases it back down when shaking stops.
  const linear=now-this.sampledAt<=SETTINGS.staleMs?this.rawStrength:0;
  const rotation=now-this.rotationAt<=250?Math.min(1,Math.abs(this.omega)/4):0;
  this.state.intensity=Math.max(this.intensity,linear,rotation);
 }
 get opacity(){return 1;}
}
