// Soft bodies for the 480 × 480 round display, after lisyarus, "Making a 2D soft-body physics engine"
// (https://lisyarus.github.io/blog/posts/soft-body-physics.html), driven by the device's own gravity.
// Rules taken from the article:
// - point masses only (unit mass), integrated with symplectic Euler: external forces update velocities,
//   then velocities update positions; units are px and seconds, in fixed STEP slices;
// - collision detection returns a normal and a penetration depth (negative = none); a point checks the
//   round glass and every other body, and only the collision with the largest depth is resolved;
// - resolution: push the point out along the normal (fixes sinking), bounce the normal velocity
//   (vn → −elasticity·vn) and apply friction to the tangential velocity (vt → vt·exp(−friction·dt));
//   velocity is only resolved while the point moves into the collider, so a separating point is never
//   pulled back in, and slower than RESTING_SPEED it doesn't bounce (resting contact);
// - each body keeps its shape by shape matching: the rest shape is rotated by θ = −atan2(Σ r×q, Σ r·q)
//   about the current centre of mass, and a spring pulls each point toward its matched position;
//   stiffness·STEP² stays well below 1 for stability;
// - damping blends each point's velocity toward the body's rigid motion (centre velocity plus average
//   spin) by 1 − exp(−damping·dt), so wobble dies down without slowing the body as a whole.
// Elasticity also acts on each contact as a whole: point bounces alone hardly matter, because the shape
// springs store the impact and push the bodies apart again (measured: 65 px/s rebound at elasticity 1,
// 58 at 0). So while two bodies touch (or a body touches the glass) their parting speed is capped at
// elasticity × the speed they met at, and an impact faster than BOUNCE_MIN is topped up to exactly
// that as they start to part: body-level restitution, 0–2. The cap rises by PEEL px/s every second of
// contact, so the squashed shapes relax slowly (the cap soaks up their stored energy) and gravity or
// a tilt can still peel an inelastic contact apart: nothing is ever glued together or to the glass.
// Modifications: the only driving force is the device's gravity (see `gravity`): tilting or moving the
// device sends every body the same acceleration, and with the device still and level nothing moves; a
// slight drag and a top speed on each body's centre velocity; a perfectly circular rest shape;
// shaking lowers elasticity.
export const CANVAS_SIZE=480,CENTER=240,DISPLAY_RADIUS=240;
export const BODY_COUNT=50,NODES=16,BODY_RADIUS=22;
export const STEP=1/240;
// Live tuning parameters (sliders), in px and seconds.
export const PARAMS=Object.freeze({
 // Shape-matching spring (1/s²): how hard each point is pulled back to the matched rest shape.
 stiffness:Object.freeze({min:50,max:3000,default:1000}),
 // Rigid-motion damping (1/s): how fast wobble dies down.
 damping:Object.freeze({min:0,max:20,default:1.5}),
 size:Object.freeze({min:.5,max:2,default:1}),
 count:Object.freeze({min:1,max:100,default:BODY_COUNT,integer:true}),
 // Gravity: px/s² for 1 g of tilt or movement in the screen plane (world.gravity is in g).
 gravity:Object.freeze({min:0,max:2000,default:600}),
 // Top centre speed (px/s) and the drag (1/s) that stops speed building up and lets bodies settle.
 maxSpeed:Object.freeze({min:10,max:1000,default:600}),
 drag:Object.freeze({min:0,max:5,default:.6}),
 // Press on the plate (after Magnum's fluidsimulation2d mouse interaction): a one-off push away from
 // the press point, at most `push` px/s, fading with distance to nothing at `pushRadius` px. Close blobs
 // fly off and bounce off the far side; distant ones (already lying on that side) barely move.
 push:Object.freeze({min:0,max:1500,default:500}),
 pushRadius:Object.freeze({min:40,max:480,default:220}),
 // Collision response: elasticity 1 keeps all normal speed; shaking lowers it (see ShakeDrain).
 // Elasticity is the body-level restitution: a real impact parts at elasticity × the speed it met at
 // (0 = dead stop, 1 = perfect bounce, 2 = twice as fast, up to the top speed).
 elasticity:Object.freeze({min:0,max:2,default:1}),
 friction:Object.freeze({min:0,max:50,default:4})
});
// Up to 100 blobs: when the blobs would cover more than FILL_MAX of the disc at the chosen size, they
// are all drawn smaller just enough to fit (100 blobs: about ×0.8), so a full plate never jams.
export const FILL_MAX=.55;
const POINT_RADIUS=1.5,WALL_GAP=1;  // points collide with the glass as small disks
// Resting contact (standard in physics engines): a point meeting something slower than this doesn't
// bounce, so blobs resting under gravity settle instead of micro-bouncing at elasticity 1.
export const RESTING_SPEED=20;
// Pressure gain (1/s²) and the cap on the rest/current area ratio it reacts to; only pushes outward,
// so it never inflates a body, only stops it being crushed.
const PRESSURE=400,PRESSURE_CAP=4;
// Gravity below this (in g, after any input smoothing) counts as level: a device lying on a table never
// creeps. Above it the dead zone is subtracted, so the response starts from zero without a jump.
export const GRAVITY_DEAD_ZONE=.05;
const PEEL=10,CONTACT_LINGER=.25; // px/s per s of contact; s after the last touching point a contact is kept
// Impacts at least this fast (px/s) get their rebound set to exactly elasticity × the approach speed, by
// a top-up when the bodies start to part. Slower contacts (resting, jostling in a pile) are only capped,
// never topped up, so a pile can't pump itself up when elasticity is above 1.
export const BOUNCE_MIN=60;
// Shaking also takes energy out of the movement: the top speed falls by up to this share.
const MOVE_DRAIN=.6;
// Share of the gap to the pointer's velocity a body right on a drag stroke takes up per move event.
const STIR_SHARE=.35;
// Settling: a body that has been touching something (glass or another body) without a break for
// SETTLE_AFTER seconds is resting, and its wobble is damped at least SETTLE_DAMPING. A bounce is a brief
// contact, so it keeps the livelier slider damping; a deep pile (50 blobs) otherwise kept vibrating at
// ~9 px/s in place. Contacts are also remembered for CONTACT_LINGER, so a body rattling in a pile counts
// as touching throughout.
const SETTLE_AFTER=.4,SETTLE_DAMPING=10;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const TAU=Math.PI*2;
const cross=(ax,ay,bx,by)=>ax*by-ay*bx;
export const valueFor=(name,slider)=>{const p=PARAMS[name],v=p.min+(p.max-p.min)*clamp(slider,0,1);return p.integer?Math.round(v):v;};
export const sliderFor=(name,value)=>{const p=PARAMS[name];return (value-p.min)/(p.max-p.min);};

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
  this.scale=1;
 }
 get centroid(){let x=0,y=0;for(const n of this.nodes){x+=n.x;y+=n.y;}return {x:x/NODES,y:y/NODES};}
 // Centre velocity, px/s.
 get velocity(){let x=0,y=0;for(const n of this.nodes){x+=n.vx;y+=n.vy;}return {x:x/NODES,y:y/NODES};}
 get area(){return Math.abs(polygonArea(this.nodes));}
 get reach(){const c=this.centroid;let r=0;for(const n of this.nodes)r=Math.max(r,Math.hypot(n.x-c.x,n.y-c.y));return r;}
 // Rest shape: a perfect circle of the current size; shape matching grows or shrinks the body to it.
 resize(scale){
  if(scale===this.scale)return;
  this.scale=scale;this.radius=this.baseRadius*scale;
  for(const q of this.rest){q.x=Math.cos(q.a)*this.radius;q.y=Math.sin(q.a)*this.radius;}
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
  this.pressurise(h);
 }
 // Area-keeping pressure (Matyka's pressure soft body): shape matching alone has no volume, so under a
 // pile's weight a body could be folded inside out against the glass. Each edge is pushed along its
 // outward normal in proportion to how far the area is below the rest shape's (capped when crushed).
 pressurise(h){
  const rest=polygonArea(this.rest),current=polygonArea(this.nodes),sign=rest<0?-1:1;
  const ratio=clamp(Math.abs(rest)/Math.max(1e-6,current*sign),0,PRESSURE_CAP),p=PRESSURE*(ratio-1)*.5*h;
  if(p<=0)return;
  for(let i=0;i<NODES;i++){
   const a=this.nodes[i],b=this.nodes[(i+1)%NODES],nx=(b.y-a.y)*sign,ny=-(b.x-a.x)*sign;
   a.vx+=nx*p;a.vy+=ny*p;b.vx+=nx*p;b.vy+=ny*p;
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
// Collision of one point with another body: if the point is inside its outline, it leaves along the
// line from that body's centre through the point (the bodies are round, so this is the way out), and
// the depth is how far the outline lies beyond it on that line. Using the nearest edge instead let a
// deeply pressed point exit through the far side and fold the body inside out under a pile's weight.
export function bodyCollision(p,body){
 const nodes=body.nodes;if(!inside(nodes,p.x,p.y))return null;
 const c=body.centroid;let dx=p.x-c.x,dy=p.y-c.y,d=Math.hypot(dx,dy);
 if(d<1e-6){dx=1;dy=0;d=1e-6;}
 const ux=dx/d,uy=dy/d;let best=null;
 for(let i=0;i<nodes.length;i++){
  // Ray c + s·u against edge a→b: s along the ray, t along the edge.
  const a=nodes[i],b=nodes[(i+1)%nodes.length],ex=b.x-a.x,ey=b.y-a.y,den=cross(ux,uy,ex,ey);
  if(Math.abs(den)<1e-9)continue;
  const ax=a.x-c.x,ay=a.y-c.y,s=cross(ax,ay,ex,ey)/den,t=cross(ax,ay,ux,uy)/den;
  if(t<-1e-9||t>1+1e-9||s<=0)continue;
  if(!best||s>best.s)best={s,a,b,t:clamp(t,0,1)};
 }
 if(!best||best.s<=d)return null;
 return {normal:{x:ux,y:uy},depth:best.s-d,body,a:best.a,b:best.b,t:best.t};
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
  const vn=p.vx*n.x+p.vy*n.y;if(vn>=0)return;if(-vn<RESTING_SPEED)elasticity=0;
  const tx=p.vx-n.x*vn,ty=p.vy-n.y*vn;
  p.vx=tx*keep-n.x*vn*elasticity;p.vy=ty*keep-n.y*vn*elasticity;return;
 }
 const {a,b,t}=c,wa=1-t,wb=t,w=1+wa*wa+wb*wb;
 const move=c.depth/w;
 p.x+=n.x*move;p.y+=n.y*move;a.x-=n.x*move*wa;a.y-=n.y*move*wa;b.x-=n.x*move*wb;b.y-=n.y*move*wb;
 const rvx=p.vx-(a.vx*wa+b.vx*wb),rvy=p.vy-(a.vy*wa+b.vy*wb),vn=rvx*n.x+rvy*n.y;
 if(vn>=0)return;if(-vn<RESTING_SPEED)elasticity=0;
 const tx=rvx-n.x*vn,ty=rvy-n.y*vn;
 // Wanted relative velocity: normal part reversed and scaled by elasticity, tangential part damped.
 const dx=(tx*keep-n.x*vn*elasticity-rvx)/w,dy=(ty*keep-n.y*vn*elasticity-rvy)/w;
 p.vx+=dx;p.vy+=dy;a.vx-=dx*wa;a.vy-=dy*wa;b.vx-=dx*wb;b.vy-=dy*wb;
}

export class SoftBodyWorld {
 constructor({random=Math.random,count=BODY_COUNT}={}){
  this.time=0;this.accumulator=0;this.stats={wallContacts:0,bodyContacts:0};
  this.random=random;this.nextId=0;this.drain=0;this.contacts=new Map();
  // Device gravity in the screen plane, in g (+x right, +y down the screen): set by app.js from the
  // accelerometer, the tilt controls or the shake test. {0, 0} = level and still.
  this.gravityInput={x:0,y:0};
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
   // Top-up once, as the bodies start to part: the shape springs alone return only ~70% of an impact.
   if(speed<0&&!c.toppedUp&&c.approach>=BOUNCE_MIN){
    c.toppedUp=true;const extra=elasticity*c.approach+speed;
    if(extra>0){if(!c.B)c.A.shift(-nx*extra,-ny*extra);else{c.A.shift(-nx*extra/2,-ny*extra/2);c.B.shift(nx*extra/2,ny*extra/2);}continue;}
   }
   const excess=-speed-elasticity*c.approach-PEEL*(this.time-c.start);if(excess<=0)continue;
   if(!c.B){c.A.shift(nx*excess,ny*excess);continue;}
   c.A.shift(nx*excess/2,ny*excess/2);c.B.shift(-nx*excess/2,-ny*excess/2);
  }
 }
 get count(){return this.bodies.length;}
 // Live elasticity: the slider, reduced by the shake drain (fully drained = no bounce at all).
 get liveElasticity(){return this.elasticity*(1-this.drain);}
 // Share of top speed left after shaking.
 get movement(){return 1-MOVE_DRAIN*this.drain;}
 // Drawn size: the Size slider, reduced just enough that the blobs cover at most FILL_MAX of the disc.
 get scale(){
  const covered=this.bodies.reduce((s,b)=>s+b.baseRadius**2,0)*this.size**2/DISPLAY_RADIUS**2;
  return covered>FILL_MAX?this.size*Math.sqrt(FILL_MAX/covered):this.size;
 }
 setDrain(value){this.drain=clamp(Number.isFinite(value)?value:0,0,1);}
 setGravity(x,y){this.gravityInput={x:Number.isFinite(x)?x:0,y:Number.isFinite(y)?y:0};}
 // Gravity after the dead zone, in px/s².
 get gravityAcceleration(){
  const {x,y}=this.gravityInput,m=Math.hypot(x,y);if(m<=GRAVITY_DEAD_ZONE)return {x:0,y:0};
  const k=(m-GRAVITY_DEAD_ZONE)/m*this.gravity;return {x:x*k,y:y*k};
 }
 // Number of blobs: remove the newest, or add new ones in free space at the current size.
 setCount(count){
  while(this.bodies.length>count)this.bodies.pop();
  while(this.bodies.length<count){
   // Best candidate (Mitchell): of many random spots, keep the one with the most room to its nearest
   // neighbour, so even 50–60 blobs start evenly spread instead of overlapping.
   // Placed at the size the full count will be drawn at, so the start layout already fits.
   const fit=Math.min(this.size,this.size*Math.sqrt(FILL_MAX*DISPLAY_RADIUS**2/(count*BODY_RADIUS**2*this.size**2)));
   const r=BODY_RADIUS*(.9+this.random()*.2),reach=r*fit,centres=this.bodies.map(b=>[b.centroid,b.reach]);
   let x=CENTER,y=CENTER,room=-Infinity;
   for(let attempt=0;attempt<300;attempt++){
    const a=this.random()*TAU,d=Math.sqrt(this.random())*Math.max(0,DISPLAY_RADIUS-reach-4),cx=CENTER+Math.cos(a)*d,cy=CENTER+Math.sin(a)*d;
    let gap=DISPLAY_RADIUS-reach-d;for(const [c,cr] of centres)gap=Math.min(gap,Math.hypot(c.x-cx,c.y-cy)-cr-reach);
    if(gap>room){room=gap;x=cx;y=cy;}
    if(room>8)break;
   }
   const body=new Body(this.nextId++,x,y,r*fit,this.random);body.baseRadius=r;body.radius=r*fit;body.scale=fit;
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
 // Push from a press at (x, y) px: each body is kicked away from the press point by push × falloff,
 // falloff = (1 − distance/pushRadius)², so the kick is strongest right at the press and gone at the
 // radius. A body right on the press point is kicked straight toward the far side (away from the centre).
 blast(x,y,strength=1){
  if(![x,y,strength].every(Number.isFinite))return;
  for(const b of this.bodies){
   const c=b.centroid;let dx=c.x-x,dy=c.y-y,d=Math.hypot(dx,dy);
   const f=Math.max(0,1-d/this.pushRadius)**2*this.push*clamp(strength,0,1);if(!f)continue;
   if(d<1e-3){dx=CENTER-x;dy=CENTER-y;d=Math.hypot(dx,dy);if(d<1e-3){dx=0;dy=1;d=1;}}
   b.shift(dx/d*f,dy/d*f);
  }
 }
 // Stir (Magnum's addRepulsiveVelocity): dragging from (x0, y0) to (x1, y1) over dt seconds carries
 // bodies near the stroke along with the pointer, fading to nothing at pushRadius from the stroke.
 stir(x0,y0,x1,y1,dt){
  if(![x0,y0,x1,y1,dt].every(Number.isFinite)||dt<=0)return;
  const ex=x1-x0,ey=y1-y0,l2=ex*ex+ey*ey;if(l2<1)return;
  const vx=ex/dt,vy=ey/dt;
  for(const b of this.bodies){
   const c=b.centroid,t=clamp(((c.x-x0)*ex+(c.y-y0)*ey)/l2,0,1),d=Math.hypot(x0+ex*t-c.x,y0+ey*t-c.y);
   const w=Math.max(0,1-d/this.pushRadius)**2*STIR_SHARE;if(!w)continue;
   const v=b.velocity;b.shift((vx-v.x)*w,(vy-v.y)*w);
  }
 }
 step(h){
  this.time+=h;
  const movement=this.movement,elasticity=this.liveElasticity,drag=Math.exp(-this.drag*h),g=this.gravityAcceleration;
  // 1. External force (device gravity) → velocities (symplectic Euler), with the drag.
  const scale=this.scale;
  for(const b of this.bodies){
   b.resize(scale);
   for(const n of b.nodes){n.vx=(n.vx+g.x*h)*drag;n.vy=(n.vy+g.y*h)*drag;}
  }
  // 2. Velocities → positions.
  for(const b of this.bodies)for(const n of b.nodes){n.x+=n.vx*h;n.y+=n.vy*h;}
  // 3. Collisions: per point, the deepest of the glass and every nearby body.
  const B=this.bodies,c=B.map(b=>b.centroid),r=B.map(b=>b.reach);
  for(let i=0;i<B.length;i++){
   const near=B.filter((o,j)=>j!==i&&Math.hypot(c[j].x-c[i].x,c[j].y-c[i].y)<r[i]+r[j]+POINT_RADIUS*2);
   for(const p of B[i].nodes){
    const hit=findCollision(p,near);if(hit.depth<=0)continue;
    resolveCollision(p,hit,Math.min(1,elasticity),this.friction,h);
    if(hit.body)this.stats.bodyContacts++;else this.stats.wallContacts++;
    this.touch(B[i],hit.body);
    B[i].lastTouch=this.time;B[i].touchingSince??=this.time;
   }
  }
  // 4. Shape matching and rigid damping (more for bodies resting in contact).
  for(const b of B){
   if(this.time-(b.lastTouch??-Infinity)>CONTACT_LINGER)b.touchingSince=null;
   const resting=b.touchingSince!=null&&this.time-b.touchingSince>SETTLE_AFTER;
   b.shapeMatch(h,this.stiffness,resting?Math.max(this.damping,SETTLE_DAMPING):this.damping);
  }
  this.restitution(elasticity);
  // 5. Top speed on each body's centre velocity; the wobble about the centre is untouched.
  const top=this.maxSpeed*movement;
  for(const b of B){const v=b.velocity,s=Math.hypot(v.x,v.y);if(s>top)b.shift(v.x*(top/s-1),v.y*(top/s-1));}
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
