// Soft bodies for the 480 × 480 round display, after lisyarus, "Making a 2D soft-body physics engine"
// (https://lisyarus.github.io/blog/posts/soft-body-physics.html), modified for free, organic wander.
// Rules taken from the article:
// - point masses only (unit mass), integrated with symplectic Euler: external forces update velocities,
//   then velocities update positions; units are px and seconds, in fixed STEP slices;
// - collision detection returns a normal and a penetration depth (negative = none); a point checks the
//   round glass and every other body, and only the collision with the largest depth is resolved;
// - resolution: push the point out along the normal (fixes sinking), bounce the normal velocity
//   (vn → −elasticity·vn) and apply friction to the tangential velocity (vt → vt·exp(−friction·dt));
//   velocity is only resolved while the point moves into the collider, so a separating point is never
//   pulled back in;
// - each body keeps its shape by shape matching: the rest shape is rotated by θ = −atan2(Σ r×q, Σ r·q)
//   about the current centre of mass, and a spring pulls each point toward its matched position;
//   stiffness·STEP² stays well below 1 for stability;
// - damping blends each point's velocity toward the body's rigid motion (centre velocity plus average
//   spin) by 1 − exp(−damping·dt), so wobble dies down without slowing the body as a whole.
// Elasticity also acts on each contact as a whole: point bounces alone hardly matter, because the shape
// springs store the impact and push the bodies apart again (measured: 65 px/s rebound at elasticity 1,
// 58 at 0). So while two bodies touch (or a body touches the glass) their parting speed is capped at
// elasticity × the speed they met at: body-level restitution. The cap rises by PEEL px/s every second of
// contact, so the squashed shapes relax slowly (the cap soaks up their stored energy) and the wander
// force can still peel an inelastic contact apart: nothing is ever glued together or to the glass.
// Modifications: no gravity; each body has its own wander force whose direction and strength drift
// smoothly with noise; a slight drag plus min/max speed on each body's centre velocity; attraction and
// repulsion between bodies; the rest shape slowly morphs (wobble); shaking lowers elasticity.
export const CANVAS_SIZE=480,CENTER=240,DISPLAY_RADIUS=240;
export const BODY_COUNT=14,NODES=16,BODY_RADIUS=22;
export const STEP=1/240;
// Live tuning parameters (sliders), in px and seconds.
export const PARAMS=Object.freeze({
 // Shape-matching spring (1/s²): how hard each point is pulled back to the matched rest shape.
 stiffness:Object.freeze({min:50,max:3000,default:600}),
 // Rigid-motion damping (1/s): how fast wobble dies down.
 damping:Object.freeze({min:0,max:20,default:4}),
 size:Object.freeze({min:.5,max:2,default:1}),
 count:Object.freeze({min:1,max:30,default:BODY_COUNT,integer:true}),
 // Wander force strength (px/s²) and how quickly its direction turns (typical rad/s).
 wander:Object.freeze({min:0,max:200,default:12}),
 turning:Object.freeze({min:0,max:3,default:.8}),
 // Centre speed limits (px/s) and the slight drag (1/s) that stops speed building up.
 minSpeed:Object.freeze({min:0,max:60,default:10}),
 maxSpeed:Object.freeze({min:10,max:300,default:45}),
 drag:Object.freeze({min:0,max:2,default:.3}),
 // Interaction forces between bodies (px/s²): attraction from up to ATTRACT_RANGE × touching
 // distance, repulsion from REPEL_RANGE × touching distance, both fading linearly with distance.
 attraction:Object.freeze({min:0,max:100,default:4}),
 repulsion:Object.freeze({min:0,max:300,default:60}),
 // Collision response: elasticity 1 keeps all normal speed; shaking lowers it (see ShakeDrain).
 elasticity:Object.freeze({min:0,max:1,default:1}),
 friction:Object.freeze({min:0,max:50,default:4}),
 // Self-morph of the rest shape (share of the radius).
 wobble:Object.freeze({min:0,max:.3,default:.11})
});
const ATTRACT_RANGE=3,REPEL_RANGE=1.6;
const POINT_RADIUS=1.5,WALL_GAP=1,CONTACT_GAP=1;  // points collide as small disks; a hair of space
// Wander: heading turn rate and strength are Ornstein-Uhlenbeck processes from each body's own random
// stream (time-driven only, so collisions never change them).
const TURN_SECONDS=1.5,STRENGTH_SECONDS=2.5,STRENGTH_SPREAD=.35,STRENGTH_MIN=.15,STRENGTH_MAX=1.85;
// Near the glass the heading turns back inward and the outward part of the force fades, so the wander
// force never pins a body against the rim.
const RIM_ZONE=1.5,RIM_TURN=3;
const PEEL=10,CONTACT_LINGER=.25; // px/s per s of contact; s after the last touching point a contact is kept
const MIN_SPEED_RATE=4;   // 1/s: how quickly a slow body is brought back up to the minimum speed
// Shaking also takes energy out of the movement: wander force and top speed fall by up to this share.
const MOVE_DRAIN=.6;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const TAU=Math.PI*2;
const cross=(ax,ay,bx,by)=>ax*by-ay*bx;
export const valueFor=(name,slider)=>{const p=PARAMS[name],v=p.min+(p.max-p.min)*clamp(slider,0,1);return p.integer?Math.round(v):v;};
export const sliderFor=(name,value)=>{const p=PARAMS[name];return (value-p.min)/(p.max-p.min);};
const stream=seed=>()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);

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
  this.id=id;this.baseRadius=radius;this.radius=radius;this.nodes=[];this.rest=[];
  for(let i=0;i<NODES;i++){const a=i/NODES*TAU;this.nodes.push({x:x+Math.cos(a)*radius,y:y+Math.sin(a)*radius,vx:0,vy:0});this.rest.push({a,x:Math.cos(a)*radius,y:Math.sin(a)*radius});}
  this.seed=random()*100;this.phase=random()*TAU;this.spin=(random()<.5?-1:1)*(.15+random()*.15);
  this.random=stream((random()*4294967296)>>>0);
  this.heading=random()*TAU;this.turn=0;this.strength=1;this.forceX=0;this.forceY=0;
 }
 gauss(){return Math.sqrt(-2*Math.log(1-this.random()))*Math.cos(TAU*this.random());}
 get centroid(){let x=0,y=0;for(const n of this.nodes){x+=n.x;y+=n.y;}return {x:x/NODES,y:y/NODES};}
 // Centre velocity, px/s.
 get velocity(){let x=0,y=0;for(const n of this.nodes){x+=n.vx;y+=n.vy;}return {x:x/NODES,y:y/NODES};}
 get area(){return Math.abs(polygonArea(this.nodes));}
 get reach(){const c=this.centroid;let r=0;for(const n of this.nodes)r=Math.max(r,Math.hypot(n.x-c.x,n.y-c.y));return r;}
 // Rest shape: a circle of the current size, gently morphing as a slowly rotating oval plus a smaller
 // trefoil, so each body changes shape on its own.
 morph(t,size,wobble){
  this.radius=this.baseRadius*size;
  const p2=this.phase+t*this.spin,p3=this.phase*1.7-t*this.spin*.6,amount=wobble*(.7+.3*Math.sin(t*.23+this.seed));
  for(const q of this.rest){const r=this.radius*(1+amount*Math.cos(2*(q.a-p2))+amount*.35*Math.cos(3*(q.a-p3)));q.x=Math.cos(q.a)*r;q.y=Math.sin(q.a)*r;}
 }
 // Wander force: heading and strength drift smoothly (Ornstein-Uhlenbeck). Near the rim the heading
 // turns back inward and the outward part of the force fades.
 steer(h,wander,turning,movement){
  const c=this.centroid,rx=c.x-CENTER,ry=c.y-CENTER,rd=Math.hypot(rx,ry)||1e-6,ux=rx/rd,uy=ry/rd;
  this.turn+=-this.turn*h/TURN_SECONDS+turning*Math.sqrt(2*h/TURN_SECONDS)*this.gauss();
  this.strength=clamp(this.strength-(this.strength-1)*h/STRENGTH_SECONDS+STRENGTH_SPREAD*Math.sqrt(2*h/STRENGTH_SECONDS)*this.gauss(),STRENGTH_MIN,STRENGTH_MAX);
  this.heading+=this.turn*h;
  const zone=this.radius*RIM_ZONE,near=clamp((rd-(DISPLAY_RADIUS-this.radius)+zone)/zone,0,1);
  let fx=Math.cos(this.heading),fy=Math.sin(this.heading);const out=fx*ux+fy*uy;
  if(near>0&&out>0){
   const inward=Math.atan2(-uy,-ux),diff=Math.atan2(Math.sin(inward-this.heading),Math.cos(inward-this.heading));
   this.heading+=diff*(1-Math.exp(-RIM_TURN*near*h));
   fx-=ux*out*near;fy-=uy*out*near;
  }
  const m=wander*this.strength*movement;this.forceX=fx*m;this.forceY=fy*m;
 }
 // Shape matching (article): best-fit rotation of the rest shape, then a spring toward each target, and
 // damping toward the rigid motion.
 shapeMatch(h,stiffness,damping){
  const c=this.centroid,v=this.velocity;let A=0,B=0,I=0,L=0;
  for(let i=0;i<NODES;i++){
   const n=this.nodes[i],q=this.rest[i],rx=n.x-c.x,ry=n.y-c.y;
   A+=rx*q.x+ry*q.y;B+=cross(rx,ry,q.x,q.y);
   I+=rx*rx+ry*ry;L+=cross(rx,ry,n.vx-v.x,n.vy-v.y);
  }
  const angle=-Math.atan2(B,A),cos=Math.cos(angle),sin=Math.sin(angle),omega=I>1e-9?L/I:0,blend=1-Math.exp(-damping*h);
  for(let i=0;i<NODES;i++){
   const n=this.nodes[i],q=this.rest[i];
   const tx=c.x+q.x*cos-q.y*sin,ty=c.y+q.x*sin+q.y*cos;
   n.vx+=stiffness*(tx-n.x)*h;n.vy+=stiffness*(ty-n.y)*h;
   const rx=n.x-c.x,ry=n.y-c.y,rvx=v.x-omega*ry,rvy=v.y+omega*rx;
   n.vx+=(rvx-n.vx)*blend;n.vy+=(rvy-n.vy)*blend;
  }
 }
 shift(dvx,dvy){for(const n of this.nodes){n.vx+=dvx;n.vy+=dvy;}}
}

