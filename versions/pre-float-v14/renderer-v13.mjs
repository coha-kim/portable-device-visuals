// v13: smooth the actual simulated membrane. No ellipse scaling or shape tween.
export const BACKGROUND='#594F47',BLOB_COLOR='#97D3B2';
export class BlobRenderer {
 constructor(canvas){this.canvas=canvas;canvas.width=480;canvas.height=480;this.ctx=canvas.getContext('2d',{alpha:false});}
 draw(blobs,opacity){
  const c=this.ctx;c.globalAlpha=1;c.fillStyle=BACKGROUND;c.fillRect(0,0,480,480);
  c.save();c.beginPath();c.arc(240,240,240,0,Math.PI*2);c.clip();
  for(const b of blobs){
   const p=b.nodes,n=p.length,last=p[n-1];c.beginPath();c.moveTo((last.x+p[0].x)/2,(last.y+p[0].y)/2);
   for(let i=0;i<n;i++){const a=p[i],next=p[(i+1)%n];c.quadraticCurveTo(a.x,a.y,(a.x+next.x)/2,(a.y+next.y)/2);}c.closePath();
   const gradient=c.createRadialGradient(b.x-6,b.y-7,0,b.x,b.y,b.radius*1.15);
   gradient.addColorStop(0,'#DCEFE5');gradient.addColorStop(.38,'#BFE3CE');gradient.addColorStop(1,BLOB_COLOR);
   c.globalAlpha=opacity;c.fillStyle=gradient;c.fill();c.strokeStyle=BACKGROUND;c.lineWidth=1.2;c.stroke();
  }
  c.restore();
 }
}
