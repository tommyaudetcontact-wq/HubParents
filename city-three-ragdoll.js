import * as P from './vendor/cannon-es.js';

// Physical limbs are a presentation layer around the existing networked impact root.
// The host still owns hits, death and the duration of incapacitation.
const SCALE=.04, RIG=.012, dolls=new Map();
const segments=[['torso','hip','chest',12,.12],['leftUpper','ls','le',2,.065],['rightUpper','rs','re',2,.065],['leftArm','le','lh',1.5,.055],['rightArm','re','rh',1.5,.055],['leftThigh','ll','lk',4,.08],['rightThigh','rl','rk',4,.08],['leftLeg','lk','lf',3,.065],['rightLeg','rk','rf',3,.065]];
const vector=(p,rig=RIG)=>new P.Vec3(p[0]*rig,p[2]*rig,-p[1]*rig);
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
function localPivot(body,world){return body.pointToLocalFrame(world,new P.Vec3());}
// A direction alone loses the front/back of a limb near a straight knee.
function orientLimb(body,direction){
 body.quaternion.setFromVectors(new P.Vec3(0,1,0),direction);
 const back=new P.Vec3(0,0,1);back.vsub(direction.scale(back.dot(direction)),back);
 if(back.lengthSquared()<1e-8)return;back.normalize();
 const current=body.quaternion.vmult(new P.Vec3(0,0,1)),roll=Math.atan2(direction.dot(current.cross(back)),current.dot(back));
 new P.Quaternion().setFromAxisAngle(direction,roll).mult(body.quaternion,body.quaternion);
}
function make(actor,pose,rig=RIG){
 const world=new P.World({gravity:new P.Vec3(0,-9.81,0),allowSleep:true});world.solver.iterations=12;world.solver.tolerance=.002;world.defaultContactMaterial.friction=.65;world.defaultContactMaterial.restitution=.08;
 const floor=new P.Body({mass:0,shape:new P.Plane()});floor.quaternion.setFromEuler(-Math.PI/2,0,0);floor.position.y=-(actor.z||0)*SCALE;world.addBody(floor);
 const bodies={},bones={},constraints=[],knees=[];
 let seed=(actor.ragdollSeed||actor.ragdollStamp||1)>>>0;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(const [name,start,end,mass,baseRadius]of segments){const radius=baseRadius*rig/RIG,a=vector(pose[start],rig),b=vector(pose[end],rig),delta=b.vsub(a),length=Math.max(.08,delta.length()),body=new P.Body({mass,linearDamping:.12,angularDamping:.25,sleepSpeedLimit:.08,sleepTimeLimit:.8,collisionFilterGroup:2,collisionFilterMask:1});body.addShape(new P.Box(new P.Vec3(radius,Math.max(.025,length/2-radius*.5),radius*.85)));body.addShape(new P.Sphere(radius),new P.Vec3(0,-length/2+radius*.3,0));body.addShape(new P.Sphere(radius),new P.Vec3(0,length/2-radius*.3,0));body.position.copy(a.vadd(b).scale(.5));delta.normalize();orientLimb(body,delta);body.angularVelocity.set((random()-.5)*5,(random()-.5)*5,(random()-.5)*5);body.velocity.set((random()-.5)*.5,0,(random()-.5)*.5);world.addBody(body);bodies[name]=body;bones[name]={start,end,length};}
 const head=new P.Body({mass:3,shape:new P.Sphere(.105*rig/RIG),linearDamping:.12,angularDamping:.25,collisionFilterGroup:2,collisionFilterMask:1});head.position.copy(vector(pose.head,rig));head.angularVelocity.set(2,-1,2);world.addBody(head);bodies.head=head;
 function connect(parent,child,joint,angle){const a=bodies[parent],b=bodies[child],point=vector(pose[joint],rig),pivotA=localPivot(a,point),pivotB=localPivot(b,point),worldAxis=child==='head'?new P.Vec3(0,1,0):b.vectorToWorldFrame(new P.Vec3(0,1,0)),axisA=a.vectorToLocalFrame(worldAxis),constraint=new P.ConeTwistConstraint(a,b,{pivotA,pivotB,axisA,axisB:new P.Vec3(0,1,0),angle,twistAngle:child==='head'?.5:.4,maxForce:5e4,collideConnected:false});// Cannon's generated tangent axes are not a shared anatomical rest frame.
 const reference=new P.Vec3(0,0,1);reference.vsub(worldAxis.scale(reference.dot(worldAxis)),reference);if(reference.lengthSquared()<1e-8)reference.set(1,0,0);reference.normalize();
 const refA=a.vectorToLocalFrame(reference),refB=b.vectorToLocalFrame(reference),update=constraint.update.bind(constraint);constraint.update=()=>{update();a.vectorToWorldFrame(refA,constraint.twistEquation.axisA);b.vectorToWorldFrame(refB,constraint.twistEquation.axisB);};
 world.addConstraint(constraint);constraints.push(constraint);}
 function knee(parent,child,joint){const a=bodies[parent],b=bodies[child],point=vector(pose[joint],rig),axis=a.vectorToWorldFrame(new P.Vec3(1,0,0)),pivotA=localPivot(a,point),pivotB=localPivot(b,point),hinge=new P.HingeConstraint(a,b,{pivotA,pivotB,axisA:a.vectorToLocalFrame(axis),axisB:b.vectorToLocalFrame(axis),maxForce:5e4,collideConnected:false}),centre=1.30,rotation=new P.Quaternion().setFromAxisAngle(axis,centre),reference=a.vectorToLocalFrame(rotation.vmult(a.vectorToWorldFrame(new P.Vec3(0,1,0)))),limit=new P.RotationalEquation(a,b,{maxForce:5e4});limit.minForce=-5e4;limit.maxForce=0;limit.maxAngle=centre;hinge.equations.push(limit);const update=hinge.update.bind(hinge);hinge.update=()=>{update();a.vectorToWorldFrame(reference,limit.axisA);b.vectorToWorldFrame(new P.Vec3(0,1,0),limit.axisB);};world.addConstraint(hinge);constraints.push(hinge);knees.push({a,b,pivotA,pivotB,axisA:a.vectorToLocalFrame(axis),max:centre*2});}
 connect('torso','head','chest',.55);connect('torso','leftUpper','ls',1.5);connect('torso','rightUpper','rs',1.5);connect('leftUpper','leftArm','le',1.25);connect('rightUpper','rightArm','re',1.25);connect('torso','leftThigh','ll',1.1);connect('torso','rightThigh','rl',1.1);knee('leftThigh','leftLeg','lk');knee('rightThigh','rightLeg','rk');
 if(actor.ragdollImpulse){const impact=actor.ragdollImpulse,co=Math.cos(actor.angle||0),si=Math.sin(actor.angle||0),dx=clamp((impact.x||0)*SCALE*.35,-7,7),dy=clamp((impact.y||0)*SCALE*.35,-7,7),upward=clamp((impact.z||0)*SCALE*.75,0,6);for(const body of Object.values(bodies)){body.velocity.x+=co*dx+si*dy;body.velocity.z+=-si*dx+co*dy;body.velocity.y+=upward;}}
 return {rig,world,bodies,bones,constraints,knees,floor,time:0,lastAge:0,accumulator:0,used:0,colliders:[],lastEnvironment:-1,pose};
}
function environment(doll,actor,obstacles){const signature=obstacles.map(o=>[o.x,o.y,o.w,o.d,o.h,o.z||0].map(n=>Math.round(n)).join(',')).join('|')+':'+Math.round(actor.x/10)+':'+Math.round(actor.y/10)+':'+Math.round((actor.angle||0)*10);if(signature===doll.environment)return;doll.environment=signature;for(const body of doll.colliders)doll.world.removeBody(body);doll.colliders=[];const co=Math.cos(actor.angle||0),si=Math.sin(actor.angle||0);for(const o of obstacles){if(Math.hypot(o.x+o.w/2-actor.x,o.y+o.d/2-actor.y)>Math.hypot(o.w,o.d)/2+120)continue;const dx=o.x+o.w/2-actor.x,dy=o.y+o.d/2-actor.y,body=new P.Body({mass:0,shape:new P.Box(new P.Vec3(o.w*SCALE/2,o.h*SCALE/2,o.d*SCALE/2))});body.position.set((dx*co+dy*si)*SCALE,((o.z||0)+o.h/2-(actor.z||0))*SCALE,(-dx*si+dy*co)*SCALE);body.quaternion.setFromEuler(0,actor.angle||0,0);doll.world.addBody(body);doll.colliders.push(body);}}
function kneeAngle(k){const axis=k.a.vectorToWorldFrame(k.axisA),a=k.a.vectorToWorldFrame(new P.Vec3(0,1,0)),b=k.b.vectorToWorldFrame(new P.Vec3(0,1,0));return Math.atan2(axis.dot(a.cross(b)),a.dot(b));}
function enforceKnees(doll){for(const k of doll.knees){
 const angle=kneeAngle(k),target=clamp(angle,0,k.max),axis=k.a.vectorToWorldFrame(k.axisA);
 // Preserve the hinge plane too: limiting only the signed angle still allowed axial twisting.
 new P.Quaternion().setFromAxisAngle(axis,target).mult(k.a.quaternion,k.b.quaternion);k.b.quaternion.normalize();
 const pivot=k.a.pointToWorldFrame(k.pivotA),offset=k.b.quaternion.vmult(k.pivotB);pivot.vsub(offset,k.b.position);
 const relative=k.b.angularVelocity.vsub(k.a.angularVelocity),speed=relative.dot(axis),allowed=angle<0?Math.max(0,speed):angle>k.max?Math.min(0,speed):speed;
 k.a.angularVelocity.vadd(axis.scale(allowed),k.b.angularVelocity);
}}
export function sample(actor,pose,{floorHeight=0,obstacles=[],dt=1/60}={}){
 const rig=SCALE*(actor.rigScale||.3),key=String(actor.id||'npc')+':'+(actor.ragdollStamp||0)+':'+(actor.ragdollSeed||0)+':'+rig,duration=Math.max(1.5,actor.ragdollDuration||1.5),age=clamp(duration-(actor.ragdoll||0),0,duration);let doll=dolls.get(key);if(!doll){doll=make(actor,pose,rig);dolls.set(key,doll);doll.accumulator=Math.min(age,.5);for(const [old,d]of dolls)if(old!==key&&Date.now()-d.used>30000)dolls.delete(old);if(dolls.size>128){const oldest=[...dolls].filter(([k])=>k!==key).sort((a,b)=>a[1].used-b[1].used)[0];if(oldest)dolls.delete(oldest[0]);}}doll.used=Date.now();doll.floor.position.y=(floorHeight-(actor.z||0))*SCALE;environment(doll,actor,obstacles);doll.world.gravity.y=actor.toyAir&&actor.zeroGravity>0?0:-9.81;
 // Fixed time steps make low frame rates and network corrections safe for constraints.
 doll.accumulator+=clamp(dt,0,.07);const steps=Math.min(8,Math.floor((doll.accumulator+1e-8)*60));for(let n=0;n<steps;n++){doll.world.step(1/60);enforceKnees(doll);doll.time+=1/60;doll.accumulator-=1/60;}
 const samples={};function add(name,p){(samples[name]??=[]).push(p);}for(const [name,bone]of Object.entries(doll.bones)){const body=doll.bodies[name];add(bone.start,body.pointToWorldFrame(new P.Vec3(0,-bone.length/2,0)));add(bone.end,body.pointToWorldFrame(new P.Vec3(0,bone.length/2,0)));}samples.head=[doll.bodies.head.position.clone()];const result={};for(const [name,points]of Object.entries(samples)){const p=points.reduce((p,q)=>p.vadd(q),new P.Vec3()).scale(1/points.length);result[name]=[p.x/doll.rig,-p.z/doll.rig,p.y/doll.rig];}for(const [name,p]of Object.entries(pose))if(!result[name])result[name]=p.slice();const frames={chest:doll.bodies.torso.quaternion.toArray(),head:doll.bodies.head.quaternion.toArray()};for(const [name,bone]of Object.entries(doll.bones))frames[bone.start]=doll.bodies[name].quaternion.toArray();frames.lh=frames.le;frames.rh=frames.re;
 Object.defineProperty(result,'rigidFrames',{value:frames,enumerable:false});Object.defineProperty(result,'orientation',{value:doll.bodies.head.quaternion.toArray(),enumerable:false});return result;
}
export function clear(){dolls.clear();}
export function stats(){return {dolls:dolls.size,bodies:[...dolls.values()].reduce((n,d)=>n+d.world.bodies.length,0),constraints:[...dolls.values()].reduce((n,d)=>n+d.constraints.length,0),knees:[...dolls.values()].reduce((n,d)=>n+d.knees.length,0),kneeAngles:[...dolls.values()].flatMap(d=>d.knees.map(k=>kneeAngle(k)))};}
if(typeof window!=='undefined')window.CityThreeRagdoll={sample,clear,stats};
