// Spring-mass soft bodies for the 480 × 480 round display, after makoto-lee/softbody-physics-simulation:
// unit-mass nodes, Hooke springs, per-frame air resistance, anti-self-collapse and point-in-polygon
// collision projected onto the nearest edge. Bodies here are circular rings (the reference builds
// rectangular grids), braced by skip and chord springs, with the pressure term from Matyka's
// "How to implement a pressure soft body model" (the reference's second citation) holding their area.
// Units follow the reference: forces and velocities per 60 Hz frame, integrated in SUBSTEPS slices.
export const CANVAS_SIZE=480,CENTER=240,DISPLAY_RADIUS=240;
export const BODY_COUNT=14,NODES=16,BODY_RADIUS=22;
export const STIFFNESS_MIN=.02,STIFFNESS_MAX=.4,STIFFNESS_DEFAULT=.15; // reference k = 0.15
// Live tuning parameters (sliders). size scales radius, speed scales drift, freedom loosens the path, wobble is the self-morph amount.
export const PARAMS=Object.freeze({
 stiffness:Object.freeze({min:STIFFNESS_MIN,max:STIFFNESS_MAX,default:STIFFNESS_DEFAULT}),
 size:Object.freeze({min:.5,max:2,default:1}),
 speed:Object.freeze({min:0,max:8,default:1}),
 // Free wander: 0 = ride the random path closely; 1 = drift freely, only loosely tied to the path.
 freedom:Object.freeze({min:0,max:1,default:.6}),
 wobble:Object.freeze({min:0,max:.3,default:.11}),
 // Share of a collision taken up as a local dent (1) versus pushing the whole body away (0).
 deformation:Object.freeze({min:0,max:1,default:.75}),
 count:Object.freeze({min:1,max:30,default:BODY_COUNT,integer:true}),
 // px per frame², like the reference's gravity_acc (0.025).
 gravity:Object.freeze({min:0,max:.05,default:0}),
 // Sliminess at rest; shaking drains it (see ShakeDrain), so the live amount is slime × (1 − drain).
 slime:Object.freeze({min:0,max:1,default:.8})
});
const SUBSTEPS=4,H=1/SUBSTEPS,FRAME=1/60;
const SPRING_DECAY=.9;        // reference "force decay"
const AIR=.995;               // reference velocity retention per frame
const SPRING_DAMPING=.04;     // along-spring damping, keeps stiff settings from ringing
const PRESSURE=.06;           // area-restoring pressure gain
const WALL_GAP=2,WALL_RESTITUTION=.35,WALL_FRICTION=.9;
const WANDER_SPEED=.33,WANDER_GAIN=.012;   // path pace px/frame at speed 1 (~11–15 px/s), seek gain
// Random path: each body owns an endless chain of random points (spread over the disc) joined by a
// Catmull-Rom curve. A target slides along it at a pace set by speed; the body seeks the target.
// Steady pace: each segment's duration is proportional to its length, so the target never crawls
// (with a fixed time per segment, two close points made a body sit nearly still for many seconds).
const PATH_PACE=20;           // px/s along the path at speed 1, measured at the nominal reach
const KNOT_GAP=.5;            // minimum distance between consecutive path points (unit disc)
// Path reach: outer points keep the body just inside the glass (in body radii from the rim).
const PATH_MARGIN=1.15;
// Personal space: within SPACE × the touching distance, a body steers around a neighbour instead of
// pressing into it, and is nudged away; contacts also bounce a little. Without this, a body whose path
// runs behind another pushes into it indefinitely and the two (then three…) clump into one still mass.
// Widened from 1.7/1.5 with the smaller, more numerous bodies, which otherwise gathered in threes and fours.
const SPACE=2.1,AVOID=2,BODY_RESTITUTION=.3;
// Near the rim the outward part of the wanted velocity is turned back inward, so drift doesn't pin a
// body against the glass.
const RIM_ZONE=8;
const SEEK=1/90;              // per frame: close the gap to the target over ~1.5 s (at freedom 0)
// Free drift: a random velocity from the body's own stream (time-driven only, so collisions never
// change it) that wanders in direction and strength, correlated over ~DRIFT_SECONDS.
const DRIFT_SECONDS=3,DRIFT=1.4;  // correlation time; drift strength relative to the path pace
// Slime, all scaled by the live sliminess (0 = plain jelly):
// - goo: springs soften and gain internal viscosity, so dents ooze back instead of springing;
// - plasticity: springs creep toward their current length and only slowly relax, so dents linger;
// - sticky strands: touching nodes of two bodies (or a node and the glass) are tied by a strand that
//   pulls back as they part, drawing out a neck, and snaps when overstretched or after a while.
const GOO_SOFTEN=.45,GOO_VISCOSITY=.12,GOO_PRESSURE=.6;  // pressure also eases, so dents aren't popped straight out
const CREEP=.03,RELAX=.006,PLASTIC_MAX=.3;  // per frame; plastic offset cap in rest lengths
const STICK_RANGE=3,STICK_K=.012,STRANDS_PER_PAIR=3,WALL_STRANDS=2;
const STRAND_STRETCH=6,STRAND_STRETCH_SLIME=28;   // px a strand stretches before it snaps (sized to BODY_RADIUS)
const STRAND_LIFE=1,STRAND_LIFE_SLIME=3;          // seconds before a strand lets go regardless
const RESTICK_SECONDS=1.2;                         // a pair can't re-stick for a moment after parting
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const TAU=Math.PI*2;
export const valueFor=(name,slider)=>{const p=PARAMS[name],v=p.min+(p.max-p.min)*clamp(slider,0,1);return p.integer?Math.round(v):v;};
export const sliderFor=(name,value)=>{const p=PARAMS[name];return (value-p.min)/(p.max-p.min);};
export const stiffnessFor=slider=>valueFor('stiffness',slider);

