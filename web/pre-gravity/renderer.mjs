// Jelly soft-body drawing on the native 480 × 480 round canvas: each body is one solid colour (by
// default the ambient owner teal #00E2B7; the Colour slider changes the hue) with a crisp edge and no
// highlight, outline, gradient or blur, drawn straight onto the canvas at full resolution (the canvas's
// own anti-aliasing only). A translucency setting fades the bodies. The full frame is repainted, so
// nothing accumulates.
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
// Smooth closed outline through the nodes: quadratic curves between edge midpoints.
export function tracePath(ctx,nodes){
 const n=nodes.length,last=nodes[n-1],first=nodes[0];
 ctx.beginPath();ctx.moveTo((last.x+first.x)/2,(last.y+first.y)/2);
 for(let i=0;i<n;i++){const p=nodes[i],q=nodes[(i+1)%n];ctx.quadraticCurveTo(p.x,p.y,(p.x+q.x)/2,(p.y+q.y)/2);}
 ctx.closePath();
}
export class JellyRenderer {
 constructor(canvas){
  this.canvas=canvas;canvas.width=480;canvas.height=480;
  this.ctx=canvas.getContext('2d',{alpha:false});
  this.translucency=RENDER_PARAMS.translucency.default;this.hue=RENDER_PARAMS.hue.default;
 }
 set(name,value){
  const p=RENDER_PARAMS[name];if(!p||!Number.isFinite(value))return;
  this[name]=Math.max(p.min,Math.min(p.max,value));
 }
 get fill(){return colourFor(this.hue);}
 draw(bodies){
  const c=this.ctx;
  c.globalAlpha=1;c.fillStyle=BACKGROUND;c.fillRect(0,0,480,480);
  c.save();c.beginPath();c.arc(240,240,240,0,Math.PI*2);c.clip();
  c.fillStyle=this.fill;c.globalAlpha=1-this.translucency;
  for(const body of bodies){tracePath(c,body.nodes);c.fill();}
  c.restore();c.globalAlpha=1;
 }
}
