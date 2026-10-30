'use strict';
const fs=require('node:fs'),vm=require('node:vm');
const prefix=fs.readFileSync('city-furniture-seat-tests.cjs','utf8').split('const toilet=')[0];
vm.runInNewContext(prefix+`
sc.THREE=require('./vendor/three.min.js');vm.runInContext(fs.readFileSync('city-three-home.js','utf8'),sc);
const fridge=C.catalog.find(v=>v.kind==='fridge');let cases=0;
for(const rotation of [0,1,2,3])for(const scale of [1,1.5]){
 const item={id:fridge.id,x:2,y:2,rotation,scale},room=profile.room,faces=[];
 const saved=JSON.stringify({item,room});
 const v=sc.CityThreeHome.createFridge({S:.04,model(f){faces.push(...f);return new sc.THREE.Group();}},b,item,room,{});
 assert(faces.length>70);for(const f of faces)for(const p of f.points)assert([p.x,p.y,p.z].every(Number.isFinite));
 v.updateAction({kind:'fridge',time:1.5,duration:3});assert(Math.abs(v.hinge.rotation.y)>1);
 v.updateAction(null);assert(Math.abs(v.hinge.rotation.y)<1e-9);assert.equal(JSON.stringify({item,room}),saved);cases++;
}
console.log('3D apartment fridge: '+cases+' placement/scale cases, hollow shelves, hinged door and immutable room state.');
`,{require,console,process,structuredClone,Buffer});