// Collision of one point with the round glass: normal points back inside, depth > 0 when the point
// (a disk of POINT_RADIUS) pokes past the rim.
export function glassCollision(p){
 const dx=p.x-CENTER,dy=p.y-CENTER,d=Math.hypot(dx,dy)||1e-6;
 return {normal:{x:-dx/d,y:-dy/d},depth:d+POINT_RADIUS-(DISPLAY_RADIUS-WALL_GAP),body:null};
}
// Collision of one point with another body: if the point is inside its outline, the nearest edge gives
// the normal (that edge's outward normal) and the depth (distance to it, plus a hair of contact gap).
export function bodyCollision(p,body){
 const nodes=body.nodes;if(!inside(nodes,p.x,p.y))return null;
 const sign=polygonArea(nodes)<0?-1:1;let best=null;
 for(let i=0;i<nodes.length;i++){
  const a=nodes[i],b=nodes[(i+1)%nodes.length],ex=b.x-a.x,ey=b.y-a.y,l2=ex*ex+ey*ey||1e-9;
  const t=clamp(((p.x-a.x)*ex+(p.y-a.y)*ey)/l2,0,1),d=Math.hypot(a.x+ex*t-p.x,a.y+ey*t-p.y);
  if(!best||d<best.distance){const l=Math.sqrt(l2);best={distance:d,a,b,t,normal:{x:ey*sign/l,y:-ex*sign/l}};}
 }
 return {normal:best.normal,depth:best.distance+CONTACT_GAP,body,a:best.a,b:best.b,t:best.t};
}
// The article's rule: of all colliders, keep the one with the largest penetration depth.
export function findCollision(p,others){
 let result={normal:{x:0,y:0},depth:-Infinity,body:null};
 const glass=glassCollision(p);if(glass.depth>result.depth)result=glass;
 for(const other of others){const c=bodyCollision(p,other);if(c&&c.depth>result.depth)result=c;}
 return result;
}
// Resolve one collision: push out, bounce the normal velocity, damp the tangential one. Against the
// glass the point takes the whole correction; against a body it is shared with that edge's two points
// (unit masses, split by the contact position t along the edge), so momentum is kept.
export function resolveCollision(p,c,elasticity,friction,h){
 const n=c.normal,keep=Math.exp(-friction*h);
 if(!c.body){
  p.x+=n.x*c.depth;p.y+=n.y*c.depth;
  const vn=p.vx*n.x+p.vy*n.y;if(vn>=0)return;
  const tx=p.vx-n.x*vn,ty=p.vy-n.y*vn;
  p.vx=tx*keep-n.x*vn*elasticity;p.vy=ty*keep-n.y*vn*elasticity;return;
 }
 const {a,b,t}=c,wa=1-t,wb=t,w=1+wa*wa+wb*wb;
 const move=c.depth/w;
 p.x+=n.x*move;p.y+=n.y*move;a.x-=n.x*move*wa;a.y-=n.y*move*wa;b.x-=n.x*move*wb;b.y-=n.y*move*wb;
 const rvx=p.vx-(a.vx*wa+b.vx*wb),rvy=p.vy-(a.vy*wa+b.vy*wb),vn=rvx*n.x+rvy*n.y;
 if(vn>=0)return;
 const tx=rvx-n.x*vn,ty=rvy-n.y*vn;
 // Wanted relative velocity: normal part reversed and scaled by elasticity, tangential part damped.
 const dx=(tx*keep-n.x*vn*elasticity-rvx)/w,dy=(ty*keep-n.y*vn*elasticity-rvy)/w;
 p.vx+=dx;p.vy+=dy;a.vx-=dx*wa;a.vy-=dy*wa;b.vx-=dx*wb;b.vy-=dy*wb;
}

