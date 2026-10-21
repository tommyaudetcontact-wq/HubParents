'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),C=require('./domain.js');
function client(host=true){const s={Math,Date,Map,Set,BrawlCore:C};s.window=s;vm.createContext(s);for(const name of ['city-damage.js','city-driving.js','city-art.js'])vm.runInContext(fs.readFileSync(name,'utf8'),s);const a={id:'p',x:600,y:550,angle:0,driving:true,vx:0,vy:-240},v=C.vehicles[0],members=[{id:'p',cars:{[v.id]:{color:'#cc3344'}}}];s.CityDamage.mount({host:()=>host,actor:()=>a,members:()=>members});s.CityDamage.bind(a,v);return {s,a,v,members,d:s.CityDamage};}
{
 const {s,a,d,v}=client();d.impact(a,15,0,-1);assert.equal(a.damage.parts[0],0);
 d.impact(a,200,0,-1);assert(a.damage.parts[0]>0&&a.damage.parts[1]===0);const front=a.damage.parts[0];d.impact(a,200,0,1);assert.equal(a.damage.parts[0],front);assert(a.damage.parts[1]>0);
 for(let i=0;i<4;i++)d.impact(a,300,-1,0);assert.equal(a.damage.parts[2],100);assert.equal(a.damage.parts[4],100);assert.equal(a.damage.parts[3],0);assert.equal(d.inspect().length,2);const piece={...d.inspect()[0]};d.tick(.02);assert.notEqual(d.inspect()[0].x,piece.x);assert(d.inspect()[0].z>piece.z);assert.notEqual(d.inspect()[0].angle,piece.angle);
 for(let i=0;i<700;i++)d.tick(.07);assert.equal(d.inspect().length,2);for(let i=0;i<200;i++)d.tick(.07);assert.equal(d.inspect().length,0);
 a.loanVehicle='car-retro';a.loanId='derby-1';d.bind(a,C.vehicles.find(v=>v.id==='car-retro'));assert.equal(a.damage.parts[0],0);a.loanVehicle=null;d.bind(a,v);assert.equal(a.damage.parts[0],front);
 console.log('Directional panel damage, mirror breakage, physical translation/spin/bounce, 60-second expiry and owned/loan isolation passed.');
}
{
 const host=client(),guest=client(false);for(let i=0;i<4;i++)host.d.impact(host.a,300,0,-1);guest.d.impact(guest.a,300,0,-1);assert.equal(guest.a.damage.parts[0],0);guest.d.receive(host.d.snapshot());assert.equal(guest.d.inspect().length,1);guest.d.tick(.03);assert(guest.d.inspect()[0].z>0);const count=guest.d.inspect().length;guest.d.receive([[1,2,NaN]]);assert.equal(guest.d.inspect().length,count);
 const a={id:'a',x:500,y:500,angle:0,driving:true,vx:0,vy:-240},b={id:'b',x:500,y:450,angle:0,npc:true,vx:0,vy:0};for(const p of [a,b])host.d.bind(p,host.v);for(const hit of host.s.CityDriving.contacts([a],[b]))host.d.contact(hit);assert(a.damage.parts[0]>0);assert(b.damage.parts[1]>0);
 const wall={id:'wall',x:102,y:150,angle:Math.PI/2,driving:true,vx:240,vy:20,speed:240};host.d.bind(wall,host.v);host.s.CityDriving.collide(wall,[{x:110,y:100,w:100,d:100}],C.cityMap);assert(wall.damage.parts.some(n=>n>0));assert.equal(wall.vy,20);
 console.log('Host-only contacts, guest debris prediction, malformed wire rejection, NPC bumper damage and building impacts without losing wall sliding passed.');
}
{
 let seq=0,p=C.makeProfile({id:'damage-test',name:'Test',grade:4});p.coins=1000;const apply=(type,data={})=>p=C.apply(p,{id:'damage-'+seq++,type,...data},'2026-10-21',false);apply('buy',{item:'car-pulse'});const car='car-pulse',parts=[100,30,55,0,100,0];apply('carWear',{car,damage:{parts,repair:0}});assert.equal(p.garage.cars[car].damage.parts[0],100);apply('carWear',{car,damage:{parts:[0,0,0,0,0,0],repair:0}});assert.equal(p.garage.cars[car].damage.parts[0],100);const fuel=p.garage.cars[car].fuel,coins=p.coins;apply('carRepair',{car});assert.equal(p.coins,coins);assert.equal(p.garage.cars[car].fuel,fuel);assert.equal(p.garage.cars[car].damage.repair,1);apply('carWear',{car,damage:{parts,repair:0}});assert.equal(p.garage.cars[car].damage.parts[0],0);assert.throws(()=>apply('carWear',{car,damage:{parts:[Infinity],repair:1}}));assert.throws(()=>apply('carRepair',{car:'car-veloce'}));
 const {d,a,v,members}=client();d.impact(a,200,0,-1);members[0].cars[v.id].damage={parts:[0,0,0,0,0,0],repair:1};d.bind(a,v);assert.equal(a.damage.parts[0],0);
 console.log('Saved damage cannot improve by ordinary writes; garage repair preserves money/fuel, rejects unowned cars and wins over delayed old damage packets.');
}
{
 const {createCanvas}=require('C:/Users/recto/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas'),{s,d,a,v}=client();s.document={createElement:()=>createCanvas(1,1)};const canvas=createCanvas(1200,610),g=canvas.getContext('2d');g.fillStyle='#bec5b2';g.fillRect(0,0,1200,610);
 const states=[[0,0,0,0,0,0],[35,0,25,0,40,0],[75,65,65,0,100,0],[100,100,100,70,100,100]];states.forEach((parts,i)=>{g.save();g.translate(150+i*300,230);g.scale(3.3,3.3);s.CityArt.car(g,{...a,x:0,y:0,angle:1.9,damage:{parts},damageLength:v.length*.8},v,'#cf4438');g.restore();g.fillStyle='#24454d';g.font='bold 21px sans-serif';g.textAlign='center';g.fillText(['Intacte','Déformée','Panneaux ouverts','Pièces arrachées'][i],150+i*300,330);});
 for(let i=0;i<4;i++)d.impact(a,300,-1,0);for(let n=0;n<30;n++)d.tick(.02);g.save();g.translate(-440,140);d.draw(g,s.CityArt.project);g.restore();fs.writeFileSync('../vehicle-damage-preview.png',canvas.toBuffer('image/png'));assert(s.CityArt.cacheStats().carPixels<=4000000);
 console.log('Native Canvas damage stages and detached panels rendered; vehicle sprites retain their bounded cache.');
}
{
 const {createCanvas}=require('C:/Users/recto/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas'),{s,v}=client();
 const render=(angle,parts)=>{const canvas=createCanvas(260,260),g=canvas.getContext('2d');g.translate(130,130);g.scale(2,2);s.CityArt.car(g,{x:0,y:0,angle,damage:{parts},noShadow:true},v,'#ad78ce');return g.getImageData(0,0,260,260).data;};
 // An opened far-side door may protrude outside the silhouette, but cannot repaint opaque body pixels.
 for(let n=0;n<24;n++){const angle=n*Math.PI/12,near=Math.sin(angle)*.94-Math.cos(angle)*.342>=0?1:-1,parts=[0,0,0,0,0,0];parts[near>0?2:3]=70;const base=render(angle,[0,0,0,0,0,0]),damaged=render(angle,parts);let changed=0;for(let i=0;i<base.length;i+=4)if(base[i+3]===255&&(base[i]!==damaged[i]||base[i+1]!==damaged[i+1]||base[i+2]!==damaged[i+2]))changed++;assert.equal(changed,0,'Far door must stay behind the opaque body at heading '+n*15);}
 const {d,a,members}=client();members[0].cars[v.id].color='#ed2424';d.bind(a,v);for(let i=0;i<3;i++)d.impact(a,300,0,-1);assert.equal(d.inspect()[0].color,'#ed2424');members[0].cars[v.id].color='#2463eb';assert.equal(d.inspect()[0].color,'#ed2424','Detached paint is frozen at impact time');a.loanVehicle='car-horizon';a.loanId='taxi';d.bind(a,C.vehicles.find(v=>v.id===a.loanVehicle));for(let i=0;i<3;i++)d.impact(a,300,0,-1);assert.equal(d.inspect().at(-1).color,'#edbd43');a.police=true;a.loanId='police';d.bind(a,C.vehicles.find(v=>v.id===a.loanVehicle));for(let i=0;i<3;i++)d.impact(a,300,0,-1);assert.equal(d.inspect().at(-1).color,'#e5e9e6');
 console.log('Far doors are masked by the body across 24 headings; detached custom-painted, taxi and police panels retain the vehicle paint at impact time.');
}
