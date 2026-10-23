import test from 'node:test';
import assert from 'node:assert/strict';
import {PalmPhysics,NODE_COUNT,meshArea} from '../physics-v13.mjs';
import {PalmInteraction} from '../interaction-v13.mjs';
import {BlobRenderer} from '../renderer-v13.mjs';
import {createHarveyServer} from '../connection-v1/server-v1.mjs';
import {once} from 'node:events';
function translate(blob,x,y,vx=0,vy=0){const dx=x-blob.x,dy=y-blob.y;for(const p of blob.particles){p.x+=dx;p.y+=dy;p.vx=vx;p.vy=vy;}}
function radii(blob){return blob.nodes.map(p=>Math.hypot(p.x-blob.x,p.y-blob.y));}
function ellipseResidual(blob){
 const n=blob.nodes.length;let xx=0,xy=0,yy=0;
 for(const p of blob.nodes){const x=p.x-blob.x,y=p.y-blob.y;xx+=x*x/n;xy+=x*y/n;yy+=y*y/n;}
 const det=xx*yy-xy*xy;
 return Math.sqrt(blob.nodes.reduce((sum,p)=>{const x=p.x-blob.x,y=p.y-blob.y,q=(x*x*yy-2*x*y*xy+y*y*xx)/(2*det);return sum+(q-1)**2;},0)/n);
}
function impact(softness){const p=new PalmPhysics({count:1,random:()=>.5});translate(p.blobs[0],412,240,180,0);let largest=0,residual=0,atHalf=0;
 for(let f=0;f<360;f++){p.advance(1/120,{repulsion:.4,deformation:softness});const r=radii(p.blobs[0]);largest=Math.max(largest,Math.max(...r)-Math.min(...r));residual=Math.max(residual,ellipseResidual(p.blobs[0]));if(f===60)atHalf=Math.max(...r)-Math.min(...r);}
 return {p,largest,residual,atHalf};}
