'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),T=require('../../vendor/three.min.js');
const scope={THREE:T,Math,Set};scope.window=scope;vm.createContext(scope);vm.runInContext(fs.readFileSync(__dirname+'/tank-model.js','utf8'),scope);
const results=[];
for(const [length,width]of [[53,30],[49,28],[55,31]]){
 const model=scope.BrawlTankModel.create({S:.04,length,width});let calls=0,triangles=0,invalid=0;
 model.group.traverse(o=>{if(!o.isMesh)return;calls++;const g=o.geometry;triangles+=(g.index?.count||g.attributes.position.count)/3*(o.isInstancedMesh?o.count:1);for(const a of Object.values(g.attributes))for(const v of a.array)if(!Number.isFinite(v))invalid++;});
 assert.equal(invalid,0);assert(calls<=35,'Too many mesh calls: '+calls);assert(triangles<35000,'Triangle budget: '+triangles);
 const m=new T.Matrix4(),n=new T.Matrix4();const top=5;let bottom=-1;for(let i=0;i<58;i++)if(Math.abs(model.trackPoint(i/58*model.trackLoop).angle-Math.PI)<.001){bottom=i+3;break;}assert(bottom>=0);
 model.update({wheelAngle:0},0);model.links.getMatrixAt(top,m);model.links.getMatrixAt(bottom,n);const topZ=m.elements[14],bottomZ=n.elements[14];
 const actor={wheelAngle:.02,speed:100,angle:.4,damage:{parts:[0,0,0,0,0,0]}},before=JSON.stringify(actor);model.update(actor,1/60);assert.equal(JSON.stringify(actor),before);model.links.getMatrixAt(top,m);model.links.getMatrixAt(bottom,n);assert(m.elements[14]<topZ,'Top track must move toward the nose');assert(n.elements[14]>bottomZ,'Bottom track must move toward the rear');
 for(const t of [0,.1,.25,.5,.75,.999999,1,2]){const p=model.trackPoint(t*model.trackLoop);assert([p.y,p.z,p.angle].every(Number.isFinite));}const first=model.trackPoint(0),last=model.trackPoint(model.trackLoop-1e-5);assert(Math.hypot(first.y-last.y,first.z-last.z)<.0001,'Track loop must close');
 model.reset();const muzzle=model.muzzle();assert(Math.abs(muzzle.z+length*1.25*.04)<1e-6);assert(Math.abs(muzzle.y-24*.04)<1e-6);model.aim(Math.PI/2,10*Math.PI/180);model.update({},0);const direction=model.muzzleDirection();assert(direction.x<-.98&&direction.y>.17&&Math.abs(direction.z)<1e-6);
 model.fire();model.update({},.12);assert(model.gun.position.z>-12,'Cannon must recoil');model.update({},.4);assert.equal(model.gun.position.z,-13);model.aim(0,99);model.update({},0);assert(Math.abs(model.gun.rotation.x-25*Math.PI/180)<1e-9);model.reset();assert.equal(model.turret.rotation.y,0);
 for(const obj of [model.links,model.pads,model.wheels,model.caps,model.bolts])for(const v of obj.instanceMatrix.array)assert(Number.isFinite(v));
 results.push({length,width,calls,triangles});model.dispose();
}
fs.writeFileSync(__dirname+'/mechanical-check.json',JSON.stringify({pass:true,checks:['finite geometry','mesh and triangle budgets','forward track direction','closed track loop','unchanged input actor','correct muzzle position','aimed muzzle direction','recoil and recovery','elevation limits','finite instance transforms'],models:results},null,2));console.log(JSON.stringify(results));console.log('PASS: 10 tank prototype checks across three dimensional fixtures. No game integration.');
