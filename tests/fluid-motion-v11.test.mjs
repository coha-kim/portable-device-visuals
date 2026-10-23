import test from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';
import { PalmPhysics, BASE_RESTITUTION } from '../physics-v11.mjs';
import { PalmInteraction, VectorMotionReader } from '../interaction-v11.mjs';
import { createHarveyServer } from '../connection-v1/server-v1.mjs';
import { once } from 'node:events';
function single(x=240,y=240,vx=0,vy=0){const p=new PalmPhysics({Matter,count:1,random:()=>.5});Matter.Body.setPosition(p.blobs[0].body,{x,y});Matter.Body.setVelocity(p.blobs[0].body,{x:vx,y:vy});return p;}
const idle={repulsion:0,deformation:0};
test('free motion retains momentum and idle wall contacts gently rebound without deformation',()=>{
 const p=single(240,240,1.2,0);for(let i=0;i<30;i++)p.advance(1/60,idle);
 assert.ok(p.blobs[0].body.velocity.x>1);assert.ok(p.blobs[0].body.position.x>270);
 const wall=single(425,240,4,0);for(let i=0;i<10;i++)wall.advance(1/60,idle);
 assert.equal(wall.blobs[0].body.restitution,BASE_RESTITUTION);assert.ok(wall.blobs[0].body.velocity.x<-.5);
 assert.equal(wall.stats.maxSquash,0);
});
test('projected tilt gravity pushes particles in the chosen screen direction',()=>{
 for(const [key,sign] of [['tiltX',1],['tiltX',-1],['tiltY',1],['tiltY',-1]]){
  const p=single();for(let i=0;i<30;i++)p.advance(1/60,idle,{[key]:sign*8});
  const position=p.blobs[0].body.position;assert.ok((position[key==='tiltX'?'x':'y']-240)*sign>20);
 }
});
test('gyroscope angular speed changes trajectories even without linear shaking or tilt',()=>{
 const cw=single(330,240),ccw=single(330,240);
 for(let f=0;f<12;f++){cw.advance(1/60,idle,{omega:2});ccw.advance(1/60,idle,{omega:-2});}
 assert.ok(cw.blobs[0].body.position.y<235);assert.ok(ccw.blobs[0].body.position.y>245);
});
test('gyro and tilt are held-gated and expire rather than reusing old input',()=>{
 const m=new PalmInteraction();m.sampleTilt(5,6,0);assert.equal(m.sampleRotation(2,0),false);
 assert.deepEqual(m.motion(0),{x:0,y:0,tiltX:0,tiltY:0,omega:0});
 m.hold(true,0);m.sampleRotation(2,0);assert.equal(m.motion(0).tiltX,5);assert.equal(m.motion(0).omega,2);
 assert.equal(m.motion(300).omega,0);assert.equal(m.motion(900).tiltX,0);
 m.sampleRotation(2,1000);m.sampleVector(16,0,0,1000);m.hold(false,1100);
 assert.deepEqual(m.motion(1100),{x:0,y:0,tiltX:0,tiltY:0,omega:0});
});
test('orientation uses screen axes and gyro alpha uses screen-normal degrees-to-radians conversion',()=>{
 const r=new VectorMotionReader();assert.deepEqual(r.orientation({beta:0,gamma:0}),{x:0,y:0});
 assert.ok(Math.abs(r.orientation({beta:90,gamma:0}).y-9.81)<1e-9);
 assert.ok(Math.abs(r.orientation({beta:0,gamma:90}).x-9.81)<1e-9);
 assert.ok(r.orientation({beta:0,gamma:90},180).x< -9.8);
 assert.equal(r.orientation({beta:null,gamma:0}),null);
 assert.equal(r.rotation({rotationRate:{alpha:180,beta:0,gamma:0}}),-Math.PI);
 assert.equal(r.rotation({rotationRate:{alpha:null}}),null);
});
test('gyro strength changes impact control independently of duration fade/rebound and full recovery still completes',()=>{
 const models=[new PalmInteraction(),new PalmInteraction()];
 models.forEach((m,i)=>{m.hold(true,0);for(let f=1;f<=300;f++){let now=f*1000/60;m.sampleRotation(i?3:.5,now);m.step(1/60,now);}m.hold(false,5000);});
 assert.ok(models[1].deformation>models[0].deformation*4);assert.equal(models[0].opacity,models[1].opacity);assert.equal(models[0].repulsion,models[1].repulsion);
 models.forEach(m=>{assert.equal(m.state.recoverySeconds,30);m.step(.05,35000);assert.equal(m.opacity,1);assert.equal(m.repulsion,0);});
});
test('six-minute free, tilt and mixed gyro/shake simulations keep all bodies finite and inside the 480px round screen',()=>{
 for(const mode of ['free','tilt','mixed']){
  const p=new PalmPhysics({Matter,random:(()=>{let s=41;return()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);})()});
  const visited=p.blobs.map(()=>new Set());let maxSpeed=0;
  for(let f=0;f<360*60;f++){
   const t=f/60,input=mode==='free'?{}:mode==='tilt'?{tiltX:Math.sin(t*.7)*8,tiltY:Math.cos(t*.7)*8}:{x:Math.sin(t*19)*22,y:Math.cos(t*14)*18,omega:Math.sin(t*.7)*3,tiltX:Math.sin(t*.3)*7,tiltY:Math.cos(t*.3)*7};
   p.advance(1/60,{repulsion:mode==='free'?0:.7,deformation:mode==='free'?0:.8},input);
   if(f%30)continue;
   p.blobs.forEach((b,i)=>{const {x,y}=b.body.position;assert.ok([x,y,b.squash].every(Number.isFinite));assert.ok(Math.hypot(x-240,y-240)+b.radius<=240.001);
    visited[i].add((y>=240?2:0)+(x>=240?1:0));maxSpeed=Math.max(maxSpeed,Math.hypot(b.body.velocity.x,b.body.velocity.y));});
  }
  assert.ok(maxSpeed<=8.001);assert.equal(p.blobs.length,8);assert.ok(p.stats.wallCollisions>0&&p.stats.blobCollisions>0);
  if(mode==='free'){assert.equal(p.stats.maxSquash,0);assert.ok(visited.every(s=>s.size>=3),'Free particles explore most quadrants');}
 }
});
test('fixed input gives the same trajectory at 30/60/120 rendering fps',()=>{
 let reference;
 for(const fps of [30,60,120]){
  const p=new PalmPhysics({Matter,random:()=>.5});for(let f=0;f<fps*5;f++)p.advance(1/fps,{repulsion:.4,deformation:.7},{tiltX:3,tiltY:2,omega:1});
  const positions=p.blobs.map(b=>({...b.body.position}));
  if(!reference)reference=positions;else positions.forEach((b,i)=>assert.ok(Math.hypot(b.x-reference[i].x,b.y-reference[i].y)<1e-6));
 }
});
test('paired preview serves v11 modules',async t=>{
 const {server}=createHarveyServer();server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
 for(const path of ['physics-v11.mjs','interaction-v11.mjs'])assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/portable/${path}`)).status,200);
});