test('zero gravity and no idle propulsion: a motionless membrane stays in place even with tilt data',()=>{
 const p=new PalmPhysics({count:1,random:()=>.5});translate(p.blobs[0],240,240);const start={x:p.blobs[0].x,y:p.blobs[0].y};
 // Describe is updated on the first step after the fixture is translated.
 p.advance(1/120);const x=p.blobs[0].x,y=p.blobs[0].y;
 for(let i=0;i<1200;i++)p.advance(1/120,{repulsion:0,deformation:0},{hasTilt:true,tiltY:9.81});
 assert.ok(Math.hypot(p.blobs[0].x-x,p.blobs[0].y-y)<1e-6);assert.equal(p.blobs[0].nodes.length,NODE_COUNT);
});
test('wall contact deforms independent local vertices rather than scaling the whole body into an ellipse',()=>{
 const stiff=impact(0),soft=impact(1);console.log('mesh impact',JSON.stringify({stiff:stiff.largest,soft:soft.largest,residual:soft.residual,atHalf:soft.atHalf}));
 assert.ok(soft.largest>stiff.largest*2);assert.ok(soft.largest>10);assert.ok(soft.residual>.015);
 assert.ok(soft.atHalf>1,'Deformation remains visible after impact instead of snapping immediately');
 const r=radii(soft.p.blobs[0]);assert.ok(Math.max(...r)-Math.min(...r)<2,'Damped constraints gradually restore the shape');
 assert.ok(soft.p.stats.minAreaRatio>.8);
});
test('blob-to-blob impacts deform the contacting membranes and keep separate boundaries',()=>{
 const p=new PalmPhysics({count:2,random:()=>.5});translate(p.blobs[0],170,240,100,0);translate(p.blobs[1],310,240,-100,0);let distortion=0;
 for(let f=0;f<150;f++){p.advance(1/120,{repulsion:.7,deformation:1});distortion=Math.max(distortion,...p.blobs.map(b=>Math.max(...radii(b))-Math.min(...radii(b))));}
 assert.ok(p.stats.blobCollisions>0);assert.ok(distortion>8);assert.equal(p.blobs.length,2);assert.notEqual(p.blobs[0].nodes,p.blobs[1].nodes);
});
test('a grabbed material point stretches locally and releases without a global shape tween',()=>{
 const p=new PalmPhysics({count:1,random:()=>.5});translate(p.blobs[0],240,240);p.advance(1/120);const b=p.blobs[0],node=b.nodes[0];
 assert.equal(p.setGrab(node.x,node.y),true);p.setGrab(335,210);
 for(let f=0;f<60;f++)p.advance(1/120,{repulsion:0,deformation:1});
 assert.ok(ellipseResidual(b)>.015);assert.ok(meshArea(b)/b.restArea>.8);p.releaseGrab();assert.equal(p.grab,null);
});
test('material flexibility depends on strength, independent of duration fading and rebound',()=>{
 const m=new PalmInteraction();m.hold(true,0);m.sampleVector(16,0,0,100);m.step(.1,100);
 assert.ok(m.deformation>.5);assert.ok(m.repulsion<.01);assert.ok(m.opacity>.99);
 m.hold(false,200);assert.equal(m.state.recoverySeconds,30);m.step(.05,30200);assert.equal(m.opacity,1);assert.equal(m.deformation,0);
});
test('six-minute mesh collision/drag stress stays finite, area-supported and inside the circular boundary',()=>{
 const p=new PalmPhysics({random:(()=>{let seed=123;return()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);})()});
 for(let f=0;f<360*120;f++){
  const t=f/120,phase=Math.floor(t/8)%3;
  if(phase===1){if(!p.grab){const n=p.blobs[0].nodes[0];p.setGrab(n.x,n.y);}p.setGrab(240+Math.cos(t)*175,240+Math.sin(t)*175);}else p.releaseGrab();
  p.advance(1/120,{repulsion:phase===0?0:.8,deformation:phase===0?0:.9},phase===2?{x:Math.sin(t*12)*22,y:Math.cos(t*9)*18,omega:Math.sin(t)*2}:{});
  if(f%120)continue;
  for(const b of p.blobs){const ratio=meshArea(b)/b.restArea;assert.ok(ratio>.6&&ratio<1.4,`area ratio ${ratio}`);
   for(const n of b.nodes){assert.ok([n.x,n.y,n.vx,n.vy].every(Number.isFinite));assert.ok(Math.hypot(n.x-240,n.y-240)<=238.00001);}
  }
 }
 assert.equal(p.blobs.length,8);assert.ok(p.stats.wallCollisions>0&&p.stats.blobCollisions>0);console.log('mesh stress',JSON.stringify(p.stats));
});
test('renderer follows actual mesh vertices at native resolution and never invokes ellipse scaling',()=>{
 let curves=0,arcs=0;const ctx={save(){},restore(){},beginPath(){},closePath(){},fillRect(){},moveTo(){},fill(){},stroke(){},clip(){},arc(){arcs++;},quadraticCurveTo(){curves++;},createRadialGradient(){return {addColorStop(){}};}};
 const canvas={getContext(){return ctx;}},p=new PalmPhysics({count:1,random:()=>.5});new BlobRenderer(canvas).draw(p.blobs,1);
 assert.equal(canvas.width,480);assert.equal(canvas.height,480);assert.equal(curves,NODE_COUNT);assert.equal(arcs,1);
});
test('fixed inputs produce the same mesh at 30/60/120 drawing fps',()=>{
 let reference;
 for(const fps of [30,60,120]){const p=new PalmPhysics({random:()=>.5});for(let i=0;i<fps*3;i++)p.advance(1/fps,{repulsion:.5,deformation:.8},{x:2,y:-1});
  const points=p.blobs.flatMap(b=>b.nodes.map(n=>({x:n.x,y:n.y})));if(!reference)reference=points;else points.forEach((n,i)=>assert.ok(Math.hypot(n.x-reference[i].x,n.y-reference[i].y)<1e-7));}
});
test('paired preview serves the mesh modules',async t=>{
 const {server}=createHarveyServer();server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
 for(const path of ['physics-v13.mjs','renderer-v13.mjs','interaction-v13.mjs'])assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/portable/${path}`)).status,200);
});
