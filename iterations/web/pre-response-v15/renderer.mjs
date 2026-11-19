// Independent snow-globe particles. Opaque background repaint prevents trails and opacity buildup.
export const BACKGROUND='#594F47',PARTICLE_COLOR='#97D3B2';
export class ParticleRenderer {
 constructor(canvas){this.canvas=canvas;canvas.width=480;canvas.height=480;this.ctx=canvas.getContext('2d',{alpha:false});}
 draw(particles,opacity=1){
  const c=this.ctx;c.globalAlpha=1;c.fillStyle=BACKGROUND;c.fillRect(0,0,480,480);
  c.save();c.beginPath();c.arc(240,240,240,0,Math.PI*2);c.clip();
  for(const p of particles){
   c.globalAlpha=opacity*p.alpha;c.fillStyle=PARTICLE_COLOR;
   c.beginPath();c.arc(p.x,p.y,p.radius,0,Math.PI*2);c.fill();
   c.globalAlpha=opacity*p.alpha*.3;c.fillStyle='#DCEFE5';
   c.beginPath();c.arc(p.x-p.radius*.2,p.y-p.radius*.22,p.radius*.42,0,Math.PI*2);c.fill();
  }
  c.restore();c.globalAlpha=1;
 }
}
