'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),T=require('./vendor/three.min.js'),C=require('./domain.js');
const scope={THREE:T,BrawlCore:C,console};scope.window=scope;vm.createContext(scope);
for(const f of ['assets3d/brawl-road.js','assets3d/brawl-road-profiles.js','city-three-road.js','city-three-fleet.js'])vm.runInContext(fs.readFileSync(f,'utf8'),scope,{filename:f});
const ctx={S:.04,material:color=>new T.MeshStandardMaterial({color})};let count=0;
for(const v of C.vehicles.filter(scope.CityThreeRoad.eligible)){
 const before=JSON.stringify(v),m=scope.CityThreeRoad.create(ctx,v,v.color,{});assert.equal(JSON.stringify(v),before);assert(m.road);assert.equal(m.wheels.length,4);assert(m.panels.length>=4,v.id+' native panels');
 m.group.updateMatrixWorld(true);m.group.traverse(o=>{if(o.isMesh)for(const key of ['position','normal'])assert([...o.geometry.attributes[key].array].every(Number.isFinite),v.id+' '+o.name+' finite '+key);});
 const part=m.model.meshes.find(o=>o.name==='front-bumper')||m.model.meshes.find(o=>o.geometry.attributes.position&&o.material===m.model.materials.paint),rest=part.geometry.attributes.position.array.slice(),version=part.geometry.attributes.position.version;
 m.update({wheelAngle:2,turnRate:.8,speed:50,damage:{parts:[65,25,70,0,0,0]}});assert.equal(m.wheels[0].roll.rotation.x,2);assert(part.geometry.attributes.position.version>version,'GPU receives deformation');assert.notDeepEqual(part.geometry.attributes.position.array,rest);
 m.update({damage:{parts:[100,100,100,100,100,100]}});assert(m.panels.every(p=>!p.group.visible));assert.equal(m.model.takeFragments().length,0,'gameplay never duplicates authoritative debris');
 m.update({damage:{parts:[0,0,0,0,0,0]}});assert.deepEqual(part.geometry.attributes.position.array,rest);assert(m.panels.every(p=>p.group.visible));
 const debris=scope.CityThreeFleet.createDebris(ctx,{i:0,color:v.color,fleet:{vehicle:v.id},w:v.width,l:v.length});assert(debris.children.length>0,'native hood/hatch debris '+v.id);assert(!new T.Box3().setFromObject(debris).isEmpty());count++;
}
assert(count>=6);assert(!scope.CityThreeRoad.eligible({body:'motorcycle'}));assert(!scope.CityThreeRoad.eligible({body:'sport'}));assert(!scope.CityThreeRoad.eligible({body:'truck',tank:true}));
console.log(count+' catalogue vehicles use workshop geometry, animated wheels, native panels, GPU-visible damage, authoritative debris and exact repair. Approved coupe/tank/motorcycles remain separate.');
