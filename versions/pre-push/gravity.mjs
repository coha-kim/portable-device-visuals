// Device gravity for the blobs, in g, in screen coordinates (+x right, +y down the screen).
// The accelerometer's accelerationIncludingGravity is the specific force f = a − g (what the sensor
// feels). Things inside the device feel the opposite, −f: tilt it and gravity has a part along the
// screen; move it and the contents lag behind. So one reading covers tilting and moving; lying flat
// and still, the in-plane part is ~0 and nothing moves. (On the ESP32 the QMI8658 accelerometer gives
// the same reading; map its axes to the panel the same way.)
// Device axes (W3C): +x to the right of the screen, +y to its top. The screen orientation angle
// rotates them into what the user sees.
export const G=9.80665;
export function screenGravity(f,angle=0){
 if(!f||![f.x,f.y].every(Number.isFinite))return null;
 const a=(Number.isFinite(angle)?angle:0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
 // −f in device axes, rotated to the displayed orientation; device +y (up) becomes screen −y.
 const x=-f.x,y=-f.y,rx=x*c-y*s,ry=x*s+y*c;
 return {x:rx/G,y:-ry/G};
}
// Fake gyroscope until the board arrives: pressing on the round display tips the plate down toward the
// pointer, like tilting a plate of balls. (x, y) is the pointer relative to the display centre in
// display radii (rim = 1); the tilt grows with distance from the centre, up to MAX_POINTER_G at the rim.
export const MAX_POINTER_G=.6;
export function pointerGravity(x,y){
 if(![x,y].every(Number.isFinite))return {x:0,y:0};
 const d=Math.hypot(x,y),k=d>1?1/d:1;
 return {x:x*k*MAX_POINTER_G,y:y*k*MAX_POINTER_G};
}
// Smooths sensor readings (they arrive at uneven rates and are noisy) and prefers a fresh sensor over
// the pointer tilt (which also eases in and out, as a hand tipping a plate would); `extra` adds a
// one-frame push (the laptop shake test).
export const SMOOTH_SECONDS=.15,SENSOR_FRESH_MS=500;
export class GravityInput {
 constructor(){this.sensor={x:0,y:0};this.sensorAt=-Infinity;this.manual={x:0,y:0};this.value={x:0,y:0};}
 reading(f,angle,now){const g=screenGravity(f,angle);if(!g)return false;this.sensor=g;this.sensorAt=now;return true;}
 setPointer(x,y){this.manual=pointerGravity(x,y);}
 level(){this.manual={x:0,y:0};}
 get usingSensor(){return this.sensorAt>-Infinity&&performance.now()-this.sensorAt<SENSOR_FRESH_MS;}
 step(dt,now=performance.now(),extra={x:0,y:0}){
  const fresh=now-this.sensorAt<SENSOR_FRESH_MS,target=fresh?this.sensor:this.manual;
  const k=1-Math.exp(-Math.max(0,dt)/SMOOTH_SECONDS);
  this.value={x:this.value.x+(target.x-this.value.x)*k,y:this.value.y+(target.y-this.value.y)*k};
  return {x:this.value.x+(extra.x||0),y:this.value.y+(extra.y||0)};
 }
}
