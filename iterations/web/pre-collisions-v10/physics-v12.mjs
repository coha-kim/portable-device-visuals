// v12: directional gravity and a direct inverse-distance pointer attractor.
// No seeded drift, propulsion, curl, centrifugal force or neighbour-velocity field.
import { PalmPhysics as CollisionPhysics } from './physics-v10.mjs';
export const BASE_RESTITUTION=.28;
export const GRAVITY=120; // canvas pixels / second squared
export class PalmPhysics extends CollisionPhysics {
  constructor(options={}) {
    super(options);
    const {Body}=this.Matter;
    const positions=[[126,145],[240,145],[354,145],[69,244],[183,244],[297,244],[411,244],[240,343]];
    const random=options.random??Math.random;
    this.gravity={x:0,y:GRAVITY};this.attractor={active:false,x:240,y:240};
    this.engine.enableSleeping=true;this.engine.gravity.scale=1e-6;
    this.blobs.forEach((b,i)=>{
      const [x,y]=positions[i%positions.length];
      Body.setPosition(b.body,{x:x+(random()-.5)*4,y:y+(random()-.5)*4});
      Body.setVelocity(b.body,{x:0,y:0});b.body.frictionAir=.008;b.body.sleepThreshold=80;
    });
  }
  setAttractor(x,y,active=true) {
    if(!active){this.attractor.active=false;return;}
    if(![x,y].every(Number.isFinite))return;
    const dx=x-240,dy=y-240,d=Math.hypot(dx,dy),scale=d>238?238/d:1;
    this.attractor={x:240+dx*scale,y:240+dy*scale,active:true};
  }
  step(input={}) {
    const {Body,Engine,Sleeping}=this.Matter;this.time+=1/60;
    const finite=(value,limit)=>Number.isFinite(value)?Math.max(-limit,Math.min(limit,value)):0;
    const ax=finite(input.x,35),ay=finite(input.y,35),omega=finite(input.omega,4);
    const previous={...this.gravity};
    // Rotation changes the direction of gravity in the device frame. It never
    // injects a perpetual tangential or centrifugal force into the particles.
    const angle=-omega/60,c=Math.cos(angle),s=Math.sin(angle);
    this.gravity={x:previous.x*c-previous.y*s,y:previous.x*s+previous.y*c};
    if(input.hasTilt){
      const blend=1-Math.exp(-1/60/.14);
      this.gravity.x+=(finite(input.tiltX,9.81)*GRAVITY/9.81-this.gravity.x)*blend;
      this.gravity.y+=(finite(input.tiltY,9.81)*GRAVITY/9.81-this.gravity.y)*blend;
    }else if(Math.abs(omega)<.001){
      const blend=1-Math.exp(-1/60/.25);
      this.gravity.x+=(0-this.gravity.x)*blend;this.gravity.y+=(GRAVITY-this.gravity.y)*blend;
    }
    const changed=Math.hypot(this.gravity.x-previous.x,this.gravity.y-previous.y)>.1;
    this.engine.gravity.x=this.gravity.x;this.engine.gravity.y=this.gravity.y;
    for(const b of this.blobs){
      const body=b.body;
      body.restitution=BASE_RESTITUTION+(0.88-BASE_RESTITUTION)*this.controls.repulsion;
      let fx=-ax*45,fy=-ay*45;
      if(this.attractor.active){
        const dx=this.attractor.x-body.position.x,dy=this.attractor.y-body.position.y;
        // Softened inverse-distance magnitude: direct pull, finite near target.
        const denominator=dx*dx+dy*dy+64*64;
        fx+=32000*dx/denominator-body.velocity.x*60*.7;
        fy+=32000*dy/denominator-body.velocity.y*60*.7;
      }
      if(changed||Math.hypot(fx,fy)>.01)Sleeping.set(body,false);
      if(fx||fy)Body.applyForce(body,body.position,{x:body.mass*fx/1e6,y:body.mass*fy/1e6});
      b.beforeVelocity={...body.velocity};
    }
    Engine.update(this.engine,1000/60);
    for(const b of this.blobs){
      const body=b.body,speed=Math.hypot(body.velocity.x,body.velocity.y);
      if(speed>7)Body.setVelocity(body,{x:body.velocity.x*7/speed,y:body.velocity.y*7/speed});
      const dx=body.position.x-240,dy=body.position.y-240,d=Math.hypot(dx,dy),limit=240-b.radius;
      if(d>limit){
        const nx=dx/d,ny=dy/d;Body.setPosition(body,{x:240+nx*limit,y:240+ny*limit});
        const normal=body.velocity.x*nx+body.velocity.y*ny;
        if(normal>0){const v={...body.velocity};Body.setVelocity(body,{x:v.x-(1+body.restitution)*normal*nx,y:v.y-(1+body.restitution)*normal*ny});
          const amount=this.controls.deformation*Math.min(1,normal/4)*.34;
          if(amount>0){b.axis=Math.atan2(ny,nx);b.squashVelocity=Math.min(5,b.squashVelocity+amount*18);}
        }
      }
      b.squashVelocity+=(-160*b.squash-13*b.squashVelocity)/60;
      b.squash=Math.max(-.20,Math.min(.32,b.squash+b.squashVelocity/60));
      this.stats.maxSquash=Math.max(this.stats.maxSquash,Math.abs(b.squash));
    }
  }
}
