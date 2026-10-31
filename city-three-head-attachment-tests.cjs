'use strict';
const fs=require('node:fs'),vm=require('node:vm');
const setup=fs.readFileSync('city-three-riff-image-tests.cjs','utf8').split('const ctx=')[0];
vm.runInNewContext(setup+`
let now=1000;scope.performance={now:()=>now};let samples=0;
for(const id of ['skin-neutral','skin-riff-nocturne','skin-princesse-rosee','skin-etoile-rodeo','skin-sentinelle-olive']){
 const member={skin:id,useCustomAppearance:id==='skin-neutral',appearance:{...C.appearanceDefaults(),hair:'hair-0'}},visual=scope.CityThreeCharacter.create({S:.04,material:c=>new T.MeshStandardMaterial({color:c})},member,scope.CharacterRig.source(member)),accessories=visual.group.getObjectByName('head-accessories');assert(accessories?.parent.isBone,'Hair and face accessories must inherit the actual head bone');
 let skull;visual.group.traverse(o=>{if(o.name==='head-surface-6')skull=o;});let reference;
 for(const speed of [0,35,110])for(let frame=0;frame<32;frame++){
  now+=1000/60;const actor={id:'npc-or-player',rigScale:.3,vx:speed,vy:0,walkPhase:frame*.17},pose=scope.CityThreeCharacter.retarget(scope.CharacterRig.joints3d({...actor,phase:actor.walkPhase,moving:speed>0}));visual.update(pose,actor,null);visual.group.updateMatrixWorld(true);skull.skeleton.update();assert(accessories.position.length()<1e-9);assert(Math.abs(accessories.quaternion.w-1)<1e-9);const point=skull.getVertexPosition(100,new T.Vector3()).applyMatrix4(skull.matrixWorld).applyMatrix4(accessories.matrixWorld.clone().invert());if(!reference)reference=point.clone();assert(point.distanceTo(reference)<1e-4,'Skull and hair must stay locked throughout walking and jogging');samples++;
 }
}
console.log('Head attachment: '+samples+' idle/walk/jog samples across five player/NPC costumes; skull, hair and hats share one bone frame.');
`,{require,console,process,Buffer,atob});
