'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('./domain.js'),G=require('./city-games.js'),D=require('./city-driving.js'),S=require('./city-sports.js'),T=require('./city-tailblazer.js'),Z=require('./city-zombie-fx.js');
const {createCanvas}=require('C:/Users/recto/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas');
function game(kind){const actors={a:{id:'a',x:650,y:550},b:{id:'b',x:700,y:550}},s=G.create(kind,'a');s.accepted=['a','b'];assert(G.start(s,actors));return {s,actors};}

// Exercise the actual City.loop -> Games.contact(event) path, not just contact(state,event).
{
 const profile={id:'a',name:'Alice',revision:1,garage:{selected:'car-pulse',cars:{'car-pulse':{fuel:600}}}},members=['a','b'].map(id=>({id,name:id,vehicle:'car-pulse',cars:profile.garage.cars}));
 const node=()=>({style:{},hidden:false,setAttribute(){},addEventListener(){},querySelector:()=>({style:{}}),getBoundingClientRect:()=>({left:0,top:0,width:390,height:650})}),canvas=createCanvas(390,650);canvas.parentElement=node();
 let now=0,callback,context,frameRequests=0;
 const scope={BrawlCore:C,Math,Date,Map,Set,crypto:require('node:crypto').webcrypto,App:{profile:()=>profile,api:async()=>({driveId:'drive'}),toast(){},closeModal(){},popup(){}},CityNetwork:{room:()=>({id:'runtime',host:'a',members}),isHost:()=>true,connected:()=>false,send(){}},document:{hidden:false,getElementById:id=>id==='city-canvas'?canvas:id==='modal'?{open:false}:['city-stick','city-action','city-fuel'].includes(id)?node():null,querySelector:()=>null,addEventListener(){},createElement:()=>createCanvas(1,1)},performance:{now:()=>now},ResizeObserver:class{observe(){}disconnect(){}},requestAnimationFrame:f=>(callback=f,++frameRequests),cancelAnimationFrame(){},setInterval:()=>1,clearInterval(){},matchMedia:()=>({matches:false}),devicePixelRatio:1,addEventListener(){}};
 scope.window=scope;vm.createContext(scope);
 for(const file of ['city-damage.js','city-driving.js','city-art.js','city-stunts.js','city-zombie-fx.js','city-combat.js','city-sports.js','city-tailblazer.js','bowling-physics.js','city-games.js','city-activities.js','city-car-depth.js','city-camera.js','city.js'])vm.runInContext(fs.readFileSync(file,'utf8'),scope);
 const mount=scope.CityGames.mount;scope.CityGames.mount=ctx=>{context=ctx;mount(ctx);};scope.City.mount();assert(scope.CityGames.launch('derby',['a','b'],'a'));
 const actors=context.actors(),d=C.cityMap.derby;
 for(let n=0;n<4;n++){
  Object.assign(actors.a,{x:d.x+120,y:d.y+120,angle:Math.PI/2,speed:160,vx:160,vy:0});
  Object.assign(actors.b,{x:d.x+190,y:d.y+120,angle:Math.PI/2,speed:0,vx:0,vy:0});
  now+=34;callback(now);const state=scope.CityGames.snapshot();assert(actors.a.damage.parts.some(v=>v>0),'Derby impact must change the rendered panel condition');assert(actors.b.damage.parts.some(v=>v>0));assert.equal(state.players.b.hp,75-n*25);assert.equal(state.players.a.hp,100-(n+1)*12.5);
  if(n<3){actors.b.x=d.x+350;for(let f=0;f<28;f++){now+=34;callback(now);}}
 }
 now+=34;callback(now);const calls=[],originalStep=scope.CityDriving.step;scope.CityDriving.step=(a,i,dt,car,boost)=>{calls.push({id:a.id,car,boost});return originalStep(a,i,dt,car,boost);};members[1].vehicle='car-inferno';members[1].cars={'car-inferno':{fuel:0,boost:5}};scope.CityActivities.controls=()=>({x:0,y:-1,brake:false});assert(scope.CityGames.launch('drift',['a','b'],'a'));now+=34;callback(now);for(const id of ['a','b']){const call=calls.find(p=>p.id===id);assert(call);assert.equal(call.car.id,'car-pulse');assert.equal(call.car.speed*.36,100);assert.equal(call.boost,0);}assert.equal(actors.a.loanVehicle,actors.b.loanVehicle);const tags=[],g=canvas.getContext('2d'),fillText=g.fillText.bind(g);g.fillText=(...args)=>{tags.push(args);fillText(...args);};scope.CityArt.nameTag(g,actors.a,members[0],true);assert(tags.some(t=>/pts · ×/.test(t[0])));assert(tags.find(t=>/pts · ×/.test(t[0]))[2]>tags.find(t=>t[0]===members[0].name)[2]);console.log('Actual city loop supplies both drift players the same 100 km/h loan car and zero personal upgrades.');
 scope.CityCamera.select('third');now+=34;callback(now);assert(scope.CityCamera.stats().faces>0,'Actual drift loop must render the perspective scene');scope.CityCamera.select('classic');now+=34;callback(now);
 const physicsStep=scope.CityDriving.step;scope.CityDriving.step=()=>{throw Error('transient vehicle frame');};const failedFrame=callback,beforeFailure=frameRequests;now+=34;assert.throws(()=>failedFrame(now),/transient vehicle frame/);assert.equal(frameRequests,beforeFailure+1);scope.CityDriving.step=physicsStep;now+=34;callback(now);assert(scope.CityGames.current('a'));console.log('A transient vehicle frame exception cannot cancel the following animation frame.');
 scope.City.destroy();console.log('Actual city frame loop applies all four derby impacts to visible player health.');
}