function polygonArea(nodes){
 let a=0;for(let i=0,n=nodes.length;i<n;i++){const p=nodes[i],q=nodes[(i+1)%n];a+=p.x*q.y-q.x*p.y;}return a/2;
}
function inside(nodes,x,y){
 let hit=false;
 for(let i=0,j=nodes.length-1;i<nodes.length;j=i++){
  const a=nodes[i],b=nodes[j];
  if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)hit=!hit;
 }
 return hit;
}

class Body {
 constructor(id,x,y,radius,random){
  this.id=id;this.baseRadius=radius;this.radius=radius;this.scale=1;this.nodes=[];this.springs=[];
  for(let i=0;i<NODES;i++){const a=i/NODES*TAU;this.nodes.push({x:x+Math.cos(a)*radius,y:y+Math.sin(a)*radius,vx:0,vy:0,fx:0,fy:0});}
  const link=(i,j,kind)=>{const a=this.nodes[i],b=this.nodes[j],l=Math.hypot(a.x-b.x,a.y-b.y);this.springs.push({a,b,rest:l,base:l,original:l,kind,angle:(i+j)/2/NODES*TAU,plastic:0});};
  for(let i=0;i<NODES;i++){link(i,(i+1)%NODES,'ring');link(i,(i+2)%NODES,'skip');}
  for(let i=0;i<NODES/2;i++)link(i,i+NODES/2,'chord');
  const reach=Math.max(1,DISPLAY_RADIUS-radius*PATH_MARGIN);this.start={x:(x-CENTER)/reach,y:(y-CENTER)/reach};
  this.originalArea=this.restArea=Math.abs(polygonArea(this.nodes));
  this.seed=random()*100;this.phase=random()*TAU;this.spin=(random()<.5?-1:1)*(.15+random()*.15);
  this.pushX=0;this.pushY=0;
  // Own random stream for the path, so other bodies or collisions never alter it.
  let pathSeed=(random()*4294967296)>>>0;
  this.pathRandom=()=>((pathSeed=(Math.imul(pathSeed,1664525)+1013904223)>>>0)/4294967296);
  this.pathTime=0;this.knots=[];this.knotTimes=[];
  let driftSeed=(random()*4294967296)>>>0;
  this.driftRandom=()=>((driftSeed=(Math.imul(driftSeed,22695477)+1)>>>0)/4294967296);
  this.driftX=0;this.driftY=0;this.wantX=0;this.wantY=0;
  this.rx=0;this.ry=0;this.rvx=0;this.rvy=0;this.rn=0;
 }
 // Path point k in unit-disc coordinates. The first knot (and the one before it) is the start
 // position, so the path begins exactly where the body is.
 knot(k){
  while(this.knots.length<=k+1)this.addKnot();
  return this.knots[k];
 }
 addKnot(){
  const K=this.knots;
  if(K.length<2){K.push(this.start??{x:0,y:0});this.knotTimes[K.length-1]=0;return;}
  // Biased outward (uniform-in-disc would be √r) so paths use the whole glass and reach the rim,
  // and never right next to the previous point.
  const last=K.at(-1);let x=0,y=0;
  for(let tries=0;tries<8;tries++){
   const a=this.pathRandom()*TAU,d=Math.pow(this.pathRandom(),.3);x=Math.cos(a)*d;y=Math.sin(a)*d;
   if(Math.hypot(x-last.x,y-last.y)>=KNOT_GAP)break;
  }
  K.push({x,y});
  const nominal=DISPLAY_RADIUS-BODY_RADIUS*PATH_MARGIN,seconds=Math.hypot(x-last.x,y-last.y)*nominal/PATH_PACE;
  this.knotTimes[K.length-1]=this.knotTimes[K.length-2]+Math.max(1.5,seconds);
 }
 // Target on the path at the current path time, in display px. Reach shrinks with body size so the
 // path keeps the whole body on the glass, letting it just kiss the rim at the path's outer points.
 pathPoint(time=this.pathTime){
  // Segment k runs from knot k to knot k+1 over knotTimes[k]…knotTimes[k+1] (knot 1 starts at 0).
  time=Math.max(0,time);
  while(this.knotTimes.at(-1)<=time||this.knots.length<3)this.addKnot();
  let lo=1,hi=this.knotTimes.length-1;
  while(hi-lo>1){const mid=(lo+hi)>>1;if(this.knotTimes[mid]<=time)lo=mid;else hi=mid;}
  const k=lo,t=(time-this.knotTimes[k])/(this.knotTimes[k+1]-this.knotTimes[k]);
  const p0=this.knot(k-1),p1=this.knot(k),p2=this.knot(k+1),p3=this.knot(k+2);
  const cr=(a,b,c,d)=>.5*(2*b+(c-a)*t+(2*a-5*b+4*c-d)*t*t+(3*b-a-3*c+d)*t*t*t);
  let x=cr(p0.x,p1.x,p2.x,p3.x),y=cr(p0.y,p1.y,p2.y,p3.y);
  const m=Math.hypot(x,y);if(m>1){x/=m;y/=m;}
  const reach=Math.max(0,DISPLAY_RADIUS-this.radius*PATH_MARGIN);
  return {x:CENTER+x*reach,y:CENTER+y*reach};
 }
 // Whole-body share of collision corrections, averaged over the contacts that produced it.
 rigid(dx,dy,dvx,dvy){this.rx+=dx;this.ry+=dy;this.rvx+=dvx;this.rvy+=dvy;this.rn++;}
 applyRigid(){
  if(!this.rn)return;
  const k=1/this.rn,x=this.rx*k,y=this.ry*k,vx=this.rvx*k,vy=this.rvy*k;
  for(const n of this.nodes){n.x+=x;n.y+=y;n.vx+=vx;n.vy+=vy;}
  this.rx=this.ry=this.rvx=this.rvy=this.rn=0;
 }
 // Size change: rescale rest lengths and rest area; springs and pressure then grow or shrink the body.
 resize(scale){
  this.scale=scale;this.radius=this.baseRadius*scale;this.restArea=this.originalArea*scale*scale;
  for(const s of this.springs){s.base=s.original*scale;if(s.kind!=='chord')s.rest=s.base;}
 }
 get centroid(){let x=0,y=0;for(const n of this.nodes){x+=n.x;y+=n.y;}return {x:x/NODES,y:y/NODES};}
 get velocity(){let x=0,y=0;for(const n of this.nodes){x+=n.vx;y+=n.vy;}return {x:x/NODES,y:y/NODES};}
 get area(){return Math.abs(polygonArea(this.nodes));}
 get reach(){const c=this.centroid;let r=0;for(const n of this.nodes)r=Math.max(r,Math.hypot(n.x-c.x,n.y-c.y));return r;}
 // Natural morphing: chord rest lengths follow a slowly rotating oval plus a smaller trefoil, so each
 // body gently changes shape even when nothing touches it. Ring/skip springs keep the outline smooth.
 morph(t,wobble){
  const p2=this.phase+t*this.spin,p3=this.phase*1.7-t*this.spin*.6;
  const amount=wobble*(.7+.3*Math.sin(t*.23+this.seed));
  for(const s of this.springs)if(s.kind==='chord')
   s.rest=s.base*(1+amount*Math.cos(2*(s.angle-p2))+amount*.35*Math.cos(3*(s.angle-p3)));
 }
 // Follow this body's own random path, loosely, with a free random drift on top. Collisions may knock
 // the body off it, but never change the path, its timing or the drift: the seek steers it back.
 wander(dt,speed,freedom=0){
  this.pathTime+=dt*speed;
  const p=this.pathPoint(),ahead=this.pathPoint(this.pathTime+.5);
  const c=this.centroid,v=this.velocity,frames=.5*60;
  // Free drift (Ornstein-Uhlenbeck): decays toward zero and is kicked by Gaussian noise each frame.
  const theta=dt/DRIFT_SECONDS,kick=Math.sqrt(2*theta);
  const g=()=>Math.sqrt(-2*Math.log(1-this.driftRandom()))*Math.cos(TAU*this.driftRandom());
  this.driftX+=-this.driftX*theta+kick*g();this.driftY+=-this.driftY*theta+kick*g();
  const drift=WANDER_SPEED*DRIFT*freedom*speed;
  // Drift may push sideways or ahead but never backwards against the path, so it can't stall a body.
  let dx=this.driftX,dy=this.driftY;const fx=ahead.x-p.x,fy=ahead.y-p.y,fl=Math.hypot(fx,fy);
  if(fl>1e-6){const back=(dx*fx+dy*fy)/fl;if(back<0){dx-=fx/fl*back;dy-=fy/fl*back;}}
  // Feed-forward along the path plus a correction toward it (weaker with more freedom), plus the free
  // drift; capped so recovery stays gentle and the pace still scales with speed.
  const seek=SEEK*(1-.85*freedom);
  let tx=(ahead.x-p.x)/frames*speed+(p.x-c.x)*seek+dx*drift,ty=(ahead.y-p.y)/frames*speed+(p.y-c.y)*seek+dy*drift;
  const cap=WANDER_SPEED*2.5*Math.max(1,speed),m=Math.hypot(tx,ty);if(m>cap){tx*=cap/m;ty*=cap/m;}
  this.wantX=tx;this.wantY=ty;
 }
 // Turn the wanted velocity (after the world has steered it around neighbours and the rim) into the
 // per-node push. Faster settings steer harder too, so the body keeps up with a fast-moving target.
 steer(speed){
  const v=this.velocity,gain=WANDER_GAIN*Math.max(1,speed);
  this.pushX=(this.wantX-v.x)*gain;this.pushY=(this.wantY-v.y)*gain;
 }
 push(gravity){for(const n of this.nodes){n.fx+=this.pushX;n.fy+=this.pushY+gravity;}}
 springForces(k,slime=0){
  const soft=k*(1-GOO_SOFTEN*slime),damping=SPRING_DAMPING+GOO_VISCOSITY*slime;
  for(const s of this.springs){
   const a=s.a,b=s.b,dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1e-6,nx=dx/d,ny=dy/d;
   const relative=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;
   const f=((d-s.rest-s.plastic)*soft*SPRING_DECAY+relative*damping);
   a.fx+=nx*f;a.fy+=ny*f;b.fx-=nx*f;b.fy-=ny*f;
  }
 }
 // Plasticity: each spring's rest length creeps toward its current length (faster when slimier) and
 // relaxes back slowly, so a dent or a pulled neck holds for a moment before oozing back.
 creep(slime){
  for(const s of this.springs){
   const d=Math.hypot(s.b.x-s.a.x,s.b.y-s.a.y),cap=s.base*PLASTIC_MAX;
   s.plastic=clamp(s.plastic+CREEP*slime*(d-s.rest-s.plastic)-RELAX*s.plastic,-cap,cap);
  }
 }
 pressureForces(slime=0){
  // Outward normal pressure on each edge, proportional to how far the area is below rest.
  const signed=polygonArea(this.nodes),sign=signed<0?-1:1,area=Math.abs(signed)||1e-6;
  const p=PRESSURE*(1-GOO_PRESSURE*slime)*(this.restArea/area-1);
  for(let i=0;i<NODES;i++){
   const a=this.nodes[i],b=this.nodes[(i+1)%NODES],ex=b.x-a.x,ey=b.y-a.y;
   // For counter-clockwise winding (positive area in screen space) the outward normal is (ey, -ex).
   const nx=ey*sign,ny=-ex*sign,f=p*.5;
   a.fx+=nx*f;a.fy+=ny*f;b.fx+=nx*f;b.fy+=ny*f;
  }
 }
 integrate(){
  const air=AIR**H;
  for(const n of this.nodes){n.vx=(n.vx+n.fx*H)*air;n.vy=(n.vy+n.fy*H)*air;n.x+=n.vx*H;n.y+=n.vy*H;n.fx=0;n.fy=0;}
 }
 // Reference anti-self-collapse: neighbours never closer than half their rest length.
 antiCollapse(){
  for(const s of this.springs){
   if(s.kind!=='ring')continue;
   const a=s.a,b=s.b,dx=a.x-b.x,dy=a.y-b.y,d=Math.hypot(dx,dy),min=s.base/2;
   if(d>=min||d<1e-9)continue;
   const shift=(min-d)/2/d;a.x+=dx*shift;a.y+=dy*shift;b.x-=dx*shift;b.y-=dy*shift;
  }
 }
}

