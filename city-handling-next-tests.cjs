'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('./domain.js'),D=require('./city-driving.js'),Combat=require('./city-combat.js'),G=require('./city-games.js'),T=require('./city-tailblazer.js'),Stunts=require('./city-stunts.js'),Circuit=require('./city-circuit.js');
globalThis.CityStunts=Stunts;
function game(kind){const actors={a:{id:'a',x:650,y:550},b:{id:'b',x:750,y:550}},s=G.create(kind,'a');s.accepted=['a','b'];assert(G.start(s,actors,['a','b'].map(id=>({id,vehicle:'car-pulse',cars:{'car-pulse':{fuel:600}}}))));return {s,actors};}
{
 const car=C.vehicles.find(v=>v.id==='car-horizon');let a={x:650,y:550,angle:Math.PI/2,speed:0,vx:0,vy:0,driving:true},p={...a,hp:100,riding:true};
 for(let n=0;n<120;n++){const input={x:n>70?.4:0,y:-.78,brake:false};a=D.collide(D.step(a,input,1/120,car),[],C.cityMap);Combat.move(p,input,1/120,{kind:'zombie'});}
 assert(Math.hypot(a.x-p.x,a.y-p.y)<1e-8);assert(Math.abs(a.angle-p.angle)<1e-8,'Zombie bonus uses the ordinary car steering/acceleration model');
 const impact=(speed,y)=>{const {s,actors}=game('zombie'),p=s.players.a;s.buffs.vehicleUntil=30;p.riding=true;Object.assign(p,{x:650,y:550,angle:Math.PI/2,vx:speed,vy:0,speed});s.wavePause=999;s.zombies=[{id:'contact-'+speed+'-'+y,x:681,y,hp:50,dead:false,phase:0}];G.laser(s,'a',{x:0,y:-.78,ax:0,ay:0,fire:false});G.simulate(s,actors,1/120);return s.zombies[0];};
 const slow=impact(70,550),fast=impact(230,550),glance=impact(230,562);assert(slow.dead&&fast.dead&&glance.dead);assert(fast.kx>slow.kx*2);assert(Math.abs(glance.spin)>Math.abs(fast.spin));
}
{
 const initial={x:900,y:1940,angle:1.1,speed:150,vx:120,vy:-90,z:40,vz:80,driving:true,yawRate:2};let a={...initial},b={...initial};
 for(let n=0;n<15;n++){a=D.step(a,{x:1,y:-1,brake:false},1/120,C.vehicles[0],5);b=D.step(b,{x:-1,y:1,brake:true},1/120,C.vehicles[0],0);assert.equal(a.angle,initial.angle);assert.equal(a.vx,initial.vx);assert.equal(a.vy,initial.vy);assert.equal(a.speed,initial.speed);assert.equal(a.x,b.x);assert.equal(a.y,b.y);}
}
{
 const hit=(speed,offset)=>{const a={id:'a',x:0,y:0,driving:true,angle:Math.PI/2,vx:speed,vy:0,speed},b={id:'b',x:35,y:offset,driving:true,angle:0,vx:0,vy:0,speed:0,parked:true};D.contacts([a],[b]);return b;};
 const straight=hit(150,0),off=hit(150,10),fast=hit(250,10);assert(Math.abs(straight.yawRate||0)<.001);assert(Math.abs(off.yawRate)>0);assert(Math.abs(fast.yawRate)>Math.abs(off.yawRate));const angle=off.angle;D.parkedStep(off,.03,[],C.cityMap);assert.notEqual(off.angle,angle);
 const p={x:C.cityMap.track.x-50,y:C.cityMap.track.y+300,angle:Math.PI*.7,speed:170,vx:100,vy:100};Circuit.constrain(p);assert(p.wallContact);assert.equal(p.engineSpeed,170);assert(Math.hypot(p.vx,p.vy)>20);
}
{
 const {s,actors}=game('drift');assert(Stunts.driftPath.length>=10);assert(Stunts.nearestDrift(actors.a).d<=42);
 for(const id of ['a','b']){s.players[id].score=id==='a'?50:100;for(let n=0;n<Stunts.driftPath.length*2;n++){const next=s.players[id].nextGate,q=Stunts.driftPath[next],prev=Stunts.driftPath[(next+Stunts.driftPath.length-1)%Stunts.driftPath.length];Object.assign(actors[id],{x:q.x,y:q.y,vx:(q.x-prev.x)*.01,vy:(q.y-prev.y)*.01});G.simulate(s,actors,.01);}assert(s.players[id].finished);assert.equal(s.players[id].lap,2);}
 assert.equal(s.phase,'finished');assert.equal(s.winner,'b','Score, rather than arrival order, decides the two-lap drift winner');
}
{
 const {s}=game('tailblazer');s.pause=0;const p=s.players.a;T.move(s,p,{x:0,y:-1},1/60);const short=p.tailLength;assert(T.pace(0)<90);assert(T.pace(40)>T.pace(0)*1.7);
 for(let n=0;n<3600;n++){s.roundTime=n/60;T.move(s,p,{x:Math.cos(n/100),y:Math.sin(n/100)},1/60);}assert(p.tailLength>short*5);assert(p.tail.length<=96);const wire=G.serialize(s,true);assert(!wire.players.a.tail);assert(wire.players.a.tailData.length<=192);assert(JSON.stringify(wire).length<5000);
}
{
 const source=fs.readFileSync('city-navigation.js','utf8');assert(!source.includes("'⚔ Combat"));const I=require('./city-invites.js');assert(!I.names.fight);assert.equal(G.launch('fight',['a','b'],'a'),false);
 const route=C.cityTrafficRoute('round-trip',0);for(const corner of [[100,100],[1750,100],[1750,1450],[100,1450]])assert(route.some(p=>p.x===corner[0]&&p.y===corner[1]));assert.notDeepEqual(route,C.cityTrafficRoute('round-trip',1));
}
{
 const {createCanvas}=require('C:/Users/recto/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas');
 let allocations=0,writes=0;const nodes=new Map(),members=[{id:'a',name:'Alice'},{id:'b',name:'Bob'}],actors={a:{id:'a',x:650,y:550},b:{id:'b',x:750,y:550}};
 const node=()=>{const attrs=new Map();let text='';return {hidden:false,style:{},events:{},setAttribute:(k,v)=>{attrs.set(k,v);writes++;},getAttribute:k=>attrs.get(k),get textContent(){return text;},set textContent(v){text=v;writes++;},addEventListener(k,f){this.events[k]=f;},querySelector:()=>({style:{}}),getBoundingClientRect:()=>({left:0,top:0,width:240,height:58}),setPointerCapture(){}};};
 const canvas=createCanvas(390,550),attrs=new Map();canvas.setAttribute=(k,v)=>{attrs.set(k,v);writes++;};canvas.getAttribute=k=>attrs.get(k);canvas.addEventListener=()=>{};canvas.getBoundingClientRect=()=>({left:0,top:0,width:390,height:550});nodes.set('city-game-canvas',canvas);
 for(const id of ['city-game','city-game-title','city-game-score','zombie-drive','zombie-slider','zombie-reverse'])nodes.set(id,node());
 const scope={BrawlCore:C,Math,Date,Map,Set,devicePixelRatio:2,App:{profile:()=>({id:'a'}),toast(){},popup(){},closeModal(){}},CityNetwork:{room:()=>({id:'render-test'}),send(){}},document:{getElementById:id=>nodes.get(id),querySelector:()=>null,addEventListener(){},createElement:()=>{allocations++;return createCanvas(1,1);}}};scope.window=scope;vm.createContext(scope);
 for(const file of ['city-driving.js','bowling-physics.js','city-zombie-fx.js','city-combat.js','city-sports.js','city-tailblazer.js','city-games.js'])vm.runInContext(fs.readFileSync(file,'utf8'),scope);
 const g=scope.CityGames;g.mount({host:()=>true,actors:()=>actors,actor:()=>actors.a,members:()=>members});assert(g.launch('tailblazer',['a','b'],'a'));g.draw({});const before=writes,allocated=allocations;for(let n=0;n<30;n++)g.draw({});assert.equal(writes,before,'Stable Tailblazer frames must not repeatedly change layout-affecting DOM attributes/text');assert.equal(allocations,allocated,'The static rink reuses one cached canvas');assert(canvas.width*canvas.height<=451000);
 assert(g.launch('zombie',['a','b'],'a'));const s=g.snapshot();s.buffs.vehicleUntil=30;g.receive(s);g.tick(.016);g.tick(.016);const slider=nodes.get('zombie-slider'),event=x=>({pointerId:1,clientX:x,preventDefault(){}});slider.events.pointerdown(event(120));for(let n=0;n<30;n++)g.tick(1/60);let p=g.snapshot().players.a;assert(p.speed>50);const angle=p.angle;slider.events.pointermove(event(225));for(let n=0;n<15;n++)g.tick(1/60);p=g.snapshot().players.a;assert(p.angle>angle);slider.events.pointerup(event(225));for(let n=0;n<40;n++)g.tick(1/60);assert(Math.abs(g.snapshot().players.a.speed)<10);g.reset();
 console.log('Tailblazer reuses its backdrop without repeated HUD layout writes; zombie slider accelerates, steers and brakes through the real game input loop.');
}
(async()=>{
 let profile={id:'a',revision:1,cityWork:{active:{id:'old',kind:'taxi',vehicle:'car-horizon',index:1,hasPassenger:true,points:[{x:650,y:550},{x:650,y:1000}],expires:Date.now()+60000}}},popup=0,cancelled=false,starts=0;
 const actor={id:'a',x:650,y:1000,driving:true},scope={BrawlCore:C,Date,Math,Map,Set,crypto:require('node:crypto').webcrypto,CityNetwork:{room:()=>null},CityArt:{parked:[],buildings:[],size:C.cityMap},CityDriving:D,document:{getElementById:()=>null,querySelector:()=>null,addEventListener(){}},App:{profile:()=>profile,setProfile:p=>profile=p,toast(){},popup:()=>popup++,closeModal(){},api:async action=>{if(action==='cityJobCheckpoint')return {profile:{id:'a',revision:2,cityWork:{quarters:1,rental:{position:{x:650,y:1000}}}},job:null};if(action==='cityJobStart'){starts++;return {profile:{id:'a',revision:3,cityWork:{}},job:{id:'next',kind:'taxi',vehicle:'car-horizon',index:0,points:[{x:1200,y:100}],expires:Date.now()+60000}};}cancelled=true;return {profile:{...profile,revision:4}};}}};scope.window=scope;vm.createContext(scope);vm.runInContext(fs.readFileSync('city-activities.js','utf8'),scope);scope.CityActivities.mount({actor:()=>actor,actors:()=>({a:actor}),members:()=>[{id:'a'}],host:()=>true,loan:(v,on)=>actor.driving=on,saveFuel:async()=>{}});scope.CityActivities.tick(.016);await new Promise(r=>setImmediate(r));scope.CityActivities.tick(.016);await new Promise(r=>setImmediate(r));assert.equal(starts,1);assert.equal(popup,0);assert(scope.CityActivities.nextPoint());await scope.CityActivities.stopService();assert(cancelled);assert(!scope.CityActivities.serviceActive());assert(!actor.driving);scope.CityActivities.tick(.016);assert.equal(starts,1);
 console.log('Shared zombie driving, speed/angle zombie impacts, frozen airborne input, angular collisions, sliding circuits, two-lap drift scoring, bounded accelerating Tailblazer, varied NPC tours and uninterrupted taxi service passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
