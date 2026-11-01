'use strict';
// Presentation only: keep simulated/network NPC positions authoritative.
(function(root){
 const clamp=(n,a,b)=>Math.max(a,Math.min(b,n)),mix=(a,b,t)=>a+(b-a)*t;
 function create(){let shown=null,from=null,target=null,elapsed=0,age=0,period=.075,recovery;
  return {update(actor,delta){const dt=clamp(Number.isFinite(delta)?delta:1/60,.001,.07),point={x:actor.x,y:actor.y,z:actor.z||0},blocked=actor.ragdoll>0||actor.ejected||actor.dead||actor.hp===0||actor.danceTime>0||point.z>3;
   if(!shown||blocked||actor.recovery!==recovery||Math.hypot(point.x-target.x,point.y-target.y)>90){shown={...point,angle:actor.angle||0};from={...point};target={...point};elapsed=period;age=0;recovery=actor.recovery;return {...actor,...shown};}
   age+=dt;
   if(point.x!==target.x||point.y!==target.y||point.z!==target.z){period=mix(period,clamp(age,1/60,.18),.5);from={x:shown.x,y:shown.y,z:shown.z};target={...point};elapsed=0;age=0;}
   const oldX=shown.x,oldY=shown.y,t=clamp((elapsed+=dt)/period,0,1);
   shown.x=mix(from.x,target.x,t);shown.y=mix(from.y,target.y,t);shown.z=mix(from.z,target.z,t);
   shown.angle+=Math.atan2(Math.sin((actor.angle||0)-shown.angle),Math.cos((actor.angle||0)-shown.angle))*(1-Math.exp(-dt*18));
   return {...actor,...shown,vx:(shown.x-oldX)/dt,vy:(shown.y-oldY)/dt};
  }};
 }
 root.CityThreeNpcMotion={create};
})(typeof window==='undefined'?globalThis:window);
