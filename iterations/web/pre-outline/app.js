import { PalmInteraction, VectorMotionReader } from './interaction-v15.mjs?softbody-20';
import { SoftBodyWorld, ShakeDrain, PARAMS, BODY_RADIUS, GRAVITY_DEAD_ZONE, valueFor } from './softbody.mjs?softbody-20';
import { JellyRenderer, RENDER_PARAMS } from './renderer.mjs?softbody-20';
import { HarveyLink } from './harvey-link-v1.mjs?softbody-20';
import { NearDetector } from './proximity.mjs?softbody-20';
import { GravityInput, G } from './gravity.mjs?softbody-20';
const interaction=new PalmInteraction(), reader=new VectorMotionReader();
const renderer=new JellyRenderer(document.querySelector('#scene'));
const physics=new SoftBodyWorld(),drain=new ShakeDrain();
// Live tuning sliders (0–1 positions). Physics parameters go to the world; translucency and colour to the renderer.
const tuning=[...document.querySelectorAll('#tuning input[data-param]')];
const ranges={...PARAMS,...RENDER_PARAMS};
const targetFor=name=>name in RENDER_PARAMS?renderer:physics;
const label={stiffness:v=>`${Math.round(v)} /s²`,damping:v=>`${v.toFixed(1)} /s`,size:v=>`${Math.round(BODY_RADIUS*v)} px radius`,count:v=>`${v}`,
  gravity:v=>v>0?`${Math.round(v)} px/s² per g`:'off',maxSpeed:v=>`${Math.round(v)} px/s`,
  drag:v=>v>0?`${v.toFixed(2)} /s`:'off',attraction:v=>v>0?`${Math.round(v)} px/s²`:'off',repulsion:v=>v>0?`${Math.round(v)} px/s²`:'off',
  elasticity:v=>`${v.toFixed(2)}`,friction:v=>v>0?`${v.toFixed(1)} /s`:'off',wobble:v=>`${Math.round(v*100)}%`,
  translucency:v=>v>0?`${Math.round(v*100)}% see-through`:'opaque',hue:()=>`■ ${renderer.fill}`};
function applyTuning(input){
  const name=input.dataset.param,target=targetFor(name);
  target.set(name,name in PARAMS?valueFor(name,Number(input.value)):ranges[name].min+(ranges[name].max-ranges[name].min)*Number(input.value));
  const output=input.nextElementSibling;output.textContent=label[name](target[name]);
  if(name==='hue')output.style.color=renderer.fill;
}
function resetTuning(){for(const input of tuning){const p=ranges[input.dataset.param];input.value=String((p.default-p.min)/(p.max-p.min));applyTuning(input);}}
for(const input of tuning)input.addEventListener('input',()=>applyTuning(input));
document.querySelector('#tuning-reset').addEventListener('click',resetTuning);
resetTuning();
// Real-size preview: the panel's 480 px span 53.28 mm. Browsers don't know a screen's physical size
// (CSS mm assume 96 px/inch, a MacBook shows about 127), so the scale is calibrated once per screen
// against a bank card and remembered in this browser.
const DISPLAY_MM=53.28,CARD_MM=[85.6,53.98],CSS_PX_PER_MM=96/25.4;
const realToggle=document.querySelector('#real-size-toggle'),calibration=document.querySelector('#calibration');
const pxPerMm=document.querySelector('#px-per-mm'),realInfo=document.querySelector('#real-size-info');
const remember=(key,value)=>{try{if(value===undefined)return localStorage.getItem(key);localStorage.setItem(key,value);}catch{return null;}};
pxPerMm.value=Number(remember('harvey-px-per-mm'))||CSS_PX_PER_MM;realToggle.checked=remember('harvey-real-size')==='1';
function applySize(){
  const scale=Number(pxPerMm.value),root=document.documentElement.style,on=realToggle.checked;
  root.setProperty('--display-size',on?`${(DISPLAY_MM*scale).toFixed(2)}px`:'480px');
  root.setProperty('--card-width',`${(CARD_MM[0]*scale).toFixed(2)}px`);root.setProperty('--card-height',`${(CARD_MM[1]*scale).toFixed(2)}px`);
  pxPerMm.nextElementSibling.textContent=`${scale.toFixed(3)} px/mm (${Math.round(scale*25.4)} px/inch)`;
  realInfo.textContent=on?`shown ${(DISPLAY_MM*scale).toFixed(0)} px across`:'shown 480 px across (1 canvas pixel per CSS pixel)';
  calibration.hidden=!on;remember('harvey-px-per-mm',String(scale));remember('harvey-real-size',on?'1':'0');
}
realToggle.addEventListener('change',applySize);pxPerMm.addEventListener('input',applySize);applySize();
const hold=document.querySelector('#hold'),simulate=document.querySelector('#simulate');
const strength=document.querySelector('#shake-strength'),metrics=document.querySelector('#metrics');
const welcome=document.querySelector('#welcome'),status=document.querySelector('#status');
const motionStatus=document.querySelector('#motion-status');
let source=null,pointer=null,drag=null,last=performance.now(),simulationTime=0,listening=false,sensorSeen=false,watchdog;
let lastMetrics=-Infinity;
const link=new HarveyLink({role:'portable',onSnapshot(message){interaction.adopt(message.states[link.population],message.serverNow);},
  onStatus(value){document.documentElement.dataset.harveyConnection=value;if(['disconnected','population-busy'].includes(value))release();}});
