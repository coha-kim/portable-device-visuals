// v14: continuously floating membranes with local, fading strain memory.
export const BASE_RESTITUTION=.28;
export const NODE_COUNT=24;
const H=1/120, ITERATIONS=6, WALL=238, GAP=1.6;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function area(nodes){let a=0;for(let i=0;i<nodes.length;i++){const p=nodes[i],q=nodes[(i+1)%nodes.length];a+=p.x*q.y-q.x*p.y;}return a*.5;}
function describe(blob){
 let x=0,y=0,minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 for(const p of blob.nodes){x+=p.x;y+=p.y;minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);}
 blob.x=x/blob.nodes.length;blob.y=y/blob.nodes.length;blob.bounds={minX,minY,maxX,maxY};
}
function distanceConstraint(a,b,rest,kind){return {a,b,rest,kind,lambda:0,memory:0};}
export class PalmPhysics {
 constructor({random=Math.random,count=8}={}){
  this.time=0;this.accumulator=0;this.previousOmega=0;this.controls={repulsion:0,deformation:0,held:false};this.grab=null;
  this.stats={wallCollisions:0,blobCollisions:0,minAreaRatio:1,maxAreaRatio:1,maxEdgeStretch:1};
  const positions=[[126,145],[240,145],[354,145],[69,244],[183,244],[297,244],[411,244],[240,343]];
  this.blobs=Array.from({length:count},(_,index)=>{
   const [cx,cy]=positions[index%positions.length],r=51,heading=random()*Math.PI*2,speed=8+random()*7;
   const node=(x,y,w=1)=>({x,y,oldX:x,oldY:y,vx:Math.cos(heading)*speed,vy:Math.sin(heading)*speed,preVX:0,preVY:0,w});
   const center=node(cx,cy,.25),nodes=Array.from({length:NODE_COUNT},(_,i)=>node(cx+r*Math.cos(i*Math.PI*2/NODE_COUNT),cy+r*Math.sin(i*Math.PI*2/NODE_COUNT)));
   const links=[];
   for(let i=0;i<NODE_COUNT;i++){
    const p=nodes[i],q=nodes[(i+1)%NODE_COUNT],b=nodes[(i+2)%NODE_COUNT];
    links.push(distanceConstraint(p,q,Math.hypot(q.x-p.x,q.y-p.y),'edge'));
    links.push(distanceConstraint(p,b,Math.hypot(b.x-p.x,b.y-p.y),'bend'));
    links.push(distanceConstraint(center,p,r,'spoke'));
   }
   const blob={driftHeading:heading,driftSpeed:18+index*.7,id:index,radius:r,center,nodes,particles:[center,...nodes],links,restArea:area(nodes),areaLambda:0,gradients:nodes.map(()=>({x:0,y:0}))};
   describe(blob);return blob;
  });
 }
 setGrab(x,y){
  if(![x,y].every(Number.isFinite))return false;
  if(this.grab){this.grab.x=x;this.grab.y=y;return true;}
  let selected=null,best=Infinity;
  for(const blob of this.blobs)for(const p of blob.nodes){const d=Math.hypot(p.x-x,p.y-y);if(d<best){best=d;selected=p;}}
  if(best>72)return false;this.grab={particle:selected,x,y};return true;
 }
 releaseGrab(){this.grab=null;}
 advance(dt,controls={repulsion:0,deformation:0},motion={}){
  this.controls={repulsion:clamp(controls.repulsion||0,0,1),deformation:clamp(controls.deformation||0,0,1),held:controls.held===true};
  this.accumulator+=clamp(Number.isFinite(dt)?dt:0,0,.05);
  while(this.accumulator+1e-10>=H){this.step(motion);this.accumulator-=H;}
 }
 solveDistance(link,softness){
  const {a,b}=link,dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);if(d<1e-8)return;
  const compliance=link.kind==='edge'?0.0000002+softness*.00024:link.kind==='bend'?.000004+softness*.003:.0000008+softness*.003;
  const alpha=compliance/(H*H),dl=(-(d-link.rest-link.memory)-alpha*link.lambda)/(a.w+b.w+alpha);
  link.lambda+=dl;const nx=dx/d,ny=dy/d;
  a.x-=a.w*nx*dl;a.y-=a.w*ny*dl;b.x+=b.w*nx*dl;b.y+=b.w*ny*dl;
 }
 solveArea(blob,softness){
  const nodes=blob.nodes,n=nodes.length;let denominator=0;
  for(let i=0;i<n;i++){const prev=nodes[(i+n-1)%n],next=nodes[(i+1)%n],g=blob.gradients[i];g.x=(next.y-prev.y)*.5;g.y=(prev.x-next.x)*.5;denominator+=nodes[i].w*(g.x*g.x+g.y*g.y);}
  const alpha=(.003+softness*.025)/(H*H),dl=(-(area(nodes)-blob.restArea)-alpha*blob.areaLambda)/(denominator+alpha);
  blob.areaLambda+=dl;
  for(let i=0;i<n;i++){const p=nodes[i],g=blob.gradients[i];p.x+=p.w*g.x*dl;p.y+=p.w*g.y*dl;}
 }
 wallContacts(blob,contacts){
  for(const p of blob.nodes){const dx=p.x-240,dy=p.y-240,d=Math.hypot(dx,dy);if(d<=WALL)continue;
   const nx=dx/d,ny=dy/d;p.x=240+nx*WALL;p.y=240+ny*WALL;
   const incoming=p.preVX*nx+p.preVY*ny;
   if(incoming>1&&!contacts.has(p)){contacts.set(p,{p,nx,ny,incoming});this.stats.wallCollisions++;}
  }
 }
 pointContact(p,polygon,contacts){
  const n=polygon.nodes.length;let inside=false,best=Infinity,edgeA,edgeB,tBest=0,qx=0,qy=0;
  for(let i=0,j=n-1;i<n;j=i++){
   const a=polygon.nodes[j],b=polygon.nodes[i];
   if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
   const dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy;
   const t=l2>1e-9?clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/l2,0,1):0;
   const x=a.x+t*dx,y=a.y+t*dy,d2=(p.x-x)**2+(p.y-y)**2;
   if(d2<best){best=d2;edgeA=a;edgeB=b;tBest=t;qx=x;qy=y;}
  }
  if(!inside&&best>=GAP*GAP)return;
  const distance=Math.sqrt(best),sign=inside?-1:1;
  let nx,ny;
  if(distance>1e-7){nx=(p.x-qx)/distance*sign;ny=(p.y-qy)/distance*sign;}
  else{const dx=edgeB.x-edgeA.x,dy=edgeB.y-edgeA.y,len=Math.hypot(dx,dy)||1;nx=dy/len;ny=-dx/len;}
  const wa=1-tBest,wb=tBest,denom=p.w+edgeA.w*wa*wa+edgeB.w*wb*wb;
  const depth=inside?distance+GAP:GAP-distance,correction=Math.min(depth,10)/denom;
  p.x+=nx*correction*p.w;p.y+=ny*correction*p.w;
  edgeA.x-=nx*correction*wa*edgeA.w;edgeA.y-=ny*correction*wa*edgeA.w;
  edgeB.x-=nx*correction*wb*edgeB.w;edgeB.y-=ny*correction*wb*edgeB.w;
  const incoming=(p.preVX-edgeA.preVX*wa-edgeB.preVX*wb)*nx+(p.preVY-edgeA.preVY*wa-edgeB.preVY*wb)*ny;
  const key=`${p.id}:${edgeA.id}:${edgeB.id}`;
  if(incoming< -1&&!contacts.has(key)){contacts.set(key,{p,a:edgeA,b:edgeB,wa,wb,nx,ny,incoming,denom});this.stats.blobCollisions++;}
 }
 solveContacts(contacts){
  for(let i=0;i<this.blobs.length;i++)for(let j=i+1;j<this.blobs.length;j++){
   const a=this.blobs[i],b=this.blobs[j],aa=a.bounds,bb=b.bounds;
   if(aa.maxX+GAP<bb.minX||bb.maxX+GAP<aa.minX||aa.maxY+GAP<bb.minY||bb.maxY+GAP<aa.minY)continue;
   for(const p of a.nodes)if(p.x>=bb.minX-GAP&&p.x<=bb.maxX+GAP&&p.y>=bb.minY-GAP&&p.y<=bb.maxY+GAP)this.pointContact(p,b,contacts);
   for(const p of b.nodes)if(p.x>=aa.minX-GAP&&p.x<=aa.maxX+GAP&&p.y>=aa.minY-GAP&&p.y<=aa.maxY+GAP)this.pointContact(p,a,contacts);
  }
 }
 step(motion){
  this.time+=H;
  const read=(v,max)=>Number.isFinite(v)?clamp(v,-max,max):0;
  const ax=read(motion.x,35),ay=read(motion.y,35),omega=read(motion.omega,4);
  const angularChange=clamp((omega-this.previousOmega)/H,-8,8);this.previousOmega=omega;
  let particleId=0;
  for(const blob of this.blobs){
   blob.areaLambda=0;
   // Remember only strain that actually happened during input. There is no generated morph.
   for(const link of blob.links){
    link.lambda=0;link.memory*=Math.exp(-H/3.5);
    if(this.controls.held&&link.kind!=='edge'){
     const strain=clamp(Math.hypot(link.b.x-link.a.x,link.b.y-link.a.y)-link.rest,-link.rest*.35,link.rest*.35);
     link.memory+=(strain-link.memory)*(1-Math.exp(-this.controls.deformation*1.8*H));
    }
   }
   let driftVX=0,driftVY=0,mass=0;
   for(const p of blob.particles){const m=1/p.w;driftVX+=p.vx*m;driftVY+=p.vy*m;mass+=m;}
   driftVX/=mass;driftVY/=mass;const driftSpeed=Math.hypot(driftVX,driftVY);
   if(driftSpeed>1)blob.driftHeading=Math.atan2(driftVY,driftVX);
   const thrust=clamp((blob.driftSpeed-driftSpeed)*.5,0,6);
   const driftAX=Math.cos(blob.driftHeading)*thrust,driftAY=Math.sin(blob.driftHeading)*thrust;
   for(const p of blob.particles){
    p.id=particleId++;p.oldX=p.x;p.oldY=p.y;
    // Gentle translation is shared by the whole mesh; local deformation velocities stay intact.
    p.vx+=(driftAX-ax*40+angularChange*(p.y-240)*.25)*H;
    p.vy+=(driftAY-ay*40-angularChange*(p.x-240)*.25)*H;
    const speed=Math.hypot(p.vx,p.vy);if(speed>340){p.vx*=340/speed;p.vy*=340/speed;}
    p.vx*=Math.exp(-.08*H);p.vy*=Math.exp(-.08*H);p.preVX=p.vx;p.preVY=p.vy;
    p.x+=p.vx*H;p.y+=p.vy*H;
   }
  }
  const walls=new Map(),contacts=new Map(),softness=this.controls.deformation;
  for(let pass=0;pass<ITERATIONS;pass++){
   for(const blob of this.blobs){
    for(const link of blob.links)this.solveDistance(link,softness);
    this.solveArea(blob,softness);
    if(this.grab&&blob.particles.includes(this.grab.particle)){
     const p=this.grab.particle,dx=this.grab.x-p.x,dy=this.grab.y-p.y,d=Math.hypot(dx,dy),limit=Math.min(d,3);
     if(d>1e-8){p.x+=dx/d*limit*.55;p.y+=dy/d*limit*.55;}
    }
    this.wallContacts(blob,walls);describe(blob);
   }
   this.solveContacts(contacts);
  }
  // The final wall projection includes locally stretched lobes, not a proxy circle.
  for(const blob of this.blobs){this.wallContacts(blob,walls);for(const p of blob.particles){p.vx=(p.x-p.oldX)/H;p.vy=(p.y-p.oldY)/H;}}
  const restitution=BASE_RESTITUTION+(0.88-BASE_RESTITUTION)*this.controls.repulsion;
  for(const {p,nx,ny,incoming} of walls.values()){
   const normal=p.vx*nx+p.vy*ny,desired=-incoming*restitution;
   if(normal>desired){p.vx+=(desired-normal)*nx;p.vy+=(desired-normal)*ny;}
  }
  for(const {p,a,b,wa,wb,nx,ny,incoming,denom} of contacts.values()){
   const relative=(p.vx-a.vx*wa-b.vx*wb)*nx+(p.vy-a.vy*wa-b.vy*wb)*ny;
   const impulse=Math.max(0,(-incoming*restitution-relative)/denom);
   p.vx+=nx*impulse*p.w;p.vy+=ny*impulse*p.w;
   a.vx-=nx*impulse*wa*a.w;a.vy-=ny*impulse*wa*a.w;b.vx-=nx*impulse*wb*b.w;b.vy-=ny*impulse*wb*b.w;
  }
  for(const blob of this.blobs){
   let vx=0,vy=0,mass=0;
   for(const p of blob.particles){const m=1/p.w;vx+=p.vx*m;vy+=p.vy*m;mass+=m;}
   vx/=mass;vy/=mass;const damping=Math.exp(-(2.2+3*(1-softness))*H);
   for(const p of blob.particles){p.vx=vx+(p.vx-vx)*damping;p.vy=vy+(p.vy-vy)*damping;const speed=Math.hypot(p.vx,p.vy);if(speed>340){p.vx*=340/speed;p.vy*=340/speed;}}
   describe(blob);const ratio=area(blob.nodes)/blob.restArea;this.stats.minAreaRatio=Math.min(this.stats.minAreaRatio,ratio);this.stats.maxAreaRatio=Math.max(this.stats.maxAreaRatio,ratio);
   for(const link of blob.links)if(link.kind==='edge')this.stats.maxEdgeStretch=Math.max(this.stats.maxEdgeStretch,Math.hypot(link.a.x-link.b.x,link.a.y-link.b.y)/link.rest);
  }
 }
}
export const meshArea=blob=>area(blob.nodes);
