// Port of ~/ambient-device-visuals/sketch.js (working tree, 2026-10-23) to the 480 × 480 round display.
// One population (the portable owner). Two domains stay separate, as in the ambient sketch:
//   AUTONOMOUS  wander(): each orb follows its own noise walk at a fixed speed. Attraction never
//               changes an orb's speed or heading; only interaction-free noise does.
//   CONTACT     contactForces(): only while two orbs' field radii overlap. attraction > 0 pulls
//               them together so the metaball field fuses them; attraction 0 is a clean bounce.
// Per-frame constants are the ambient values at 60 Hz, lengths scaled from its 600 px height.
export const CANVAS_SIZE=480,CENTER=240,DISPLAY_RADIUS=240;
export const SCALE=480/600;
export const ORB_COUNT=4;
export const BASE_ATTRACTION=.8,ATTR_MAX=4;
// For equal orbs with kernel (1 - d²)² and iso 0.2, the midpoint field reaches the iso at d ≈ 0.83 × (ra + rb).
export const FUSE_RATIO=.83;
const FRAME=1/60;
const MOVE_BASE_PX=.9*SCALE,NOISE_BASE=.005;
const WANDER_SPEED_MIN=.35,WANDER_SPEED_MAX=1.10,WANDER_SPEED_OFFSET=8441;
const WANDER_NOISE_OFFSETS=[0,2113,4229,6337];
const EDGE_MARGIN=110*SCALE,EDGE_STEER=2.6;
const COLLISION_REACH_FACTOR=1.05,ZERO_ATTRACTION_SEPARATION=1.02;
const ATTRACT_BASE=.18*SCALE,REPULSION_BOUNCE=3.0*SCALE;
// Radius: ambient overallSize 65 × 1.4 × 1.15, one larger "master" orb, others up to 20 px smaller.
const BLOB_SIZE=65*1.4*1.15*SCALE,SIZE_MULTIPLIER=1.15,FIELD_REACH=1.10;
const RADIUS_VARIATION_PX=20,MASTER_BONUS_MIN=5,MASTER_BONUS_MAX=10;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const finite=(x,fallback)=>Number.isFinite(x)?x:fallback;
const lerp=(a,b,t)=>a+(b-a)*t;

// Seeded 2D Perlin noise with p5-style octaves (4, falloff 0.5), output roughly 0..1.
// Only differences of two samples drive heading, so its exact mean does not matter.
export function createNoise(random=Math.random){
 const perm=new Uint8Array(512),p=Array.from({length:256},(_,i)=>i);
 for(let i=255;i>0;i--){const j=Math.floor(random()*(i+1));[p[i],p[j]]=[p[j],p[i]];}
 for(let i=0;i<512;i++)perm[i]=p[i&255];
 const fade=t=>t*t*t*(t*(t*6-15)+10);
 const grad=(h,x,y)=>((h&1)?-x:x)+((h&2)?-y:y);
 function perlin(x,y){
  const X=Math.floor(x)&255,Y=Math.floor(y)&255,xf=x-Math.floor(x),yf=y-Math.floor(y),u=fade(xf),v=fade(yf);
  const aa=perm[perm[X]+Y],ab=perm[perm[X]+Y+1],ba=perm[perm[X+1]+Y],bb=perm[perm[X+1]+Y+1];
  return lerp(lerp(grad(aa,xf,yf),grad(ba,xf-1,yf),u),lerp(grad(ab,xf,yf-1),grad(bb,xf-1,yf-1),u),v);
 }
 return (x,y)=>{let sum=0,amp=.5,freq=1;for(let o=0;o<4;o++){sum+=amp*perlin(x*freq,y*freq);amp*=.5;freq*=2;}return clamp(.5+sum*.75,0,1);};
}

