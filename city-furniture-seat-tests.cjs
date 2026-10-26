"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),C=require('./domain');
const {createCanvas}=require(require.resolve('@napi-rs/canvas',{paths:[process.cwd(),require('node:path').dirname(process.execPath)]}));
C.setCityStandalone(true);
const profile=C.upgrade(C.makeProfile('seat-test','Test',4));
profile.cityEstate.owned=true;profile.room={...profile.room,size:14,proportionsVersion:1,tileGridVersion:1};
const sc={BrawlCore:C,console,document:{createElement:()=>createCanvas(1,1),addEventListener(){}},App:{profile:()=>profile},CityNetwork:{room:()=>null},CityArt:{buildings:[],project:(x,y,z=0)=>({x:x*.94+y*.342,y:(y*.94-x*.342)*.82-z})},addEventListener(){}};sc.window=sc;
vm.createContext(sc);
for(const file of ['apartment.js','character-art.js','furniture-models.js','furniture-art.js','construction.js','house-refresh.js','city-homes.js','city-living.js','character-rig.js'])vm.runInContext(fs.readFileSync(file,'utf8'),sc,{filename:file});
const b={x:0,y:0,owner:profile.id,homeData:profile,playerHome:true};sc.CityArt.buildings=[b];
const toilet=C.catalog.find(i=>(i.kind||i.id)==='toilet');
for(const kind of ['toilet','sink','fridge','sofa','bed','table']){
 const id=C.catalog.find(i=>(i.kind||i.id)===kind).id,item={id,x:2,y:2,rotation:0},calls=[];
 const context={drawImage:(...args)=>calls.push(args)};
 sc.CityHomes.paintFurniture(context,{b,item});
 const thumbnail={getContext:()=>context};assert(sc.CityHomes.previewFurniture(thumbnail,id));
 assert.equal(calls[0][0],calls[1][0],kind+' uses the exact same cached image in store and world');
 assert(Math.abs(calls[0][3]/calls[0][4]-calls[1][3]/calls[1][4])<1e-10,kind+' is fitted uniformly, never stretched');
 const canvas=createCanvas(220,150);sc.Apartment.preview(canvas,id);assert(canvas.getContext('2d').getImageData(0,0,220,150).data.some(n=>n));
}
const neutral=()=>({hip:[0,0,48],chest:[0,0,88],head:[0,0,104],ls:[-16,0,84],rs:[16,0,84],ll:[-7,0,46],rl:[7,0,46],le:[-20,0,65],re:[20,0,65],lh:[-17,0,47],rh:[17,0,47],lk:[-7,0,25],rk:[7,0,25],lf:[-7,0,4],rf:[7,0,4]});
const actor={id:profile.id,x:120,y:120,z:0,insideHome:profile.id,driving:false};
sc.CityLiving.mount({actor:()=>actor,actors:()=>({[profile.id]:actor})});
for(const toiletModel of [toilet,...C.catalog.filter(i=>i.kind==='toilet'&&i.modelIndex!==undefined)])for(const scale of [1,2])for(let rotation=0;rotation<4;rotation++){
 const item={id:toiletModel.id,x:2,y:2,rotation,scale};profile.room.items=[item];
 const before={x:actor.x,y:actor.y,z:actor.z};sc.City={screenPoint:(...p)=>sc.CityArt.project(...p)};assert(sc.CityLiving.handle(actor.id,{action:'living-pose',kind:'toilet',item:item.id,duration:6}));
 const seat=sc.CityHomes.furnitureSeat(b,item);assert(Math.abs(actor.homeAction.seatHeight-seat.z)<1e-8);
 actor.homeAction.startedWall-=1000;for(let n=0;n<40;n++)sc.CityLiving.step(actor,{x:0,y:0},1/60);
 assert(Math.hypot(actor.x-seat.x,actor.y-seat.y)<.1,'Hips move over the actual bowl regardless of approach');assert.equal(actor.z,0);const screen=sc.CityArt.project(seat.x,seat.y,seat.z);assert.equal(sc.CityHomes.itemAtScreen(b,screen.x,screen.y)?.id,item.id,'Picking uses the same corrected geometry as drawing');
 assert.equal(actor.angle,Math.PI+rotation*Math.PI/2,'Faces away from the cistern in every orientation');
 const original=neutral(),pose=sc.CityLiving.joints(original,actor);assert(Math.abs(pose.hip[2]*.4-seat.z)<1e-8,'Hips rest exactly at the seat elevation');
 assert.equal(pose.lk[2],pose.ll[2],'Thighs are horizontal');assert.equal(pose.lf[2],4,'Feet remain at floor level');assert(pose.lk[1]>pose.ll[1]+20);assert.equal(original.hip[2],48,'Pose leaves shared neutral rig untouched');
 assert(sc.CityLiving.handle(actor.id,{action:'living-stop'}));assert.equal(actor.x,before.x);assert.equal(actor.y,before.y);
}
const small={id:toilet.id,x:2,y:2,rotation:0};assert.equal(sc.CityHomes.furniturePoint(b,small,.5,.5,100).z,42.5,'Small half-tile furniture also scales vertically');
// Optional visual contact sheet, using the production world renderer and articulated character rig.
if(process.argv.includes('--image')){
 const out=createCanvas(1280,540),ctx=out.getContext('2d');ctx.fillStyle='#eff2e9';ctx.fillRect(0,0,1280,540);
 for(let rotation=0;rotation<4;rotation++){
  const item={...small,x:0,y:0,rotation};profile.room.items=[item];actor.x=80;actor.y=80;
  sc.CityLiving.handle(actor.id,{action:'living-pose',kind:'toilet',item:item.id,duration:6});actor.homeAction.time=1;
  const seat=sc.CityHomes.furnitureSeat(b,item);actor.x=seat.x;actor.y=seat.y;
  ctx.fillStyle='#29444d';ctx.font='bold 18px sans-serif';ctx.fillText('Orientation '+(rotation*90)+'°',rotation*320+20,32);
  const preview=createCanvas(220,150);sc.Apartment.preview(preview,item.id);ctx.drawImage(preview,rotation*320+50,45);
  ctx.save();ctx.translate(rotation*320+140,450);ctx.scale(3,3);
  sc.CityHomes.paintFurniture(ctx,{b,item});const p=sc.CityArt.project(seat.x,seat.y),f=sc.CityArt.project(Math.sin(actor.angle),-Math.cos(actor.angle));
  sc.CharacterRig.draw(ctx,{skin:'skin-neutral',useCustomAppearance:false},{x:p.x,y:p.y,scale:.4,yaw:Math.atan2(f.x,f.y),homeAction:actor.homeAction,shadow:false});ctx.restore();
  sc.CityLiving.handle(actor.id,{action:'living-stop'});
 }
 fs.writeFileSync('../toilettes-proportions-et-assise.png',out.toBuffer('image/png'));
}
C.setCityStandalone(false);console.log('Furniture: identical store/world sprites without stretch, proportional small models, seated hips on bowl, horizontal thighs, grounded feet, all four rotations, scaled models and return position passed.');
