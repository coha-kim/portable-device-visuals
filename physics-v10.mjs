// Matter.js collision bodies with a circular wall; no wrap, attractors or fusion.
export class PalmPhysics {
  constructor({Matter=globalThis.Matter, random=Math.random, count=8}={}) {
    if (!Matter) throw new Error('Matter.js must load before the palm simulation.');
    this.Matter=Matter; this.time=0; this.accumulator=0; this.controls={repulsion:0,deformation:0};
    this.engine=Matter.Engine.create({positionIterations:10,velocityIterations:8});
    this.engine.gravity.scale=0;
    this.stats={blobCollisions:0,wallCollisions:0,maxSquash:0};
    this.blobs=Array.from({length:count},(_,i)=>{
      const angle=(i-1)*Math.PI*2/Math.max(1,count-1), reach=i===0?0:156;
      const body=Matter.Bodies.circle(240+Math.cos(angle)*reach,240+Math.sin(angle)*reach,51,
        {label:'blob',friction:0,frictionStatic:0,frictionAir:.012,restitution:0,slop:.01});
      Matter.Body.setInertia(body,Infinity);
      const heading=random()*Math.PI*2;
      Matter.Body.setVelocity(body,{x:Math.cos(heading)*.22,y:Math.sin(heading)*.22});
      return {body,radius:51,phase:random()*100,squash:0,squashVelocity:0,axis:0,beforeVelocity:{x:0,y:0}};
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
    for(const b of this.blobs){
      const body=b.body;body.restitution=this.controls.repulsion*.88;
      const dx=Math.sin(this.time*.23+b.phase)*.28,dy=Math.cos(this.time*.19+b.phase*1.7)*.28;
      Body.applyForce(body,body.position,{x:body.mass*((dx-body.velocity.x)*.000025-ax*.00010),
        y:body.mass*((dy-body.velocity.y)*.000025-ay*.00010)});
      b.beforeVelocity={...body.velocity};
    }
    Engine.update(this.engine,1000/60);
    for(const b of this.blobs){
      const body=b.body,speed=Math.hypot(body.velocity.x,body.velocity.y);
      if(speed>7)Body.setVelocity(body,{x:body.velocity.x*7/speed,y:body.velocity.y*7/speed});
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
