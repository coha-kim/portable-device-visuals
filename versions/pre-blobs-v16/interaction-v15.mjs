// Particle interaction, updated in place. Full-hold duration retains the shared recovery protocol.
import {PalmInteraction as PreviousInteraction} from './interaction-v13.mjs';
import {SETTINGS} from './interaction.mjs';
export {VectorMotionReader} from './interaction-v13.mjs';
export class PalmInteraction extends PreviousInteraction {
 hold(value,now=performance.now()){
  super.hold(value,now);
  if(value&&this.held)this.state.intensity=Math.max(.25,this.intensity);
 }
 step(dt,now){
  super.step(dt,now);
  if(!this.held)return;
  const linear=now-this.sampledAt<=SETTINGS.staleMs?this.rawStrength:0;
  const rotation=now-this.rotationAt<=250?Math.min(1,Math.abs(this.omega)/4):0;
  this.state.intensity=Math.max(.25,this.intensity,linear,rotation);
 }
 get activity(){return Math.max(this.intensity*.7,Math.min(1,this.period/20));}
 get repulsion(){return this.activity;}
 get speedScale(){return 1-this.activity*.78;}
 get opacity(){return 1-this.activity*.82;}
}
