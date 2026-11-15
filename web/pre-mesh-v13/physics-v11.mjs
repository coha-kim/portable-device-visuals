// v11: fluid-inspired particle inertia for separate blobs (not an APIC solver).
// Low drag, contact momentum exchange, tilt gravity and rotating-frame forces.
export const BASE_RESTITUTION = 0.28;
export class PalmPhysics {
  constructor({Matter=globalThis.Matter, random=Math.random, count=8}={}) {
    if (!Matter) throw new Error('Matter.js must load before the palm simulation.');
    this.Matter=Matter; this.time=0; this.omega=0; this.accumulator=0; this.controls={repulsion:0,deformation:0};
    this.engine=Matter.Engine.create({positionIterations:10,velocityIterations:8});
    this.engine.gravity.scale=0;
    this.stats={blobCollisions:0,wallCollisions:0,maxSquash:0};
    this.blobs=Array.from({length:count},(_,i)=>{
      const angle=(i-1)*Math.PI*2/Math.max(1,count-1), reach=i===0?0:156;
      const body=Matter.Bodies.circle(240+Math.cos(angle)*reach,240+Math.sin(angle)*reach,51,
        {label:'blob',friction:0,frictionStatic:0,frictionAir:.001,restitution:0,slop:.01});
      Matter.Body.setInertia(body,Infinity);
      const heading=random()*Math.PI*2, speed=1.0+random()*.6;
      Matter.Body.setVelocity(body,{x:Math.cos(heading)*speed,y:Math.sin(heading)*speed});
      return {body,radius:51,phase:random()*100,squash:0,squashVelocity:0,axis:0,lastHeading:heading,beforeVelocity:{x:0,y:0}};
    });
    this.byId=new Map(this.blobs.map(b=>[b.body.id,b]));
    const wallCount=96, thickness=36, reach=240+thickness/2;
    const walls=Array.from({length:wallCount},(_,i)=>{
      const angle=i*Math.PI*2/wallCount;
      return Matter.Bodies.rectangle(240+Math.cos(angle)*reach,240+Math.sin(angle)*reach,
        2*reach*Math.tan(Math.PI/wallCount)+2,thickness,
        {label:'wall',isStatic:true,angle:angle+Math.PI/2,friction:0,frictionStatic:0,restitution:0,slop:.01});
    });
    Matter.Composite.add(this.engine.world,[...this.blobs.map(b=>b.body),...walls]);
    Matter.Events.on(this.engine,'collisionStart',event=>this.onCollision(event));
  }
  onCollision(event) {
    for(const pair of event.pairs) {
      const a=this.byId.get(pair.bodyA.id),b=this.byId.get(pair.bodyB.id);
      if(!a&&!b)continue;
      if(a&&b)this.stats.blobCollisions++;else this.stats.wallCollisions++;
      const av=a?.beforeVelocity??{x:0,y:0},bv=b?.beforeVelocity??{x:0,y:0},n=pair.collision.normal;
      const speed=Math.abs((av.x-bv.x)*n.x+(av.y-bv.y)*n.y);
      const amount=this.controls.deformation*Math.min(1,speed/4)*.34;
      if(amount<=0)continue;
      for(const blob of [a,b])if(blob){blob.axis=Math.atan2(n.y,n.x);blob.squashVelocity=Math.min(5,blob.squashVelocity+amount*18);}
    }
  }
  advance(dt,controls={repulsion:0,deformation:0},acceleration={x:0,y:0}) {
    this.controls={repulsion:Math.max(0,Math.min(1,controls.repulsion||0)),deformation:Math.max(0,Math.min(1,controls.deformation||0))};
    this.accumulator+=Math.max(0,Math.min(.1,dt));
    while(this.accumulator+1e-10>=1/60){this.step(acceleration);this.accumulator-=1/60;}
  }
  step(acceleration) {
    const {Body,Engine}=this.Matter;this.time+=1/60;
    const ax=Number.isFinite(acceleration.x)?Math.max(-35,Math.min(35,acceleration.x)):0;
    const ay=Number.isFinite(acceleration.y)?Math.max(-35,Math.min(35,acceleration.y)):0;
    const tiltX=Number.isFinite(acceleration.tiltX)?Math.max(-9.81,Math.min(9.81,acceleration.tiltX)):0;
    const tiltY=Number.isFinite(acceleration.tiltY)?Math.max(-9.81,Math.min(9.81,acceleration.tiltY)):0;
    const targetOmega=Number.isFinite(acceleration.omega)?Math.max(-4,Math.min(4,acceleration.omega)):0;
    const oldOmega=this.omega;
    this.omega+=(targetOmega-this.omega)*(1-Math.exp(-1/60/.12));
    const angularAcceleration=Math.max(-10,Math.min(10,(this.omega-oldOmega)*60));
    const omega=this.omega;
    for(const b of this.blobs){
      const body=b.body;
      body.restitution=BASE_RESTITUTION+(0.88-BASE_RESTITUTION)*this.controls.repulsion;
      const vx=body.velocity.x,vy=body.velocity.y,speed=Math.hypot(vx,vy);
      if(speed>.08)b.lastHeading=Math.atan2(vy,vx);
      // Gentle along-path propulsion prevents a slow contact from freezing an orb.
      // There are no destination points or velocity overrides steering it home.
      const thrust=Math.max(0,1-speed/.9)*22;
      const turn=Math.sin(this.time*.23+b.phase)*2;
      const dx=body.position.x-240,dy=body.position.y-240;
      const spinX=(2*omega*vy*60+omega*omega*dx+angularAcceleration*dy)*.55;
      const spinY=(-2*omega*vx*60+omega*omega*dy-angularAcceleration*dx)*.55;
      const accelerationX=-ax*65+tiltX*35+spinX+Math.cos(b.lastHeading)*thrust-Math.sin(b.lastHeading)*turn;
      const accelerationY=-ay*65+tiltY*35+spinY+Math.sin(b.lastHeading)*thrust+Math.cos(b.lastHeading)*turn;
      Body.applyForce(body,body.position,{x:body.mass*accelerationX/1e6,y:body.mass*accelerationY/1e6});
      b.beforeVelocity={...body.velocity};
    }
    // A small, symmetric exchange shares momentum with near neighbours without
    // attraction, fusion or a shared destination (a lightweight viscosity cue).
    for(let i=0;i<this.blobs.length;i++)for(let j=i+1;j<this.blobs.length;j++){
      const a=this.blobs[i].body,b=this.blobs[j].body;
      const distance=Math.hypot(a.position.x-b.position.x,a.position.y-b.position.y);
      const weight=Math.max(0,1-distance/155);
      if(!weight)continue;
      const fx=(b.velocity.x-a.velocity.x)*weight*.0000015;
      const fy=(b.velocity.y-a.velocity.y)*weight*.0000015;
      Body.applyForce(a,a.position,{x:a.mass*fx,y:a.mass*fy});Body.applyForce(b,b.position,{x:-b.mass*fx,y:-b.mass*fy});
    }
    Engine.update(this.engine,1000/60);
    for(const b of this.blobs){
      const body=b.body,speed=Math.hypot(body.velocity.x,body.velocity.y);
      if(speed>8)Body.setVelocity(body,{x:body.velocity.x*8/speed,y:body.velocity.y*8/speed});
      // Analytical fallback protects the round viewport even under sensor spikes.
      const dx=body.position.x-240,dy=body.position.y-240,d=Math.hypot(dx,dy),limit=240-b.radius;
      if(d>limit){const nx=dx/d,ny=dy/d;Body.setPosition(body,{x:240+nx*limit,y:240+ny*limit});
        const normal=body.velocity.x*nx+body.velocity.y*ny;
        if(normal>0){const velocity={...body.velocity};Body.setVelocity(body,{x:velocity.x-(1+body.restitution)*normal*nx,y:velocity.y-(1+body.restitution)*normal*ny});
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
