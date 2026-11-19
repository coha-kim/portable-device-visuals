// v9 compact-support metaball field, updated in place for the split/merge blobs.
// Field runs at half resolution (240 × 240 = 57,600 px) and is upscaled: ~4× cheaper than native,
// the same budget an ESP32-S3 firmware port would use. One float buffer, no sqrt per pixel; every
// output pixel is rewritten each frame, so nothing accumulates. Shading follows field depth, so
// fused wax reads as one smooth body with a lighter, thicker core rather than separate cells.
export const BACKGROUND=Object.freeze([89,79,71]);      // #594F47
export const RIM=Object.freeze([151,211,178]);          // #97D3B2
export const CORE=Object.freeze([207,224,189]);         // #CFE0BD
export const DULL=Object.freeze([114,155,130]);         // #729B82
// A lone blob crosses this threshold at its nominal radius: (1 - 1/4)^3.
const THRESHOLD=.421875,FEATHER=.065,DEPTH=1.8;
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
export function palette(dullness=0){
 const t=Math.max(0,Math.min(1,dullness));
 return {rim:mix(RIM,DULL,t),core:mix(CORE,DULL,t)};
}
export function paintPixels(width,height,blobs,dullness,field,pixels,background=BACKGROUND){
 field.fill(0);
 for(const b of blobs){
  const r2=b.r*b.r,support=b.r*2;
  const left=Math.max(0,Math.floor(b.x-support)),right=Math.min(width-1,Math.ceil(b.x+support));
  const top=Math.max(0,Math.floor(b.y-support)),bottom=Math.min(height-1,Math.ceil(b.y+support));
  for(let y=top;y<=bottom;y++){
   const dy2=(y+.5-b.y)**2;
   for(let x=left;x<=right;x++){
    const d2=((x+.5-b.x)**2+dy2)/r2;
    if(d2>=4)continue;
    const u=1-d2*.25;
    field[y*width+x]+=u*u*u;
   }
  }
 }
 const {rim,core}=palette(dullness),bg=background;
 const dr=core[0]-rim[0],dg=core[1]-rim[1],db=core[2]-rim[2];
 for(let i=0;i<field.length;i++){
  const f=field[i],p=i*4;
  if(f<THRESHOLD-FEATHER*.5){pixels[p]=bg[0];pixels[p+1]=bg[1];pixels[p+2]=bg[2];pixels[p+3]=255;continue;}
  const s=Math.min(1,(f-THRESHOLD)/FEATHER+.5),alpha=s*s*(3-2*s);
  const k=Math.min(1,(f-THRESHOLD)/DEPTH),c=k*(2-k);
  pixels[p]=bg[0]+(rim[0]+dr*c-bg[0])*alpha;
  pixels[p+1]=bg[1]+(rim[1]+dg*c-bg[1])*alpha;
  pixels[p+2]=bg[2]+(rim[2]+db*c-bg[2])*alpha;
  pixels[p+3]=255;
 }
}
export class MetaballRenderer {
 constructor(canvas,{scale=.5}={}){
  this.canvas=canvas;canvas.width=480;canvas.height=480;
  this.context=canvas.getContext('2d',{alpha:false});
  this.buffer=document.createElement('canvas');
  this.buffer.width=this.buffer.height=Math.round(480*scale);this.scale=this.buffer.width/480;
  this.bufferContext=this.buffer.getContext('2d',{alpha:false});
  const count=this.buffer.width*this.buffer.height;
  this.field=new Float32Array(count);
  this.image=this.bufferContext.createImageData(this.buffer.width,this.buffer.height);
  this.points=[];
  this.context.imageSmoothingEnabled=true;this.context.imageSmoothingQuality='high';
 }
 draw(blobs,dullness=0){
  const s=this.scale;
  while(this.points.length<blobs.length)this.points.push({x:0,y:0,r:0});
  this.points.length=blobs.length;
  for(let i=0;i<blobs.length;i++){const p=this.points[i],b=blobs[i];p.x=b.x*s;p.y=b.y*s;p.r=b.r*s;}
  paintPixels(this.buffer.width,this.buffer.height,this.points,dullness,this.field,this.image.data);
  this.bufferContext.putImageData(this.image,0,0);
  this.context.drawImage(this.buffer,0,0,480,480);
 }
}
