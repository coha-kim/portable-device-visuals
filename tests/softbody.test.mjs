import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import { DRAINED,SoftBodyWorld,BODY_COUNT,NODES,CENTER,DISPLAY_RADIUS,STEP,PARAMS,FILL_MAX,GRAVITY_DEAD_ZONE,RESTING_SPEED,valueFor,sliderFor,ShakeDrain,FIRM_SECONDS,RECOVER_SECONDS,findCollision,glassCollision,bodyCollision,resolveCollision} from '../softbody.mjs';
import {createHarveyServer} from '../connection-v1/server-v1.mjs';
const TAU=Math.PI*2;
const seeded=(s=11)=>()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);
const finite=w=>w.bodies.every(b=>b.nodes.every(n=>[n.x,n.y,n.vx,n.vy].every(Number.isFinite)));
const inGlass=w=>w.bodies.every(b=>b.nodes.every(n=>Math.hypot(n.x-CENTER,n.y-CENTER)<=DISPLAY_RADIUS+.5));
const speed=b=>{const v=b.velocity;return Math.hypot(v.x,v.y);};
// How far the outline departs from a circle: spread of node distances from the centroid.
function roughness(b){const c=b.centroid,d=b.nodes.map(n=>Math.hypot(n.x-c.x,n.y-c.y)),m=d.reduce((s,x)=>s+x,0)/d.length;return Math.max(...d)/m-Math.min(...d)/m;}
// A world with no interaction forces or drag (and level: no gravity), for controlled experiments.
function still(options={},extra={}){
 const w=new SoftBodyWorld({random:seeded(),...options});
 for(const [k,v] of Object.entries({drag:0,...extra}))w.set(k,v);
 return w;
}
function place(body,x,y,vx=0,vy=0){const c=body.centroid;for(const n of body.nodes){n.x+=x-c.x;n.y+=y-c.y;n.vx=vx;n.vy=vy;}}

