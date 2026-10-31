const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),T=require('../../vendor/three.min.js');
const scope={THREE:T};vm.createContext(scope);vm.runInContext(fs.readFileSync(__dirname+'/road-model.js','utf8'),scope);
const profiles=JSON.parse(fs.readFileSync(__dirname+'/sculpt-spec.json','utf8')).roadFleetProfiles;
for(const family of ['compact','suv','van','bus','pickup']){
 const p={...profiles[family],family},before=JSON.stringify(p),m=scope.BrawlRoadModel.create(p,'#888888',1);
 assert.equal(JSON.stringify(p),before,'immutable '+family);assert.equal(m.wheels.length,4);
 m.group.traverse(o=>{if(o.isMesh)for(const key of ['position','normal'])assert([...o.geometry.attributes[key].array].every(Number.isFinite),family+' '+o.name);});
 const doors=m.panels.filter(p=>p.name.startsWith('door-'));assert.equal(doors.length,p.doors);
 if(family==='compact'||family==='suv'){
  const hatch=m.panels.find(p=>p.name==='trunk').group;
  for(const id of ['rear-window','rear-fascia','trunk-skin'])assert(hatch.children.some(o=>o.name===id),family+' complete hatch '+id);
 }
 if(family==='van'){
  for(const side of [-1,1]){const door=m.panels.find(p=>p.name==='door-'+(side<0?'left':'right')+'-1').group;assert(door.children.some(o=>o.name==='cargo-upper-'+side));assert(!door.children.some(o=>o.material===m.materials.glass));}
  const a=m.panels.find(p=>p.name==='trunk').group,b=m.panels.find(p=>p.name==='cargo-door-right').group;
  assert(a.position.x<0&&b.position.x>0,'rear hinges on opposite sides');
  for(const door of [a,b]){assert(door.children.some(o=>o.name.startsWith('rear-door-upper-')));assert(door.children.some(o=>o.name.startsWith('rear-door-lower-')));}
  assert(!m.meshes.some(o=>o.name==='rear-window'),'solid cargo doors');
 }
 if(family==='pickup'){for(const id of ['engine-bay-floor','engine','cargo-liner','cargo-wall--1','cargo-wall-1']){const node=m.meshes.find(o=>o.name===id);const box=new T.Box3().setFromObject(node,true);assert(box.min.y>=p.base-.02,'raised interior is not hanging below pickup body: '+id);}assert(m.panels.some(p=>p.name==='trunk'));}
 if(family==='bus'){
  assert.equal(m.meshes.filter(o=>o.name.startsWith('passenger-pane-')).length,10);
  assert.equal(m.meshes.filter(o=>o.name.startsWith('passenger-headrest-')).length,10);
  assert.equal(m.meshes.filter(o=>o.name.startsWith('seat-front-')).length,1);
 }
 m.update({wheelAngle:1.5,steer:.2});for(const w of m.wheels){assert.equal(w.roll.rotation.x,1.5);assert.equal(w.steer.rotation.y,w.front?.2:0);}
 console.log(family+': finite surfaces, immutable profile, native openings and seated cabin, four wheel pivots verified; destruction not yet enabled.');
}

for(const family of ['suv','pickup','van','bus']){
 const m=scope.BrawlRoadModel.create({...profiles[family],family},'#888888',2);
 m.group.traverse(o=>{if(o.isMesh)for(const key of ['position','normal'])assert([...o.geometry.attributes[key].array].every(Number.isFinite),'form '+family+' '+o.name);});
 assert.equal(m.meshes.filter(o=>o.name.startsWith('headlight-lens-')).length,4,'native paired round lamps '+family);
 if(family==='van'){assert.equal(m.meshes.filter(o=>o.name.startsWith('steel-disc-')).length,4);assert.equal(m.meshes.filter(o=>o.name.startsWith('spoke-')).length,0);}
 if(family==='pickup'){assert.equal(m.meshes.filter(o=>o.name.startsWith('tread-block-')).length,96);assert.equal(m.meshes.filter(o=>o.name.startsWith('bed-rib-')).length,7);}
 if(family==='suv')assert.equal(m.meshes.filter(o=>o.name.startsWith('roof-rail-foot-')).length,4);
 if(family==='bus')assert.equal(m.meshes.filter(o=>o.name.startsWith('entry-step-')).length,3);
 console.log(family+': finite form geometry and native family details verified.');
}
