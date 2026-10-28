'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),T=require('./vendor/three.min.js'),C=require('./domain.js');
let now=1000,shots=[];const s={THREE:T,BrawlCore:C,Math,Set,performance:{now:()=>now},CityTanks:{inspect:()=>({shots})}};s.window=s;vm.createContext(s);for(const f of ['assets3d/brawl-tank.js','city-three-tank.js','city-three-vehicle.js'])vm.runInContext(fs.readFileSync(f,'utf8'),s,{filename:f});
const ctx={S:.04,material:color=>new T.MeshStandardMaterial({color})};
for(const v of C.vehicles.filter(v=>v.tank)){
 const actor={id:'pilot',angle:.3,wheelAngle:.2,speed:80,tankCooldown:0,damage:{parts:[0,0,0,0,0,0]}},before=JSON.stringify(actor),visual=s.CityThreeVehicle.create(ctx,v,v.color,actor);assert(visual.tank);assert(!visual.cabin);visual.update(actor);assert.equal(JSON.stringify(actor),before);
 assert.equal(visual.model.materials.paint.color.getHexString(),v.color.slice(1));const muzzle=visual.model.muzzle();assert(Math.abs(muzzle.z+v.length*1.25*.04)<1e-6);assert(Math.abs(muzzle.y-.96)<1e-6);
 let calls=0,triangles=0;visual.group.traverse(o=>{if(o.isMesh){calls++;triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3*(o.isInstancedMesh?o.count:1);for(const a of Object.values(o.geometry.attributes))for(const n of a.array)assert(Number.isFinite(n));}});assert(calls<35);assert(triangles<35000);
 shots=[{owner:'pilot',fireId:'prediction-'+v.id,life:1.59}];now+=20;visual.update(actor);now+=100;visual.update(actor);assert(visual.model.gun.position.z>-12,'Immediate local shot must recoil');for(let n=0;n<20;n++){now+=20;visual.update(actor);}assert.equal(visual.model.gun.position.z,-13);shots=[{owner:'pilot',fireId:'prediction-'+v.id,life:1.58,id:99}];now+=20;visual.update(actor);assert.equal(visual.model.gun.position.z,-13,'Confirmed prediction must not recoil twice');shots=[];
 const ownedGeometry=new Set(),ownedMaterial=new Set();visual.group.traverse(o=>{if(o.userData.ownedGeometry){assert(!ownedGeometry.has(o.geometry));ownedGeometry.add(o.geometry);}if(o.userData.ownedMaterial){assert(!ownedMaterial.has(o.material));ownedMaterial.add(o.material);}});assert(ownedGeometry.size>0&&ownedMaterial.size>0);visual.model.dispose();
 console.log(v.id+': approved model, matching muzzle, '+calls+' meshes, '+triangles+' triangles, immediate predicted recoil, confirmation deduplication and cleanup ownership passed.');
}
assert(!s.CityThreeVehicle.create(ctx,C.vehicles.find(v=>v.id==='car-retro'),'#dd5544',{}).tank);
assert.deepEqual(C.vehicles.filter(v=>v.tank).map(v=>[v.price,v.mass,v.speed]),[[300,6,150],[300,6,175],[300,6,160]]);
console.log('Tank graphics preserve the existing vehicle definitions, driver exclusion and authoritative simulation.');
