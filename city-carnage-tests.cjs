'use strict';
const assert=require('node:assert/strict'),C=require('./domain.js'),G=require('./city-games.js'),K=require('./city-carnage.js'),D=require('./city-driving.js'),I=require('./city-invites.js');
const actors=n=>Object.fromEntries(Array.from({length:n},(_,i)=>['p'+i,{id:'p'+i,x:650+i*40,y:550,angle:.3,fuel:210,driving:false}]));
for(const kind of K.kinds){
 const a=actors(6),s=G.create(kind,'p0');s.accepted=Object.keys(a);assert(G.start(s,a,s.accepted.map(id=>({id,vehicle:'car-retro'}))));assert.equal(s.bots.length,16);assert.equal(new Set(s.bots.map(b=>b.model)).size,16);assert.equal(new Set(s.bots.map(b=>b.paint)).size,16);assert.deepEqual(I.limits[kind],[1,6]);
 const grid=Object.values(a).concat(s.bots);for(let i=0;i<grid.length;i++)for(let j=i+1;j<grid.length;j++)assert(!D.overlap(D.shape(grid[i]),D.shape(grid[j])),kind+' spawn must not overlap');
 for(const b of s.bots)assert(b.x>=0&&b.y>=0&&b.x<C.cityMap.width&&b.y<C.cityMap.height);
 assert(K.decode(K.wire(s)));const bad=K.wire(s);bad[1][0]=bad[0][0];assert.equal(K.decode(bad),null);
 const before=s.bots.map(b=>[b.x,b.y]);G.simulate(s,a,3.01);for(let i=0;i<90;i++)G.simulate(s,a,1/30);assert(s.bots.some((b,i)=>Math.hypot(b.x-before[i][0],b.y-before[i][1])>15));
 const victim=s.bots[0];for(let n=0;n<4;n++){s.elapsed+=1;G.contact(s,{a:a.p0,b:victim,av:180,bv:20,closing:160});assert.equal(victim.hp,75-n*25);}
 assert.equal(s.players.p0.score,1);assert.equal(s.players.p0.hp,100);const hp=s.players.p0.hp;G.contact(s,{a:a.p0,b:s.bots[1],av:0,bv:0,closing:0});assert.equal(s.players.p0.hp,hp);
 const wire=G.serialize(s,true);assert(!wire.bots);assert.equal(K.decode(wire.botFrames).length,16);assert(JSON.stringify(wire).length<12000);
 for(let n=0;n<20;n++){s.elapsed+=1;G.contact(s,{a:a.p1,b:s.bots[n%16],av:20,bv:180,closing:160});assert.equal(s.players.p1.hp,100);assert.equal(s.players.p1.respawn,0);}const position={x:a.p1.x,y:a.p1.y};s.players.p1.hp=0;s.players.p1.respawn=3;G.simulate(s,a,.01);assert.equal(s.players.p1.hp,100);assert.equal(s.players.p1.respawn,0);assert.equal(a.p1.x,position.x);assert.equal(a.p1.y,position.y);
 s.players.p1.score=2;s.elapsed=s.duration+4;G.simulate(s,a,.01);assert.equal(s.phase,'finished');assert.equal(s.winner,'p1');assert.equal(a.p0.x,650);assert.equal(a.p0.driving,false);assert.equal(a.p0.fuel,210);
 const tooMany=actors(7),invalid=G.create(kind,'p0');invalid.accepted=Object.keys(tooMany);assert.equal(G.start(invalid,tooMany),false);
 console.log(kind+': six players, sixteen distinct NPC, moving AI, physical damage, NPC eliminations, invulnerable players, bounded validated snapshots and ranking.');
}
const track=K.circuit('carnage-course'),s={kind:'carnage-course',bumps:[track.length*.19]},car={...K.sample(track,s.bumps[0]),speed:180,z:0};K.bump(s,car);assert(car.vz>100&&car.z>0);const off={...K.sample(track,400,140),speed:100,vx:100,vy:0};K.constrain(s,off);assert(K.nearest(track,off).d<=42.01);assert(K.dirt.y>=2200);assert(K.dirt.x+K.dirt.w<2870);
const a=actors(1),city=G.create('carnage-ville','p0');G.start(city,a);assert(new Set(city.bots.map(b=>Math.floor(b.x/100)+','+Math.floor(b.y/100))).size>=10);
console.log('Dirt ramps launch moving cars; track sliding stays on-road, map expansion avoids neighboring arenas, city NPC are distributed.');

{const a=actors(1),s=G.create('carnage-ville','p0');G.start(s,a);s.countdown=0;s.elapsed=4;const bot=s.bots[0];Object.assign(a.p0,{x:650,y:550,angle:Math.PI/2,vx:180,vy:0,speed:180,driving:true});Object.assign(bot,{x:690,y:550,angle:Math.PI/2,vx:0,vy:0,speed:0});const events=D.contacts([a.p0],[bot]);assert(events.length);for(const event of events)G.contact(s,event);assert.equal(bot.hp,75);assert(bot.vx>0);assert.equal(s.players.p0.hp,100);}
console.log('Real oriented vehicle contacts propel the NPC and apply Carnage health damage through the shared driving engine.');