export class OrbPhysics {
 constructor({random=Math.random,count=ORB_COUNT}={}){
  this.noise=createNoise(random);this.clock=0;this.accumulator=0;this.frames=0;
  this.controls={attraction:BASE_ATTRACTION,radiusScale:1};
  this.stats={contacts:0};
  // Start loosely gathered so the first contacts are genuine approaches.
  this.orbs=Array.from({length:count},(_,i)=>{
   const a=i/count*Math.PI*2-Math.PI/2,master=i===0;
   const offset=master?lerp(MASTER_BONUS_MIN,MASTER_BONUS_MAX,random()):-RADIUS_VARIATION_PX*random();
   return {id:i,master,x:CENTER+Math.cos(a)*90+(random()-.5)*30,y:CENTER+Math.sin(a)*90+(random()-.5)*30,
    baseRadius:Math.max(20*SIZE_MULTIPLIER*SCALE,BLOB_SIZE+offset*SIZE_MULTIPLIER*SCALE)*FIELD_REACH,
    noiseSeed:random()*1000,autoX:0,autoY:0,forceX:0,forceY:0,mergeAmount:0};
  });
  for(const o of this.orbs)this.contain(o);
 }
 radius(o){return o.baseRadius*this.controls.radiusScale;}
 advance(dt,controls={}){
  this.controls={attraction:clamp(finite(controls.attraction,BASE_ATTRACTION),0,ATTR_MAX),
   radiusScale:clamp(finite(controls.radiusScale,1),.2,1)};
  this.accumulator+=clamp(finite(dt,0),0,.1);
  while(this.accumulator+1e-10>=FRAME){this.frame();this.accumulator-=FRAME;}
 }
 frame(){
  this.frames++;this.clock+=NOISE_BASE;
  for(const o of this.orbs)this.wander(o);
  for(const o of this.orbs)this.contactForces(o);
  for(const o of this.orbs){o.x+=o.autoX+o.forceX;o.y+=o.autoY+o.forceY;this.contain(o);}
  if(this.controls.attraction<=0)this.separate();
 }
 // AUTONOMOUS: difference of two noise channels per axis (zero-mean), soft steer off the round edge.
 wander(o){
  const n=this.noise,z=this.clock,[a,b,c,d]=WANDER_NOISE_OFFSETS;
  let vx=n(o.noiseSeed+a,z)-n(o.noiseSeed+b,z),vy=n(o.noiseSeed+c,z)-n(o.noiseSeed+d,z);
  const dx=o.x-CENTER,dy=o.y-CENTER,dist=Math.hypot(dx,dy),gap=DISPLAY_RADIUS-dist;
  if(gap<EDGE_MARGIN&&dist>1e-6){const s=EDGE_STEER*(1-gap/EDGE_MARGIN);vx-=dx/dist*s;vy-=dy/dist*s;}
  const m=Math.hypot(vx,vy);
  if(m>1e-3){
   const speed=MOVE_BASE_PX*lerp(WANDER_SPEED_MIN,WANDER_SPEED_MAX,n(o.noiseSeed+WANDER_SPEED_OFFSET,z*.72+19));
   o.autoX=vx/m*speed;o.autoY=vy/m*speed;
  }else{o.autoX=0;o.autoY=0;}
 }
 // CONTACT: local response only while field radii overlap; it adds to, never replaces, the wander.
 contactForces(o){
  o.forceX=0;o.forceY=0;o.mergeAmount=0;
  const attraction=this.controls.attraction,t=clamp(attraction/ATTR_MAX,0,1),r=this.radius(o);
  for(const other of this.orbs){
   if(other===o)continue;
   const dx=other.x-o.x,dy=other.y-o.y,d=Math.hypot(dx,dy);
   const reach=(r+this.radius(other))*lerp(ZERO_ATTRACTION_SEPARATION,COLLISION_REACH_FACTOR,t);
   if(d>=reach)continue;
   const ux=d>1e-4?dx/d:1,uy=d>1e-4?dy/d:0,contact=clamp(1-d/reach,0,1);
   if(attraction>0){const pull=attraction*ATTRACT_BASE*contact;o.forceX+=ux*pull;o.forceY+=uy*pull;}
   else{const push=REPULSION_BOUNCE*contact;o.forceX-=ux*push;o.forceY-=uy*push;}
   if(o.id<other.id)this.stats.contacts++;
   o.mergeAmount=Math.max(o.mergeAmount,attraction>0?t*contact:0);
  }
 }
 // Keep the whole blob on the glass (ambient keeps the whole ring on canvas).
 contain(o){
  const dx=o.x-CENTER,dy=o.y-CENTER,d=Math.hypot(dx,dy),limit=DISPLAY_RADIUS-this.radius(o);
  if(d>limit&&d>1e-6){o.x=CENTER+dx/d*limit;o.y=CENTER+dy/d*limit;}
 }
 // Zero attraction: hard floor so orbs bounce and never fuse.
 separate(){
  const b=this.orbs;
  for(let i=0;i<b.length;i++)for(let j=i+1;j<b.length;j++){
   const p=b[i],q=b[j];let dx=q.x-p.x,dy=q.y-p.y,d=Math.hypot(dx,dy);
   const min=(this.radius(p)+this.radius(q))*ZERO_ATTRACTION_SEPARATION;
   if(d>=min)continue;
   if(d<1e-4){dx=1;dy=0;d=1e-4;}
   const push=(min-d)/2,ux=dx/d,uy=dy/d;
   p.x-=ux*push;p.y-=uy*push;q.x+=ux*push;q.y+=uy*push;this.contain(p);this.contain(q);
  }
 }
 // Render input: centre and current radius per orb.
 get blobs(){return this.orbs.map(o=>({x:o.x,y:o.y,r:this.radius(o)}));}
 // Number of visually separate blobs (connected components of fused pairs).
 pieces(){
  const b=this.orbs,parent=b.map((_,i)=>i),find=i=>parent[i]===i?i:(parent[i]=find(parent[i]));
  for(let i=0;i<b.length;i++)for(let j=i+1;j<b.length;j++)
   if(Math.hypot(b[i].x-b[j].x,b[i].y-b[j].y)<(this.radius(b[i])+this.radius(b[j]))*FUSE_RATIO)parent[find(i)]=find(j);
  return new Set(b.map((_,i)=>find(i))).size;
 }
 // Autonomous wander speed in px/s (attraction-independent by construction).
 get meanSpeed(){return this.orbs.reduce((s,o)=>s+Math.hypot(o.autoX,o.autoY),0)/this.orbs.length*60;}
}
