import test from 'node:test';
import assert from 'node:assert/strict';
import {screenGravity,pointerGravity,MAX_POINTER_G,GravityInput,G,SENSOR_FRESH_MS} from '../gravity.mjs';
const near=(a,b,msg)=>assert.ok(Math.abs(a.x-b.x)<1e-6&&Math.abs(a.y-b.y)<1e-6,`${msg}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
test('accelerometer to screen gravity: contents feel the opposite of the specific force',()=>{
 near(screenGravity({x:0,y:0,z:G}),{x:0,y:0},'flat on a table: nothing in the screen plane');
 near(screenGravity({x:0,y:G,z:0}),{x:0,y:1},'held upright: blobs fall to the bottom of the screen');
 near(screenGravity({x:-G,y:0,z:0}),{x:1,y:0},'right edge down: blobs go right');
 near(screenGravity({x:G*.5,y:0,z:G*.866}),{x:-.5,y:0},'left edge down 30°: half a g to the left');
 // Moving the device right (a = +x, at rest otherwise flat) pushes the contents left.
 near(screenGravity({x:3,y:0,z:G}),{x:-3/G,y:0},'contents lag behind a push');
 // Landscape (screen turned 90°): the device's top now points to the user's left.
 near(screenGravity({x:0,y:G,z:0},90),{x:1,y:0},'device top down in landscape = screen right side down');
 assert.equal(screenGravity(null),null);assert.equal(screenGravity({x:NaN,y:0}),null);
});
test('a press is the origin of the force: gravity points away from it, to the opposite side; a fresh sensor wins',()=>{
 near(pointerGravity(0,0),{x:0,y:0},'centre: level');
 near(pointerGravity(1,0),{x:-MAX_POINTER_G,y:0},'press at the right rim: the left side is the ground');
 near(pointerGravity(0,-.5),{x:0,y:MAX_POINTER_G/2},'press halfway up: half gravity downward');
 near(pointerGravity(3,4),{x:-.6*MAX_POINTER_G,y:-.8*MAX_POINTER_G},'outside the disc: capped at the rim');
 near(pointerGravity(NaN,0),{x:0,y:0},'bad input: level');
 const g=new GravityInput(),settle=(from,n=240)=>{let v;for(let i=0;i<n;i++)v=g.step(1/60,from+i*4);return v;};
 g.setPointer(0,-1);let v=g.step(1/60,0);assert.ok(v.y>0&&v.y<MAX_POINTER_G*.2,'eases in like a hand tipping a plate');
 near(settle(0),{x:0,y:MAX_POINTER_G},'pointer tilt after easing');
 g.level();near(settle(0),{x:0,y:0},'Level: flat again');
 g.setPointer(0,-1);g.reading({x:-G,y:0,z:0},0,1000);v=settle(1000,60);
 assert.ok(v.x>.99&&Math.abs(v.y)<.01,'sensor wins while fresh');
 near(settle(1000+SENSOR_FRESH_MS+100),{x:0,y:MAX_POINTER_G},'stale sensor: back to the pointer');
 const one=g.step(0,5000,{x:.3,y:0});assert.ok(Math.abs(one.x-.3)<1e-6,'shake push added for one frame');
});
