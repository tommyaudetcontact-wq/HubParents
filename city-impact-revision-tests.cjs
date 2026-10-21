'use strict';
const assert=require('node:assert/strict'),C=require('./domain.js'),D=require('./city-driving.js'),Z=require('./city-zombie-fx.js'),S=require('./city-stunts.js');
// Long bumper footprints rotate with each model; fast cars cannot tunnel through them.
for(const angle of [0,Math.PI/4,Math.PI/2,2.1])for(const sign of [-1,1]){
 const fx=Math.sin(angle)*sign,fy=-Math.cos(angle)*sign,b={id:'b',x:600,y:600,angle,driving:true,halfWidth:16,halfLength:38,vx:0,vy:0},a={id:'a',x:600-fx*75,y:600-fy*75,angle,driving:true,halfWidth:16,halfLength:38,vx:fx*240,vy:fy*240};
 assert.equal(D.contacts([a,b]).length,1);assert(Math.hypot(b.vx,b.vy)>0);
}
{
 const a={id:'a',x:650,y:600,angle:Math.PI/2,driving:true,vx:1200,vy:0,recovery:3},b={id:'b',x:600,y:600,angle:0,npc:true,vx:0,vy:0};
 const previous=new Map([['a',{x:500,y:600,recovery:3}],['b',{x:600,y:600}]]);
 assert.equal(D.contacts([a],[b],new Set(),previous).length,1);assert(a.x<b.x);assert(b.crashed);assert(b.vx>0);
 const miss={...a,id:'miss',x:650,y:700};assert.equal(D.contacts([miss],[{...b,x:600,y:600}],new Set(),new Map([['miss',{x:500,y:700,recovery:3}],['b',{x:600,y:600}]] )).length,0);
}
// Physics takes over until both rotation and sliding stop, then a whole second is held.
{
 let car={...C.cityTraffic('crash')[0],crashed:true,driving:true,vx:180,vy:-55,yawRate:3,stillFor:0},travel=car.travel,start={x:car.x,y:car.y},still=0,seenStill=false,steps=0;
 while(car.crashed&&steps++<1500){const before={...car};car=C.cityTrafficStep([car],1/60,0,[],(a,t)=>D.parkedStep(a,t,[],C.cityMap))[0];assert.equal(car.travel,travel);if(car.stillFor>0){if(seenStill){assert.equal(car.x,before.x);assert.equal(car.y,before.y);assert.equal(car.angle,before.angle);}seenStill=true;still+=1/60;}}
 assert(car.recovering);assert(still>=.99);assert(Math.hypot(car.x-start.x,car.y-start.y)>30);
 let largest=0;while(car.recovering&&steps++<3000){const before={...car};car=C.cityTrafficStep([car],1/60,0)[0];largest=Math.max(largest,Math.hypot(car.x-before.x,car.y-before.y));}
 assert(!car.recovering,'NPC rejoins the lane after its physical crash');assert(largest<6,'No teleport back to the route');
 car={...car,crashed:true,recovering:false,stillFor:.9,vx:30};car=C.cityTrafficStep([car],1/60,0)[0];assert.equal(car.stillFor,0,'New motion resets the stop timer');
}
{
 const car=Z.vehicle();assert.equal(car.trail,'fire');let p={x:0,y:0,angle:0,driving:true,speed:0,vx:0,vy:0};for(let n=0;n<1200;n++)p=D.step(p,{x:0,y:-.78},1/120,car);assert(Math.abs(p.speed*.36-150)<.01);
 const dead=kind=>{const s={elapsed:1,kills:0,drops:[],lastDropAt:0},z={id:kind,x:0,y:0,phase:0};Z.death(s,z,{vx:690,vy:0,kind});return z;},gun=dead('gun'),flame=dead('flame'),missile=dead('missile');assert(gun.kx>300);assert(flame.kx>gun.kx);assert(missile.kx>flame.kx*1.5);assert(missile.vz>flame.vz);const rig=Z.rigFor(missile,1.5);assert(rig.nodes[6][0]>100,'Explosion carries the articulated body a visible distance');
}
assert(S.areas.drift.w>=1000&&S.areas.drift.h>=1000);const p=S.driftPath[0],q=S.driftPath[1],len=Math.hypot(q.x-p.x,q.y-p.y),a={x:p.x-(q.y-p.y)/len*70,y:p.y+(q.x-p.x)/len*70,vx:10,vy:0,speed:10};const before={...a};S.constrainDrift(a);assert.equal(a.x,before.x);assert.equal(a.y,before.y);assert(S.driftPath.length>30);
console.log('Oriented bumper and swept impacts; physical NPC crash, full one-second stop and smooth rejoin; fire car at 150 km/h; stronger weapon-specific corpse propulsion; wider rounded drift passed.');

