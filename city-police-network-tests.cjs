'use strict';
const fs=require('node:fs'),vm=require('node:vm');
// Use six complete city clients and the same delayed, ordered transport as the all-mode suite.
let fixture=fs.readFileSync('city-multiplayer-sync-tests.cjs','utf8').split("run(50);clients.guest.key")[0];
fixture=fixture.replace("'city-tanks.js','city-mini-soldiers.js'","'city-tanks.js','city-police.js','city-mini-soldiers.js'").replace("process.env.CITY_NETWORK_STRESS==='1'","true");
vm.runInNewContext(fixture+`
run(70);const h=clients.host.sc,g=clients.guest.sc;
g.CityNetwork.send('activity',{action:'inventory-equip',item:'gravity'});run(60);assert(g.CityInventory.request());assert(g.CityInventory.inspect().shots.some(q=>q.local),'Guest firing remains instant');run(80);
for(const c of Object.values(clients))assert(c.sc.CityPolice.current('guest'),'Every peer sees the guest wanted status');assert(!h.CityPolice.current('host'),'Bystanders are not wanted');
h.CityInventory.handle('host',{action:'inventory-equip',item:'dance'});assert(h.CityInventory.request());run(60);for(const c of Object.values(clients)){assert(c.sc.CityPolice.current('host'));assert(c.sc.CityPolice.current('guest'));assert.equal(c.sc.CityPolice.snapshot().wave,1);}
function safeRun(n){for(let k=0;k<n;k++){for(const id of ['host','guest']){const status=clients[host].sc.CityPolice.current(id);if(status){status.hp=100;status.vehicleHp=100;}}frame();}}
for(const expected of [2,4,8,16,32]){const police=clients[host].sc.CityPolice;for(const officer of police.units())police.hit(officer,100,'guest');safeRun(180);for(const c of Object.values(clients)){assert.equal(c.sc.CityPolice.snapshot().wave,expected);assert.equal(c.sc.CityPolice.units().filter(p=>!p.dead).length,expected);}}
for(const c of Object.values(clients))assert.equal(c.sc.CityPolice.traffic().filter(a=>a.policeTank).length,2);assert(Math.max(...sizes)<196608,'Full 32-officer response still fits the signed transport');
assert(!h.CitySpawn.handle('guest',{action:'road-spawn-return',point:{x:650,y:550,angle:0}}));assert(!h.CityGames.launch('hockey',['host','guest'],'host'),'A minigame cannot erase a pursuit');
host='guest';pending=[];for(const c of Object.values(clients))c.sc.City.authorityChanged();safeRun(100);const elected=clients.guest.sc;assert(elected.CityPolice.current('host')&&elected.CityPolice.current('guest'));assert.equal(elected.CityPolice.snapshot().wave,32,'Migration preserves the police response');
// Only the eliminated player leaves the wanted list; the other pursuit continues.
elected.CityPolice.current('host').hp=2;elected.CityPolice.hit(clients.host.sc.City.localActor(),10,'police-test');run(50);for(const c of Object.values(clients)){assert(!c.sc.CityPolice.current('host'));assert(c.sc.CityPolice.current('guest'));}run(220);for(const c of Object.values(clients))assert(!c.sc.CityPolice.locked('host'));
elected.CityPolice.current('guest').hp=2;elected.CityPolice.hit(elected.City.localActor(),10,'police-test');run(250);for(const c of Object.values(clients)){assert(!c.sc.CityPolice.active());assert(!c.sc.CityPolice.current('guest'));}for(const c of Object.values(clients))c.sc.City.destroy();console.log('Six full clients with variable latency: instant guest fire, wanted-state replication, shared doubling waves through 32 + two tanks, blocked spawn/mode escape, host migration and independent death endings passed.');
`,{require,console,process,structuredClone,Buffer},{filename:'six-client-police-fixture.cjs'});
