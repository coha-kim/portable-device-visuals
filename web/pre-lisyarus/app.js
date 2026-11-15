import { PalmInteraction, VectorMotionReader } from './interaction-v15.mjs?softbody-15';
import { SoftBodyWorld, ShakeDrain, PARAMS, BODY_RADIUS, valueFor } from './softbody.mjs?softbody-15';
import { JellyRenderer, RENDER_PARAMS } from './renderer.mjs?softbody-15';
import { HarveyLink } from './harvey-link-v1.mjs';
const interaction=new PalmInteraction(), reader=new VectorMotionReader();
const renderer=new JellyRenderer(document.querySelector('#scene'));
const physics=new SoftBodyWorld(),drain=new ShakeDrain();
// Live tuning sliders (0–1 positions). Physics parameters go to the world; translucency to the renderer.
const tuning=[...document.querySelectorAll('#tuning input[data-param]')];
const ranges={...PARAMS,...RENDER_PARAMS};
const targetFor=name=>name in RENDER_PARAMS?renderer:physics;
const label={stiffness:v=>`k ${v.toFixed(2)}`,size:v=>`${Math.round(BODY_RADIUS*v)} px radius`,
  deformation:v=>`${Math.round(v*100)}% dent, ${Math.round((1-v)*100)}% push`,count:v=>`${v}`,
  gravity:v=>v>0?`${v.toFixed(3)} px/frame²`:'off',speed:v=>`×${v.toFixed(1)}`,freedom:v=>`${Math.round(v*100)}%`,slime:v=>`${Math.round(v*100)}%`,wobble:v=>`${Math.round(v*100)}%`,
  translucency:v=>v>0?`${Math.round(v*100)}% see-through`:'opaque'};
function applyTuning(input){
  const name=input.dataset.param,target=targetFor(name);
  target.set(name,name in PARAMS?valueFor(name,Number(input.value)):ranges[name].min+(ranges[name].max-ranges[name].min)*Number(input.value));
  input.nextElementSibling.textContent=label[name](target[name]);
}
function resetTuning(){for(const input of tuning){const p=ranges[input.dataset.param];input.value=String((p.default-p.min)/(p.max-p.min));applyTuning(input);}}
for(const input of tuning)input.addEventListener('input',()=>applyTuning(input));
document.querySelector('#tuning-reset').addEventListener('click',resetTuning);
resetTuning();
const hold=document.querySelector('#hold'),simulate=document.querySelector('#simulate');
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
  hold.setAttribute('aria-pressed',String(value));simulate.setAttribute('aria-pressed',String(value&&source==='simulate'));
  if(before!==value){if(value)link.send('hold');else{link.send('intensity',interaction.intensity);link.send('release');}}
}
function sourceElement(kind){return kind==='simulate'?simulate:hold;}
function release(){
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
hold.addEventListener('pointermove',event=>{
  if(event.pointerId!==pointer||source!=='button'||!drag)return;
  const dt=Math.max(.008,Math.min(.1,(event.timeStamp-drag.time)/1000));
  const vx=(event.clientX-drag.x)/dt,vy=(event.clientY-drag.y)/dt;
  interaction.sampleVector((vx-drag.vx)/dt/1200,(vy-drag.vy)/dt/1200,0,performance.now());
  drag={x:event.clientX,y:event.clientY,time:event.timeStamp,vx,vy};
});
for(const button of [hold,simulate]){
  for(const name of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(name,event=>{if(event.pointerId===pointer)release();});
  button.addEventListener('contextmenu',event=>event.preventDefault());
  button.addEventListener('blur',()=>{if(source!=='keyboard')release();});
}
addEventListener('keydown',event=>{
  if(event.target.matches('input,select,textarea')||![' ','Enter'].includes(event.key))return;
  if(event.key==='Enter'&&![hold,simulate].includes(event.target))return;
  event.preventDefault();if(event.repeat||source)return;
  source=event.target===simulate?'simulate':'keyboard';setHeld(true);
});
addEventListener('keyup',event=>{if([' ','Enter'].includes(event.key)&&pointer===null)release();});
addEventListener('blur',release);
document.addEventListener('visibilitychange',()=>{release();last=performance.now();});
function screenAngle(){return screen.orientation?.angle??window.orientation??0;}
function onMotion(event){
  const now=performance.now(),vector=reader.read(event,now,screenAngle()),omega=reader.rotation(event);
  if(!vector&&omega===null)return;sensorSeen=true;clearTimeout(watchdog);
  motionStatus.textContent='Motion connected. Hold while shaking or turning.';
  if(vector)interaction.sampleVector(vector.x,vector.y,vector.z,now);
  if(omega!==null)interaction.sampleRotation(omega,now);
}
async function enableMotion(){
  status.textContent='';
  if(!window.isSecureContext){status.textContent='Use HTTPS on your phone to enable motion.';return;}
  if(typeof DeviceMotionEvent==='undefined'){status.textContent='No motion sensor is available here. Use the laptop shake test.';return;}
  try{
    const permission=typeof DeviceMotionEvent.requestPermission==='function'
      ?await DeviceMotionEvent.requestPermission():'granted';
    if(permission!=='granted'){status.textContent='Motion access was not allowed.';return;}
    if(!listening){addEventListener('devicemotion',onMotion);listening=true;}
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
    interaction.step(dt,now);
    // Shaking drains the slime in proportion to how long it lasts; it seeps back after release.
    physics.setDrain(drain.step(dt,{held:interaction.held,intensity:interaction.intensity}));
    physics.advance(dt);
    renderer.draw(physics.bodies,physics.strands);
    if(now-lastMetrics>100){
      metrics.textContent=`${interaction.held?`${interaction.state.holdDurationSeconds.toFixed(1)}s held`:interaction.state.phase==='recovering'?'Recovering':'Baseline'} · ${physics.count} soft bod${physics.count===1?'y':'ies'} · slime ${Math.round(physics.sliminess*100)}%`;
      lastMetrics=now;
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
