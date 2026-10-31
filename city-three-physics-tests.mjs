import assert from 'node:assert/strict';
import {sample,clear,stats as ragdollStats} from './city-three-ragdoll.js';
import {step,reset,stats as propStats} from './city-three-props.js';
const pose={hip:[0,0,48],chest:[0,0,88],head:[0,0,104],ls:[-16,0,84],rs:[16,0,84],le:[-20,0,65],re:[20,0,65],lh:[-17,0,47],rh:[17,0,47],ll:[-7,0,46],rl:[7,0,46],lk:[-7,0,25],rk:[7,0,25],lf:[-7,0,4],rf:[7,0,4]};
for(const count of [1,6]){clear();for(let n=0;n<180;n++)for(let id=0;id<count;id++){const actor={id:'fall-'+id,x:id*40,y:100,z:0,angle:0,ragdollDuration:3,ragdoll:3-n/60,ragdollStamp:1,ragdollSeed:id+3},saved=JSON.stringify(actor),q=sample(actor,pose);assert.equal(JSON.stringify(actor),saved);assert(Object.values(q).flat().every(Number.isFinite));if(n===179){assert(q.head[2]>3&&q.head[2]<35);assert(q.hip[2]<35);}}assert.equal(ragdollStats().constraints,count*9);}clear();
console.log('Cannon rigid ragdolls: one and six actors, nine constrained joints each, finite motion, ground contact, settling and unchanged authoritative roots.');
const endings=[];for(const hz of [30,60,120]){clear();let end;for(let n=0;n<hz;n++)end=sample({id:'refresh-rate',x:0,y:0,z:0,angle:0,ragdoll:3-n/hz,ragdollDuration:3,ragdollSeed:11},pose,{dt:1/hz});endings.push(end);}for(const p of endings.slice(1))for(const key of ['head','hip','lf','rf'])assert(Math.hypot(...p[key].map((v,n)=>v-endings[0][key][n]))<1e-5,'Ragdolls must not run twice as fast on a 120 Hz screen');
clear();for(let frame=0;frame<12;frame++)for(let id=0;id<48;id++)sample({id:'crowd-'+id,x:id*30,y:0,z:0,angle:0,ragdoll:3-frame/60,ragdollDuration:3,ragdollSeed:id+1},pose);assert.equal(ragdollStats().dolls,48,'A crowd explosion must not evict and recreate visible ragdolls every frame');clear();
clear();const tossed={id:'zombie-launch',x:0,y:0,z:8,angle:Math.PI/2,ragdoll:2,ragdollDuration:2,ragdollSeed:17,ragdollImpulse:{x:350,y:0,z:160}},savedToss=JSON.stringify(tossed);let launched;for(let n=0;n<20;n++)launched=sample({...tossed,ragdoll:2-n/60},pose,{dt:1/60});assert(launched.hip[2]>pose.hip[2]+10,'Zombie impact launches the constrained ragdoll upward');assert(launched.hip[1]>20,'World impulse is transformed into the rotated body frame');assert.equal(JSON.stringify(tossed),savedToss);clear();
console.log('Ragdoll timing: identical 30/60/120 Hz motion and 48 simultaneous persistent bodies passed.');
// Check the actual simulated hinges throughout impacts, not just their configured limits.
let largestBend=0;
for(let seed=1;seed<=24;seed++){
 clear();
 const starting=structuredClone(pose);
 if(seed%2)for(const side of ['l','r']){starting[side+'k'][1]=8;starting[side+'f'][1]=-9;}
 for(let frame=0;frame<240;frame++){
  const actor={id:'knee-'+seed,x:0,y:0,z:seed%3?35:0,angle:seed*.37,ragdollDuration:4,ragdoll:4-frame/60,ragdollSeed:seed,ragdollStamp:seed};
  sample(actor,starting,{dt:frame%3===0?1/30:1/60});
  const measured=ragdollStats();
  assert.equal(measured.knees,2);
  for(const angle of measured.kneeAngles){
   assert(Number.isFinite(angle));
   assert(angle>=-1e-5&&angle<=2.60001,`Knee bent backwards or beyond its range: seed ${seed}, frame ${frame}, angle ${angle}`);
   largestBend=Math.max(largestBend,angle);
  }
 }
}
assert(largestBend>.5,'Knees must still bend naturally during a fall');
clear();
console.log('Knees: 24 impact seeds / 5,760 frames, flexion stays between 0 and 149 degrees, including bent starting poses and variable frame rates.');
reset();const definitions=[{id:'a',x:0,y:0,type:'bin'},{id:'b',x:42,y:0,type:'bin'},{id:'pole',x:220,y:80,type:'pole'}],bodies={a:{x:0,y:0,z:0,vx:180,vy:0,vz:70,angle:0,omega:3,fallen:true,tiltV:4,at:0}},buildings=[{x:100,y:-100,w:20,d:200,h:100}];
for(let n=0;n<240;n++){step(1/60,{bodies,definitions,buildings,clock:n/60});for(const b of Object.values(bodies)){assert(['x','y','z','vx','vy','vz','pitch','roll'].every(k=>Number.isFinite(b[k])));assert(b.x<115,'Rigid debris must collide with the building volume');}}assert.equal(propStats().bodies,3);assert.equal(propStats().walls,1);assert(bodies.a.pitch!==0||bodies.a.roll!==0);assert(Math.abs(bodies.a.vz)<5);assert(Object.keys(bodies).includes('b'),'A moving object wakes and pushes another object');
console.log('Cannon props: full-volume wall collisions, object-to-object impulses, three-axis rotation, gravity and settled bodies.');reset();
