// Independent Canvas paths. Shapes never share fields or generate connecting necks.
export const BACKGROUND='#594F47';
export const BLOB_COLOR='#97D3B2';
export class BlobRenderer {
  constructor(canvas){this.canvas=canvas;canvas.width=480;canvas.height=480;this.ctx=canvas.getContext('2d',{alpha:false});}
  draw(blobs,opacity){
    const ctx=this.ctx;ctx.globalAlpha=1;ctx.fillStyle=BACKGROUND;ctx.fillRect(0,0,480,480);
    ctx.save();ctx.beginPath();ctx.arc(240,240,240,0,Math.PI*2);ctx.clip();
    for(const b of blobs){
      const squash=b.squash,along=1-squash,across=1/along;
      ctx.save();ctx.translate(b.body.position.x,b.body.position.y);ctx.rotate(b.axis);ctx.scale(along,across);
      ctx.globalAlpha=opacity;
      const gradient=ctx.createRadialGradient(-b.radius*.12,-b.radius*.14,0,0,0,b.radius);
      gradient.addColorStop(0,'#DCEFE5');gradient.addColorStop(.38,'#BFE3CE');gradient.addColorStop(1,BLOB_COLOR);
      ctx.fillStyle=gradient;ctx.beginPath();ctx.arc(0,0,b.radius-1.1,0,Math.PI*2);ctx.fill();
      // A small background-coloured seam preserves each silhouette at contact.
      ctx.strokeStyle=BACKGROUND;ctx.lineWidth=1.2;ctx.stroke();ctx.restore();
    }
    ctx.restore();
  }
}