export class SoftBodyWorld {
 constructor({random=Math.random,count=BODY_COUNT,stiffness=STIFFNESS_DEFAULT}={}){
  this.time=0;this.accumulator=0;this.stiffness=stiffness;this.stats={wallContacts:0,bodyContacts:0};
  this.random=random;this.nextId=0;this.strands=[];this.parted=new Map();this.drain=0;
  for(const name of ['size','speed','freedom','wobble','deformation','gravity','slime'])this[name]=PARAMS[name].default;
  // Start scattered over the disc in free space (a ring no longer fits the larger population).
  this.bodies=[];this.setCount(count);
 }
 get count(){return this.bodies.length;}
 // Live sliminess: the resting amount, reduced by the shake drain (0 = none, 1 = fully firm).
 get sliminess(){return this.slime*(1-clamp(this.drain,0,1));}
 setDrain(value){this.drain=clamp(Number.isFinite(value)?value:0,0,1);}
 // Number of blobs: remove the newest, or add new ones in free space at the current size.
 setCount(count){
  while(this.bodies.length>count){const gone=this.bodies.pop();this.strands=this.strands.filter(t=>t.A!==gone&&t.B!==gone);}
  while(this.bodies.length<count){
   const r=BODY_RADIUS*(.9+this.random()*.2),reach=r*this.size;let x=CENTER,y=CENTER;
   for(let attempt=0;attempt<60;attempt++){
    const a=this.random()*TAU,d=Math.sqrt(this.random())*Math.max(0,DISPLAY_RADIUS-reach-12);
    x=CENTER+Math.cos(a)*d;y=CENTER+Math.sin(a)*d;
    if(this.bodies.every(b=>{const c=b.centroid;return Math.hypot(c.x-x,c.y-y)>b.reach+reach+4;}))break;
   }
   const body=new Body(this.nextId++,CENTER,CENTER,r,this.random);
   for(const n of body.nodes){n.x=x+(n.x-CENTER)*this.size;n.y=y+(n.y-CENTER)*this.size;}
   const pathReach=Math.max(1,DISPLAY_RADIUS-r*this.size*PATH_MARGIN);body.start={x:(x-CENTER)/pathReach,y:(y-CENTER)/pathReach};
   body.resize(this.size);this.bodies.push(body);
  }
 }
 setStiffness(k){this.set('stiffness',k);}
 set(name,value){
  const p=PARAMS[name];if(!p||!Number.isFinite(value))return;
  const v=clamp(p.integer?Math.round(value):value,p.min,p.max);
  if(name==='count'){this.setCount(v);return;}
  this[name]=v;
  if(name==='size')for(const b of this.bodies)b.resize(this.size);
 }
 advance(dt){
  this.accumulator+=clamp(Number.isFinite(dt)?dt:0,0,.1);
  while(this.accumulator+1e-10>=FRAME){this.frame();this.accumulator-=FRAME;}
 }
 frame(){
  for(let s=0;s<SUBSTEPS;s++){
   this.time+=FRAME*H;
   // Morph targets and the wander push update once per frame; all forces apply every substep.
   for(const b of this.bodies){if(s===0){b.morph(this.time,this.wobble);b.wander(FRAME,this.speed,this.freedom);}}
   if(s===0){this.avoid();for(const b of this.bodies)b.steer(this.speed);}
   const slime=this.sliminess;
   for(const b of this.bodies){b.push(this.gravity);b.springForces(this.stiffness,slime);b.pressureForces(slime);}
   this.strandForces(slime);
   for(const b of this.bodies)b.integrate();
   this.collideBodies();
   for(const b of this.bodies)b.applyRigid();
   for(const b of this.bodies){this.collideWall(b);b.applyRigid();this.clampToGlass(b);b.antiCollapse();}
  }
  const slime=this.sliminess;
  for(const b of this.bodies)b.creep(slime);
  this.updateStrands(slime);
 }
 // Strands pull their two ends together only when stretched past their starting length.
 strandForces(slime){
  for(const t of this.strands){
   const a=t.a,b=t.b,dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1e-6,over=d-t.rest;
   if(over<=0)continue;
   const f=STICK_K*slime*over,fx=dx/d*f,fy=dy/d*f;
   a.fx+=fx;a.fy+=fy;if(!t.wall){b.fx-=fx;b.fy-=fy;}
  }
 }
 // Once per frame: age and snap strands, then let touching nodes stick. Without slime nothing sticks
 // and existing strands snap at once.
 updateStrands(slime){
  const life=STRAND_LIFE+STRAND_LIFE_SLIME*slime,reach=STRAND_STRETCH+STRAND_STRETCH_SLIME*slime;
  const kept=[];
  for(const t of this.strands){
   t.age+=FRAME;t.stretch=Math.hypot(t.b.x-t.a.x,t.b.y-t.a.y)-t.rest;
   if(slime>0&&t.age<life*t.hold&&t.stretch<reach){t.reach=reach;kept.push(t);}
   else this.parted.set(t.key,this.time);
  }
  this.strands=kept;
  if(slime<=0)return;
  const count=new Map();for(const t of kept)count.set(t.key,(count.get(t.key)||0)+1);
  const free=key=>(count.get(key)||0)<(key.startsWith('w')?WALL_STRANDS:STRANDS_PER_PAIR)&&!(this.time-(this.parted.get(key)??-Infinity)<RESTICK_SECONDS);
  const tied=new Set(kept.map(t=>t.a));
  const add=(key,a,b,A,B,wall)=>{
   count.set(key,(count.get(key)||0)+1);tied.add(a);
   this.strands.push({key,a,b,A,B,wall,rest:Math.max(0,Math.hypot(b.x-a.x,b.y-a.y)),age:0,stretch:0,reach,hold:.6+.8*this.random()});
  };
  const B=this.bodies,c=B.map(b=>b.centroid);
  for(let i=0;i<B.length;i++)for(let j=i+1;j<B.length;j++){
   const key=B[i].id+':'+B[j].id;
   if(!free(key)||Math.hypot(c[i].x-c[j].x,c[i].y-c[j].y)>B[i].reach+B[j].reach+STICK_RANGE)continue;
   for(const a of B[i].nodes){
    if(!free(key)||tied.has(a))continue;
    for(const b of B[j].nodes)if(Math.hypot(b.x-a.x,b.y-a.y)<STICK_RANGE){add(key,a,b,B[i],B[j],false);break;}
   }
  }
  const limit=DISPLAY_RADIUS-WALL_GAP-STICK_RANGE*.5;
  for(const b of B){
   const key='w'+b.id;
   for(const a of b.nodes){
    if(!free(key)||tied.has(a))continue;
    const dx=a.x-CENTER,dy=a.y-CENTER,d=Math.hypot(dx,dy);
    if(d>=limit)add(key,a,{x:CENTER+dx/d*(DISPLAY_RADIUS-WALL_GAP),y:CENTER+dy/d*(DISPLAY_RADIUS-WALL_GAP)},b,null,true);
   }
  }
 }
 // Personal space, steering only (paths and drift are untouched): near a neighbour, the part of a
 // body's wanted velocity that heads into it is turned sideways so the body slides around, and a soft
 // nudge moves the two apart. Near the rim the outward part is turned back inward.
 avoid(){
  const B=this.bodies,c=B.map(b=>b.centroid);
  for(let i=0;i<B.length;i++){
   const A=B[i];let tx=A.wantX,ty=A.wantY;
   for(let j=0;j<B.length;j++){
    if(i===j)continue;
    const dx=c[j].x-c[i].x,dy=c[j].y-c[i].y,d=Math.hypot(dx,dy)||1e-6,touch=A.radius+B[j].radius,range=touch*SPACE;
    if(d>=range)continue;
    const near=clamp((range-d)/(range-touch*.9),0,1),nx=dx/d,ny=dy/d,into=tx*nx+ty*ny;
    if(into>0){
     const px=-ny,py=nx,side=Math.sign(tx*px+ty*py)||(A.id<B[j].id?1:-1);
     tx+=(-nx+px*side)*into*near;ty+=(-ny+py*side)*into*near;
    }
    tx-=nx*WANDER_SPEED*AVOID*near*near;ty-=ny*WANDER_SPEED*AVOID*near*near;
   }
   const rx=c[i].x-CENTER,ry=c[i].y-CENTER,rd=Math.hypot(rx,ry)||1e-6,edge=rd-(DISPLAY_RADIUS-A.radius);
   if(edge>-RIM_ZONE){const ux=rx/rd,uy=ry/rd,out=tx*ux+ty*uy;if(out>0){const k=clamp((edge+RIM_ZONE)/RIM_ZONE,0,1)*1.6;tx-=ux*out*k;ty-=uy*out*k;}}
   A.wantX=tx;A.wantY=ty;
  }
 }
 // Round glass: nodes past the rim are projected back; their outward speed is reflected and damped,
 // tangential speed loses some to friction. `deformation` splits each correction between the node
 // (a local dent the springs then recover) and the whole body (a push with no dent).
 collideWall(body){
  const limit=DISPLAY_RADIUS-WALL_GAP,local=this.deformation,whole=1-local;
  for(const n of body.nodes){
   const dx=n.x-CENTER,dy=n.y-CENTER,d=Math.hypot(dx,dy);
   if(d<=limit)continue;
   const nx=dx/d,ny=dy/d,cx=-nx*(d-limit),cy=-ny*(d-limit);
   const out=n.vx*nx+n.vy*ny,tx=n.vx-out*nx,ty=n.vy-out*ny;
   const normal=out>0?-out*WALL_RESTITUTION:out;
   const dvx=tx*WALL_FRICTION+nx*normal-n.vx,dvy=ty*WALL_FRICTION+ny*normal-n.vy;
   n.x+=cx*local;n.y+=cy*local;n.vx+=dvx*local;n.vy+=dvy*local;
   if(whole>0)body.rigid(cx*whole,cy*whole,dvx*whole,dvy*whole);
   this.stats.wallContacts++;
  }
 }
 // Hard guarantee after the whole-body share is applied: no node outside the glass.
 clampToGlass(body){
  const limit=DISPLAY_RADIUS-WALL_GAP;
  for(const n of body.nodes){const dx=n.x-CENTER,dy=n.y-CENTER,d=Math.hypot(dx,dy);if(d>limit){n.x=CENTER+dx/d*limit;n.y=CENTER+dy/d*limit;}}
 }
 // Reference collision: a node inside another body is moved onto that body's nearest edge. Here the
 // correction is shared with the edge's two nodes and approach speed is reversed with a little bounce,
 // so both bodies dent and then part rather than sticking.
 collideBodies(){
  const b=this.bodies;
  for(let i=0;i<b.length;i++)for(let j=0;j<b.length;j++){
   if(i===j)continue;
   const A=b[i],B=b[j],ca=A.centroid,cb=B.centroid;
   if(Math.hypot(ca.x-cb.x,ca.y-cb.y)>A.reach+B.reach)continue;
   for(const n of A.nodes){
    if(!inside(B.nodes,n.x,n.y))continue;
    let best=Infinity,bi=0,bt=0,qx=0,qy=0;
    for(let e=0;e<NODES;e++){
     const p=B.nodes[e],q=B.nodes[(e+1)%NODES],ex=q.x-p.x,ey=q.y-p.y,len2=ex*ex+ey*ey||1e-9;
     const t=clamp(((n.x-p.x)*ex+(n.y-p.y)*ey)/len2,0,1),x=p.x+ex*t,y=p.y+ey*t,d2=(n.x-x)**2+(n.y-y)**2;
     if(d2<best){best=d2;bi=e;bt=t;qx=x;qy=y;}
    }
    const p=B.nodes[bi],q=B.nodes[(bi+1)%NODES],dx=qx-n.x,dy=qy-n.y,d=Math.sqrt(best);
    if(d<1e-9)continue;
    const nx=dx/d,ny=dy/d,wp=1-bt,wq=bt,share=1/(1+wp*wp+wq*wq),local=this.deformation,whole=1-local;
    const evx=p.vx*wp+q.vx*wq,evy=p.vy*wp+q.vy*wq,closing=(n.vx-evx)*nx+(n.vy-evy)*ny,impulse=closing<0?closing*share*(1+BODY_RESTITUTION):0;
    // Local dent at the contact: the node and the edge it pierced.
    n.x+=dx*share*local;n.y+=dy*share*local;
    p.x-=dx*share*wp*local;p.y-=dy*share*wp*local;q.x-=dx*share*wq*local;q.y-=dy*share*wq*local;
    n.vx-=nx*impulse*local;n.vy-=ny*impulse*local;
    p.vx+=nx*impulse*wp*local;p.vy+=ny*impulse*wp*local;q.vx+=nx*impulse*wq*local;q.vy+=ny*impulse*wq*local;
    // Whole-body push for the rest, so low deformation separates bodies without denting them.
    if(whole>0){
     A.rigid(dx*share*whole,dy*share*whole,-nx*impulse*whole,-ny*impulse*whole);
     B.rigid(-dx*share*whole,-dy*share*whole,nx*impulse*whole,ny*impulse*whole);
    }
    this.stats.bodyContacts++;
   }
  }
 }
}

// Shake drain: sliminess falls in proportion to how long the user has been shaking. Each second of
// shaking (held, with intensity above SHAKE_MIN) adds 1/FIRM_SECONDS of drain, so after FIRM_SECONDS
// of shaking the blobs are plain jelly. When shaking stops the slime seeps back over RECOVER_SECONDS
// (from fully drained); it is not touched while holding still.
export const SHAKE_MIN=.12,FIRM_SECONDS=10,RECOVER_SECONDS=30;
export class ShakeDrain {
 constructor(){this.seconds=0;}
 get level(){return this.seconds/FIRM_SECONDS;}
 step(dt,{held=false,intensity=0}={}){
  dt=clamp(Number.isFinite(dt)?dt:0,0,.1);
  if(held&&intensity>SHAKE_MIN)this.seconds=Math.min(FIRM_SECONDS,this.seconds+dt);
  else if(!held)this.seconds=Math.max(0,this.seconds-dt*FIRM_SECONDS/RECOVER_SECONDS);
  return this.level;
 }
}
