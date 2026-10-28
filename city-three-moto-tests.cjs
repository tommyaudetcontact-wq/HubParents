'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),T=require('./vendor/three.min.js'),C=require('./domain.js');
let now=100;const s={THREE:T,BrawlCore:C,performance:{now:()=>now},Math,Set};s.window=s;vm.createContext(s);for(const f of ['assets3d/brawl-riff-image.js','city-three-batches.js','assets3d/brawl-moto.js','city-three-moto.js','city-three-vehicle.js'])vm.runInContext(fs.readFileSync(f,'utf8'),s,{filename:f});
assert.equal(fs.readFileSync('assets3d/brawl-moto.js','utf8'),fs.readFileSync('experiments/moto-lab/moto-model.js','utf8'),'Use the inspected prototype model in production');
let count=0;for(const v of C.vehicles.filter(s.CityThreeMoto.eligible)){
 const a={id:'a',x:10,y:20,angle:0,speed:100,wheelAngle:1,damage:{parts:[0,0,0,0,0,0]}},copy=JSON.stringify(a),visual=s.CityThreeVehicle.create({S:.04},v,v.color,a);assert(visual.motorcycle);visual.update(a);assert.equal(JSON.stringify(a),copy);assert.equal(visual.model.wheels[0].roll.rotation.x,-1);
 for(const heading of [.1,.2,.4]){now+=33;visual.update({...a,angle:heading});const q=s.BrawlMotoModel.riderPose(s.BrawlRiffImage.rest,visual.mount,{rigScale:.3});for(const [i,side]of [[0,'l'],[1,'r']]){const hand=visual.mount.hands[i],p=q[side+'h'];assert(Math.hypot(p[0]*.3-hand[0],p[2]*.3-hand[1],-p[1]*.3-hand[2])<.25);}}
 const painted=[];visual.group.traverse(o=>{if(o.isMesh&&o.material.color?.getHexString()===new T.Color(v.color).getHexString())painted.push(o);});assert(painted.length);const m=painted[0],rest=m.geometry.attributes.position.array.slice();visual.update({...a,damage:{parts:[90,90]}});assert.notDeepEqual(m.geometry.attributes.position.array,rest,'Damage must change the bike body');visual.update(a);assert.deepEqual(m.geometry.attributes.position.array,rest,'Repaired bike must regain its original geometry');
 const owned=new Map();visual.group.traverse(o=>{if(o.userData.ownedGeometry){assert(!owned.has(o.geometry),'Geometry must have one owner');owned.set(o.geometry,true);}});assert(owned.size<25);count++;
}
assert(count>=6);assert(!s.CityThreeMoto.eligible(C.vehicles.find(v=>v.skateboard)));assert(!s.CityThreeMoto.eligible(C.vehicles.find(v=>v.scooter&&!v.skateboard)));
console.log(count+' motorcycle definitions: production factory, animated wheels, steering contact IK, reversible damage and bounded owned geometry passed.');
