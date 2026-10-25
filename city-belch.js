'use strict';
(function(root){
 const C=root.BrawlCore,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 function step(q,dt,ctx){
  q.life=Math.max(0,q.life-dt);const reach=520*clamp(1-q.life/.7,0,1);
  if(!ctx.host())return;
  const seen=new Set(q.hits||[]),inside=a=>{const dx=a.x-q.x,dy=a.y-q.y,t=dx*q.dirX+dy*q.dirY;return t>=0&&t<=reach&&Math.abs(dx*q.dirY-dy*q.dirX)<=25+t*.55;};
  for(const a of ctx.all()){
   const id='actor:'+a.id;if(a.id===q.owner||seen.has(id)||!inside(a)||!ctx.allowed(a)||a.dead||a.policeDead||a.vehicleRespawn>0||a.crushRespawn>0||root.CityVacuum?.held(a))continue;
   seen.add(id);const force=clamp(950-Math.hypot(a.x-q.x,a.y-q.y)*.65,500,950),vx=q.dirX*force,vy=q.dirY*force,foot=a.pedestrian||!a.driving&&!a.npc&&!a.parked;
   if(foot){ctx.killPerson(a,q.owner);Object.assign(a,{knockX:vx,knockY:vy,ejectVZ:145,z:Math.max(1,a.z||0),ragdollDuration:6,ragdoll:5.4,ejected:true});}
   else{const model=ctx.model(a);root.CityPolice?.injured?.(a,q.owner);if(a.policeUnit)root.CityPolice?.hit(a,10000,q.owner,true);root.CityDamage?.bind(a,model);root.CityDamage?.shatter(a,450,q.dirX,q.dirY);if(model?.body==='motorcycle'){root.CityDamage?.destroyBike(a,450,q.dirX,q.dirY);a.crushRespawn=15;a.hp=0;a.falls=3;a.riderTime=0;a.corpseTime=10;}else root.CityVehiclePhysics?.destroy(a);Object.assign(a,{vx,vy,vz:105,z:Math.max(1,a.z||0),rollRate:2.8,pitchRate:1.9,crashed:true,stillFor:0});}
  }
  for(const p of root.CityProps?.targets?.()||[]){const a=root.CityProps.body(p.id)||p,id='prop:'+p.id;if(seen.has(id)||!inside(a)||root.CityVacuum?.hidden('prop',p.id))continue;seen.add(id);root.CityProps.impact(p.id,'belch',{vx:q.dirX*900,vy:q.dirY*900});const body=root.CityProps.body(p.id);if(body)root.CityProps.body(p.id,{...body,vx:q.dirX*650,vy:q.dirY*650,omega:7,tiltV:8,fallen:true});}
  q.hits=[...seen];root.CityBuildings?.wave(q,reach,185);
  // Small loose chips join the advancing front; large sections keep their mesh and mass.
  root.CityDamage?.impulse?.(q.x+q.dirX*reach,q.y+q.dirY*reach,25+reach*.3,360);
 }
 function draw(c,q,project){
  const age=clamp(1-q.life/.7,0,1),reach=520*age;c.save();c.globalAlpha=(1-age)*.85;c.lineWidth=3+5*(1-age);
  for(let n=0;n<3;n++){const d=Math.max(4,reach-n*35),width=25+d*.55;c.strokeStyle=['#d7ffc1','#f5ffe9','#a2e9dc'][n];c.beginPath();for(let i=0;i<=16;i++){const u=i/8-1,p=project(q.x+q.dirX*(d-22*u*u)+q.dirY*width*u,q.y+q.dirY*(d-22*u*u)-q.dirX*width*u,q.z+Math.cos(u*Math.PI/2)*18);i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y);}c.stroke();}
  c.globalAlpha=(1-age)*.18;c.fillStyle='#d1f8ba';c.beginPath();const start=project(q.x,q.y,q.z);c.moveTo(start.x,start.y);for(let i=0;i<=12;i++){const u=i/6-1,p=project(q.x+q.dirX*reach+q.dirY*(25+reach*.55)*u,q.y+q.dirY*reach-q.dirX*(25+reach*.55)*u,q.z);c.lineTo(p.x,p.y);}c.closePath();c.fill();c.restore();
 }
 const out={step,draw};if(typeof module!=='undefined')module.exports=out;else root.CityBelch=out;
})(typeof window==='undefined'?globalThis:window);
