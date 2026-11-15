// Lava-lamp blob interaction, updated in place. Full-hold duration retains the shared recovery protocol.
// repulsion follows live shake strength (split vs. stick); energy adds held time (slower, duller).
import {PalmInteraction as PreviousInteraction} from './interaction-v13.mjs';
import {SETTINGS} from './interaction.mjs';
export {VectorMotionReader} from './interaction-v13.mjs';
export const HOLD_FLOOR=.12;
const clamp01=x=>Math.max(0,Math.min(1,x));
export class PalmInteraction extends PreviousInteraction {
 hold(value,now=performance.now()){
  super.hold(value,now);
  if(value&&this.held)this.state.intensity=Math.max(HOLD_FLOOR,this.intensity);
 }
 step(dt,now){
  super.step(dt,now);
  if(!this.held)return;
  const linear=now-this.sampledAt<=SETTINGS.staleMs?this.rawStrength:0;
  const rotation=now-this.rotationAt<=250?Math.min(1,Math.abs(this.omega)/4):0;
  this.state.intensity=Math.max(HOLD_FLOOR,this.intensity,linear,rotation);
 }
 get repulsion(){return clamp01(this.intensity);}
 get energy(){return clamp01(.55*this.intensity+.45*Math.min(1,this.period/12));}
 get speedScale(){return 1-this.energy*.7;}
 get dullness(){return this.energy;}
 // Colour dulling replaces the previous opacity fade.
 get opacity(){return 1;}
}
