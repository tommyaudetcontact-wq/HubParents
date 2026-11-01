'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),scope={};vm.createContext(scope);vm.runInContext(fs.readFileSync('city-three-npc-motion.js','utf8'),scope);
for(const hz of [30,60,120]){const motion=scope.CityThreeNpcMotion.create();let source={x:0,y:0,angle:Math.PI-.02,recovery:0},previous=motion.update(source,1/hz),maxStep=0;
 for(let frame=1;frame<hz*3;frame++){if(frame%Math.round(hz/10)===0)source={...source,x:source.x+7,angle:-Math.PI+.02};const before=JSON.stringify(source),p=motion.update(source,1/hz);assert.equal(JSON.stringify(source),before);assert(Number.isFinite(p.vx));maxStep=Math.max(maxStep,Math.abs(p.x-previous.x));assert(Math.abs(p.x-source.x)<16);assert(Math.abs(Math.atan2(Math.sin(p.angle-previous.angle),Math.cos(p.angle-previous.angle)))<.1);previous=p;}
 assert(maxStep<180/hz,'10 Hz snapshots must not become 7-unit frame jumps at '+hz+' Hz: '+maxStep);
 for(let n=0;n<hz;n++)previous=motion.update(source,1/hz);assert(Math.abs(previous.x-source.x)<.001);assert(Math.abs(previous.vx)<.001);
 assert.equal(motion.update({...source,x:500},1/hz).x,500,'true relocation snaps');assert.equal(motion.update({...source,x:510,ragdoll:2},1/hz).x,510,'ragdoll is never delayed');assert.equal(motion.update({...source,x:515,recovery:1},1/hz).x,515,'respawn/recovery snaps');
}
assert(fs.readFileSync('city-three.js','utf8').includes('entry.npcMotion.update(actor,deltaTime)'));
console.log('NPC presentation: 10 Hz walking samples render continuously at 30/60/120 Hz, shortest turns, clean stops and immediate ragdoll/teleport; simulation untouched.');
