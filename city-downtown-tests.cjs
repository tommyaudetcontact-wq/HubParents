'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),C=require('./domain'),D=require('./city-driving');
const m=C.cityMap,north=m.downtown;
assert.equal(north.buildings.length,9);assert(m.minY<north.y);
for(const b of north.buildings){assert(b.y+b.d<0&&b.h>=150&&b.h<=260);assert(b.x>0&&b.x+b.w<m.coreWidth);for(const e of north.roads){const horizontal=e.a.y===e.b.y;assert(horizontal?Math.abs(b.y-e.a.y)>70&&Math.abs(b.y+b.d-e.a.y)>70:Math.abs(b.x-e.a.x)>70&&Math.abs(b.x+b.w-e.a.x)>70,'Buildings leave every road and sidewalk clear');}}
for(const target of [{x:100,y:-1150},{x:1750,y:-700},{x:650,y:-250}]){const r=C.cityRoute({x:650,y:550},target);assert(r.length>1);assert.deepEqual(r.at(-1),target);for(let i=1;i<r.length;i++)assert(r[i].x===r[i-1].x||r[i].y===r[i-1].y,'Routes have no diagonal shortcuts through buildings');}
C.configureResidential([{id:'test-house',size:40}]);assert(C.cityRoute({x:-300,y:100}, {x:1200,y:-1150}).some(p=>p.y<0),'Housing relayout preserves downtown roads');C.configureResidential();
for(const driving of [false,true]){const a={x:650,y:-700,z:0,vx:0,vy:-100,speed:100,angle:0,driving};D.collide(a,[],m);assert.equal(a.y,-700,'Walking and driving retain negative world coordinates');a.y=-1500;D.collide(a,[],m);assert(a.y>m.minY&&a.y<0);}
let prefix=fs.readFileSync('city-toy-updates-tests.cjs','utf8').split('// Count actual accepted automatic shots')[0];prefix=prefix.replace("'city-inventory.js'","'city-buildings.js','city-inventory.js'");
vm.runInNewContext(prefix+`
const w=fixture(),guest=fixture(false),B=w.sc.CityBuildings,G=guest.sc.CityBuildings;
const api=f=>({host:()=>f===w,actor:()=>f.a,actors:()=>f.actors,members:()=>[{id:'a'},{id:'b'}]});B.mount(api(w));G.mount(api(guest));
w.sc.CityArt.buildings=C.cityMap.downtown.buildings.map(b=>({...b}));guest.sc.CityArt.buildings=w.sc.CityArt.buildings.map(b=>({...b}));
const towers=w.sc.CityArt.buildings.slice();for(let n=0;n<24;n++)w.sc.CityArt.buildings.push({...towers[n%9],x:2200+n*240});guest.sc.CityArt.buildings=w.sc.CityArt.buildings.map(b=>({...b}));for(const b of w.sc.CityArt.buildings)B.point(b,{x:b.x+2,y:b.y+20,z:10,vx:1,vy:0},8);assert.equal(B.inspect().states.length,33);assert(G.receive(B.snapshot()),'Guests accept simultaneous damage to more than thirty-two buildings across the expanded city');B.mount(api(w));G.mount(api(guest));w.sc.CityArt.buildings=towers;guest.sc.CityArt.buildings=towers.map(b=>({...b}));
const b=w.sc.CityArt.buildings[4];B.point(b,{x:b.x+2,y:b.y+30,z:20,vx:1,vy:0},150);assert(B.inspect().states[0].hp.some(h=>h===0)&&B.inspect().states[0].hp.some(h=>h===100),'A tower has localized damage and resistance');assert(G.receive(B.snapshot()));
B.blast(b.x+b.w/2,b.y+b.d/2,250,600);for(let n=0;n<60;n++)B.tick(.02);assert(!B.solid(b));assert(G.receive(B.snapshot()));assert(!G.solid(guest.sc.CityArt.buildings[4]));for(let n=0;n<3500;n++)B.tick(.02);assert(B.solid(b)&&!B.active(),'Tower rebuilds using the ordinary sixty-second construction cycle');
Object.assign(w.a,{x:650,y:-700,z:40,vx:0,vy:0});w.sc.CityInventory.levitate(w.a,5,{vx:0,vy:0});w.sc.CityInventory.floatStep(w.a,.02);assert(w.a.y<0,'Weapon physics stays in the northern district');
console.log('Downtown: nine bounded towers, clear streets, connected road graph after housing relayout, north walking/driving/effects, localized demolition, guest structure replication and reconstruction passed.');
`,{require,console,structuredClone,Buffer,process});
let network=fs.readFileSync('city-multiplayer-sync-tests.cjs','utf8').split("run(50);clients.guest.key('keydown','d')")[0];
vm.runInNewContext(network+`
run(50);const s=structuredClone(latest.host);s.actors.forEach(a=>{a.x=650;a.y=-700;a.recovery=(a.recovery||0)+1;});for(const [id,c]of Object.entries(clients))if(id!=='host'){c.sc.City.receiveState(structuredClone(s));assert(c.sc.City.localActor().y<0,'Guests accept authoritative player poses north of the shops');}
console.log('Five guests accept authoritative northern player positions without rejecting the new map bounds.');
`,{require,console,structuredClone,Buffer,process});
