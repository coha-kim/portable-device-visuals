import test from 'node:test';
import assert from 'node:assert/strict';
import {JellyRenderer,BACKGROUND,FILL,FILL_HUE,colourFor,RENDER_PARAMS,outlineWidth,OUTLINE_SECONDS,MIN_OUTLINE} from '../renderer.mjs';
import {SoftBodyWorld} from '../softbody.mjs';
function make(){
 const calls=[],gradients=[];
 const ctx={globalAlpha:1,fillStyle:'',strokeStyle:'',lineWidth:1,filter:'none',shadowBlur:0,
  save(){calls.push(['save']);},restore(){calls.push(['restore']);},beginPath(){calls.push(['beginPath']);},closePath(){},
  arc(...a){calls.push(['arc',...a]);},clip(){calls.push(['clip']);},ellipse(){calls.push(['ellipse']);},
  moveTo(...a){calls.push(['moveTo',...a]);},quadraticCurveTo(...a){calls.push(['quad',...a]);},
  lineTo(...a){calls.push(['lineTo',...a]);},stroke(){calls.push(['stroke']);},
  fillRect(...a){calls.push(['fillRect',this.fillStyle,this.globalAlpha,...a]);},fill(...a){calls.push(['fill',this.globalAlpha,...a]);},drawImage(...a){calls.push(['drawImage',...a]);},
  createRadialGradient(...a){const g={a,stops:[],addColorStop(o,c){this.stops.push([o,c]);}};gradients.push(g);return g;}};
 const canvas={getContext(){return ctx;}};return {renderer:new JellyRenderer(canvas),canvas,ctx,calls,gradients};
}
test('native 480 × 480 round canvas, #CCCCCC background, solid orange #F47839 with no highlight',()=>{
 assert.equal(FILL,'#F47839');assert.equal(BACKGROUND,'#CCCCCC');
 const r=make(),w=new SoftBodyWorld({random:Math.random});r.renderer.draw(w.bodies);
 assert.equal(r.canvas.width,480);assert.equal(r.canvas.height,480);
 assert.deepEqual(r.calls[0],['fillRect',BACKGROUND,1,0,0,480,480]);
 assert.ok(r.calls.some(c=>c[0]==='arc'&&c[1]===240&&c[2]===240&&c[3]===240)&&r.calls.some(c=>c[0]==='clip'));
 assert.equal(r.gradients.length,0);assert.equal(r.ctx.fillStyle,FILL);
 assert.equal(r.calls.filter(c=>c[0]==='stroke'||c[0]==='ellipse').length,0);
});
test('no blur: each body is one crisp fill at full resolution, with no soft border, filter, shadow or buffer',()=>{
 const r=make(),w=new SoftBodyWorld({random:Math.random,count:3});r.renderer.draw(w.bodies);
 const fills=r.calls.filter(c=>c[0]==='fill');assert.equal(fills.length,3,'one fill per body');
 assert.ok(fills.every(c=>c[1]===1),'fully opaque');
 assert.equal(r.calls.filter(c=>c[0]==='quad').length,3*w.bodies[0].nodes.length,'one outline per body');
 assert.equal(r.calls.filter(c=>c[0]==='drawImage').length,0,'drawn straight onto the canvas');
 assert.equal(r.ctx.filter,'none');assert.equal(r.ctx.shadowBlur,0);
 // The outline passes through the nodes' edge midpoints, not grown or shrunk.
 const b=w.bodies[0],n=b.nodes,move=r.calls.find(c=>c[0]==='moveTo');
 assert.deepEqual(move.slice(1),[(n.at(-1).x+n[0].x)/2,(n.at(-1).y+n[0].y)/2]);
});
test('every frame repaints the whole background and restores alpha, so nothing trails',()=>{
 const r=make();r.renderer.draw([]);r.renderer.draw([]);
 assert.equal(r.calls.filter(c=>c[0]==='fillRect').length,2);
});
test('fill to outline: thickness inversely proportional to interaction time; solid at rest',()=>{
 assert.ok(!('translucency' in RENDER_PARAMS),'translucency removed');
 assert.equal(outlineWidth(22,0),22,'at rest: a full disc');
 for(const t of [1,2,5,9])assert.ok(Math.abs(outlineWidth(22,t)*(OUTLINE_SECONDS+t)-22*OUTLINE_SECONDS)<1e-9,`width × (τ + t) constant at ${t} s`);
 assert.ok(Math.abs(outlineWidth(22,1)-11)<1e-9,'1 s: half the radius');assert.ok(outlineWidth(22,10)>=MIN_OUTLINE&&outlineWidth(22,1e6)===MIN_OUTLINE,'never thinner than the minimum');
 assert.equal(outlineWidth(22,NaN),22);assert.equal(outlineWidth(22,-3),22);
 const draw=t=>{const r=make(),w=new SoftBodyWorld({random:Math.random,count:1});r.renderer.draw(w.bodies,t);return {r,b:w.bodies[0]};};
 const solid=draw(0);assert.deepEqual(solid.r.calls.filter(c=>c[0]==='fill').map(c=>c.slice(2)),[[]],'solid: one plain fill');
 const ring=draw(3),fills=ring.r.calls.filter(c=>c[0]==='fill');
 assert.deepEqual(fills.map(c=>c[2]),['evenodd'],'outlined: outer path minus inset hole');
 const moves=ring.r.calls.filter(c=>c[0]==='moveTo').map(c=>Math.hypot(c[1]-ring.b.centroid.x,c[2]-ring.b.centroid.y));
 assert.equal(moves.length,2);assert.ok(Math.abs(moves[0]-moves[1]-outlineWidth(ring.b.radius,3))<.5,'hole inset by the outline width');
});
test('colour slider sets the fill hue; the default is exactly the orange, every hue equally vivid',()=>{
 assert.equal(colourFor(FILL_HUE),FILL);assert.equal(RENDER_PARAMS.hue.default,FILL_HUE);
 assert.equal(colourFor(0),'#F43939');assert.equal(colourFor(120),'#39F439');assert.equal(colourFor(360),colourFor(0));
 for(let h=0;h<360;h+=15){const [r,g,b]=colourFor(h).slice(1).match(/../g).map(x=>parseInt(x,16));assert.equal(Math.max(r,g,b),0xF4,`hue ${h}`);assert.equal(Math.min(r,g,b),0x39);}
 const r=make(),w=new SoftBodyWorld({random:Math.random,count:1});r.renderer.set('hue',280);r.renderer.draw(w.bodies);
 assert.equal(r.ctx.fillStyle,colourFor(280));assert.equal(r.renderer.fill,'#B639F4');
 r.renderer.set('hue',999);assert.equal(r.renderer.hue,360);
});
