// Fixed-population snow-globe particles. Updated in place; no emitter or blob mesh.
export const PARTICLE_COUNT=400;
export const CANVAS_SIZE=480;
export const WALL_RADIUS=239;
const H=1/120,TAU=Math.PI*2;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const finite=(x,fallback=0)=>Number.isFinite(x)?x:fallback;
function nextRandom(p){p.seed=(Math.imul(p.seed,1664525)+1013904223)>>>0;return p.seed/4294967296;}
export class ParticlePhysics {
 constructor({random=Math.random,count=PARTICLE_COUNT}={}){
  this.time=0;this.accumulator=0;this.controls={repulsion:0,speedScale:1,held:false};
  this.stats={wallCollisions:0,particleCollisions:0};
  this.forcesX=new Float64Array(count);this.forcesY=new Float64Array(count);
  this.particles=[];
  for(let id=0;id<count;id++){
   const radius=1.4+random()*.75,heading=random()*TAU,baseSpeed=23+random()*8;
   let x,y;
   for(let attempt=0;attempt<2000;attempt++){
    const a=random()*TAU,r=Math.sqrt(random())*(WALL_RADIUS-radius-2);x=240+Math.cos(a)*r;y=240+Math.sin(a)*r;
    if(this.particles.every(p=>(p.x-x)**2+(p.y-y)**2>(p.radius+radius+2)**2))break;
   }
   this.particles.push({id,x,y,radius,heading,baseSpeed,vx:Math.cos(heading)*baseSpeed,vy:Math.sin(heading)*baseSpeed,
    alpha:.78+random()*.22,seed:(((random()*4294967296)>>>0)^Math.imul(id+1,2654435761))>>>0,
    turnRate:0,targetTurn:0,nextTurn:0});
  }
 }
 advance(dt,controls={},motion={}){
  const repulsion=clamp(finite(controls.repulsion),0,1);
  this.controls={repulsion,speedScale:clamp(finite(controls.speedScale,1-.78*repulsion),.22,1),held:controls.held===true};
  this.accumulator+=clamp(finite(dt),0,.05);
  while(this.accumulator+1e-10>=H){this.step(motion);this.accumulator-=H;}
 }
 neighbourForces(){
  const particles=this.particles,fx=this.forcesX,fy=this.forcesY,effect=this.controls.repulsion;
  const support=14+50*effect,range=Math.max(support,42),pressure=4+220*effect;
  fx.fill(0);fy.fill(0);
  for(let i=0;i<particles.length;i++)for(let j=i+1;j<particles.length;j++){
   const a=particles[i],b=particles[j],dx=b.x-a.x,dy=b.y-a.y,d2=dx*dx+dy*dy;
   if(d2>=range*range)continue;
   let d=Math.sqrt(d2),nx,ny;
   if(d<1e-8){const angle=(i*2.399963+j*1.618034)%TAU;nx=Math.cos(angle);ny=Math.sin(angle);d=0;}
   else{nx=dx/d;ny=dy/d;}
   if(d<support){
    const weight=1-d/support,f=pressure*weight*weight;
    fx[i]-=nx*f;fy[i]-=ny*f;fx[j]+=nx*f;fy[j]+=ny*f;
   }
   if(d<42){
    // Symmetric local viscosity gives passing neighbours a loose shared fluid motion.
    const viscosity=.45*(1-effect*.65)*(1-d/42);
    const x=(b.vx-a.vx)*viscosity,y=(b.vy-a.vy)*viscosity;
    fx[i]+=x;fy[i]+=y;fx[j]-=x;fy[j]-=y;
   }
  }
 }
 wallContact(p){
  const dx=p.x-240,dy=p.y-240,d=Math.hypot(dx,dy),limit=WALL_RADIUS-p.radius;
  if(d<=limit)return;
  const nx=dx/d,ny=dy/d;p.x=240+nx*limit;p.y=240+ny*limit;
  const outward=p.vx*nx+p.vy*ny;
  if(outward>0){p.vx-=1.86*outward*nx;p.vy-=1.86*outward*ny;this.stats.wallCollisions++;}
  const hx=Math.cos(p.heading),hy=Math.sin(p.heading),headingOut=hx*nx+hy*ny;
  if(headingOut>0)p.heading=Math.atan2(hy-2*headingOut*ny,hx-2*headingOut*nx);
 }
 particleContacts(){
  const particles=this.particles;
  for(let i=0;i<particles.length;i++)for(let j=i+1;j<particles.length;j++){
   const a=particles[i],b=particles[j],dx=b.x-a.x,dy=b.y-a.y,minimum=a.radius+b.radius;
   if(dx*dx+dy*dy>=minimum*minimum)continue;
   const distance=Math.hypot(dx,dy),angle=(i*2.399963+j*1.618034)%TAU;
   const nx=distance>1e-8?dx/distance:Math.cos(angle),ny=distance>1e-8?dy/distance:Math.sin(angle);
   const correction=(minimum-distance+.001)*.5;
   a.x-=nx*correction;a.y-=ny*correction;b.x+=nx*correction;b.y+=ny*correction;
   const closing=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;
   if(closing<0){const impulse=-closing*.8;a.vx-=nx*impulse;a.vy-=ny*impulse;b.vx+=nx*impulse;b.vy+=ny*impulse;this.stats.particleCollisions++;}
  }
 }
 step(motion){
  this.time+=H;this.neighbourForces();
  const inputX=this.controls.held?clamp(finite(motion.x),-35,35):0;
  const inputY=this.controls.held?clamp(finite(motion.y),-35,35):0;
  const omega=this.controls.held?clamp(finite(motion.omega),-4,4):0;
  for(let i=0;i<this.particles.length;i++){
   const p=this.particles[i];
   if(this.time>=p.nextTurn){p.targetTurn=(nextRandom(p)*2-1)*.65;p.nextTurn=this.time+2+nextRandom(p)*3;}
   p.turnRate+=(p.targetTurn-p.turnRate)*(1-Math.exp(-H/1.4));p.heading+=p.turnRate*H;
   const target=p.baseSpeed*this.controls.speedScale;
   // Pressure from the vessel balances neighbour pressure, avoiding a pinned outer ring.
   const dx=p.x-240,dy=p.y-240,d=Math.hypot(dx,dy),gap=WALL_RADIUS-p.radius-d;
   if(d>1e-8&&gap<32&&this.controls.repulsion>0){
    const wallPressure=440*this.controls.repulsion*(1-Math.max(0,gap)/32)**2;
    this.forcesX[i]-=dx/d*wallPressure;this.forcesY[i]-=dy/d*wallPressure;
   }
   p.vx+=((Math.cos(p.heading)*target-p.vx)/1.3+this.forcesX[i]-inputX*7+omega*(p.y-240)*.12)*H;
   p.vy+=((Math.sin(p.heading)*target-p.vy)/1.3+this.forcesY[i]-inputY*7-omega*(p.x-240)*.12)*H;
   this.limitSpeed(p);p.x+=p.vx*H;p.y+=p.vy*H;this.wallContact(p);
  }
  for(let pass=0;pass<2;pass++){this.particleContacts();for(const p of this.particles)this.wallContact(p);}
  for(const p of this.particles)this.limitSpeed(p);
 }
 limitSpeed(p){
  // Repulsion and a strong shake may change direction, never override the low-energy speed ceiling.
  const speed=Math.hypot(p.vx,p.vy),limit=p.baseSpeed*this.controls.speedScale;
  if(speed>limit){p.vx*=limit/speed;p.vy*=limit/speed;}
 }
 get meanSpeed(){return this.particles.reduce((sum,p)=>sum+Math.hypot(p.vx,p.vy),0)/this.particles.length;}
}
