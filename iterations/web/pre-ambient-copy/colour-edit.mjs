// Colour edit on the round display. Pressing a blob for 3 s opens a colour wheel around the border. A black
// line runs from the chosen colour on the wheel to that blob and follows it as it moves. Pressing the wheel
// picks a colour; pulling away from the wheel stretches a sling, and letting go flings a drop of the colour
// from the fingertip into the blob. The colour then spreads from there through the whole population (one
// colour per person, as on the ambient display). Everything is in canvas px; the wheel uses the same
// colours as the Colour slider (colourFor).
export const LONG_PRESS_SECONDS=3,PRESS_SLOP=14,RING_WIDTH=26,RING_INNER=240-RING_WIDTH,RING_GRAB=RING_INNER-8,PULL_MIN=24;
const CENTER=240,TAU=Math.PI*2,OPEN_SECONDS=.18,SHOW_PROGRESS_AFTER=.3,SEGMENTS=120;
const FLIGHT_SPEED=420,PULL_SPEED=6,MAX_SPEED=1400,STEER=10,MAX_FLIGHT=2,RIPPLE_SPEED=520,DROP_RADIUS=9,KICK=.2;
const INK='#000';
const radiusOf=(x,y)=>Math.hypot(x-CENTER,y-CENTER);
// Hue 0 sits at the top of the wheel, running clockwise.
export const hueAt=(x,y)=>((Math.atan2(y-CENTER,x-CENTER)*180/Math.PI+90)%360+360)%360;
export function ringPoint(hue,r=RING_INNER+RING_WIDTH/2){const a=(hue-90)*Math.PI/180;return {x:CENTER+Math.cos(a)*r,y:CENTER+Math.sin(a)*r};}
// The blob under a press: the nearest whose outline is within a few px of it.
export function pickBlob(bodies,x,y){
 let best=null,gap=Infinity;
 for(const b of bodies){const c=b.centroid,d=Math.hypot(c.x-x,c.y-y);if(d<b.radius+6&&d<gap){best=b;gap=d;}}
 return best;
}
export class ColourEdit {
 constructor({colourFor,getHue,onColour}){
  Object.assign(this,{colourFor,getHue,onColour,state:'idle',target:null,held:0,opened:0,hue:0,at:null,drop:null,ripple:null,pull:null});
 }
 // Open, aiming or flying: the display's usual press, tilt and stir are off.
 get active(){return !['idle','pressing'].includes(this.state);}
 close(){this.state='idle';this.target=null;this.pull=null;this.drop=null;this.opened=0;}
 // Returns true when the press belongs to the edit, not to the display.
 press(x,y,bodies){
  if(this.state==='flying')return true;
  if(this.state==='open'){if(radiusOf(x,y)>=RING_GRAB)this.grab(x,y);else this.close();return true;}
  this.target=pickBlob(bodies,x,y);
  if(this.target){this.state='pressing';this.held=0;this.at={x,y};}
  return false;
 }
 grab(x,y){this.state='aiming';this.hue=hueAt(x,y);this.pull=null;}
 move(x,y){
  if(this.state==='pressing'&&Math.hypot(x-this.at.x,y-this.at.y)>PRESS_SLOP){this.close();return;}
  // Still down after the long press: sliding out to the wheel picks a colour in the same gesture.
  if(this.state==='open'&&this.down&&radiusOf(x,y)>=RING_GRAB)this.grab(x,y);
  if(this.state!=='aiming')return;
  if(radiusOf(x,y)>=RING_GRAB){this.hue=hueAt(x,y);this.pull=null;}else this.pull={x,y};
 }
 release(x,y){
  this.down=false;
  if(this.state==='pressing'){this.close();return;}
  if(this.state!=='aiming')return;
  if(this.pull)this.pull={x,y};
  const a=ringPoint(this.hue),length=this.pull?Math.hypot(this.pull.x-a.x,this.pull.y-a.y):0;
  if(length<PULL_MIN){this.state='open';this.pull=null;return;}
  // The drop leaves the fingertip still heading away from the wheel, then homes in on the blob.
  const speed=Math.min(MAX_SPEED,FLIGHT_SPEED+length*PULL_SPEED),ux=(this.pull.x-a.x)/length,uy=(this.pull.y-a.y)/length;
  this.drop={x:this.pull.x,y:this.pull.y,vx:ux*speed,vy:uy*speed,speed,time:0};
  this.pull=null;this.state='flying';
 }
 // The pointer was lost (not lifted): nothing is fired.
 cancelGesture(){
  this.down=false;
  if(this.state==='pressing')this.close();else if(this.state==='aiming'){this.state='open';this.pull=null;}
 }
 hit(){
  const d=this.drop,before=this.getHue(),c=this.target.centroid;
  this.target.shift(d.vx*KICK,d.vy*KICK);
  this.ripple={x:c.x,y:c.y,from:this.colourFor(before),time:0};
  this.onColour(this.hue);this.close();
 }
 step(dt,bodies){
  if(this.ripple&&(this.ripple.time+=dt)*RIPPLE_SPEED>2*CENTER+CENTER)this.ripple=null;
  if(this.state==='idle')return;
  if(!bodies.includes(this.target)){this.close();return;}
  if(this.state==='pressing'){
   this.held+=dt;
   if(this.held>=LONG_PRESS_SECONDS){this.state='open';this.hue=this.getHue();this.down=true;}
   return;
  }
  this.opened=Math.min(1,this.opened+dt/OPEN_SECONDS);
  if(this.state!=='flying')return;
  const d=this.drop,c=this.target.centroid,dx=c.x-d.x,dy=c.y-d.y,dist=Math.hypot(dx,dy)||1e-6,k=1-Math.exp(-STEER*dt);
  d.time+=dt;
  if(dist<this.target.radius+d.speed*dt||d.time>MAX_FLIGHT){this.hit();return;}
  d.vx+=(dx/dist*d.speed-d.vx)*k;d.vy+=(dy/dist*d.speed-d.vy)*k;d.x+=d.vx*dt;d.y+=d.vy*dt;
 }
 // While the colour spreads, blobs it hasn't reached keep the old one (null: the renderer's own fill).
 colourOf=body=>{
  const r=this.ripple;if(!r)return null;
  const c=body.centroid;return Math.hypot(c.x-r.x,c.y-r.y)>r.time*RIPPLE_SPEED?r.from:null;
 };
 draw(ctx){
  if(this.state==='idle')return;
  ctx.save();
  if(this.state==='pressing'){
   if(this.held>SHOW_PROGRESS_AFTER){
    const c=this.target.centroid,share=(this.held-SHOW_PROGRESS_AFTER)/(LONG_PRESS_SECONDS-SHOW_PROGRESS_AFTER);
    ctx.strokeStyle=INK;ctx.lineWidth=2;ctx.beginPath();ctx.arc(c.x,c.y,this.target.reach+5,-Math.PI/2,-Math.PI/2+share*TAU);ctx.stroke();
   }
   ctx.restore();return;
  }
  // The wheel, growing in from the border.
  const width=RING_WIDTH*this.opened;
  ctx.lineWidth=width;
  for(let i=0;i<SEGMENTS;i++){
   const a=i/SEGMENTS*TAU-Math.PI/2;ctx.strokeStyle=this.colourFor(i/SEGMENTS*360);
   ctx.beginPath();ctx.arc(CENTER,CENTER,240-width/2,a-.004,a+TAU/SEGMENTS+.004);ctx.stroke();
  }
  // The line from the chosen colour to the blob.
  const a=ringPoint(this.hue,240-width),c=this.target.centroid,dx=c.x-a.x,dy=c.y-a.y,dist=Math.hypot(dx,dy)||1,stop=Math.max(0,dist-this.target.reach-4);
  const ex=a.x+dx/dist*stop,ey=a.y+dy/dist*stop;
  ctx.strokeStyle=INK;ctx.lineWidth=2;ctx.lineCap='round';
  ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(ex,ey);ctx.stroke();
  ctx.fillStyle=INK;ctx.beginPath();ctx.arc(ex,ey,3.5,0,TAU);ctx.fill();
  // The sling: two bands from either side of the chosen colour to the drop at the fingertip.
  const colour=this.colourFor(this.hue);
  if(this.pull){
   ctx.beginPath();
   for(const side of [-6,6]){const s=ringPoint(this.hue+side,RING_INNER);ctx.moveTo(s.x,s.y);ctx.lineTo(this.pull.x,this.pull.y);}
   ctx.stroke();
  }
  const spot=ringPoint(this.hue);
  ctx.fillStyle=colour;ctx.beginPath();ctx.arc(spot.x,spot.y,RING_WIDTH/2*this.opened,0,TAU);ctx.fill();ctx.stroke();
  const drop=this.drop??this.pull;
  if(drop){ctx.beginPath();ctx.arc(drop.x,drop.y,DROP_RADIUS,0,TAU);ctx.fill();ctx.stroke();}
  ctx.restore();
 }
}
