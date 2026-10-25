'use strict';
(function(root){
 function step(q,dt,ctx){
  q.life=Math.max(0,q.life-dt);if(q.struck)return;const owner=ctx.all().find(a=>a.id===q.owner);if(owner){q.dirX=Math.sin(owner.angle||0);q.dirY=-Math.cos(owner.angle||0);q.x=owner.x+q.dirX*18;q.y=owner.y+q.dirY*18;q.z=36+(owner.z||0);}
  if(q.life>.25)return;q.struck=true;if(!ctx.host())return;
  for(const a of ctx.all()){if(a.id===q.owner||!ctx.allowed(a)||a.dead||a.policeDead||a.toyDead>0||a.vehicleRespawn>0||a.crushRespawn>0||root.CityVacuum?.held(a))continue;const dx=a.x-q.x,dy=a.y-q.y,t=dx*q.dirX+dy*q.dirY,foot=a.pedestrian||!a.driving&&!a.npc&&!a.parked;if(t< -10||t>(foot?95:115)||Math.abs(dx*q.dirY-dy*q.dirX)>55||Math.abs((a.z||0)-q.z)>65)continue;
   root.CityPolice?.injured?.(a,q.owner);if(foot){if(a.policeUnit||ctx.members().some(m=>m.id===a.id))root.CityPolice?.hit(a,40,q.owner,true);else{a.toyGunHp=(a.toyGunHp??60)-70;if(a.toyGunHp<=0)ctx.killPerson(a,q.owner);}Object.assign(a,{knockX:q.dirX*260,knockY:q.dirY*260,ejectVZ:65,z:Math.max(1,a.z||0),ragdoll:Math.max(1.4,a.ragdoll||0),hitStun:.6});}
   else{const model=ctx.model(a);root.CityDamage?.bind(a,model);root.CityDamage?.impact(a,260,q.dirX,q.dirY);a.toyGunHp=(a.toyGunHp??100)-45;if(a.policeUnit)root.CityPolice?.hit(a,45,q.owner,true);if(a.toyGunHp<=0){root.CityDamage?.shatter(a,300,q.dirX,q.dirY);if(model?.body==='motorcycle'){root.CityDamage?.destroyBike(a,300,q.dirX,q.dirY);a.crushRespawn=15;a.hp=0;a.falls=3;}else root.CityVehiclePhysics?.destroy(a);}a.vx=(a.vx||0)+q.dirX*150;a.vy=(a.vy||0)+q.dirY*150;}
  }
  for(const p of root.CityProps?.targets?.()||[]){const a=root.CityProps.body(p.id)||p,dx=a.x-q.x,dy=a.y-q.y,t=dx*q.dirX+dy*q.dirY;if(t>=-10&&t<=100&&Math.abs(dx*q.dirY-dy*q.dirX)<50)root.CityProps.impact(p.id,'hammer',{vx:q.dirX*300,vy:q.dirY*300});}
  root.CityBuildings?.wave(q,100,105);root.CityDamage?.impulse?.(q.x+q.dirX*65,q.y+q.dirY*65,65,180);
 }
 function draw(c,q,project){if(!q.struck)return;const t=1-q.life/.25,p=project(q.x+q.dirX*70,q.y+q.dirY*70,q.z);c.save();c.globalAlpha=1-t;c.strokeStyle='#f5d7a0';c.lineWidth=2;for(let n=0;n<9;n++){const a=n*2.399,r=5+t*35;c.beginPath();c.moveTo(p.x+Math.cos(a)*r*.3,p.y+Math.sin(a)*r*.3);c.lineTo(p.x+Math.cos(a)*r,p.y+Math.sin(a)*r);c.stroke();}c.restore();}
 const out={step,draw};if(typeof module!=='undefined')module.exports=out;else root.CityHammer=out;
})(typeof window==='undefined'?globalThis:window);
