// Jelly soft-body drawing on the native 480 × 480 round canvas: each body is one solid colour (by
// default the ambient owner teal #00E2B7; the Colour slider changes the hue) with no highlight,
// outline or gradient, and a blurry, translucent border.
// The soft border is cheap enough for an ESP32 port: the outline is cut into thin bands running from
// EDGE px outside to EDGE px inside; each band is an annulus (even-odd fill) with its own alpha on a
// smoothstep ramp, so the edge fades in evenly and no band is painted twice. The whole scene is drawn
// into a half-resolution buffer and smoothed up to 480 × 480, which blends the band steps.
// Sticky slime strands between bodies (and to the glass) are drawn as round-capped strokes that
// thin as they stretch, with the same soft edge, behind the bodies so they read as necks of goo.
// A translucency setting fades the bodies. The full frame is repainted, so nothing accumulates.
export const BACKGROUND='#594F47',FILL='#00E2B7';
// Colour slider: the hue of the fill, at the saturation and lightness of the default teal (100%, 44%),
// so every choice is equally vivid against the background. The default hue gives exactly FILL.
export const FILL_HUE=120+60*0xB7/0xE2,FILL_LIGHTNESS=0xE2/2/255;
export function colourFor(hue){
 const h=((hue%360)+360)%360,l=FILL_LIGHTNESS,c=1-Math.abs(2*l-1),x=c*(1-Math.abs(h/60%2-1)),m=l-c/2;
 const [r,g,b]=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
 return '#'+[r,g,b].map(v=>Math.round((v+m)*255).toString(16).padStart(2,'0')).join('').toUpperCase();
}
// Translucency slider: 0 = opaque jelly; higher lets the background and overlapping bodies show through.
export const RENDER_PARAMS=Object.freeze({translucency:Object.freeze({min:0,max:.9,default:0}),hue:Object.freeze({min:0,max:360,default:FILL_HUE})});
// Soft border: half-width in display px (capped at a quarter of the body radius) and band count.
export const EDGE=9,BANDS=8;
// Strands: width in display px when unstretched, and soft-edge strokes [extra width, alpha], outermost first.
export const STRAND_WIDTH=9,STRAND_EDGE=Object.freeze([[6,.2],[3,.5],[0,1]]);  // sized for the smaller bodies
// Alpha of each band, outermost first: smoothstep from transparent to solid.
export const EDGE_PROFILE=Object.freeze(Array.from({length:BANDS},(_,i)=>{const t=(i+.5)/BANDS;return t*t*(3-2*t);}));
export function tracePath(ctx,nodes,cx=0,cy=0,grow=0,scale=1,append=false){
 const n=nodes.length,point=p=>{
  if(!grow)return [p.x*scale,p.y*scale];
  const dx=p.x-cx,dy=p.y-cy,d=Math.hypot(dx,dy)||1;return [(p.x+dx/d*grow)*scale,(p.y+dy/d*grow)*scale];
 };
 const pts=nodes.map(point),[lx,ly]=pts[n-1],[fx,fy]=pts[0];
 if(!append)ctx.beginPath();
 ctx.moveTo((lx+fx)/2,(ly+fy)/2);
 for(let i=0;i<n;i++){const [px,py]=pts[i],[qx,qy]=pts[(i+1)%n];ctx.quadraticCurveTo(px,py,(px+qx)/2,(py+qy)/2);}
 ctx.closePath();
}
const clamp01=x=>Math.max(0,Math.min(1,x));
const defaultBuffer=()=>typeof document==='undefined'?null:document.createElement('canvas');
export class JellyRenderer {
 constructor(canvas,{scale=.5,createBuffer=defaultBuffer}={}){
  this.canvas=canvas;canvas.width=480;canvas.height=480;
  this.ctx=canvas.getContext('2d',{alpha:false});
  this.translucency=RENDER_PARAMS.translucency.default;this.hue=RENDER_PARAMS.hue.default;
  // Without a buffer (e.g. tests), draw straight onto the display canvas at full resolution.
  const buffer=createBuffer();
  if(buffer){
   this.scale=scale;buffer.width=buffer.height=Math.round(480*scale);
   this.buffer=buffer;this.target=buffer.getContext('2d',{alpha:false});
   this.ctx.imageSmoothingEnabled=true;this.ctx.imageSmoothingQuality='high';
  }else{this.scale=1;this.buffer=null;this.target=this.ctx;}
 }
 set(name,value){
  const p=RENDER_PARAMS[name];if(!p||!Number.isFinite(value))return;
  this[name]=Math.max(p.min,Math.min(p.max,value));
 }
 get fill(){return colourFor(this.hue);}
 draw(bodies,strands=[]){
  const c=this.target,s=this.scale,size=480*s,opacity=1-this.translucency;
  c.globalAlpha=1;c.fillStyle=BACKGROUND;c.fillRect(0,0,size,size);
  c.save();c.beginPath();c.arc(size/2,size/2,size/2,0,Math.PI*2);c.clip();
  const fill=this.fill;c.fillStyle=fill;c.strokeStyle=fill;c.lineCap='round';
  for(const t of strands){
   const thin=Math.pow(clamp01(1-(t.stretch||0)/(t.reach||1)),.7),w=Math.max(1.5,STRAND_WIDTH*thin);
   for(const [extra,alpha] of STRAND_EDGE){
    c.beginPath();c.moveTo(t.a.x*s,t.a.y*s);c.lineTo(t.b.x*s,t.b.y*s);
    c.lineWidth=(w+extra*thin)*s;c.globalAlpha=alpha*opacity;c.stroke();
   }
  }
  for(const body of bodies){
   const {x,y}=body.centroid,edge=Math.min(EDGE,body.radius*.25),step=2*edge/BANDS;
   for(let i=0;i<BANDS;i++){
    const outer=edge-i*step;
    tracePath(c,body.nodes,x,y,outer,s);tracePath(c,body.nodes,x,y,outer-step,s,true);
    c.globalAlpha=EDGE_PROFILE[i]*opacity;c.fill('evenodd');
   }
   tracePath(c,body.nodes,x,y,-edge,s);c.globalAlpha=opacity;c.fill();
  }
  c.restore();c.globalAlpha=1;
  if(this.buffer)this.ctx.drawImage(this.buffer,0,0,480,480);
 }
}