// Sustained shooting has no three-shot stall, on the host and on a predicted guest.
for(const kind of ['laser','zombie']){
 const {s,actors}=game(kind),p=s.players.a;p.ammo=0;s.wavePause=999;
 let shots=0,last=-1;
 for(let n=0;n<360;n++){G.laser(s,'a',{x:0,y:0,ax:0,ay:-1,fire:true});G.simulate(s,actors,1/120);if(p.lastShot!==undefined&&p.lastShot!==last){shots++;last=p.lastShot;}}
 assert(shots>=9&&shots<=11,kind+' must sustain its .3-second cadence even at zero ammo');
}

{
 const {s}=game('tennis');s.pause=0;const p=s.players.a;
 for(const x of [-1,0,1]){p.cooldown=0;s.ball.live=false;S.hit(s,'a',p,{fire:true,x,ax:-x});const target=s.ball.x+s.ball.vx*1.35;assert(Math.abs(target-(300+x*190))<.01);assert(s.ball.vy<0);}
 const a=S.tennisLayout(390,650),b=S.tennisLayout(780,1300);assert(Math.abs(b.scale/a.scale-2)<1e-9);assert.equal(S.controls({x:1,y:0},'tennis').x,1);
}
{
 let normal={x:0,y:0,angle:0,speed:180,vx:0,vy:-180},drift={...normal};const car=C.vehicles[0];
 for(let n=0;n<90;n++){normal=D.step(normal,{x:.55,y:-.78},1/120,car);drift=D.step(drift,{x:.55,y:-.78,drift:true},1/120,car);}
 const slip=a=>Math.abs(a.vx*Math.cos(a.angle)+a.vy*Math.sin(a.angle));assert(slip(drift)>slip(normal)*2);assert(Math.hypot(drift.vx,drift.vy)>80);
 const player={id:'p',x:0,y:0,driving:true,angle:Math.PI/2,vx:180,vy:0,speed:180},npc={id:'n',npc:true,x:35,y:0,angle:Math.PI/2,vx:0,vy:0,speed:0};D.contacts([player],[npc]);assert(player.vx>145);assert(npc.vx>180);
 let a={x:82,y:140,angle:Math.PI*.75,speed:180,vx:120,vy:120,driving:true};const y=a.y;
 for(let n=0;n<180;n++){a=D.step(a,{x:0,y:-.78},1/120,car);D.collide(a,[{x:100,y:0,w:100,d:1000}],{width:2000,height:2000});}assert(a.y>y+80,'Driving into a wall at an angle keeps sliding along it');
}
{
 const {s}=game('zombie'),z={id:'physical-test',x:200,y:300,phase:2,hp:1};s.elapsed=2;Z.death(s,z,{vx:500,vy:200});
 const launch=Z.rigFor(z,2.2).nodes.map(n=>n.slice(0,3)),land=Z.rigFor(z,5).nodes;
 assert(launch.some(n=>n[2]>30));assert(land.every(n=>n[2]>=1.99&&n.every(Number.isFinite)));assert(land.some(n=>n[0]>70));assert(land.every(n=>n[2]<8),'Independent articulated joints settle on the ground');
 s.zombies=[];s.drops=[{id:'car',kind:'car',x:s.players.a.x,y:s.players.a.y,expires:20}];Z.before(s,.01);assert.equal(s.buffs.vehicleUntil,32);assert(Object.values(s.players).every(p=>p.riding));s.elapsed=32.1;Z.before(s,.01);assert(Object.values(s.players).every(p=>!p.riding));
}
{
 const {s,actors}=game('tailblazer');s.pause=0;const a=s.players.a,b=s.players.b;b.tail=[[a.x-20,a.y],[a.x+20,a.y]];assert(T.crash(s,a));b.tail=[];a.x=500+T.radius;assert(T.crash(s,a));
 for(let round=1;round<=3;round++){s.pause=0;a.out=false;a.hp=100;a.x=500;a.y=300;a.tail=[];b.out=true;b.hp=0;b.tail=[];s.roundPause=1.49;T.step(s,actors,.02,G.finish);}
 assert.equal(s.phase,'finished');assert.equal(s.winner,'a');assert.equal(a.score,15);assert.equal(b.score,9);
 assert.notEqual(T.colors[0],T.colors[1]);assert(JSON.stringify(G.serialize(s,true)).length<16000);
}
console.log('Full-cadence shooters, joystick-directed vertical tennis, real drift slip, heavy player cars, wall sliding, physical zombie joints/car bonus and three-round Tailblazer passed.');

