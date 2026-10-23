// Lava-lamp metaball physics for the 480 × 480 round display. A fixed pool of sub-blobs is held
// together by short-range cohesion at rest (reads as one blob). Shake-driven repulsion breaks the
// bonds; sub-blobs then drift and bounce apart, fusing again only where they collide. O(n²) on
// 14 blobs at 60 Hz: ~91 pair checks per step, cheap enough for an ESP32-S3.
export const CANVAS_SIZE=480,CENTER=240,WALL_RADIUS=240;
export const BLOB_RADII=Object.freeze([38,35,33,31,30,29,28,27,26,25,24,23,22,21]);
const H=1/60,TAU=Math.PI*2;
export const TUNING=Object.freeze({
 drift:15,          // idle drift speed, px/s
 maxSpeed:40,       // speed ceiling at rest, px/s (scaled down by energy)
 relax:1.6,         // seconds for velocity to settle toward the drift target
 cohesion:55,       // bond spring, px/s²; fades as (1 - repulsion)²
 core:26,           // soft overlap push keeping fused blobs from stacking
 gather:.05,        // weak pull to the group centroid so separated pieces rejoin after recovery
 repel:140,         // pair repulsion at full strength, px/s²
 shake:3.2,         // px/s² per m/s² of held acceleration
 swirl:.1,          // tangential response to held rotation
 restitution:.72,   // wall bounce
 stick:.55          // fraction of closing speed absorbed when blobs collide and fuse
});
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const finite=(x,fallback=0)=>Number.isFinite(x)?x:fallback;
// A pair visually fuses with this kernel up to ~1.27 × (ra + rb); used for counting pieces.
export const FUSE_RATIO=1.25;
export class BlobPhysics {
 constructor({random=Math.random,radii=BLOB_RADII}={}){
  this.time=0;this.accumulator=0;this.controls={repulsion:0,speedScale:1,held:false};
  this.stats={wallBounces:0,collisions:0};
  this.seed=random()*100;
  this.fx=new Float64Array(radii.length);this.fy=new Float64Array(radii.length);
  // Golden-angle spiral: starts as one lump just above centre.
  this.blobs=radii.map((r,i)=>{
   const a=i*2.39996,d=Math.sqrt(i)*13;
   return {id:i,r,x:CENTER+Math.cos(a)*d,y:CENTER-20+Math.sin(a)*d,vx:0,vy:0,
    seed:random()*100,phase:random()*TAU,response:.6+random()*.8,bend:(random()*2-1)*.6,grip:0};
  });
  // Grip: how much repulsion a blob's bonds withstand. Bigger blobs hold on longer, so a gentle
  // shake sheds small pieces from a core and only a hard shake breaks the lump apart entirely.
  const lo=Math.min(...radii),hi=Math.max(...radii);
  for(const p of this.blobs)p.grip=.35+.45*(p.r-lo)/Math.max(1,hi-lo)+random()*.1;
  this.meanRadius=radii.reduce((s,r)=>s+r,0)/radii.length;
 }
 advance(dt,controls={},motion={}){
  const repulsion=clamp(finite(controls.repulsion),0,1);
  this.controls={repulsion,speedScale:clamp(finite(controls.speedScale,1),.2,1),held:controls.held===true};
  this.accumulator+=clamp(finite(dt),0,.05);
  while(this.accumulator+1e-10>=H){this.step(motion);this.accumulator-=H;}
 }
 pairForces(){
  const b=this.blobs,fx=this.fx,fy=this.fy,{repulsion}=this.controls,T=TUNING;
  fx.fill(0);fy.fill(0);
  for(let i=0;i<b.length;i++)for(let j=i+1;j<b.length;j++){
   const p=b[i],q=b[j],dx=q.x-p.x,dy=q.y-p.y,sum=p.r+q.r;
   // Pair looseness: 0 while repulsion is below the weaker blob's grip, 1 once well past it.
   const loose=clamp((repulsion-Math.min(p.grip,q.grip))/.2,0,1);
   const cohesion=T.cohesion*(1-loose)**2,repel=T.repel*repulsion*loose,reach=1+.6*loose;
   const range=sum*Math.max(1.8,reach),d2=dx*dx+dy*dy;
   if(d2>=range*range)continue;
   let d=Math.sqrt(d2),nx,ny;
   if(d<1e-6){const a=(i*2.399963+j*1.618034)%TAU;nx=Math.cos(a);ny=Math.sin(a);d=0;}else{nx=dx/d;ny=dy/d;}
   const rest=sum*.5,bond=sum*1.8;
   let f=0; // positive pulls p toward q
   if(d<rest)f-=T.core*(1-d/rest);
   else if(d<bond){const x=(d-rest)/(bond-rest);f+=cohesion*4*x*(1-x);}
   const rr=sum*reach;
   if(repel>0&&d<rr){const w=1-d/rr;f-=repel*w*w;}
   // Smaller blobs respond more, so a shaken lump sheds small pieces first.
   const mp=q.r/sum,mq=p.r/sum;
   fx[i]+=nx*f*mp*2;fy[i]+=ny*f*mp*2;fx[j]-=nx*f*mq*2;fy[j]-=ny*f*mq*2;
  }
 }
 collide(){
  // Collisions are soft: the metaball field fuses overlapping blobs; closing speed is partly absorbed.
  const b=this.blobs;
  for(let i=0;i<b.length;i++)for(let j=i+1;j<b.length;j++){
   const p=b[i],q=b[j],dx=q.x-p.x,dy=q.y-p.y,touch=(p.r+q.r)*.75,d2=dx*dx+dy*dy;
   if(d2>=touch*touch||d2<1e-12)continue;
   const d=Math.sqrt(d2),nx=dx/d,ny=dy/d,closing=(q.vx-p.vx)*nx+(q.vy-p.vy)*ny;
   if(closing>=0)continue;
   const mp=p.r*p.r,mq=q.r*q.r,impulse=-closing*TUNING.stick/(mp+mq);
   p.vx-=nx*impulse*mq;p.vy-=ny*impulse*mq;q.vx+=nx*impulse*mp;q.vy+=ny*impulse*mp;
   this.stats.collisions++;
  }
 }
 step(motion){
  this.time+=H;this.pairForces();
  const t=this.time,b=this.blobs,T=TUNING,{repulsion,speedScale,held}=this.controls;
  const ax=held?clamp(finite(motion.x),-35,35):0,ay=held?clamp(finite(motion.y),-35,35):0;
  const omega=held?clamp(finite(motion.omega),-4,4):0;
  // Shared flow carries the whole lump (lava-lamp wander); individual flow gently morphs it.
  const S=this.seed,sx=Math.sin(t*.19+S)+.45*Math.sin(t*.37+S*1.3),sy=Math.cos(t*.16+S*2)+.35*Math.cos(t*.29+S*.7);
  let cx=0,cy=0,mass=0;
  for(const p of b){const m=p.r*p.r;cx+=p.x*m;cy+=p.y*m;mass+=m;}
  cx/=mass;cy/=mass;
  const gather=T.gather*(1-repulsion)**3,drift=T.drift*speedScale/1.4,limit=T.maxSpeed*speedScale;
  for(let i=0;i<b.length;i++){
   const p=b[i];
   const ix=Math.sin(t*.31+p.seed)+.5*Math.sin(t*.53+p.phase),iy=Math.cos(t*.27+p.seed*2)+.5*Math.cos(t*.47+p.phase);
   // Loosened pieces wander on their own paths, so split blobs keep meeting and fusing.
   const own=.8+.7*repulsion;
   let tx=(sx+own*ix)*drift,ty=(sy+own*iy)*drift;
   // Steer the drift target away from the rim (v9 soft limit); bounces handle the rest.
   const dx=p.x-CENTER,dy=p.y-CENTER,dist=Math.max(1e-3,Math.hypot(dx,dy));
   const steer=Math.max(0,(dist-(WALL_RADIUS-p.r-30))/25)*drift*1.5;
   tx-=dx/dist*steer;ty-=dy/dist*steer;
   let fx=this.fx[i]+(cx-p.x)*gather,fy=this.fy[i]+(cy-p.y)*gather;
   if(held){
    // Each blob reads the shake slightly differently (size, gain, bend), which pulls the lump apart.
    const k=T.shake*p.response*(this.meanRadius/p.r)**.8,c=Math.cos(p.bend),s=Math.sin(p.bend);
    fx-=(ax*c-ay*s)*k;fy-=(ax*s+ay*c)*k;
    fx+=omega*dy*T.swirl;fy-=omega*dx*T.swirl;
   }
   p.vx+=((tx-p.vx)/T.relax+fx)*H;p.vy+=((ty-p.vy)/T.relax+fy)*H;
  }
  this.collide();
  for(const p of b){
   const speed=Math.hypot(p.vx,p.vy);
   if(speed>limit){p.vx*=limit/speed;p.vy*=limit/speed;}
   p.x+=p.vx*H;p.y+=p.vy*H;this.wall(p);
  }
 }
 wall(p){
  // The visible edge may kiss the rim; the centre stays inside so the blob never leaves the glass.
  const dx=p.x-CENTER,dy=p.y-CENTER,d=Math.hypot(dx,dy),limit=WALL_RADIUS-p.r*.85;
  if(d<=limit)return;
  const nx=dx/d,ny=dy/d;p.x=CENTER+nx*limit;p.y=CENTER+ny*limit;
  const out=p.vx*nx+p.vy*ny;
  if(out>0){p.vx-=(1+TUNING.restitution)*out*nx;p.vy-=(1+TUNING.restitution)*out*ny;this.stats.wallBounces++;}
 }
 // Number of visually separate pieces (connected components of fused pairs).
 pieces(){
  const b=this.blobs,parent=b.map((_,i)=>i),find=i=>parent[i]===i?i:(parent[i]=find(parent[i]));
  for(let i=0;i<b.length;i++)for(let j=i+1;j<b.length;j++){
   const p=b[i],q=b[j];if(Math.hypot(q.x-p.x,q.y-p.y)<(p.r+q.r)*FUSE_RATIO)parent[find(i)]=find(j);
  }
  return new Set(b.map((_,i)=>find(i))).size;
 }
 get meanSpeed(){return this.blobs.reduce((s,p)=>s+Math.hypot(p.vx,p.vy),0)/this.blobs.length;}
}