test('fifty small, perfectly round bodies of point masses, scattered apart, level and still',()=>{
 const w=new SoftBodyWorld({random:seeded()});
 assert.equal(w.count,BODY_COUNT);assert.equal(BODY_COUNT,50);assert.deepEqual(w.gravityInput,{x:0,y:0});
 for(const name of ['wander','turning','minSpeed','attraction','repulsion','wobble'])assert.ok(!(name in PARAMS),`no ${name}: nothing drives or reshapes the blobs but the device and the press`);
 for(const b of w.bodies){assert.equal(b.nodes.length,NODES);assert.ok(roughness(b)<.02,'starts round');assert.ok(b.radius<25,'small');}
 assert.ok(inGlass(w));
 const overlaps=v=>{let n=0;for(let i=0;i<v.count;i++)for(let j=i+1;j<v.count;j++){const a=v.bodies[i].centroid,b=v.bodies[j].centroid;if(Math.hypot(a.x-b.x,a.y-b.y)<v.bodies[i].reach+v.bodies[j].reach)n++;}return n;};
 assert.equal(overlaps(new SoftBodyWorld({random:seeded(),count:14})),0,'14: no overlap at start');
 assert.ok(overlaps(w)<=5,`50: spread by best-candidate placement (${overlaps(w)} light overlaps, parted in the first frames)`);
 assert.equal(w.elasticity,.99,'baseline elasticity is 0.99');
 assert.ok(PARAMS.stiffness.max*STEP*STEP<.1,'stiffness·dt² well below 1 (article stability bound)');
});
test('symplectic Euler with nothing acting: a free body glides straight at constant speed',()=>{
 const w=still({count:1}),b=w.bodies[0];place(b,200,240,20,0);
 for(let f=0;f<60;f++)w.advance(1/60);
 const c=b.centroid,v=b.velocity;
 assert.ok(Math.abs(v.x-20)<1e-6&&Math.abs(v.y)<1e-6,`velocity kept (${v.x}, ${v.y})`);
 assert.ok(Math.abs(c.x-220)<.01&&Math.abs(c.y-240)<.01,`moved 20 px in 1 s (${c.x})`);
});
test('shape matching: a rigidly rotated body feels no spring force; a squashed one returns to round',()=>{
 const w=still({count:1},{damping:4}),b=w.bodies[0];place(b,240,240);
 const c=b.centroid,a=.9;for(const n of b.nodes){const x=n.x-c.x,y=n.y-c.y;n.x=c.x+x*Math.cos(a)-y*Math.sin(a);n.y=c.y+x*Math.sin(a)+y*Math.cos(a);}
 b.shapeMatch(STEP,PARAMS.stiffness.max,0);
 assert.ok(b.nodes.every(n=>Math.hypot(n.vx,n.vy)<1e-9),'best-fit rotation found: targets equal current points');
 for(const n of b.nodes)n.x=c.x+(n.x-c.x)*.6;
 assert.ok(roughness(b)>.3);for(let f=0;f<120;f++)w.advance(1/60);
 assert.ok(roughness(b)<.05,`springs back (${roughness(b).toFixed(3)})`);
});
test('damping blends toward the rigid motion: wobble dies, the glide and spin survive',()=>{
 const run=damping=>{const w=still({count:1},{damping}),b=w.bodies[0];place(b,240,240,10,0);
  const c=b.centroid;for(const n of b.nodes){n.x=c.x+(n.x-c.x)*1.3;n.vx+=-(n.y-c.y)*.5;n.vy+=(n.x-c.x)*.5;}
  let late=0;for(let f=0;f<120;f++){w.advance(1/60);if(f>=90)late=Math.max(late,roughness(b));}return {late,v:b.velocity};};
 const damped=run(10),loose=run(0);
 assert.ok(damped.late<loose.late*.5,JSON.stringify({damped:damped.late,loose:loose.late}));
 assert.ok(Math.abs(damped.v.x-10)<.5,'glide kept');
});
test('device gravity is the only driving force: level and still, blobs settle and stay perfect circles',()=>{
 const w=new SoftBodyWorld({random:seeded(10)});
 for(let f=0;f<60*15;f++)w.advance(1/60);
 for(const b of w.bodies){assert.ok(speed(b)<.05,`settled (${speed(b).toFixed(3)} px/s)`);assert.ok(roughness(b)<.005,`perfect circle (${roughness(b).toFixed(4)})`);}
 const before=w.bodies.map(b=>b.centroid);for(let f=0;f<60*10;f++)w.advance(1/60);
 w.bodies.forEach((b,i)=>assert.ok(Math.hypot(b.centroid.x-before[i].x,b.centroid.y-before[i].y)<.5,'stays put'));
 // Within the dead zone (a device lying on a table, a little off level) still nothing moves.
 w.setGravity(GRAVITY_DEAD_ZONE*.9,0);for(let f=0;f<60*5;f++)w.advance(1/60);
 w.bodies.forEach((b,i)=>assert.ok(Math.hypot(b.centroid.x-before[i].x,b.centroid.y-before[i].y)<.5,'dead zone'));
 // Tilt: every blob falls the same way.
 const y0=w.bodies.map(b=>b.centroid.y);w.setGravity(0,.5);for(let f=0;f<30;f++)w.advance(1/60);
 assert.ok(w.bodies.every((b,i)=>b.centroid.y>y0[i]),'tilted down: all move down');
 assert.deepEqual(w.gravityAcceleration,{x:0,y:(.5-GRAVITY_DEAD_ZONE)*PARAMS.gravity.default},'dead zone subtracted, then gravity strength');
});
test('tilting moves the blobs; a steady tilt piles them up and they come to rest; level again, they turn round',()=>{
 const w=new SoftBodyWorld({random:seeded(10),count:14}),B=w.bodies;let travel=0,prev=B.map(b=>b.centroid);
 for(let f=0;f<60*20;f++){const t=f/60;w.setGravity(.6*Math.cos(t*.8),.6*Math.sin(t*.8));w.advance(1/60);const c=B.map(b=>b.centroid);B.forEach((b,i)=>{travel+=Math.hypot(c[i].x-prev[i].x,c[i].y-prev[i].y);});prev=c;}
 assert.ok(travel/B.length/20>60,`rotating tilt keeps them flowing (${(travel/B.length/20).toFixed(0)} px/s)`);
 w.setGravity(0,.5);for(let f=0;f<60*15;f++)w.advance(1/60);
 let jiggle=0;for(let f=0;f<60*5;f++){w.advance(1/60);jiggle=Math.max(jiggle,B.reduce((s,b)=>s+speed(b),0)/B.length);}
 assert.ok(jiggle<5,`pile at rest: at most a slow settling drift (${jiggle.toFixed(2)} px/s, under 0.6 mm/s on the panel)`);
 assert.ok(B.reduce((s,b)=>s+b.centroid.y,0)/B.length>380,'piled at the low side');
 assert.ok(Math.max(...B.map(roughness))>.15,'squashed by their own weight: same soft-body contacts');
 w.setGravity(0,0);for(let f=0;f<60*20;f++)w.advance(1/60);
 for(const b of B){assert.ok(speed(b)<.5);assert.ok(roughness(b)<.01,`round again (${roughness(b).toFixed(3)})`);}
});
test('drag slows a coasting body as exp(−drag·t); speed never passes the max',()=>{
 const w=still({count:1},{drag:.5}),b=w.bodies[0];place(b,240,240,30,0);
 for(let f=0;f<60;f++)w.advance(1/60);
 assert.ok(Math.abs(speed(b)-30*Math.exp(-.5))<.5,`${speed(b).toFixed(2)} ≈ ${(30*Math.exp(-.5)).toFixed(2)}`);
 const v=new SoftBodyWorld({random:seeded()});v.set('maxSpeed',25);v.set('gravity',2000);
 let over=0;for(let f=0;f<60*10;f++){v.setGravity(Math.cos(f/60),Math.sin(f/60));v.advance(1/60);for(const b of v.bodies)over=Math.max(over,speed(b));}
 assert.ok(over<=25+1e-6,`never above max (${over.toFixed(2)})`);
});
test('collision detection keeps the deepest of the glass and every other body',()=>{
 const w=still({count:2}),[A,B]=w.bodies;place(A,200,240);place(B,215,240);
 const p={x:205,y:240,vx:0,vy:0},a=bodyCollision(p,A),b=bodyCollision(p,B);
 assert.ok(a&&b&&a.depth!==b.depth,'inside both');
 const hit=findCollision(p,[A,B]);assert.equal(hit.depth,Math.max(a.depth,b.depth));assert.equal(hit.body,a.depth>b.depth?A:B);
 assert.equal(findCollision({x:240,y:240},[]).depth,glassCollision({x:240,y:240}).depth,'only the glass: negative depth, no collision');
 assert.ok(glassCollision({x:240,y:240}).depth<0);
 const rim={x:CENTER+DISPLAY_RADIUS+3,y:240};assert.ok(findCollision(rim,[A,B]).depth>0&&findCollision(rim,[A,B]).body===null);
});
test('resolution: pushed out along the normal, vn → −elasticity·vn, vt → vt·exp(−friction·dt)',()=>{
 for(const e of [1,.4,0]){
  const p={x:CENTER+DISPLAY_RADIUS+2,y:240,vx:30,vy:-20},c=glassCollision(p);
  resolveCollision(p,c,e,10,STEP);
  assert.ok(glassCollision(p).depth<=1e-9,'out of the glass');
  assert.ok(Math.abs(p.vx-(-30*e))<1e-9,`normal bounce at e=${e}`);
  assert.ok(Math.abs(p.vy-(-20*Math.exp(-10*STEP)))<1e-9,'friction on the tangential part');
 }
 const leaving={x:CENTER+DISPLAY_RADIUS+2,y:240,vx:-5,vy:0};resolveCollision(leaving,glassCollision(leaving),1,10,STEP);
 assert.equal(leaving.vx,-5,'already separating: velocity untouched');
 // Between bodies the impulse is shared with the edge's two points: momentum is kept.
 const w=still({count:2}),[A,B]=w.bodies;place(A,200,240,0,0);place(B,200+(A.radius+B.radius)*.85,240,-40,0);
 const p=B.nodes.find(n=>bodyCollision(n,A));assert.ok(p);
 const before=[...A.nodes,...B.nodes].reduce((s,n)=>s+n.vx,0);
 resolveCollision(p,bodyCollision(p,A),1,4,STEP);
 const after=[...A.nodes,...B.nodes].reduce((s,n)=>s+n.vx,0);
 assert.ok(Math.abs(after-before)<1e-9,'momentum kept');const left=bodyCollision(p,A);assert.ok(!left||left.depth<.05,`pushed out to the outline (${left?.depth})`);
});
test('elasticity sets the rebound: 0 barely parts, 1 bounces, up to 2 bounces back faster than it came',()=>{
 const run=e=>{const w=still({count:2},{elasticity:e,friction:0}),[A,B]=w.bodies;place(A,190,240,40,0);place(B,290,240,-40,0);
  for(let f=0;f<120;f++)w.advance(1/60);return B.velocity.x-A.velocity.x;};
 const bouncy=run(1),half=run(.5),dead=run(0);
 assert.ok(bouncy>50,`separating at ${bouncy.toFixed(1)} px/s of 80 approach`);
 assert.ok(half>bouncy*.4&&half<bouncy*.75,`elasticity 0.5 keeps about half (${half.toFixed(1)})`);
 assert.ok(dead<bouncy*.25,`elasticity 0 barely parts (${dead.toFixed(1)})`);
 // Above 1 the rebound is faster than the impact: elasticity × the approach speed (80 px/s here).
 const super15=run(1.5),super2=run(2);assert.ok(super15>95&&super2>120&&super2>super15,`1.5 → ${super15.toFixed(0)}, 2 → ${super2.toFixed(0)} px/s`);
 const wall=e=>{const w=still({count:1},{elasticity:e,friction:0}),b=w.bodies[0];place(b,400,240,60,0);for(let f=0;f<90;f++)w.advance(1/60);return -b.velocity.x;};
 assert.ok(wall(1)>wall(0)*1.5,`glass bounce ${wall(1).toFixed(1)} vs ${wall(0).toFixed(1)}`);
});
test('no attraction or repulsion: two still blobs near each other stay put',()=>{
 const w=still({count:2}),[A,B]=w.bodies,t=A.radius+B.radius;place(A,240-1.2*t,240);place(B,240+1.2*t,240);
 for(let f=0;f<60;f++)w.advance(1/60);
 assert.ok(Math.abs(Math.hypot(A.centroid.x-B.centroid.x,A.centroid.y-B.centroid.y)/t-2.4)<1e-6);
});
test('shaking lowers elasticity and movement, in proportion to shake time; both recover',()=>{
 const d=new ShakeDrain(),shake={held:true,intensity:.6};
 for(let i=0;i<60*2;i++)d.step(1/60,shake);assert.ok(Math.abs(d.level-2/FIRM_SECONDS)<1e-6,'2 s of shaking = 2/10 drained');
 for(let i=0;i<60*3;i++)d.step(1/60,shake);assert.ok(Math.abs(d.level-5/FIRM_SECONDS)<1e-6,'5 s = half');
 for(let i=0;i<60*3;i++)d.step(1/60,{held:true,intensity:0});assert.ok(Math.abs(d.level-.5)<1e-6,'holding still neither drains nor recovers');
 for(let i=0;i<60*20;i++)d.step(1/60,shake);assert.equal(d.level,1,'fully drained, never past it');
 for(let i=0;i<60*RECOVER_SECONDS/2;i++)d.step(1/60,{held:false});assert.ok(Math.abs(d.level-.5)<1e-6,'half back after half the recovery time');
 const three=new ShakeDrain();for(let i=0;i<60*3;i++)three.step(1/60,shake);
 for(let i=0;i<60*179;i++)three.step(1/60,{held:false});assert.ok(three.seconds>0,'3 s of shaking: not yet recovered after 2 min 59 s');
 for(let i=0;i<60*2;i++)three.step(1/60,{held:false});assert.equal(three.seconds,0,'3 s of shaking = 3 min to recover');assert.equal(RECOVER_SECONDS,600);
 const w=new SoftBodyWorld({random:seeded()});w.setDrain(.25);assert.ok(Math.abs(w.liveElasticity-(.99+(DRAINED.elasticity-.99)*.25))<1e-9);
 w.setDrain(0);assert.equal(w.liveElasticity,.99);assert.equal(w.liveFriction,.2);assert.equal(w.liveDrag,.6);
 w.setDrain(1);assert.ok(Math.abs(w.liveElasticity-.12)<1e-9,'elasticity falls to 0.12');assert.equal(w.liveFriction,9,'friction rises to 9');assert.ok(Math.abs(w.liveDrag-.72)<1e-9,'drag rises to 0.72');w.setDrain(.25);
 w.setDrain(1);assert.ok(w.movement<.5);w.setDrain(NaN);assert.equal(w.liveElasticity,.99);assert.equal(w.movement,1);
 // (Top speed set low enough to matter: draining lowers it by up to 60%.)
 const median=drain=>{const v=new SoftBodyWorld({random:seeded()});v.set('maxSpeed',120);v.setDrain(drain);const s=[];for(let f=0;f<60*30;f++){v.setGravity(Math.cos(f/60),Math.sin(f/60));v.advance(1/60);for(const b of v.bodies)s.push(speed(b));}s.sort((a,b)=>a-b);return s[s.length>>1];};
 assert.ok(median(1)<median(0)*.75,'movement slows when drained');
});
test('under the weight of a 1 g pile no body is folded inside out (radial exit from a neighbour)',()=>{
 const w=new SoftBodyWorld({random:seeded(),count:14}),share=b=>b.area/(Math.PI*b.radius**2);let below=0,n=0;
 for(let f=0;f<60*60;f++){const t=f/60;w.setGravity(Math.cos(t*.7),Math.sin(t*1.3));w.advance(1/60);for(const b of w.bodies){if(share(b)<.4)below++;n++;}}
 assert.ok(below/n<.01,`squashed below 40% area ${(below/n*100).toFixed(2)}% of the time`);
 // A point pushed deep into a body leaves away from that body's centre, never through the far side.
 const v=still({count:2}),[A]=v.bodies;place(A,240,240);const c=A.centroid,p={x:c.x+A.radius*.7,y:c.y+2,vx:0,vy:0};
 const hit=bodyCollision(p,A);assert.ok(hit.normal.x>.9,'exits on its own side');assert.ok(Math.abs(hit.depth-(A.radius-Math.hypot(A.radius*.7,2)))<1.5,'depth to the outline on that side');
});
test('a press kicks blobs away from it, strongest close by and nothing beyond the push reach',()=>{
 const w=still({count:3}),[A,B,C]=w.bodies;place(A,240,150);place(B,240,250);place(C,240,420);
 w.blast(240,120);
 const kick=b=>b.velocity.y;
 assert.ok(kick(A)>kick(B)&&kick(B)>0,'closer = stronger, all away (downward) from a press above');
 assert.equal(speed(C),0,'beyond the reach: untouched');
 assert.ok(Math.abs(kick(A)-PARAMS.push.default*(1-30/PARAMS.pushRadius.default)**2)<1,'push × (1 − d/reach)²');
 const v=still({count:1}),[D]=v.bodies;place(D,240,100);v.blast(240,100);assert.ok(D.velocity.y>0&&Math.abs(D.velocity.x)<1e-9,'on the press point: toward the far side');
 v.set('push',0);place(D,240,100);v.blast(240,100);assert.equal(speed(D),0,'push 0: no kick');
});
test('dragging stirs blobs near the stroke along with the pointer; far ones stay',()=>{
 const w=still({count:2},{pushRadius:120}),[A,B]=w.bodies;place(A,240,240);place(B,240,460-B.radius);
 w.stir(200,240,260,240,.1);
 assert.ok(A.velocity.x>50,`carried along (${A.velocity.x.toFixed(0)} px/s)`);assert.ok(Math.abs(A.velocity.y)<1e-6);
 assert.equal(speed(B),0,'outside the reach');
});
test('resting contact: a slow meeting does not bounce, a fast one does',()=>{
 for(const [v,bounces] of [[RESTING_SPEED*.5,false],[RESTING_SPEED*3,true]]){
  const p={x:CENTER+DISPLAY_RADIUS+1,y:240,vx:v,vy:0};resolveCollision(p,glassCollision(p),1,0,STEP);
  assert.equal(p.vx<0,bounces,`${v} px/s`);
 }
});
test('stable: two minutes of hard tilting at slider extremes stay finite, inside the glass, and recover',()=>{
 for(const extra of [{},{stiffness:PARAMS.stiffness.max,elasticity:1,friction:0},{stiffness:PARAMS.stiffness.min,elasticity:0,friction:50},{gravity:2000,maxSpeed:600},{count:100,damping:0}]){
  const w=new SoftBodyWorld({random:seeded()});for(const [k,v] of Object.entries(extra))w.set(k,v);
  for(let f=0;f<60*(extra.count?30:120);f++){const t=f/60;w.setGravity(Math.cos(t*.7)*(t%20<10?1:.3),Math.sin(t*1.3));w.advance(1/60);}
  assert.ok(finite(w)&&inGlass(w),JSON.stringify(extra));
  // Hard impacts may squash a body for a moment, but none stays folded: level again, all recover.
  w.setGravity(0,0);for(let f=0;f<60*10;f++)w.advance(1/60);
  // (75%: a full plate of 100 blobs keeps some pressed together, about 87% area, but none is folded.)
  for(const b of w.bodies)assert.ok(b.area>Math.PI*b.radius**2*.75,`recovers its shape (${JSON.stringify(extra)})`);
 }
});
test('fixed step: 30, 60 and 120 fps drawing give the same motion',()=>{
 const run=fps=>{const w=new SoftBodyWorld({random:seeded()});for(let f=0;f<fps*5;f++)w.advance(1/fps);return w.bodies.flatMap(b=>b.nodes.map(n=>[n.x,n.y]));};
 const base=run(60);for(const other of [run(30),run(120)])other.forEach((p,i)=>assert.ok(Math.abs(p[0]-base[i][0])<1e-6&&Math.abs(p[1]-base[i][1])<1e-6));
});
test('tuning sliders map 0–1 to each parameter range; defaults round-trip; the world clamps',()=>{
 for(const [name,p] of Object.entries(PARAMS)){
  assert.equal(valueFor(name,0),p.min);assert.equal(valueFor(name,1),p.max);
  const back=valueFor(name,sliderFor(name,p.default));assert.ok(Math.abs(back-p.default)<1e-9,name);
 }
 const w=new SoftBodyWorld({random:seeded()});w.set('elasticity',3);assert.equal(w.elasticity,2);w.set('friction',-1);assert.equal(w.friction,0);w.set('nonsense',1);assert.ok(!('nonsense' in w));
});
test('number of blobs adds bodies in free space and removes the newest',()=>{
 const w=new SoftBodyWorld({random:seeded()});
 w.set('count',PARAMS.count.max);assert.equal(w.count,200);assert.ok(finite(w)&&inGlass(w));
 const first=w.bodies[0];w.set('count',1);assert.equal(w.count,1);assert.equal(w.bodies[0],first);
 w.set('count',3.6);assert.equal(w.count,4);w.set('count',0);assert.equal(w.count,PARAMS.count.min);
});
test('size grows or shrinks the bodies through the shape-matching rest shape',()=>{
 const w=still({count:1}),b=w.bodies[0];place(b,240,240);w.set('size',1);for(let f=0;f<60;f++)w.advance(1/60);const r0=b.reach;
 w.set('size',1.6);for(let f=0;f<60;f++)w.advance(1/60);assert.ok(b.reach>r0*1.45,`grew to ${(b.reach/r0).toFixed(2)}×`);
 w.set('size',.6);for(let f=0;f<120;f++)w.advance(1/60);assert.ok(b.reach<r0*.7,`shrank to ${(b.reach/r0).toFixed(2)}×`);
});
test('up to 200 blobs: past what fits, all are drawn smaller just enough to fit the plate',()=>{
 const w=new SoftBodyWorld({random:seeded()});w.set('size',1);assert.equal(w.scale,w.size,'50 fit at full size');
 w.set('count',100);const covered=()=>w.bodies.reduce((s,b)=>s+(b.baseRadius*w.scale)**2,0)/DISPLAY_RADIUS**2;
 assert.ok(w.scale<1&&w.scale>.7,`100 shrink (×${w.scale.toFixed(2)})`);assert.ok(Math.abs(covered()-FILL_MAX)<1e-9,'exactly the fill limit');
 for(let f=0;f<60*3;f++)w.advance(1/60);assert.ok(w.bodies.every(b=>Math.abs(b.radius-b.baseRadius*w.scale)<1e-9),'every blob resized');
 assert.ok(finite(w)&&inGlass(w));
 w.set('count',200);assert.ok(w.scale>.5&&w.scale<.6,`200 at about ×0.57 (×${w.scale.toFixed(2)})`);assert.ok(Math.abs(covered()-FILL_MAX)<1e-9);
 for(let f=0;f<60*3;f++){w.setGravity(Math.cos(f/30),Math.sin(f/30));w.advance(1/60);}assert.ok(finite(w)&&inGlass(w),'200 stay finite and in the glass');
 w.set('count',100);w.set('size',.5);assert.equal(w.scale,.5,'small blobs fit without shrinking further');
});
test('paired preview serves the soft-body entry points',async t=>{
 const {server}=createHarveyServer();server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}/portable/`;
 for(const path of ['softbody.mjs','interaction-v15.mjs','renderer.mjs'])assert.equal((await fetch(base+path)).status,200);
 const app=await(await fetch(base+'app.js')).text();
 assert.match(app,/SoftBodyWorld/);assert.match(app,/JellyRenderer/);assert.match(app,/renderer\.draw\(physics\.bodies,drain\.seconds[,)]/);assert.match(app,/physics.setDrain\(drain.step\(/);assert.match(app,/target.set\(name,name in PARAMS\?valueFor\(name/);assert.match(app,/RENDER_PARAMS/);
 const html=await(await fetch(base+'index.html')).text();
 for(const id of [...Object.keys(PARAMS),'hue','tuning-reset','tilt-level'])assert.match(html,new RegExp(`id="${id}"`),id);
});
test('inelastic contacts lose their bounce but never glue blobs together or to the glass',()=>{
 for(const set of [w=>w.set('elasticity',0),w=>w.setDrain(1)]){
  const w=new SoftBodyWorld({random:seeded(10)});set(w);let longest=0;
  for(let f=0;f<60*60;f++){w.advance(1/60);for(const c of w.contacts.values())longest=Math.max(longest,w.time-c.start);}
  assert.ok(longest<6,`longest unbroken contact ${longest.toFixed(1)} s`);
 }
});
test('a deep pile of 50 rests calmly (extra damping only while resting in contact); a lone drop still bounces',()=>{
 const w=new SoftBodyWorld({random:seeded()});w.setGravity(0,.5);for(let f=0;f<60*15;f++)w.advance(1/60);
 let drift=0;for(let f=0;f<60*5;f++){w.advance(1/60);drift=Math.max(drift,w.bodies.reduce((s,b)=>s+speed(b),0)/w.count);}
 assert.ok(drift<4,`pile drift ${drift.toFixed(2)} px/s`);
 const v=new SoftBodyWorld({random:seeded(),count:1}),b=v.bodies[0];place(b,240,90);v.setGravity(0,.54);
 let impact=0,rebound=0,prev=0;for(let f=0;f<60*4&&!rebound;f++){v.advance(1/60);const vy=b.velocity.y;impact=Math.max(impact,vy);if(prev>0&&vy<0){for(let k=0;k<12;k++){v.advance(1/60);rebound=Math.max(rebound,-b.velocity.y);}}prev=vy;}
 assert.ok(rebound>impact*.6,`bounce keeps ${(rebound/impact*100).toFixed(0)}% of ${impact.toFixed(0)} px/s`);
});
