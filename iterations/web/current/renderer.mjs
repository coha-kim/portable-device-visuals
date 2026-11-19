// Jelly soft-body drawing on the native 480 × 480 round canvas: each body is one solid colour (by
// default orange #F47839 on a #CCCCCC background; the Colour slider changes the hue) with a crisp edge and no
// highlight, gradient or blur, drawn straight onto the canvas at full resolution (the canvas's own
// anti-aliasing only). At rest each body is solidly filled; as the user interacts it hollows into an
// outline (see outlineWidth). The full frame is repainted, so nothing accumulates.
export const BACKGROUND='#CCCCCC',FILL='#F47839';
// Colour slider: the hue of the fill, at the saturation and lightness of the default fill, so every
// choice is equally vivid against the background. The default hue gives exactly FILL.
function hsl(hex){
 const [r,g,b]=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255),max=Math.max(r,g,b),min=Math.min(r,g,b),l=(max+min)/2,d=max-min;
 const s=d?d/(1-Math.abs(2*l-1)):0,h=!d?0:max===r?60*((g-b)/d+6)%360:max===g?60*((b-r)/d+2):60*((r-g)/d+4);
 return {h,s,l};
}
const BASE=hsl(FILL);
export const FILL_HUE=BASE.h,FILL_SATURATION=BASE.s,FILL_LIGHTNESS=BASE.l;
export function colourFor(hue){
 const h=((hue%360)+360)%360,l=FILL_LIGHTNESS,c=(1-Math.abs(2*l-1))*FILL_SATURATION,x=c*(1-Math.abs(h/60%2-1)),m=l-c/2;
 const [r,g,b]=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
 return '#'+[r,g,b].map(v=>Math.round((v+m)*255).toString(16).padStart(2,'0')).join('').toUpperCase();
}
export const RENDER_PARAMS=Object.freeze({hue:Object.freeze({min:0,max:360,default:FILL_HUE})});
// Fill to outline: the outline's thickness is inversely proportional to how long the user has been
// interacting (held shaking, ShakeDrain seconds): radius × OUTLINE_SECONDS / (OUTLINE_SECONDS + t).
// At t = 0 that is the full radius, a solid disc; after 1 s half the radius; after 10 s a 1/11 ring
// (about 2 px), never thinner than MIN_OUTLINE. As the drain seeps back after release, it fills in again.
export const OUTLINE_SECONDS=1,MIN_OUTLINE=1.5;
export function outlineWidth(radius,seconds){
 const t=Math.max(0,Number.isFinite(seconds)?seconds:0);
 return Math.max(Math.min(MIN_OUTLINE,radius),radius*OUTLINE_SECONDS/(OUTLINE_SECONDS+t));
}
// Smooth closed outline through the nodes: quadratic curves between edge midpoints. With `inset`, every
// node is first moved that far toward the centre (the hole of an outlined body), appended to the path.
export function tracePath(ctx,nodes,inset=0,centre=null){
 const n=nodes.length,at=p=>{if(!inset)return p;const dx=p.x-centre.x,dy=p.y-centre.y,d=Math.hypot(dx,dy)||1,k=Math.max(0,d-inset)/d;return {x:centre.x+dx*k,y:centre.y+dy*k};};
 const pts=nodes.map(at),last=pts[n-1],first=pts[0];
 if(!inset)ctx.beginPath();
 ctx.moveTo((last.x+first.x)/2,(last.y+first.y)/2);
 for(let i=0;i<n;i++){const p=pts[i],q=pts[(i+1)%n];ctx.quadraticCurveTo(p.x,p.y,(p.x+q.x)/2,(p.y+q.y)/2);}
 ctx.closePath();
}
export class JellyRenderer {
 constructor(canvas){
  this.canvas=canvas;canvas.width=480;canvas.height=480;
  this.ctx=canvas.getContext('2d',{alpha:false});
  this.hue=RENDER_PARAMS.hue.default;
 }
 set(name,value){
  const p=RENDER_PARAMS[name];if(!p||!Number.isFinite(value))return;
  this[name]=Math.max(p.min,Math.min(p.max,value));
 }
 get fill(){return colourFor(this.hue);}
 // interactSeconds: how long the user has been interacting (0 = solid fill). colourOf(body) may give a
 // body its own colour for this frame (a new colour spreading through the population); null keeps the fill.
 draw(bodies,interactSeconds=0,colourOf=null){
  const c=this.ctx;
  c.fillStyle=BACKGROUND;c.fillRect(0,0,480,480);
  c.save();c.beginPath();c.arc(240,240,240,0,Math.PI*2);c.clip();
  const fill=this.fill;
  for(const body of bodies){
   const width=outlineWidth(body.radius,interactSeconds);
   c.fillStyle=colourOf?.(body)??fill;
   tracePath(c,body.nodes);
   if(width<body.radius){tracePath(c,body.nodes,width,body.centroid);c.fill('evenodd');}else c.fill();
  }
  c.restore();
 }
}
