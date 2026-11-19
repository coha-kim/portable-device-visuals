import test from 'node:test';
import assert from 'node:assert/strict';
import {NearDetector,ENTER_DBM,EXIT_DBM,DWELL_SECONDS,COOLDOWN_SECONDS,STALE_SECONDS} from '../proximity.mjs';
// Feed a constant (or generated) RSSI at 10 readings per second; returns the times taps fired.
function feed(d,from,to,rssi,step=.1){const fired=[];for(let t=from;t<to-1e-9;t+=step){const v=typeof rssi==='function'?rssi(t):rssi;if(d.reading(v,t))fired.push(+t.toFixed(2));}return fired;}
test('a tap needs the portable held close for the dwell time, then fires once',()=>{
 let taps=0;const d=new NearDetector({onNear:()=>taps++});
 assert.deepEqual(feed(d,0,2,-70),[],'far away: nothing');
 const fired=feed(d,2,6,-38);assert.equal(fired.length,1,'held close: one tap');
 assert.ok(fired[0]-2>=DWELL_SECONDS&&fired[0]-2<DWELL_SECONDS+.6,`after the dwell (${fired[0]-2} s)`);assert.equal(taps,1);
});
test('passing by briefly does not tap; noise around the threshold does not double-fire',()=>{
 const d=new NearDetector();
 assert.deepEqual(feed(d,0,.5,-38),[],'shorter than the dwell');feed(d,.5,2,-70);
 // Noisy hover just around the enter level, never dropping below the exit level: at most one tap.
 let s=7;const noise=()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296-.5)*12;
 assert.ok(feed(d,2,20,()=>ENTER_DBM+3+noise()).length<=1);
});
test('hysteresis and cooldown: re-arms only after moving away, and not within the cooldown',()=>{
 const d=new NearDetector();
 assert.equal(feed(d,0,2,-38).length,1);
 assert.equal(feed(d,2,2.6,EXIT_DBM+3).length,0,'eased back but not away: still disarmed');
 assert.equal(feed(d,2.6,3.6,-38).length,0,'back close without moving away: no second tap');
 feed(d,3.6,4.2,-75);
 const again=feed(d,4.2,8,-38);assert.equal(again.length,1,'moved away and back: taps again');
 assert.ok(again[0]-1.0>=COOLDOWN_SECONDS-1e-9,'respects the cooldown since the first tap');
});
test('stale readings count as away; bad readings are ignored',()=>{
 const d=new NearDetector();feed(d,0,.5,-38);
 assert.equal(d.reading(-38,.5+STALE_SECONDS+.5),false,'gap: dwell starts over');
 assert.equal(d.reading(NaN,3),false);assert.equal(d.reading(-38,NaN),false);
 d.tick(10);assert.equal(d.level,null);
});
