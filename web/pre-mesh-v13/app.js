import { PalmInteraction, VectorMotionReader } from './interaction-v12.mjs?v=gravity-12';
import { PalmPhysics, BASE_RESTITUTION } from './physics-v12.mjs?v=gravity-12';
import { BlobRenderer } from './renderer-v10.mjs?v=collisions-10';
import { HarveyLink } from './harvey-link-v1.mjs';
const interaction=new PalmInteraction(), reader=new VectorMotionReader();
const renderer=new BlobRenderer(document.querySelector('#scene'));
const physics=new PalmPhysics();
const hold=document.querySelector('#hold'),simulate=document.querySelector('#simulate');
const tiltTest=document.querySelector('#tilt-test'),tiltAngle=document.querySelector('#tilt-angle'),scene=document.querySelector('#scene');
const strength=document.querySelector('#shake-strength'),metrics=document.querySelector('#metrics');
const welcome=document.querySelector('#welcome'),status=document.querySelector('#status');
const motionStatus=document.querySelector('#motion-status');
let source=null,pointer=null,drag=null,last=performance.now(),simulationTime=0,listening=false,sensorSeen=false,watchdog;
let lastMetrics=-Infinity;
const link=new HarveyLink({role:'portable',onSnapshot(message){interaction.adopt(message.states[link.population],message.serverNow);},
  onStatus(value){document.documentElement.dataset.harveyConnection=value;if(['disconnected','population-busy'].includes(value))release();}});