setInterval(()=>{if(interaction.held)link.send('intensity',interaction.intensity);},100);
// Colour transfer: tapping the portable near the ambient display sends the chosen blob colour, which
// becomes this population's colour there. In the browser the Tap button stands in for the proximity
// sensing; on the device, NearDetector.reading(rssi, seconds) fires the same onNear from the Pi's
// Bluetooth beacon strength (see proximity.mjs and docs/colour-tap.md).
const tapStatus=document.querySelector('#tap-status');
function sendColourToAmbient(){
  const colour=renderer.fill,sent=link.sendColour(colour);
  tapStatus.textContent=sent?`Sent ${colour} to the ambient display.`
    :`Not paired, so ${colour} was not sent. Open the portable from the bridge links (npm run bridge) to send it.`;
}
const near=new NearDetector({onNear:sendColourToAmbient});
window.harveyProximity={near,sendColourToAmbient};
document.querySelector('#tap-ambient').addEventListener('click',sendColourToAmbient);
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
// Device gravity: the only thing that moves the blobs. The accelerometer reading covers tilting and
// moving the device; on a laptop the Tilt sliders stand in for it (see gravity.mjs).
const gravity=new GravityInput();
const tiltRight=document.querySelector('#tilt-right'),tiltToward=document.querySelector('#tilt-toward'),tiltOutput=document.querySelector('#tilt-output');
function applyTilt(){gravity.setTilt(Number(tiltRight.value),Number(tiltToward.value));}
for(const input of [tiltRight,tiltToward])input.addEventListener('input',applyTilt);
document.querySelector('#tilt-level').addEventListener('click',()=>{tiltRight.value='0';tiltToward.value='0';applyTilt();});
function onMotion(event){
  const now=performance.now(),vector=reader.read(event,now,screenAngle()),omega=reader.rotation(event);
  if(gravity.reading(event.accelerationIncludingGravity,screenAngle(),now))sensorSeen=true;
  if(!vector&&omega===null)return;sensorSeen=true;clearTimeout(watchdog);
  motionStatus.textContent='Motion connected. Tilt or move the device to move the blobs; hold while shaking to lower elasticity.';
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
    simulationTime+=dt;let shakePush={x:0,y:0};
    if(source==='simulate'){
      const amplitude=Number(strength.value)*22,sx=Math.sin(simulationTime*19)*amplitude,sy=Math.cos(simulationTime*14)*amplitude*.8;
      interaction.sampleVector(sx,sy,0,now);
      interaction.sampleRotation(0,now);
      // The simulated shake moves the device, so the contents feel the opposite acceleration.
      shakePush={x:-sx/G,y:-sy/G};
    }
    const g=gravity.step(dt,now,shakePush);physics.setGravity(g.x,g.y);
    interaction.step(dt,now);
    // Shaking lowers elasticity (and top speed) in proportion to how long it lasts; it seeps back after release.
    physics.setDrain(drain.step(dt,{held:interaction.held,intensity:interaction.intensity}));
    physics.advance(dt);
    renderer.draw(physics.bodies);
    if(now-lastMetrics>100){
      metrics.textContent=`${interaction.held?`${interaction.state.holdDurationSeconds.toFixed(1)}s held`:interaction.state.phase==='recovering'?'Recovering':'Baseline'} · ${physics.count} soft bod${physics.count===1?'y':'ies'} · elasticity ${physics.liveElasticity.toFixed(2)} (slider ${physics.elasticity.toFixed(2)}) · movement ${Math.round(physics.movement*100)}%`;
      tiltOutput.textContent=`gravity ${Math.hypot(g.x,g.y).toFixed(2)} g from ${gravity.usingSensor?'the motion sensor':'the tilt sliders'}${Math.hypot(g.x,g.y)<=GRAVITY_DEAD_ZONE?' (level: blobs settle)':''}`;
      lastMetrics=now;
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
