import { PalmInteraction, VectorMotionReader } from './interaction-v15.mjs?ambient-43';
import { HarveyLink, attractionFor } from './harvey-link-v1.mjs?ambient-43';
import { ShakeDrain } from './shake-drain.mjs?ambient-43';
const interaction=new PalmInteraction(), reader=new VectorMotionReader();
const hold=document.querySelector('#hold'),simulate=document.querySelector('#simulate');
const strength=document.querySelector('#shake-strength'),metrics=document.querySelector('#metrics');
const welcome=document.querySelector('#welcome'),status=document.querySelector('#status');
const motionStatus=document.querySelector('#motion-status');
let source=null,pointer=null,drag=null,last=performance.now(),simulationTime=0,listening=false,sensorSeen=false,watchdog;
let lastMetrics=-Infinity;
const link=new HarveyLink({role:'portable',onSnapshot(message){interaction.adopt(message.states[link.population],message.serverNow);},
  onStatus(value){document.documentElement.dataset.harveyConnection=value;if(['disconnected','population-busy'].includes(value))release();}});
// The ambient sketch (ambient/sketch-portable.js) calls this before each physics step, exactly as
// ambient-link-v1.mjs does on the ambient display: each population's colour attraction follows its
// portable's intensity. Paired, it uses the room's states; standalone, this portable's own state.
window.harveyAmbientV1={update(){
  const attractionStrengths=link.snapshot
    ?link.snapshot.states.map((_,population)=>attractionFor(link.state(population).intensity))
    :Object.assign([],{[link.population]:attractionFor(interaction.intensity)});
  window.updateParamsFromSensor?.({attractionStrengths});
}};
// Wax sliders. They set the copied sketch's own live values (globals of ambient/sketch-portable.js),
// so defaults are the ambient ones: size → overallSize, speed → the population's speed (wander and
// buoyancy), gravity → how fast warm wax rises and cool wax sinks (BUOYANCY_PX). Merging (0–1) sets
// how readily touching drops fuse: 0 never; 0.5 is exactly the ambient rules (40 frames of contact,
// fuse reach 0.8, no pull); higher fuses sooner, from further and while drifting apart, with a pull.
// Shaking drains it: the live value is the slider × (1 − shake drain), see shake-drain.mjs.
let merging=.5,liveMerging=.5;const drain=new ShakeDrain();
function setMerging(m){merging=m;applyMerging(m*(1-drain.level));}
function applyMerging(m){
  liveMerging=m;const more=Math.max(0,(m-.5)/.5);
  DRAIN_FRAMES=m>0?Math.round(40*Math.pow(.5/m,1.5)):Infinity;
  FUSE_REACH=.8+.15*more;SEPARATING_SPEED=.05+.25*more;tuning.COALESCE_PULL=1.5*more;
}
const WAX={
  size:{min:30,max:110,step:1,default:65,get:()=>overallSize,set:v=>updateParamsFromSensor({overallSize:v}),label:v=>`${Math.round(v/65*100)}%`},
  merging:{min:0,max:1,step:.01,default:.5,get:()=>merging,set:setMerging,label:v=>v<=0?'off (drops never fuse)':v===.5?'ambient default':`${Math.round(v*100)}%`},
  speed:{min:0,max:3,step:.05,default:1,get:()=>speedByPop[0],set:v=>updateParamsFromSensor({speeds:[v]}),label:v=>`×${v.toFixed(2)}`},
  gravity:{min:0,max:2.5,step:.05,default:.8,get:()=>tuning.BUOYANCY_PX,set:v=>{tuning.BUOYANCY_PX=v;},label:v=>v>0?`${v.toFixed(2)} px/frame rise and sink`:'off (no rising or sinking)'}
};
const waxInputs=[...document.querySelectorAll('#wax input[data-param]')];
function showWax(input){const p=WAX[input.dataset.param];input.nextElementSibling.textContent=p.label(p.get());}
for(const input of waxInputs){
  const p=WAX[input.dataset.param];Object.assign(input,{min:p.min,max:p.max,step:p.step});input.value=String(p.get());showWax(input);
  input.addEventListener('input',()=>{p.set(Number(input.value));showWax(input);});
}
document.querySelector('#wax-reset').addEventListener('click',()=>{for(const input of waxInputs){const p=WAX[input.dataset.param];p.set(p.default);input.value=String(p.default);showWax(input);}});
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
// The ambient sketch draws itself (p5); this loop only advances the hold/shake state.
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
    applyMerging(merging*(1-drain.step(dt,{held:interaction.held,intensity:interaction.intensity})));
    if(now-lastMetrics>100){
      const state=interaction.held?`${interaction.state.holdDurationSeconds.toFixed(1)}s held`:interaction.state.phase==='recovering'?'Recovering':'Baseline';
      metrics.textContent=`${state} · intensity ${interaction.intensity.toFixed(2)} · merging ${Math.round(liveMerging*100)}% (slider ${Math.round(merging*100)}%)`;
      lastMetrics=now;
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
