// Shake drain: merging falls in proportion to how long the user has been shaking. Each second of
// shaking (held, with intensity above SHAKE_MIN) adds 1/FIRM_SECONDS of drain, so after FIRM_SECONDS
// of shaking drops no longer merge. Holding still pauses it; after release merging seeps back over
// RECOVER_SECONDS (from fully drained).
export const SHAKE_MIN=.12,FIRM_SECONDS=10,RECOVER_SECONDS=30;
export class ShakeDrain {
 constructor(){this.seconds=0;}
 get level(){return this.seconds/FIRM_SECONDS;}
 step(dt,{held=false,intensity=0}={}){
  dt=Math.max(0,Math.min(.1,Number.isFinite(dt)?dt:0));
  if(held&&intensity>SHAKE_MIN)this.seconds=Math.min(FIRM_SECONDS,this.seconds+dt);
  else if(!held)this.seconds=Math.max(0,this.seconds-dt*FIRM_SECONDS/RECOVER_SECONDS);
  return this.level;
 }
}
