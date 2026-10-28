'use strict';
(function(root){
 if(!root.BrawlTankModel)return;
 function create(ctx,v,color,actor={}){
  const model=root.BrawlTankModel.create({S:ctx.S,length:v.length,width:v.width,color}),seen=new Set();let lastAt=0,lastFire=-Infinity,oldCooldown=actor.tankCooldown||0;
  const geometries=new Set(),materials=new Set();model.group.traverse(o=>{if(o.geometry&&!geometries.has(o.geometry)){geometries.add(o.geometry);o.userData.ownedGeometry=true;}if(o.material&&!materials.has(o.material)){materials.add(o.material);o.userData.ownedMaterial=true;}});
  function update(a){const now=root.performance?.now?.()||0,dt=lastAt?Math.max(0,Math.min(.07,(now-lastAt)/1000)):1/60;lastAt=now;let fired=false;
   for(const q of root.CityTanks?.inspect()?.shots||[]){if(q.owner!==a.id||q.life<1.3)continue;const key=q.fireId||String(q.id);if(seen.has(key))continue;seen.add(key);if(seen.size>32)seen.delete(seen.values().next().value);fired=true;}
   if((a.tankCooldown||0)>oldCooldown+.2&&now-lastFire>1100)fired=true;oldCooldown=a.tankCooldown||0;
   if(fired&&!a.crushed&&!(a.vehicleRespawn>0)){model.fire();lastFire=now;}
   model.update(a,dt);
  }
  return {group:model.group,update,tank:true,model};
 }
 root.CityThreeTank={create};
})(typeof window==='undefined'?globalThis:window);
