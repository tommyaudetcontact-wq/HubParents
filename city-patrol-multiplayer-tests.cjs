'use strict';
const fs=require('node:fs'),vm=require('node:vm');
let prefix=fs.readFileSync('city-multiplayer-sync-tests.cjs','utf8').split("run(50);clients.guest.key('keydown','d')")[0];
prefix=prefix.replace('const stress=',"C.setCityStandalone(true);const stress=").replace("'city.js'","'city-patrol.js','city.js'");
vm.runInNewContext(prefix+`
run(60);const h=clients.host.sc,g=clients.guest.sc;
const m={id:'guest-patrol-123456789',owner:'guest',phase:'running',created:now,expires:now+600000,count:1,reward:1,seq:0,targets:[{id:'guest-target',x:1750,y:550,model:'car-retro',armed:true,hits:0,hp:100,combat:0}]};
assert(g.CityPatrol.handle('guest',{action:'patrol-start',mission:m}));g.CityNetwork.send('activity',{action:'patrol-start',mission:m});run(35);
assert(h.CityPatrol.onDuty('guest'));assert(g.City.localActor().driving);assert.equal(latest.host.actors.find(a=>a.id==='guest').loanId,'patrol:'+m.id);
clients.guest.key('keydown','w');run(150);clients.guest.key('keyup','w');run(60);divergence('Guest police driving',18);assert(latest.host.actors.find(a=>a.id==='guest').police,'Duty car remains a police car on host');
for(const client of Object.values(clients)){const s=client.sc.CityPatrol.inspect();assert.equal(s.jobs.length,1);assert.equal(s.jobs[0].targets[0].hp,100);assert.equal(s.jobs[0].targets[0].hits,0);}
// The guest may not independently modify target health, and all clients retain state through host migration.
const before=h.CityPatrol.inspect().jobs[0].targets[0].hits;g.CityPatrol.contact({a:g.City.localActor(),b:g.CityPatrol.inspect().jobs[0].targets[0].car,closing:150});assert.equal(g.CityPatrol.inspect().jobs[0].targets[0].hits,before);
host='p2';for(const c of Object.values(clients))c.sc.City.authorityChanged();run(80);assert(clients.p2.sc.CityPatrol.onDuty('guest'));divergence('Migrated guest police driving',20);assert(clients.p2.sc.CityPatrol.inspect().jobs[0].targets[0].car.route?.length,'New host resumes road routing');
C.setCityStandalone(false);C.configureResidential();console.log('Police multiplayer: six actual city clients keep the guest loan, speed, police appearance, target health, prediction and NPC authority consistent under delayed packets and host migration.');
`,{require,console,structuredClone,Buffer,process});
