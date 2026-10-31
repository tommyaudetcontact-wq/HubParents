'use strict';
// Authored in-place locomotion. Original poses, visually referenced against GTA IV/V gameplay.
(function(root){
 const T=root.THREE;if(!T)return;
 const TAU=Math.PI*2,clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),mix=(a,b,t)=>a+(b-a)*t;
 const smooth=t=>t*t*(3-2*t),vec=p=>new T.Vector3(...p),length=(r,a,b)=>vec(r[a]).distanceTo(vec(r[b]));
 // Cycle starts at contact. The return folds the heel BEHIND the hip, not up in front.
 // [cycle, fore/aft ankle, ankle lift, foot pitch]. Stance has exactly linear ground travel.
 const recovery=[
  [.42,-12,0,-.40],[.50,-14,6.5,-.48],[.61,-9,9,-.24],
  [.73,0,6,.02],[.88,13,2,.14],[1,10,0,.12]
 ];
 function curve(keys,u,index){let n=0;while(n<keys.length-2&&u>keys[n+1][0])n++;
  const b=keys[n],c=keys[n+1],a=keys[Math.max(0,n-1)],d=keys[Math.min(keys.length-1,n+2)],span=c[0]-b[0],t=clamp((u-b[0])/span,0,1),slope=(x,y)=>(y[index]-x[index])/(y[0]-x[0]||1);
  let m0=slope(a,c),m1=slope(b,d),delta=slope(b,c);
  if(delta===0)m0=m1=0;else{if(m0*delta<0)m0=0;if(m1*delta<0)m1=0;const max=3*Math.abs(delta);m0=clamp(m0,-max,max);m1=clamp(m1,-max,max);}
  if(keys===recovery){if(index===1){if(n===0)m0=-22/.42;if(n===keys.length-2)m1=-22/.42;}else if(index===2||index===3){if(n===0)m0=0;if(n===keys.length-2)m1=0;}}
  return (2*t*t*t-3*t*t+1)*b[index]+(t*t*t-2*t*t+t)*span*m0+(-2*t*t*t+3*t*t)*c[index]+(t*t*t-t*t)*span*m1;
 }
 function foot(u,jog){
  const contact=u<.42;
  let y=contact?10-22*u/.42:curve(recovery,u,1),lift=contact?0:Math.max(0,curve(recovery,u,2));
  const pitch=contact?(u<.12?mix(.12,0,smooth(u/.12)):u>.31?mix(0,-.40,smooth((u-.31)/.11)):0):curve(recovery,u,3);
  // Walking has a longer planted interval and very low foot clearance.
  const stance=.64,walkY=u<stance?10-20*u/stance:mix(-10,10,smooth((u-stance)/(1-stance))),walkLift=u<stance?0:3*Math.sin(Math.PI*(u-stance)/(1-stance))**2;
  y=mix(walkY,y,jog);lift=mix(walkLift,lift,jog);
  const p=mix(0,pitch,jog),soleCompensation=Math.max(0,Math.sin(p)*(p>0?3.4:-8))+3.3*(Math.cos(p)-1);
  return {y,z:4+lift+Math.max(0,soleCompensation),lift,pitch:p,contact:jog>.5?contact:u<stance};
 }
 function knee(hip,target,l1,l2,pole){const start=vec(hip),axis=vec(target).sub(start),distance=clamp(axis.length(),Math.abs(l1-l2)+.001,l1+l2-.001);axis.normalize();
  const bend=vec(pole).sub(start);bend.addScaledVector(axis,-bend.dot(axis)).normalize();const along=(l1*l1-l2*l2+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,l1*l1-along*along));
  return {knee:start.clone().addScaledVector(axis,along).addScaledVector(bend,height).toArray(),ankle:start.addScaledVector(axis,distance).toArray()};
 }
 function sample(rest,actor){
  const strength=actor.gaitWeight??1,speed=Math.hypot(actor.vx||0,actor.vy||0),jog=smooth(clamp((speed-55)/50,0,1)),phase=actor.walkPhase||0,cycle=((phase/TAU)%1+1)%1,weight=Math.sin(phase)*strength,bob=mix(-.25+.25*Math.cos(phase*2),curve([[0,-.85],[.18,-1.6],[.52,-.6],[.78,0],[1,-.85]],(cycle*2)%1,1),jog)*strength,pelvisYaw=jog*.045*weight,chestYaw=-jog*.04*weight;
  const q=Object.fromEntries(Object.entries(rest).map(([k,p])=>[k,p.slice()]));
  q.hip[0]+=.45*jog*weight;q.hip[1]+=jog*strength;q.hip[2]+=bob;q.chest[0]-=.15*jog*weight;q.chest[1]+=jog*3.5*strength;q.chest[2]+=bob;q.head[1]+=jog*4*strength;q.head[2]+=bob*.65;
  const rotate=(origin,a,b,yaw)=>{const d=vec(a).sub(vec(b)),c=Math.cos(yaw),s=Math.sin(yaw);return [origin[0]+d.x*c-d.y*s,origin[1]+d.x*s+d.y*c,origin[2]+d.z];},footRotations={},jointYaw={hip:chestYaw,chest:chestYaw*.5},contacts={};
  const feet={};let compression=0;
  for(const [side,shift]of [['l',0],['r',.5]]){const u=(cycle+shift)%1,f=foot(u,jog),sole=root.BrawlRiffImage?.footSoles?.[side];if(sole?.length)f.z=.4-Math.min(...sole.map(([y,z])=>y*Math.cos(f.pitch)-z*Math.sin(f.pitch)))+f.lift;feet[side]=f;
   f.y=mix(rest[side+'f'][1],f.y,strength);f.z=mix(rest[side+'f'][2],f.z,strength);f.pitch*=strength;
   // Reach correction is continuous through the walk/jog stance boundary.
   {const hip=rotate(q.hip,rest[side+'l'],rest.hip,pelvisYaw),reach=length(rest,side+'l',side+'k')+length(rest,side+'k',side+'f')-.01,horizontal=(rest[side+'f'][0]-hip[0])**2+(f.y-hip[1])**2;compression=Math.max(compression,hip[2]-f.z-Math.sqrt(Math.max(0,reach*reach-horizontal)));}
  }
  if(compression>0)for(const key of ['hip','chest','head'])q[key][2]-=compression;
  for(const [side,sign,shift]of [['l',-1,0],['r',1,.5]]){
   const u=(cycle+shift)%1,f=feet[side],theta=TAU*u;
   q[side+'l']=rotate(q.hip,rest[side+'l'],rest.hip,pelvisYaw);q[side+'s']=rotate(q.chest,rest[side+'s'],rest.chest,chestYaw);
   const target=[rest[side+'f'][0],f.y,f.z],leg=knee(q[side+'l'],target,length(rest,side+'l',side+'k'),length(rest,side+'k',side+'f'),[q[side+'l'][0],24,q[side+'l'][2]-20]);
   q[side+'k']=leg.knee;q[side+'f']=leg.ankle;footRotations[side]=[f.pitch,sign*.035+pelvisYaw*.25,0];contacts[side]=f.contact;
   // Swing comes from the shoulder; the forearm follows a loose, varying elbow bend.
   const shoulder=mix(-.06-.24*Math.cos(theta),-.12-.38*Math.cos(theta),jog),flex=mix(.18+.10*Math.sin(theta),1.35+.10*Math.sin(theta+.4),jog),a=vec([sign*.075,Math.sin(shoulder),-Math.cos(shoulder)]).normalize(),b=vec([-sign*.055*jog,Math.sin(shoulder+flex),-Math.cos(shoulder+flex)]).normalize();
   a.lerp(vec(rest[side+'e']).sub(vec(rest[side+'s'])).normalize(),1-strength).normalize();b.lerp(vec(rest[side+'h']).sub(vec(rest[side+'e'])).normalize(),1-strength).normalize();
   q[side+'e']=vec(q[side+'s']).addScaledVector(a,length(rest,side+'s',side+'e')).toArray();q[side+'h']=vec(q[side+'e']).addScaledVector(b,length(rest,side+'e',side+'h')).toArray();
   jointYaw[side+'s']=jointYaw[side+'e']=jointYaw[side+'h']=chestYaw; jointYaw[side+'l']=jointYaw[side+'k']=pelvisYaw;
  }
  Object.defineProperties(q,{footRotations:{value:footRotations},jointYaw:{value:jointYaw},locomotion:{value:{cycle,jog,contacts,version:'authored-contact-v2'}}});return q;
 }
 function controller(){let phase=0,speed=0,weight=0,ready=false;return {update(actor,dt){dt=clamp(dt,0,.07);const blocked=actor.riding||actor.ragdoll>0||actor.homeAction||actor.danceTime>0,target=blocked?0:Math.hypot(actor.vx||0,actor.vy||0);if(!ready){phase=actor.walkPhase||0;ready=true;}speed+=(target-speed)*(1-Math.exp(-dt*12));weight+=((target>1?1:0)-weight)*(1-Math.exp(-dt*12));if(blocked){weight=0;speed=0;}else phase+=dt*mix(4.5,12,smooth(clamp(speed/145,0,1)))*clamp(speed/20,0,1);return {...actor,vx:speed,vy:0,walkPhase:phase,gaitWeight:weight};}};}
 root.CityThreeLocomotion={sample,controller};
})(typeof window==='undefined'?globalThis:window);
