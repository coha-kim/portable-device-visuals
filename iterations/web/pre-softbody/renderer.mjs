// Ambient sketch's shared scalar field, ported to the round display. Kernel (1 - d²)² inside each
// orb's radius, iso 0.20 with a ±0.10 smoothstep edge. Centres lighten with field depth; here they
// lighten toward #CFE0BD instead of white, and the whole palette dulls toward #729B82.
// The ambient wall mirror is omitted: orbs are always kept fully inside the glass, so a mirrored
// field could never reach a visible pixel.
// The field runs at 240 × 240 and is upscaled (ambient uses native resolution on a Pi; this keeps
// the per-frame cost inside an ESP32-S3 budget). Every pixel is rewritten, so nothing accumulates.
export const BACKGROUND=Object.freeze([89,79,71]);      // #594F47
export const RIM=Object.freeze([151,211,178]);          // #97D3B2
export const CORE=Object.freeze([207,224,189]);         // #CFE0BD
export const DULL=Object.freeze([114,155,130]);         // #729B82
export const FIELD_ISO=.20,FIELD_EDGE=.10;
const CENTER_DEPTH=1.2;  // ambient: centre reaches full lightening (0.66) at field - iso ≈ 1.2
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
export function palette(dullness=0){
 const t=Math.max(0,Math.min(1,dullness));
 return {rim:mix(RIM,DULL,t),core:mix(CORE,DULL,t)};
}
function splat(field,size,x,y,r){
 const r2=r*r,left=Math.max(0,Math.floor(x-r)),right=Math.min(size-1,Math.ceil(x+r));
 const top=Math.max(0,Math.floor(y-r)),bottom=Math.min(size-1,Math.ceil(y+r));
 for(let py=top;py<=bottom;py++){
  const dy2=(py+.5-y)**2;
  for(let px=left;px<=right;px++){
   const d2=((px+.5-x)**2+dy2)/r2;
   if(d2>=1)continue;
   const u=1-d2;field[py*size+px]+=u*u;
  }
 }
}
// blobs: [{x,y,r}] in field pixels on a square field of `size` with the display circle inscribed.
export function paintPixels(size,blobs,dullness,field,pixels,background=BACKGROUND){
 field.fill(0);
 for(const b of blobs)splat(field,size,b.x,b.y,b.r);
 const {rim,core}=palette(dullness),bg=background;
 const dr=core[0]-rim[0],dg=core[1]-rim[1],db=core[2]-rim[2],low=FIELD_ISO-FIELD_EDGE;
 for(let i=0;i<field.length;i++){
  const f=field[i],p=i*4;
  pixels[p+3]=255;
  if(f<=low){pixels[p]=bg[0];pixels[p+1]=bg[1];pixels[p+2]=bg[2];continue;}
  const e=Math.min(1,(f-low)/(FIELD_EDGE*2)),alpha=e*e*(3-2*e);
  const k=Math.max(0,Math.min(1,(f-FIELD_ISO)/CENTER_DEPTH));
  pixels[p]=bg[0]+(rim[0]+dr*k-bg[0])*alpha;
  pixels[p+1]=bg[1]+(rim[1]+dg*k-bg[1])*alpha;
  pixels[p+2]=bg[2]+(rim[2]+db*k-bg[2])*alpha;
 }
}
export class MetaballRenderer {
 constructor(canvas,{scale=.5}={}){
  this.canvas=canvas;canvas.width=480;canvas.height=480;
  this.context=canvas.getContext('2d',{alpha:false});
  this.size=Math.round(480*scale);this.scale=this.size/480;
  this.buffer=document.createElement('canvas');this.buffer.width=this.buffer.height=this.size;
  this.bufferContext=this.buffer.getContext('2d',{alpha:false});
  this.field=new Float32Array(this.size*this.size);
  this.image=this.bufferContext.createImageData(this.size,this.size);
  this.points=[];
  this.context.imageSmoothingEnabled=true;this.context.imageSmoothingQuality='high';
 }
 draw(blobs,dullness=0){
  const s=this.scale;
  while(this.points.length<blobs.length)this.points.push({x:0,y:0,r:0});
  this.points.length=blobs.length;
  for(let i=0;i<blobs.length;i++){const p=this.points[i],b=blobs[i];p.x=b.x*s;p.y=b.y*s;p.r=b.r*s;}
  paintPixels(this.size,this.points,dullness,this.field,this.image.data);
  this.bufferContext.putImageData(this.image,0,0);
  this.context.drawImage(this.buffer,0,0,480,480);
 }
}