setInterval(()=>{if(interaction.held)link.send('intensity',interaction.intensity);},100);
function setHeld(value){
  const before=interaction.held;interaction.hold(value);
  hold.setAttribute('aria-pressed',String(value));simulate.setAttribute('aria-pressed',String(value&&source==='simulate'));tiltTest.setAttribute('aria-pressed',String(value&&source==='tilt'));
  if(before!==value){if(value)link.send('hold');else{link.send('intensity',interaction.intensity);link.send('release');}}
}
function sourceElement(kind){return kind==='attractor'?scene:kind==='simulate'?simulate:kind==='tilt'?tiltTest:hold;}
function release(){
  physics.setAttractor(0,0,false);
  if(source==='tilt')interaction.clearTestTilt();
  const active=sourceElement(source),id=pointer;
  source=null;pointer=null;drag=null;setHeld(false);
  if(id!==null&&active.hasPointerCapture(id))active.releasePointerCapture(id);
}
function press(event,kind){
  if(event.button!==0||source)return;event.preventDefault();source=kind;pointer=event.pointerId;
  const element=sourceElement(kind);element.setPointerCapture(pointer);
  drag={x:event.clientX,y:event.clientY,time:event.timeStamp,vx:0,vy:0};setHeld(true);
}
hold.addEventListener('pointerdown',event=>press(event,'button'));
simulate.addEventListener('pointerdown',event=>press(event,'simulate'));
tiltTest.addEventListener('pointerdown',event=>press(event,'tilt'));
function moveAttractor(event){
  const r=scene.getBoundingClientRect();
  physics.setAttractor((event.clientX-r.left)*480/r.width,(event.clientY-r.top)*480/r.height);
}
scene.addEventListener('pointerdown',event=>{press(event,'attractor');if(source==='attractor')moveAttractor(event);});
scene.addEventListener('pointermove',event=>{
  if(source!=='attractor'||event.pointerId!==pointer)return;
  moveAttractor(event);
  const dt=Math.max(.008,Math.min(.1,(event.timeStamp-drag.time)/1000));
  const speed=Math.hypot(event.clientX-drag.x,event.clientY-drag.y)/dt;
  // Pointer speed controls impact feedback only; attraction supplies the force.
  interaction.sampleVector(0,0,Math.min(16,speed/70),performance.now());
  drag={...drag,x:event.clientX,y:event.clientY,time:event.timeStamp};
});
hold.addEventListener('pointermove',event=>{
  if(event.pointerId!==pointer||source!=='button'||!drag)return;
  const dt=Math.max(.008,Math.min(.1,(event.timeStamp-drag.time)/1000));
  const vx=(event.clientX-drag.x)/dt,vy=(event.clientY-drag.y)/dt;
  interaction.sampleVector((vx-drag.vx)/dt/1200,(vy-drag.vy)/dt/1200,0,performance.now());
  drag={x:event.clientX,y:event.clientY,time:event.timeStamp,vx,vy};
});
for(const button of [hold,simulate,tiltTest,scene]){
  for(const name of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(name,event=>{if(event.pointerId===pointer)release();});
  button.addEventListener('contextmenu',event=>event.preventDefault());
  button.addEventListener('blur',()=>{if(source!=='keyboard')release();});
}
addEventListener('keydown',event=>{
  if(event.target.matches('input,select,textarea')||![' ','Enter'].includes(event.key))return;
  if(event.key==='Enter'&&![hold,simulate,tiltTest].includes(event.target))return;
  event.preventDefault();if(event.repeat||source)return;
  source=event.target===simulate?'simulate':event.target===tiltTest?'tilt':'keyboard';setHeld(true);
});
addEventListener('keyup',event=>{if([' ','Enter'].includes(event.key)&&pointer===null)release();});
addEventListener('blur',release);
document.addEventListener('visibilitychange',()=>{release();last=performance.now();});
function screenAngle(){return screen.orientation?.angle??window.orientation??0;}
function onMotion(event){
  const now=performance.now(),vector=reader.read(event,now,screenAngle()),omega=reader.rotation(event);
  if(!vector&&omega===null)return;sensorSeen=true;clearTimeout(watchdog);
  motionStatus.textContent='Motion connected. Tilt changes gravity; hold while shaking.';
  if(vector)interaction.sampleVector(vector.x,vector.y,vector.z,now);
  if(omega!==null)interaction.sampleRotation(omega,now);
}
function onOrientation(event){
  const tilt=reader.orientation(event,screenAngle());
  if(tilt)interaction.sampleTilt(tilt.x,tilt.y,performance.now());
}
async function enableMotion(){
  status.textContent='';
  if(!window.isSecureContext){status.textContent='Use HTTPS on your phone to enable motion.';return;}
  if(typeof DeviceMotionEvent==='undefined'){status.textContent='No motion sensor is available here. Use the laptop shake test.';return;}
  try{
    // Invoke both permission requests directly in this user gesture before awaiting.
    const motionPermission=typeof DeviceMotionEvent.requestPermission==='function'?DeviceMotionEvent.requestPermission():Promise.resolve('granted');
    const orientationPermission=typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission==='function'
      ?DeviceOrientationEvent.requestPermission().catch(()=> 'denied'):Promise.resolve('granted');
    const [permission,orientation]=await Promise.all([motionPermission,orientationPermission]);
    if(permission!=='granted'){status.textContent='Motion access was not allowed.';return;}
    if(!listening){addEventListener('devicemotion',onMotion);if(orientation==='granted')addEventListener('deviceorientation',onOrientation);listening=true;}
    welcome.hidden=true;
    watchdog=setTimeout(()=>{if(!sensorSeen)motionStatus.textContent='No sensor readings yet. The laptop shake test is still available.';},4000);
  }catch{status.textContent='Motion could not start. Check sensor permissions or use the laptop test.';}
}
document.querySelector('#enable').addEventListener('click',enableMotion);
document.querySelector('#motion-setup').addEventListener('click',()=>{release();welcome.hidden=false;});
document.querySelector('#view').addEventListener('click',()=>{welcome.hidden=true;});
if(new URLSearchParams(location.search).get('input')==='shake')welcome.hidden=false;
function frame(now){
  const dt=Math.max(0,Math.min(.05,(now-last)/1000));last=now;
  if(!document.hidden){
    simulationTime+=dt;
    if(source==='simulate'){
      const amplitude=Number(strength.value)*22;
      interaction.sampleVector(Math.sin(simulationTime*19)*amplitude,Math.cos(simulationTime*14)*amplitude*.8,0,now);
      interaction.sampleRotation(0,now);
    }
    if(source==='tilt'){
      const angle=Number(tiltAngle.value)*Math.PI/180;
      interaction.sampleTilt(Math.sin(angle)*9.81,Math.cos(angle)*9.81,now);
      interaction.sampleRotation(0,now);
    }
    interaction.step(dt,now);
    physics.advance(dt,{repulsion:interaction.repulsion,deformation:interaction.deformation},interaction.motion(now));
    renderer.draw(physics.blobs,interaction.opacity);
    if(now-lastMetrics>100){
      metrics.textContent=`${interaction.held?`${interaction.state.holdDurationSeconds.toFixed(1)}s held`:interaction.state.phase==='recovering'?'Recovering':'Baseline'} · Opacity ${Math.round(interaction.opacity*100)}% · Bounce ${Math.round((BASE_RESTITUTION+(0.88-BASE_RESTITUTION)*interaction.repulsion)*100)}% · Shake ${Math.round(interaction.intensity*100)}%`;
      lastMetrics=now;
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
