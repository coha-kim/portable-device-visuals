import test from 'node:test';
import assert from 'node:assert/strict';
import {paintPixels,palette,BACKGROUND,RIM,CORE,DULL} from '../renderer.mjs';
const W=120;
function paint(blobs,dullness=0){const field=new Float32Array(W*W),px=new Uint8ClampedArray(W*W*4);paintPixels(W,W,blobs,dullness,field,px);return px;}
const at=(px,x,y)=>Array.from(px.slice((y*W+x)*4,(y*W+x)*4+3));
test('supplied palette: #594F47 background, #97D3B2 rim to #CFE0BD core, dulling to #729B82',()=>{
 assert.deepEqual(BACKGROUND,[89,79,71]);assert.deepEqual(RIM,[151,211,178]);assert.deepEqual(CORE,[207,224,189]);assert.deepEqual(DULL,[114,155,130]);
 assert.deepEqual(palette(1),{rim:[...DULL],core:[...DULL]});assert.deepEqual(palette(0),{rim:[...RIM],core:[...CORE]});
});
test('fused body is lighter where thicker and fully dull at maximum energy',()=>{
 const blobs=[{x:60,y:60,r:20},{x:75,y:60,r:20}];
 const fresh=paint(blobs),dull=paint(blobs,1);
 const rim=at(fresh,60,41),core=at(fresh,67,60);
 assert.ok(core[0]>rim[0]&&core[1]>rim[1],JSON.stringify({rim,core}));
 assert.deepEqual(at(dull,67,60),[...DULL]);
 assert.deepEqual(at(fresh,2,2),[...BACKGROUND]);
});
test('nearby blobs fuse across a gap; distant blobs stay separate',()=>{
 const bridge=d=>at(paint([{x:60-d/2,y:60,r:15},{x:60+d/2,y:60,r:15}]),60,60);
 assert.notDeepEqual(bridge(34),[...BACKGROUND],'fuses at a small gap');
 assert.deepEqual(bridge(70),[...BACKGROUND],'separate when far apart');
});
test('every pixel is rewritten each frame, so moved blobs leave no trail',()=>{
 const field=new Float32Array(W*W),px=new Uint8ClampedArray(W*W*4);
 paintPixels(W,W,[{x:30,y:30,r:15}],0,field,px);paintPixels(W,W,[{x:90,y:90,r:15}],0,field,px);
 assert.deepEqual(at(px,30,30),[...BACKGROUND]);assert.ok(px.every((v,i)=>i%4!==3||v===255));
});