(async()=>{
 for(const kind of ['coin','card']){
  let profile={id:'a',revision:1,cards:[]},rewardResolve,popup='',stops=0;
  const modal={open:false},card=C.cards[0],texts=[];
  const scope={Date,Math,BrawlCore:C,CityArt:{project:(x,y,z)=>({x,y:y-z})},CityGames:{overlayActive:()=>false},GameFX:{reveal:c=>'<article>'+c.id+'</article>'},document:{getElementById:()=>modal},App:{profile:()=>profile,setProfile:p=>profile=p,popup:html=>{popup=html;},toast(){},api:async action=>action==='cityLootStatus'?{loot:{id:'confirmed-pickup',x:100,y:100,kind,expires:Date.now()+60000}}:new Promise(resolve=>rewardResolve=resolve)}};
  scope.window=scope;vm.createContext(scope);vm.runInContext(fs.readFileSync('city-loot.js','utf8'),scope);
  scope.CityLoot.mount({actor:()=>({x:100,y:100}),stop:()=>stops++});scope.CityLoot.tick();await new Promise(r=>setImmediate(r));scope.CityLoot.tick();assert(rewardResolve);assert.equal(popup,'');
  const g=createCanvas(400,400).getContext('2d'),fillText=g.fillText.bind(g);g.fillText=(text,...args)=>{texts.push(text);fillText(text,...args);};
  scope.CityLoot.draw(g);assert(!texts.includes('+1 $'),'No visual money grant before server confirmation');
  if(kind==='card')modal.open=true;
  rewardResolve({loot:null,reward:kind,profile:{...profile,revision:2,cards:kind==='card'?[{id:card.id}]:[]}});await new Promise(r=>setImmediate(r));
  if(kind==='coin'){scope.CityLoot.draw(g);assert(texts.includes('+1 $'));}else{assert.equal(popup,'','Do not replace an already open dialog');modal.open=false;scope.CityLoot.tick();assert(popup.includes(card.id));assert.equal(stops,1);}
  scope.CityLoot.reset();
 }
 console.log('Confirmed city pickups show floating +1 $ or the existing card reward reveal; pending dialogs are preserved.');
})().catch(e=>{console.error(e);process.exitCode=1;});
