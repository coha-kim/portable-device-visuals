import test from 'node:test';
import assert from 'node:assert/strict';
import { paintPixels } from '../renderer.mjs';
const width=120, height=80, bg=[236,234,219];
function make() {
  const f=new Float32Array(width*height), l=new Float32Array(width*height), p=new Uint8ClampedArray(width*height*4);
  return {f,l,p, draw(blobs,opacity=1){paintPixels(width,height,blobs,opacity,bg,f,l,p);}, pixel(x,y){return [...p.slice((y*width+x)*4,(y*width+x)*4+4)];}};
}
test('moving blobs completely removes previous-frame pixels',()=>{
  const r=make(); r.draw([{x:25,y:40,r:12}]); assert.notDeepEqual(r.pixel(25,40),[...bg,255]);
  r.draw([{x:90,y:40,r:12}]); assert.deepEqual(r.pixel(25,40),[...bg,255]);
  r.draw([]); for(let i=0;i<width*height;i++) assert.deepEqual([...r.p.slice(i*4,i*4+4)],[...bg,255]);
});
test('opacity blends pixels without changing field geometry',()=>{
  const r=make(), blobs=[{x:50,y:40,r:15}]; r.draw(blobs); const full=r.pixel(50,40), field=r.f.slice();
  r.draw(blobs,.5); assert.deepEqual(r.f,field); const faded=r.pixel(50,40);
  for(let i=0;i<3;i++) assert.ok(Math.abs(faded[i]-(full[i]+bg[i])/2)<=1);
  r.draw(blobs,0); assert.deepEqual(r.pixel(50,40),[...bg,255]);
});
test('nearby fields fuse across the gap while separated blobs do not',()=>{
  const r=make(); r.draw([{x:45,y:40,r:13},{x:75,y:40,r:13}]); assert.notDeepEqual(r.pixel(60,40),[...bg,255]);
  r.draw([{x:25,y:40,r:13},{x:95,y:40,r:13}]); assert.deepEqual(r.pixel(60,40),[...bg,255]);
});
