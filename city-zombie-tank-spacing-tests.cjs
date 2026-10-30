'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const sc={BrawlCore:require('./domain'),CityArt:{buildings:[],size:{width:5000,height:5000}}};sc.window=sc;vm.createContext(sc);
for(const f of ['city-driving.js','city-zombie-fx.js'])vm.runInContext(fs.readFileSync(f,'utf8'),sc);
const s={kind:'zombie',elapsed:1,effects:[],drops:[],zombies:[],players:Object.fromEntries(Array.from({length:6},(_,i)=>['p'+i,{id:'p'+i,x:620+i*6,y:620,hp:100,angle:Math.PI/2,cooldown:0}])),buffs:{until:0,vehicleUntil:30,rate:0},shots:[]};
sc.CityZombieFX.before(s,.016);
const ps=Object.values(s.players);for(let i=0;i<ps.length;i++){assert(ps[i].riding);for(let j=0;j<i;j++)assert(Math.hypot(ps[i].x-ps[j].x,ps[i].y-ps[j].y)>145);sc.CityZombieFX.weapon(s,ps[i].id,ps[i],{fire:true},0);}
assert.equal(new Set(s.shots.map(q=>q.owner)).size,6);
const positions=ps.map(p=>[p.x,p.y]);sc.CityZombieFX.before(s,.016);assert.deepEqual(ps.map(p=>[p.x,p.y]),positions);
console.log('Zombie tank bonus: six overlapping teammates receive separate tanks once, and all six can fire.');

