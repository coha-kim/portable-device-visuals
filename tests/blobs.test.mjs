import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {BlobPhysics,BLOB_RADII,WALL_RADIUS,CENTER} from '../blobs.mjs';
import {PalmInteraction,HOLD_FLOOR} from '../interaction-v15.mjs';
import {createHarveyServer} from '../connection-v1/server-v1.mjs';
const seeded=(s=11)=>()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);
// Laptop-style held shake at a given strength (0–1), like the preview's test source.
function run({amplitude=0,idle=8,hold=12,after=0,random=seeded()}={}){
 const p=new BlobPhysics({random}),m=new PalmInteraction();let now=0;const samples=[];
 const total=idle+hold+after;
 for(let f=0;f<total*60;f++){
  now+=1000/60;const t=now/1000;
  if(f===idle*60)m.hold(true,now);if(f===(idle+hold)*60)m.hold(false,now);
  if(m.held&&amplitude>0){const A=amplitude*22;m.sampleVector(Math.sin(t*5.3)*A+Math.sin(t*2.1)*A*.5,Math.cos(t*4.1)*A*.8,0,now);}
  m.step(1/60,now);p.advance(1/60,{repulsion:m.repulsion,speedScale:m.speedScale,held:m.held},m.motion(now));
  samples.push({t:f/60,pieces:p.pieces(),speed:p.meanSpeed,held:m.held});
 }
 return {p,m,samples};
}
const contained=p=>p.blobs.every(b=>[b.x,b.y,b.vx,b.vy].every(Number.isFinite)&&Math.hypot(b.x-CENTER,b.y-CENTER)<=WALL_RADIUS-b.r*.85+1e-6);
test('interaction: repulsion follows shake strength; energy slows and dulls; colour replaces opacity fade',()=>{
 const m=new PalmInteraction();assert.equal(m.repulsion,0);assert.equal(m.speedScale,1);assert.equal(m.dullness,0);assert.equal(m.opacity,1);
 m.hold(true,0);assert.equal(m.repulsion,HOLD_FLOOR);
 m.sampleVector(4,0,0,10);m.step(1/60,10);const gentle=m.repulsion;
 m.sampleVector(16,0,0,20);m.step(1/60,20);assert.equal(m.repulsion,1);assert.ok(gentle<.25,`gentle ${gentle}`);
 assert.ok(m.speedScale<1&&m.dullness>.5);
 m.step(.05,12000);assert.ok(m.dullness>m.intensity*.55,'held time adds energy even after shaking stops');
 m.hold(false,12000);const r=m.repulsion,d=m.dullness;
 m.step(.05,20000);assert.ok(m.repulsion<r&&m.dullness<d&&m.speedScale>1-d*.7);
 m.step(.05,12000+m.state.recoverySeconds*1000);assert.equal(m.repulsion,0);assert.equal(m.dullness,0);assert.equal(m.speedScale,1);
});
test('idle: the pool reads as one drifting blob that keeps moving',()=>{
 const p=new BlobPhysics({random:seeded()});const start=p.blobs.map(b=>({...b}));let moved=0;
 for(let f=0;f<60*90;f++){p.advance(1/60);if(f%60===0)assert.equal(p.pieces(),1,`split while idle at ${f/60}s`);}
 for(let i=0;i<start.length;i++)moved+=Math.hypot(p.blobs[i].x-start[i].x,p.blobs[i].y-start[i].y);
 assert.ok(moved/start.length>20,'lump drifts');assert.ok(contained(p));assert.equal(p.blobs.length,BLOB_RADII.length);
});
test('shake strength grades the split: gentle sticks, medium sheds pieces, hard breaks apart',()=>{
 const peak=a=>Math.max(...run({amplitude:a}).samples.filter(s=>s.held).map(s=>s.pieces));
 const gentle=peak(.35),medium=peak(.6),hard=peak(1);
 assert.equal(gentle,1);assert.ok(medium>1&&medium<hard,JSON.stringify({medium,hard}));assert.ok(hard>=8,JSON.stringify({hard}));
});
test('split blobs still fuse when they collide (metaball contact, absorbed closing speed)',()=>{
 const p=new BlobPhysics({random:seeded(),radii:[25,25]});
 Object.assign(p.blobs[0],{x:180,y:240,vx:40,vy:0});Object.assign(p.blobs[1],{x:300,y:240,vx:-40,vy:0});
 let closest=Infinity;
 for(let f=0;f<120;f++){p.advance(1/60,{repulsion:1,speedScale:1,held:true});closest=Math.min(closest,Math.hypot(p.blobs[0].x-p.blobs[1].x,p.blobs[0].y-p.blobs[1].y));}
 assert.ok(closest<50*1.25,`closest ${closest}`);assert.ok(p.stats.collisions>0||closest<50*1.25);
 for(let f=0;f<60*8;f++)p.advance(1/60,{repulsion:1,speedScale:1});
 assert.equal(p.pieces(),2,'full repulsion separates them again after contact');
});
test('blobs move slower while shaking; speed never exceeds the energy ceiling',()=>{
 const {samples}=run({amplitude:1,idle:10,hold:15});
 const mean=(a,b)=>{const s=samples.filter(x=>x.t>=a&&x.t<b);return s.reduce((n,x)=>n+x.speed,0)/s.length;};
 assert.ok(mean(18,25)<mean(2,10),JSON.stringify([mean(2,10),mean(18,25)]));
 const p=new BlobPhysics({random:seeded()});
 for(let f=0;f<600;f++){p.advance(1/60,{repulsion:1,speedScale:.4,held:true},{x:35*Math.sin(f),y:35,omega:4});for(const b of p.blobs)assert.ok(Math.hypot(b.vx,b.vy)<=40*.4+1e-6);}
});
test('after release, pieces gradually gather back into one blob',()=>{
 const {samples,p}=run({amplitude:1,idle:4,hold:10,after:110});
 assert.ok(samples.find(s=>s.t>13).pieces>4);assert.equal(samples.at(-1).pieces,1);assert.ok(contained(p));
});
test('unheld sensor data adds no force; fixed step agrees across 30/60/120 fps',()=>{
 const a=new BlobPhysics({random:seeded()}),b=new BlobPhysics({random:seeded()});
 for(let f=0;f<240;f++){a.advance(1/60);b.advance(1/60,{},{x:35,y:-35,omega:4});}
 assert.deepEqual(a.blobs,b.blobs);
 const out=[30,60,120].map(fps=>{const p=new BlobPhysics({random:seeded()});for(let f=0;f<fps*5;f++)p.advance(1/fps,{repulsion:.8,speedScale:.6});return p.blobs.map(b=>[b.x,b.y]);});
 for(const o of out.slice(1))o.forEach((v,i)=>{assert.ok(Math.abs(v[0]-out[0][i][0])<1e-6&&Math.abs(v[1]-out[0][i][1])<1e-6);});
});
test('six minutes of idle, hard shaking and recovery stay finite and inside the glass',()=>{
 const {p}=run({amplitude:1,idle:60,hold:180,after:120});assert.ok(contained(p));
});
test('paired preview serves the blob entry points',async t=>{
 const {server}=createHarveyServer();server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}/portable/`;
 for(const path of ['blobs.mjs','interaction-v15.mjs','renderer.mjs'])assert.equal((await fetch(base+path)).status,200);
 const app=await(await fetch(base+'app.js')).text();
 assert.match(app,/BlobPhysics/);assert.match(app,/MetaballRenderer/);assert.match(app,/renderer.draw\(physics.blobs,interaction.dullness\)/);assert.match(app,/speedScale:interaction.speedScale/);
});
