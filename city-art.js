'use strict';
window.CityArt=(()=>{
 const size={width:1300,height:1100},project=(x,y,z=0)=>({x:(x-y)*.78,y:(x+y)*.44-z});
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
 let ground=null,sprites=new Map();
 function poly(c,points,color){c.fillStyle=color;c.beginPath();points.forEach((p,n)=>n?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.closePath();c.fill();}
 function plane(c,x,y,w,d,z,color){poly(c,[[x,y],[x+w,y],[x+w,y+d],[x,y+d]].map(p=>project(...p,z)),color);}
 function wall(c,x,y,w,d,z,h,color){poly(c,[project(x,y,z),project(x+w,y+d,z),project(x+w,y+d,z+h),project(x,y,z+h)],color);}
 function box(c,x,y,w,d,z,h,color,side,roof){wall(c,x,y+d,w,0,z,h,color);wall(c,x+w,y,0,d,z,h,side);plane(c,x,y,w,d,z+h,roof);}
 function building(c,b){const {x,y,w,d,h}=b;plane(c,x+18,y+12,w+12,d+12,0,'#25354122');box(c,x,y,w,d,0,h,b.color,'#9a9589',b.roof);wall(c,x,y+d,w,0,0,5,'#ede4cd');wall(c,x+w,y,0,d,0,5,'#c5bda9');
 for(let z=18;z<h-8;z+=25){for(let n=16;n<w-15;n+=31){wall(c,x+n,y+d+.2,17,0,z,16,'#415765');wall(c,x+n+2,y+d+.3,12,0,z+3,10,'#a5cbd0');}for(let n=16;n<d-15;n+=30)wall(c,x+w+.2,y+n,0,16,z,16,'#52717d');}
 box(c,x-3,y-3,w+6,d+6,h,4,'#e7dfce','#bfbbaa',b.roof);box(c,x+22,y+22,30,22,h+4,11,'#b4b8b0','#929c9c','#d1d6c9');plane(c,x+60,y+20,30,35,h+4,'#546970');
 if(b.name){const p=project(x+w*.5,y+d+.5,12);c.save();c.translate(p.x,p.y);c.transform(.87,.49,0,1,0,0);c.fillStyle=b.fuel?'#b84e47':'#476b6d';c.fillRect(-w*.42,-11,w*.84,16);c.fillStyle='#fff4d8';c.font='bold 10px sans-serif';c.textAlign='center';c.fillText(b.name,0,0);c.restore();}
 if(b.fuel){for(const px of [x+55,x+155]){box(c,px,y+d+75,13,16,0,27,'#c9514e','#943f42','#f0e7cc');wall(c,px+2,y+d+91,9,0,14,8,'#304b54');}for(const px of [x+15,x+w-15])box(c,px,y+d+30,4,4,0,55,'#dfd8c5','#a6a8a0','#f0e6cb');box(c,x-10,y+d+20,w+20,100,55,6,'#c04f48','#9e4843','#eee6d1');}}
 function tree(c,x,y){plane(c,x+10,y+8,30,23,0,'#243c3820');box(c,x,y,5,5,0,22,'#958363','#796e55','#9b896b');const p=project(x,y,36);for(const [dx,dy,r,color]of [[0,0,23,'#4f7f69'],[-9,-6,17,'#6e9978'],[7,-13,16,'#8aad86']]){c.fillStyle=color;c.beginPath();c.arc(p.x+dx,p.y+dy,r,0,7);c.fill();}}
 function paintGround(c){plane(c,-25,-25,size.width+50,size.height+50,0,'#a7b99a');plane(c,30,30,1240,1040,0,'#cfcebc');for(const x of [100,650,1200])plane(c,x-58,35,116,1030,0,'#626d76');for(const y of [100,550,1000])plane(c,35,y-58,1230,116,0,'#626d76');for(const x of [100,650,1200])for(let y=35;y<1060;y+=48)if(![100,550,1000].some(n=>Math.abs(y-n)<85))plane(c,x-1,y,2,21,0,'#e4d9ab');for(const y of [100,550,1000])for(let x=35;x<1260;x+=48)if(![100,650,1200].some(n=>Math.abs(x-n)<85))plane(c,x,y-1,21,2,0,'#e4d9ab');
 for(const x of [100,650,1200])for(const y of [100,550,1000]){for(let n=0;n<6;n++){plane(c,x-44+n*16,y-85,9,17,0,'#e9e2cc');plane(c,x-85,y-44+n*16,17,9,0,'#e9e2cc');}}
 plane(c,735,650,400,290,0,'#bfc3b6');for(let x=750;x<1120;x+=45){plane(c,x,850,2,70,0,'#e8e1c6');}plane(c,780,910,340,35,0,'#d7ccb2');
 for(const x of [165,570,735,1140])for(const y of [165,485,635,945])tree(c,x,y);
 }
 function background(c,create){if(!ground){ground=create();ground.width=2048;ground.height=1200;const g=ground.getContext('2d');g.translate(890,30);paintGround(g);}c.drawImage(ground,-890,-30);}
 function drawBuilding(c,b,create){let img=sprites.get(b);const bounds=[project(b.x,b.y),project(b.x+b.w+40,b.y+b.d+145),project(b.x+b.w,b.y)].map(p=>p.x),left=Math.floor(project(b.x-35,b.y+b.d+145).x-20),top=Math.floor(project(b.x,b.y,b.h+30).y-30),width=Math.ceil(project(b.x+b.w+45,b.y-30).x-left+25),height=Math.ceil((b.w+b.d+150)*.44+b.h+70);if(!img){img=create();img.width=width*2;img.height=height*2;const g=img.getContext('2d');g.scale(2,2);g.translate(-left,-top);building(g,b);sprites.set(b,img);}c.drawImage(img,left,top,width,height);}
 function car(c,a,v,color){const local=(x,y,z=0)=>project(a.x+Math.cos(a.angle)*x-Math.sin(a.angle)*y,a.y+Math.sin(a.angle)*x+Math.cos(a.angle)*y,z),p=(coords,col)=>poly(c,coords.map(q=>local(...q)),col),w=v.width*.75,l=v.length*.8; p([[-w-3,-l+5],[w+4,-l+5],[w+4,l+7],[-w-3,l+7]],'#1e30302c');for(const x of [-w-2,w-1])for(const y of [-l+6,l-13])p([[x,y,2],[x+4,y,2],[x+4,y+8,2],[x,y+8,2]],'#26343b');p([[-w,-l,5],[w,-l,5],[w,l,5],[-w,l,5]],color);p([[-w,l,0],[w,l,0],[w,l,6],[-w,l,6]],'#354951');p([[w,-l,0],[w,l,0],[w,l,6],[w,-l,6]],'#526773');const back=v.body==='pickup'?l*.08:l*.5;p([[-w*.8,-l*.4,7],[w*.8,-l*.4,7],[w*.7,back,14],[-w*.7,back,14]],'#9ac1c7');p([[-w*.7,-l*.13,14],[w*.7,-l*.13,14],[w*.7,back,14],[-w*.7,back,14]],color);if(v.body==='pickup')p([[-w*.8,l*.2,7],[w*.8,l*.2,7],[w*.8,l*.8,7],[-w*.8,l*.8,7]],'#405763');if(v.body==='sport')p([[-w,l*.8,9],[w,l*.8,9],[w,l*.9,9],[-w,l*.9,9]],'#344d59');for(const x of [-w+2,w-6])p([[x,-l,7],[x+4,-l,7],[x+4,-l+4,7],[x,-l+4,7]],'#fff0b8');}
 function preview(canvas,v,color){canvas.width=340;canvas.height=220;const c=canvas.getContext('2d');c.fillStyle='#e9f0e8';c.fillRect(0,0,340,220);c.translate(170,115);c.scale(2.3,2.3);car(c,{x:0,y:0,angle:Math.PI/2},v,color||v.color);}
 return {size,buildings,project,background,drawBuilding,car,preview,clear:()=>{ground=null;sprites.clear();}};
})();
