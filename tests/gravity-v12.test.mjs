import test from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';
import {PalmPhysics,GRAVITY} from '../physics-v12.mjs';
import {PalmInteraction} from '../interaction-v12.mjs';
import {createHarveyServer} from '../connection-v1/server-v1.mjs';
import {once} from 'node:events';
const baseline={repulsion:0,deformation:0};
function single(){const p=new PalmPhysics({Matter,count:1,random:()=>.5});Matter.Body.setPosition(p.blobs[0].body,{x:240,y:160});return p;}
test('starts from rest and accelerates downward without invented drift',()=>{
 const p=single();assert.equal(p.blobs[0].body.velocity.x,0);assert.equal(p.blobs[0].body.velocity.y,0);
 for(let i=0;i<60;i++)p.advance(1/60,baseline);
 assert.ok(p.blobs[0].body.position.y>200);assert.ok(Math.abs(p.blobs[0].body.position.x-240)<1e-6);assert.equal(p.gravity.y,GRAVITY);
});
test('gravity settles a resting scene instead of perpetually propelling it',()=>{
 const p=new PalmPhysics({Matter,random:()=>.5});
 for(let i=0;i<60*90;i++)p.advance(1/60,baseline);
 const meanY=p.blobs.reduce((s,b)=>s+b.body.position.y,0)/8;
 const maxSpeed=Math.max(...p.blobs.map(b=>Math.hypot(b.body.velocity.x,b.body.velocity.y)));
 assert.ok(meanY>290);assert.ok(maxSpeed<.12,`Remaining speed ${maxSpeed}`);assert.equal(p.stats.maxSquash,0);
});
test('pointer attraction pulls toward a chosen point and release restores falling',()=>{
 const p=single();p.setAttractor(240,80);
 for(let i=0;i<120;i++)p.advance(1/60,baseline);
 const raised=p.blobs[0].body.position.y;assert.ok(raised<145,`Attracted y ${raised}`);
 p.setAttractor(0,0,false);for(let i=0;i<120;i++)p.advance(1/60,baseline);
 assert.ok(p.blobs[0].body.position.y>raised+80);
});
test('tilt changes directional gravity and gyro turns it without a swirl force',()=>{
 const p=single();for(let i=0;i<45;i++)p.advance(1/60,baseline,{hasTilt:true,tiltX:9.81,tiltY:0});
 assert.ok(p.gravity.x>118&&p.gravity.y<2);assert.ok(p.blobs[0].body.position.x>250);
 const g=single();for(let i=0;i<30;i++)g.advance(1/60,baseline,{omega:2});
 assert.ok(g.gravity.x>90);assert.ok(Math.abs(Math.hypot(g.gravity.x,g.gravity.y)-GRAVITY)<1e-8);
});
test('live orientation affects passive gravity while linear shake still requires activation',()=>{
 const m=new PalmInteraction();m.sampleTilt(5,6,0);assert.equal(m.motion(0).hasTilt,true);assert.equal(m.motion(0).tiltX,5);
 assert.equal(m.sampleVector(16,0,0,0),false);assert.equal(m.motion(0).x,0);assert.equal(m.motion(900).hasTilt,false);
 m.hold(true,1000);m.sampleVector(16,0,0,1000);assert.equal(m.motion(1000).x,16);m.hold(false,1100);assert.equal(m.motion(1100).x,0);
});
test('six-minute gravity, attraction and motion cycles remain finite and contained',()=>{
 const p=new PalmPhysics({Matter,random:()=>.5});
 for(let i=0;i<360*60;i++){
  const t=i/60,phase=Math.floor(t/10)%3;
  if(phase===1)p.setAttractor(240+Math.cos(t)*130,190+Math.sin(t)*80);else p.setAttractor(0,0,false);
  p.advance(1/60,{repulsion:phase===2?.8:0,deformation:phase===2?.8:0},phase===2?{x:16*Math.sin(t*14),y:14*Math.cos(t*11),hasTilt:true,tiltX:7*Math.sin(t),tiltY:7*Math.cos(t),omega:Math.sin(t)*2}:{});
  if(i%60)continue;
  for(const b of p.blobs){assert.ok([b.body.position.x,b.body.position.y,b.squash].every(Number.isFinite));assert.ok(Math.hypot(b.body.position.x-240,b.body.position.y-240)+b.radius<=240.001);}
 }
 assert.equal(p.blobs.length,8);assert.ok(p.stats.wallCollisions>0&&p.stats.blobCollisions>0);
});
test('paired preview serves the gravity version',async t=>{
 const {server}=createHarveyServer();server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
 for(const path of ['physics-v12.mjs','interaction-v12.mjs'])assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/portable/${path}`)).status,200);
});