export class SoftBodyWorld {
 constructor({random=Math.random,count=BODY_COUNT}={}){
  this.time=0;this.accumulator=0;this.stats={wallContacts:0,bodyContacts:0};
  this.random=random;this.nextId=0;this.drain=0;this.contacts=new Map();
  for(const [name,p] of Object.entries(PARAMS))if(name!=='count')this[name]=p.default;
  // Start scattered over the disc in free space.
  this.bodies=[];this.setCount(count);
 }
 // Remember a contact between two bodies (other = null: the glass) for body-level restitution.
 touch(body,other){
  const key=other?(body.id<other.id?`${body.id}:${other.id}`:`${other.id}:${body.id}`):`${body.id}:glass`;
  const c=this.contacts.get(key);
  if(c)c.last=this.time;else this.contacts.set(key,{A:other&&body.id>other.id?other:body,B:other&&body.id>other.id?body:other,approach:0,start:this.time,last:this.time});
 }
 // Normal direction and closing speed of a contact: positive while the two approach.
 closing(c){
  const a=c.A.centroid,va=c.A.velocity;
  if(!c.B){const dx=a.x-CENTER,dy=a.y-CENTER,d=Math.hypot(dx,dy)||1e-6,nx=dx/d,ny=dy/d;return {nx,ny,speed:va.x*nx+va.y*ny};}
  const b=c.B.centroid,vb=c.B.velocity,dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1e-6,nx=dx/d,ny=dy/d;
  return {nx,ny,speed:(va.x-vb.x)*nx+(va.y-vb.y)*ny};
 }
 // Cap each contact's parting speed at elasticity × its approach speed, easing off with contact time
 // (momentum kept between bodies).
 restitution(elasticity){
  for(const [key,c] of this.contacts){
   if(this.time-c.last>CONTACT_LINGER||!this.bodies.includes(c.A)||(c.B&&!this.bodies.includes(c.B))){this.contacts.delete(key);continue;}
   const {nx,ny,speed}=this.closing(c);c.approach=Math.max(c.approach,speed);
   const excess=-speed-elasticity*c.approach-PEEL*(this.time-c.start);if(excess<=0)continue;
   if(!c.B){c.A.shift(nx*excess,ny*excess);continue;}
   c.A.shift(nx*excess/2,ny*excess/2);c.B.shift(-nx*excess/2,-ny*excess/2);
  }
 }
 get count(){return this.bodies.length;}
 // Live elasticity: the slider, reduced by the shake drain (fully drained = no bounce at all).
 get liveElasticity(){return this.elasticity*(1-this.drain);}
 // Share of wander force and top speed left after shaking.
 get movement(){return 1-MOVE_DRAIN*this.drain;}
 setDrain(value){this.drain=clamp(Number.isFinite(value)?value:0,0,1);}
 // Number of blobs: remove the newest, or add new ones in free space at the current size.
 setCount(count){
  while(this.bodies.length>count)this.bodies.pop();
  while(this.bodies.length<count){
   const r=BODY_RADIUS*(.9+this.random()*.2),reach=r*this.size;let x=CENTER,y=CENTER;
   for(let attempt=0;attempt<60;attempt++){
    const a=this.random()*TAU,d=Math.sqrt(this.random())*Math.max(0,DISPLAY_RADIUS-reach-12);
    x=CENTER+Math.cos(a)*d;y=CENTER+Math.sin(a)*d;
    if(this.bodies.every(b=>{const c=b.centroid;return Math.hypot(c.x-x,c.y-y)>b.reach+reach+4;}))break;
   }
   const body=new Body(this.nextId++,x,y,r*this.size,this.random);body.baseRadius=r;body.radius=r*this.size;
   this.bodies.push(body);
  }
 }
 set(name,value){
  const p=PARAMS[name];if(!p||!Number.isFinite(value))return;
  const v=clamp(p.integer?Math.round(value):value,p.min,p.max);
  if(name==='count'){this.setCount(v);return;}
  this[name]=v;
 }
 advance(dt){
  this.accumulator+=clamp(dt,0,.05);this.stats={wallContacts:0,bodyContacts:0};
  while(this.accumulator>=STEP){this.step(STEP);this.accumulator-=STEP;}
 }
 // Attraction and repulsion between body centres, as accelerations added to every point of a body.
 interact(h){
  const B=this.bodies,c=B.map(b=>b.centroid);
  for(let i=0;i<B.length;i++)for(let j=i+1;j<B.length;j++){
   const dx=c[j].x-c[i].x,dy=c[j].y-c[i].y,d=Math.hypot(dx,dy)||1e-6,touch=B[i].radius+B[j].radius;
   let f=0;
   if(d<touch*ATTRACT_RANGE)f+=this.attraction*(1-d/(touch*ATTRACT_RANGE));
   if(d<touch*REPEL_RANGE)f-=this.repulsion*(1-d/(touch*REPEL_RANGE));
   if(!f)continue;
   const ax=dx/d*f*h,ay=dy/d*f*h;B[i].shift(ax,ay);B[j].shift(-ax,-ay);
  }
 }
 step(h){
  this.time+=h;
  const movement=this.movement,elasticity=this.liveElasticity,drag=Math.exp(-this.drag*h);
  // 1. External forces → velocities (symplectic Euler), with the slight drag.
  for(const b of this.bodies){
   b.morph(this.time,this.size,this.wobble);
   b.steer(h,this.wander,this.turning,movement);
   for(const n of b.nodes){n.vx=(n.vx+b.forceX*h)*drag;n.vy=(n.vy+b.forceY*h)*drag;}
  }
  this.interact(h);
  // 2. Velocities → positions.
  for(const b of this.bodies)for(const n of b.nodes){n.x+=n.vx*h;n.y+=n.vy*h;}
  // 3. Collisions: per point, the deepest of the glass and every nearby body.
  const B=this.bodies,c=B.map(b=>b.centroid),r=B.map(b=>b.reach);
  for(let i=0;i<B.length;i++){
   const near=B.filter((o,j)=>j!==i&&Math.hypot(c[j].x-c[i].x,c[j].y-c[i].y)<r[i]+r[j]+POINT_RADIUS*2);
   for(const p of B[i].nodes){
    const hit=findCollision(p,near);if(hit.depth<=0)continue;
    resolveCollision(p,hit,elasticity,this.friction,h);
    if(hit.body)this.stats.bodyContacts++;else this.stats.wallContacts++;
    this.touch(B[i],hit.body);
   }
  }
  // 4. Shape matching and rigid damping.
  for(const b of B)b.shapeMatch(h,this.stiffness,this.damping);
  this.restitution(elasticity);
  // 5. Speed limits on each body's centre velocity; the wobble about the centre is untouched.
  const top=Math.max(this.minSpeed,this.maxSpeed*movement);
  for(const b of B){
   const v=b.velocity,s=Math.hypot(v.x,v.y);
   if(s>top)b.shift(v.x*(top/s-1),v.y*(top/s-1));
   else if(s<this.minSpeed){
    const ux=s>1e-3?v.x/s:Math.cos(b.heading),uy=s>1e-3?v.y/s:Math.sin(b.heading),k=(this.minSpeed-s)*(1-Math.exp(-MIN_SPEED_RATE*h));
    b.shift(ux*k,uy*k);
   }
  }
 }
}

// Shake drain: elasticity (and some movement) falls in proportion to how long the user has been
// shaking. Each second of held shaking (intensity above SHAKE_MIN) adds 1/FIRM_SECONDS, so after
// FIRM_SECONDS collisions no longer bounce. Holding still pauses it; after release it seeps back over
// RECOVER_SECONDS (from fully drained).
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