{
 globalThis.CityStunts=S;const car=C.vehicles[0],start={x:660,y:1940,angle:Math.PI/2,driving:true,speed:180,vx:180,vy:0};const takeoff=D.step(start,{x:1,y:-1},1/120,car);assert(takeoff.z>0&&takeoff.jumpSpin>0);let left={...takeoff},right={...takeoff};for(let n=0;n<20;n++){left=D.step(left,{x:-1,y:1},1/120,car);right=D.step(right,{x:1,y:-1},1/120,car);assert.equal(left.angle,right.angle);assert.equal(left.vx,right.vx);assert.equal(left.vy,right.vy);}assert(left.angle>takeoff.angle,'Takeoff retains part of the grounded steering rotation');assert(takeoff.jumpSpin<takeoff.turnRate);console.log('Airborne car retains 65% of its takeoff rotation, independent of steering during flight.');
}

{
 const Combat=require('./city-combat.js'),s={kind:'zombie',elapsed:5,kills:0,lastDropAt:0,drops:[],effects:[],shots:[],buffs:{weapon:'flame',until:30},players:{a:{x:650,y:550,hp:100,score:0,super:5,cooldown:1},b:{x:655,y:550,hp:100,score:0}}};s.zombies=[{id:'left',x:500,y:550,hp:99999,phase:0},{id:'right',x:800,y:550,hp:99999,phase:1},{id:'far',x:950,y:550,hp:500,phase:2}];Combat.fire(s,'a',s.players.a,{special:true,fire:false,ax:0,ay:0});assert(s.zombies[0].dead&&s.zombies[1].dead);assert(!s.zombies[2].dead);assert(s.zombies[0].kx<0&&s.zombies[1].kx>0);assert.equal(s.players.a.super,0);assert.equal(s.players.a.score,2);assert.equal(s.players.b.hp,100);assert.equal(s.shots.length,0);const effects=s.effects.length;Combat.fire(s,'a',s.players.a,{special:true,ax:0,ay:0});assert.equal(s.effects.length,effects);s.players.a.super=5;Combat.fire(s,'a',s.players.a,{special:true},true);assert.equal(s.players.a.super,0);assert(!s.zombies[2].dead);console.log('Zombie Super clears a 190-unit radius without aiming, including with a weapon bonus; radial propulsion, one charge consumption, teammate safety and guest visual prediction passed.');
}

{
 const heights=[];for(const speed of [80,160,300]){let a={x:660,y:1940,angle:Math.PI/2,driving:true,speed,vx:speed,vy:0};a=S.jump(a,1/120);let peak=0;for(let n=0;n<240;n++){a=S.jump(a,1/120);peak=Math.max(peak,a.z);}heights.push(peak);}assert(heights[1]>heights[0]*1.5&&heights[2]>heights[1]*1.5,'Jump height must visibly scale with takeoff speed');
 const d=S.areas.drift;assert(d.w>=1500&&d.h>=1400);for(const b of [C.cityMap.track,C.cityMap.field,S.areas.tennis])assert(d.x>b.x+b.w+100||d.y>b.y+b.h+100||d.x+d.w+100<b.x||d.y+d.h+100<b.y,'Separated facilities need a clear grass gap');assert(d.x+d.w<C.cityMap.width&&d.y+d.h<C.cityMap.height);const u=S.areas.sumo;assert(u.y-u.r>d.y+d.h);for(const p of S.driftPath)assert(p.x-108>d.x&&p.x+108<d.x+d.w&&p.y-108>d.y&&p.y+108<d.y+d.h);console.log('Expanded drift ground clears the race circuit, soccer, tennis and sumo; slow, medium and fast jumps have distinct heights.');
}

{
 const G=require('./city-games.js'),actors={p:{id:'p',x:650,y:550}},s=G.create('zombie','p');G.start(s,actors);s.buffs.vehicleUntil=30;s.wavePause=999;s.zombies=Array.from({length:16},(_,i)=>({id:'crowd'+i,x:620+Math.cos(i)*24,y:550+Math.sin(i)*24,hp:50,phase:i,cooldown:0}));for(let i=0;i<180;i++){G.laser(s,'p',{x:0,y:i>120?-.78:0,ax:0,ay:0,brake:i<=120});G.simulate(s,actors,1/60);}assert.equal(s.phase,'running');assert.equal(s.players.p.hp,100);assert(s.players.p.speed>50,'A stopped car can accelerate again after being surrounded by zombies');s.buffs.vehicleUntil=s.elapsed-.01;G.simulate(s,actors,1/60);assert(!s.players.p.riding&&!s.players.p.driving);s.buffs.vehicleUntil=s.elapsed+30;s.players.p.hp=0;Z.before(s,1/60);assert(!s.players.p.riding,'Downed teammates must not appear as frozen bonus cars');console.log('Zombie vehicle survives a surrounding crowd, restarts after braking, expires normally and does not appear on downed teammates.');
}

{
 const v=S.driftVehicle();let a={x:0,y:0,angle:0,speed:0,vx:0,vy:0,driving:true};for(let n=0;n<2000;n++){a=D.step(a,{x:n>900?.8:0,y:-1,drift:n>900},1/120,v);assert(Math.hypot(a.vx,a.vy)*.36<=100.001);}assert.equal(v.speed*.36,100);console.log('The standard drift car stays within 100 km/h in straight lines and sustained slides.');
}
