'use strict';
window.CityArt=(()=>{
 const size={width:1300,height:1100},project=(x,y,z=0)=>({x:x*.94+y*.342,y:(y*.94-x*.342)*.82-z});
 const buildings=[
 {x:185,y:190,w:155,d:110,h:66,color:'#e4c9aa',roof:'#688c8a',name:'RUE DES TILLEULS'},
 {x:380,y:185,w:160,d:125,h:94,color:'#c78467',roof:'#667986',name:'LE COIN'},
 {x:190,y:355,w:140,d:100,h:52,color:'#e2d8be',roof:'#7e9a87'},
 {x:375,y:355,w:160,d:100,h:73,color:'#a8bcc0',roof:'#697b8a'},
 {x:755,y:185,w:170,d:110,h:87,color:'#ead7a7',roof:'#b47664',name:'BELLEVUE'},
 {x:965,y:190,w:145,d:115,h:58,color:'#c3d0bc',roof:'#698e88'},
 {x:765,y:355,w:140,d:105,h:64,color:'#cd967e',roof:'#6a808c'},
 {x:965,y:355,w:145,d:105,h:92,color:'#e2ccb3',roof:'#867e88'},
 {x:190,y:665,w:155,d:115,h:72,color:'#b6cbc8',roof:'#6b828d'},
 {x:390,y:665,w:140,d:115,h:55,color:'#dfb79b',roof:'#9d776c'},
 {x:195,y:835,w:140,d:105,h:60,color:'#decbb2',roof:'#788c77'},
 {x:390,y:840,w:140,d:100,h:83,color:'#c48973',roof:'#788995'},
 {x:845,y:705,w:235,d:100,h:48,color:'#eee0ba',roof:'#b74848',name:'STATION • OCTANE',fuel:true}
 ];
 for(const p of BrawlCore.cityPlaces||[]){const b=buildings[p.building];if(b)b.name=({'sale-skins':'STUDIO SIGNATURE','sale-bath':'BAIN & COMPAGNIE','sale-furniture':'LE SALON',restaurant:'LE RELAIS · RESTO',taxi:'CENTRALE TAXIS',garage:'GARAGE COULEURS',fuel:'STATION OCTANE'}[p.id]);}
 let ground=null,sprites=new Map(),avatars=new Map();
 function poly(c,points,color){c.fillStyle=color;c.beginPath();points.forEach((p,n)=>n?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.closePath();c.fill();}
 function plane(c,x,y,w,d,z,color){poly(c,[[x,y],[x+w,y],[x+w,y+d],[x,y+d]].map(p=>project(...p,z)),color);}
 function wall(c,x,y,w,d,z,h,color){poly(c,[project(x,y,z),project(x+w,y+d,z),project(x+w,y+d,z+h),project(x,y,z+h)],color);c.strokeStyle='#38443d88';c.lineWidth=.65;c.stroke();}
 function box(c,x,y,w,d,z,h,color,side,roof){wall(c,x,y+d,w,0,z,h,color);wall(c,x,y,0,d,z,h,side);plane(c,x,y,w,d,z+h,roof);}
 function building(c,b){const {x,y,w,d,h}=b;plane(c,x+18,y+12,w+12,d+12,0,'#25354122');box(c,x,y,w,d,0,h,b.color,tint(b.color,-30),b.roof);wall(c,x,y+d,w,0,0,5,'#ede4cd');wall(c,x+w,y,0,d,0,5,'#c5bda9');
 for(let z=18;z<h-8;z+=25){for(let n=16;n<w-15;n+=31){wall(c,x+n,y+d+.2,17,0,z,16,'#415765');wall(c,x+n+2,y+d+.3,12,0,z+3,10,'#a5cbd0');}for(let n=16;n<d-15;n+=30)wall(c,x-.2,y+n,0,16,z,16,'#52717d');}
 box(c,x-3,y-3,w+6,d+6,h,4,'#e7dfce','#bfbbaa',b.roof);box(c,x+22,y+22,30,22,h+4,11,'#b4b8b0','#929c9c','#d1d6c9');plane(c,x+60,y+20,30,35,h+4,'#546970');
 if(!b.fuel){wall(c,x+10,y+d+.5,w-20,0,6,19,'#37525b');for(let n=12;n<w-15;n+=24)wall(c,x+n,y+d+.8,18,0,9,13,'#8ea9aa');wall(c,x+w*.45,y+d+1,18,0,0,26,'#31484b');plane(c,x-3,y+d-3,w+6,14,29,b.color==='#c78467'?'#a74b46':'#6b8e85');for(let n=4;n<w;n+=16)plane(c,x+n,y+d-3,7,14,29,'#e3d8bd');for(let n=12;n<w-15;n+=22)plane(c,x+n,y+15,9,20,h+4,'#536b72');}
 if(b.name){const p=project(x+w*.5,y+d+.5,12);c.save();c.translate(p.x,p.y);c.transform(.94,-.28044,0,1,0,0);c.fillStyle=b.fuel?'#b84e47':'#476b6d';c.fillRect(-w*.42,-11,w*.84,16);c.fillStyle='#fff4d8';c.font='bold 10px sans-serif';c.textAlign='center';c.fillText(b.name,0,0);c.restore();}
 if(b.fuel){for(const px of [x+55,x+155]){box(c,px,y+d+75,13,16,0,27,'#c9514e','#943f42','#f0e7cc');wall(c,px+2,y+d+91,9,0,14,8,'#304b54');}for(const px of [x+15,x+w-15])box(c,px,y+d+30,4,4,0,55,'#dfd8c5','#a6a8a0','#f0e6cb');box(c,x-10,y+d+20,w+20,100,55,6,'#c04f48','#9e4843','#eee6d1');}}
 function tree(c,x,y){plane(c,x+10,y+8,30,23,0,'#243c3820');box(c,x,y,5,5,0,22,'#958363','#796e55','#9b896b');const p=project(x,y,36);for(const [dx,dy,r,color]of [[0,0,23,'#4f7f69'],[-9,-6,17,'#6e9978'],[7,-13,16,'#8aad86']]){c.fillStyle=color;c.beginPath();c.arc(p.x+dx,p.y+dy,r,0,7);c.fill();}}
 function paintGround(c){plane(c,-25,-25,size.width+50,size.height+50,0,'#a7b99a');plane(c,30,30,1240,1040,0,'#cfcebc');for(const x of [100,650,1200])plane(c,x-58,35,116,1030,0,'#626d76');for(const y of [100,550,1000])plane(c,35,y-58,1230,116,0,'#626d76');for(const x of [100,650,1200])for(let y=35;y<1060;y+=48)if(![100,550,1000].some(n=>Math.abs(y-n)<85))plane(c,x-1,y,2,21,0,'#e4d9ab');for(const y of [100,550,1000])for(let x=35;x<1260;x+=48)if(![100,650,1200].some(n=>Math.abs(x-n)<85))plane(c,x,y-1,21,2,0,'#e4d9ab');
 for(const x of [100,650,1200])for(const y of [100,550,1000]){for(let n=0;n<6;n++){plane(c,x-44+n*16,y-85,9,17,0,'#e9e2cc');plane(c,x-85,y-44+n*16,17,9,0,'#e9e2cc');}}
 for(const y of [162,488,612,938])for(let x=175;x<1140;x+=42)plane(c,x,y,1,35,0,'#a9a99555');for(const x of [162,588,712,1138])for(let y=175;y<935;y+=42)plane(c,x,y,35,1,0,'#aaa99555');
 plane(c,735,650,400,290,0,'#bfc3b6');for(let x=750;x<1120;x+=45){plane(c,x,850,2,70,0,'#e8e1c6');}plane(c,780,910,340,35,0,'#d7ccb2');
 for(const x of [165,570,735,1140])for(const y of [165,485,635,945])tree(c,x,y);
 }
 function bounds(x,y,w,d,h=0){const points=[[x,y],[x+w,y],[x+w,y+d],[x,y+d]].flatMap(p=>[project(...p),project(...p,h)]),left=Math.floor(Math.min(...points.map(p=>p.x))-20),top=Math.floor(Math.min(...points.map(p=>p.y))-20);return {left,top,width:Math.ceil(Math.max(...points.map(p=>p.x))-left+20),height:Math.ceil(Math.max(...points.map(p=>p.y))-top+20)};}
 function background(c,create){if(!ground){const b=bounds(-50,-50,size.width+100,size.height+100,60),density=Math.min(1.5,Math.sqrt(4000000/(b.width*b.height)));ground=create();ground.width=Math.ceil(b.width*density);ground.height=Math.ceil(b.height*density);ground.mapBounds=b;const g=ground.getContext('2d');g.scale(density,density);g.translate(-b.left,-b.top);paintGround(g);}const b=ground.mapBounds;c.drawImage(ground,b.left,b.top,b.width,b.height);}
 function drawBuilding(c,b,create){let img=sprites.get(b);if(!img){const r=bounds(b.x-35,b.y-30,b.w+80,b.d+175,b.h+35);img=create();img.width=r.width*2;img.height=r.height*2;img.mapBounds=r;const g=img.getContext('2d');g.scale(2,2);g.translate(-r.left,-r.top);building(g,b);sprites.set(b,img);}const r=img.mapBounds;c.drawImage(img,r.left,r.top,r.width,r.height);}
 const tint=(hex,n)=>'#'+hex.replace('#','').match(/../g).map(v=>Math.max(0,Math.min(255,parseInt(v,16)+n)).toString(16).padStart(2,'0')).join('');
 function car(c,a,v,color){
 const w=v.width*.7,l=v.length*.8,sport=['sport','coupe','rally'].includes(v.body),tall=['suv','van','minivan','bus'].includes(v.body),h=sport?7:tall?13:10,roofH=h+(tall?9:6),pickup=v.body==='pickup',open=v.body==='convertible';
 const local=(x,y,z=0)=>project(a.x+Math.cos(a.angle)*x-Math.sin(a.angle)*y,a.y+Math.sin(a.angle)*x+Math.cos(a.angle)*y,z),shape=(points,fill,stroke='#253335',line=.65)=>{const ps=points.map(p=>local(...p));poly(c,ps,fill);if(stroke){c.strokeStyle=stroke;c.lineWidth=line;c.stroke();}},line=(ps,col,width=1)=>{c.beginPath();ps.map(p=>local(...p)).forEach((p,n)=>n?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.strokeStyle=col;c.lineWidth=width;c.stroke();};
 const outline=[[-w*.8,-l],[-w,-l*.78],[-w,l*.8],[-w*.8,l],[w*.8,l],[w,l*.8],[w,-l*.78],[w*.8,-l]],bodyColor=color||v.color||'#ae443e';
 shape(outline.map(([x,y])=>[x+6,y+6,0]),'#172b3038',null);
 for(const x of [-w-2,w-1])for(const y of [-l*.65,l*.45]){shape([[x,y,0],[x+3,y,0],[x+3,y+9,0],[x,y+9,0]],'#1d2429');shape([[x,y,1],[x,y+9,1],[x,y+9,6],[x,y,6]],'#111e24');}
 const faces=outline.map(([x,y],n)=>{const [u,t]=outline[(n+1)%outline.length];return {p:[[x,y,2],[u,t,2],[u,t,h],[x,y,h]],depth:(local(x,y).y+local(u,t).y)/2,fill:n<3?tint(bodyColor,-36):tint(bodyColor,-20)};}).sort((a,b)=>a.depth-b.depth);for(const f of faces)shape(f.p,f.fill);
 shape(outline.map(([x,y])=>[x,y,h]),tint(bodyColor,6));
 const cabinFront=-l*(tall?.47:.25),cabinBack=pickup?l*.1:tall?l*.66:l*.47,roofFront=cabinFront+l*.16,roofBack=cabinBack-l*.13,cw=w*.82,rw=w*.67;
 shape([[-cw,cabinFront,h],[cw,cabinFront,h],[rw,roofFront,roofH],[-rw,roofFront,roofH]],'#4b6772');
 shape([[-rw,roofBack,roofH],[rw,roofBack,roofH],[cw,cabinBack,h],[-cw,cabinBack,h]],'#324b59');
 for(const side of [-1,1]){shape([[side*cw,cabinFront,h],[side*cw,cabinBack,h],[side*rw,roofBack,roofH],[side*rw,roofFront,roofH]],'#33515c');line([[side*cw,0,h],[side*rw,0,roofH]],tint(bodyColor,20),1.4);}
 if(open){shape([[-rw,roofFront,roofH],[rw,roofFront,roofH],[rw,roofBack,roofH],[-rw,roofBack,roofH]],'#2b3437');for(const x of [-w*.35,w*.35])shape([[x-3,0,roofH],[x+3,0,roofH],[x+3,l*.2,roofH],[x-3,l*.2,roofH]],'#bb9874');}else{shape([[-rw,roofFront,roofH],[rw,roofFront,roofH],[rw,roofBack,roofH],[-rw,roofBack,roofH]],tint(bodyColor,24));line([[-rw*.7,roofFront+2,roofH+.1],[-rw*.7,roofBack-2,roofH+.1]],tint(bodyColor,43),1);}
 line([[-w*.7,-l*.8,h+.1],[-w*.55,cabinFront-3,h+.1]],tint(bodyColor,40));line([[w*.7,-l*.8,h+.1],[w*.55,cabinFront-3,h+.1]],tint(bodyColor,-15));
 line([[-cw*.7,cabinFront+2,h+1],[rw*.4,roofFront-1,roofH]],'#b1d4db',1.2);
 if(pickup){shape([[-w*.83,l*.22,h],[w*.83,l*.22,h],[w*.8,l*.87,h],[-w*.8,l*.87,h]],'#35434a');for(let n=-2;n<=2;n++)line([[n*w*.22,l*.27,h+.2],[n*w*.22,l*.82,h+.2]],'#56646a',.6);}
 for(const x of [-w*.75,w*.4]){shape([[x,-l+.7,h],[x+w*.35,-l+.7,h],[x+w*.35,-l*.87,h],[x,-l*.87,h]],'#f3e9bb');shape([[x,l*.86,h],[x+w*.35,l*.86,h],[x+w*.35,l-.7,h],[x,l-.7,h]],'#bb433b');}
 line([[-w*.68,-l,4],[w*.68,-l,4]],'#c2c6bb',1.3);line([[-w*.7,l,4],[w*.7,l,4]],'#b2b6b0',1.2);
 for(const side of [-1,1]){shape([[side*w*.85,cabinFront+3,h],[side*(w+3),cabinFront+3,h],[side*(w+3),cabinFront+7,h],[side*w*.85,cabinFront+7,h]],tint(bodyColor,-20));line([[side*w*.97,2,h],[side*w*.97,8,h]],'#d6d6c6',.9);}
 if(a.taxi){shape([[-w*.45,-2,roofH+2],[w*.45,-2,roofH+2],[w*.45,5,roofH+2],[-w*.45,5,roofH+2]],'#fff5c5');line([[-w*.2,0,roofH+2],[w*.2,0,roofH+2]],'#303f3e',2);}
 if(sport)shape([[-w*.9,l*.76,h+2],[w*.9,l*.76,h+2],[w*.9,l*.86,h+2],[-w*.9,l*.86,h+2]],tint(bodyColor,-25));
 }
 function avatar(c,a,m,create){if(typeof Apartment==='undefined')return;const phase=Math.floor(((a.walkPhase||0)%(Math.PI*2))/(Math.PI/2)),key=JSON.stringify([m.skin,m.appearance,m.useCustomAppearance,phase]);let canvas=avatars.get(key);if(!canvas){canvas=create();canvas.width=220;canvas.height=190;const apt=Object.create(Apartment.prototype);apt.ctx=canvas.getContext('2d');apt.iso=()=>({x:110,y:170});apt.profile={appearance:m.appearance,useCustomAppearance:m.useCustomAppearance??true,household:{player:{dead:false}}};apt.character({x:0,y:0},m.skin||'skin-neutral','',phase*Math.PI/2,m.useCustomAppearance===false?null:m.appearance);avatars.set(key,canvas);if(avatars.size>64)avatars.delete(avatars.keys().next().value);}const p=project(a.x,a.y);c.drawImage(canvas,p.x-44,p.y-68,88,76);}
 function preview(canvas,v,color){canvas.width=340;canvas.height=220;const c=canvas.getContext('2d');c.fillStyle='#ded9ca';c.fillRect(0,0,340,220);c.translate(170,115);c.scale(2.4,2.4);car(c,{x:0,y:0,angle:Math.PI/2},v,color||v.color);}
 const parked=[{x:390,y:515,angle:Math.PI/2,model:6},{x:820,y:585,angle:-Math.PI/2,model:8},{x:685,y:285,angle:0,model:2},{x:1050,y:870,angle:0,model:4}];
 const obstacles=parked.map(a=>{const v=BrawlCore.vehicles[a.model],w=Math.abs(Math.cos(a.angle))*v.width*1.4+Math.abs(Math.sin(a.angle))*v.length*1.6,d=Math.abs(Math.sin(a.angle))*v.width*1.4+Math.abs(Math.cos(a.angle))*v.length*1.6;return {x:a.x-w/2,y:a.y-d/2,w,d};});
 return {avatar,obstacles,parked,size,buildings,project,background,drawBuilding,car,preview,clear:()=>{ground=null;sprites.clear();avatars.clear();}};
})();
