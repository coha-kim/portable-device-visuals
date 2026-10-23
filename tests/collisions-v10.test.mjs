import test from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';
import { PalmInteraction,VectorMotionReader } from '../interaction-v10.mjs';
import { PalmPhysics } from '../physics-v10.mjs';
import { createHarveyServer } from '../connection-v1/server-v1.mjs';
import { once } from 'node:events';

test('duration independently controls fade/rebound; strength controls deformation',()=>{
 const models=[new PalmInteraction(),new PalmInteraction()];
 models.forEach((m,i)=>{m.hold(true,0);for(let f=1;f<=300;f++){const now=f*1000/60;m.sampleVector(i?16:3,0,0,now);m.step(1/60,now);}});
 assert.equal(models[0].opacity,models[1].opacity);assert.equal(models[0].repulsion,models[1].repulsion);
 assert.ok(models[1].deformation>models[0].deformation*3);
 assert.ok(Math.abs(models[0].opacity-.78)<1e-10);assert.ok(Math.abs(models[0].repulsion-5/12)<1e-10);
});
test('stationary holds change duration without inventing shake; stale/released input adds no force',()=>{
 const m=new PalmInteraction();assert.equal(m.sampleVector(16,0,0,0),false);assert.deepEqual(m.acceleration(0),{x:0,y:0});
 m.hold(true,0);m.step(.05,4000);assert.equal(m.intensity,0);assert.equal(m.deformation,0);assert.ok(m.repulsion>0);
 m.sampleVector(16,0,0,4000);assert.equal(m.acceleration(4000).x,16);assert.deepEqual(m.acceleration(4200),{x:0,y:0});
 m.hold(false,4500);assert.equal(m.state.holdDurationSeconds,4.5);assert.equal(m.state.recoverySeconds,30);
 assert.deepEqual(m.acceleration(4500),{x:0,y:0});assert.equal(m.sampleVector(16,0,0,4510),false);
 m.step(.05,34500);assert.equal(m.opacity,1);assert.equal(m.repulsion,0);assert.equal(m.deformation,0);
});
test('re-holding preserves remaining duration and long holds keep the 120-second recovery cap',()=>{
 const m=new PalmInteraction();m.hold(true,0);m.step(.05,25000);m.hold(false,25000);
 assert.equal(m.state.recoverySeconds,120);assert.equal(m.opacity,.12);assert.equal(m.repulsion,1);
 m.step(.05,55000);const opacity=m.opacity;m.hold(true,55000);assert.equal(m.opacity,opacity);
});
test('motion reader excludes static gravity and rotates acceleration into screen coordinates',()=>{
 const r=new VectorMotionReader();assert.deepEqual(r.read({accelerationIncludingGravity:{x:0,y:0,z:9.81}},0),{x:0,y:0,z:0});
 assert.deepEqual(r.read({accelerationIncludingGravity:{x:0,y:0,z:9.81}},20),{x:0,y:0,z:0});
 const a=r.read({acceleration:{x:10,y:0,z:0}},40,90);assert.ok(Math.abs(a.x)<1e-10);assert.equal(a.y,-10);
 assert.equal(r.read({acceleration:{x:null,y:0,z:0}},50),null);
});
function collision(repulsion,deformation,wall=false){
 const p=new PalmPhysics({Matter,count:wall?1:2,random:()=>.5});
 if(wall){Matter.Body.setPosition(p.blobs[0].body,{x:425,y:240});Matter.Body.setVelocity(p.blobs[0].body,{x:4,y:0});}
 else p.blobs.forEach((b,i)=>{Matter.Body.setPosition(b.body,{x:i?295:185,y:240});Matter.Body.setVelocity(b.body,{x:i?-2:2,y:0});});
 for(let n=0;n<30;n++)p.advance(1/60,{repulsion,deformation});return p;
}
test('baseline contact resolves without rebound or deformation; duration adds elastic rebound',()=>{
 const base=collision(0,0),bounce=collision(1,0),soft=collision(1,1);
 assert.ok(base.stats.blobCollisions>0&&bounce.stats.blobCollisions>0);assert.equal(base.stats.maxSquash,0);assert.equal(bounce.stats.maxSquash,0);
 assert.ok(soft.stats.maxSquash>.08);assert.ok(bounce.blobs[1].body.position.x-base.blobs[1].body.position.x>15);
});
test('round wall contains bodies and only stronger input produces squash/rebound',()=>{
 const base=collision(0,0,true),active=collision(1,1,true);
 assert.equal(base.stats.maxSquash,0);assert.ok(active.stats.maxSquash>.08);
 assert.ok(active.blobs[0].body.position.x<base.blobs[0].body.position.x-20);
 for(const p of [base,active])for(const b of p.blobs)assert.ok(Math.hypot(b.body.position.x-240,b.body.position.y-240)+b.radius<=240.001);
});
test('six-minute idle and vigorous-shake simulations stay finite, bounded, and keep eight separate collision bodies',()=>{
 for(const active of [false,true]){
  const p=new PalmPhysics({Matter,random:(()=>{let s=23;return()=>((s=(s*1664525+1013904223)>>>0)/4294967296);})()});
  for(let f=0;f<360*60;f++){
   const t=f/60;p.advance(1/60,{repulsion:active?1:0,deformation:active?1:0},active?{x:22*Math.sin(t*19),y:18*Math.cos(t*14)}:{x:0,y:0});
   if(f%60)continue;
   for(const b of p.blobs){assert.ok([b.body.position.x,b.body.position.y,b.squash].every(Number.isFinite));assert.ok(Math.hypot(b.body.position.x-240,b.body.position.y-240)+b.radius<=240.001);}
  }
  assert.equal(p.blobs.length,8);if(!active)assert.equal(p.stats.maxSquash,0);
  assert.ok(p.stats.blobCollisions>0);assert.ok(p.stats.wallCollisions>0);
 }
});
test('motion is invariant across 30/60/120 drawing rates',()=>{
 const result=[];
 for(const fps of [30,60,120]){const p=new PalmPhysics({Matter,random:()=>.5});for(let f=0;f<fps*5;f++)p.advance(1/fps,{repulsion:.5,deformation:0},{x:2,y:-1});result.push(p.blobs.map(b=>({...b.body.position})));}
 result.slice(1).forEach(orbs=>orbs.forEach((b,i)=>assert.ok(Math.hypot(b.x-result[0][i].x,b.y-result[0][i].y)<1e-6)));
});
test('paired preview serves all new scripts and vendor, while denying arbitrary nested files',async t=>{
 const {server}=createHarveyServer();server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}/portable/`;
 for(const path of ['interaction-v10.mjs','physics-v10.mjs','renderer-v10.mjs','vendor/matter-0.20.0.min.js'])assert.equal((await fetch(base+path)).status,200);
 for(const path of ['vendor/matter-LICENSE.txt','versions/pre-collisions-v10/app.js','connection-v1/server-v1.mjs'])assert.equal((await fetch(base+path)).status,404);
});
