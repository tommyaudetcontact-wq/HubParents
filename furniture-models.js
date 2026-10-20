'use strict';
/* Furniture is designed by function: all supports meet the floor, trim belongs
   to the object, and variants change the construction rather than adding cages. */
window.FurnitureModels=(()=>{
 function build(item,original){if(item.modelIndex===undefined)return original;const n=item.modelIndex,a=n%5,v=Math.floor(n/5),k=item.kind,c=item.finish||BrawlCore.furnitureDefault,out=[];
 const b=(x,y,w,d,z,h,color=c.body,alpha=1,sides=0)=>{if(w>0&&d>0&&h>0)out.push({x,y,w,d,z,h,c:color,alpha,sides,material:alpha<1?'glass':Object.keys(c).map(key=>c[key]===color?item.materialChannels?.[key]:null).find(Boolean)||'paint'});},leg=(x,y,h=16,w=.045)=>b(x,y,w,w,0,h,c.frame),feet=(x,y,w,d,h=16)=>{for(const xx of [x,x+w-.045])for(const yy of [y,y+d-.045])leg(xx,yy,h);},handle=(x,y,z,w=.12)=>b(x,y,w,.02,z,1.2,c.detail);
 if(k==='bed'){
  const w=[.53,.58,.67,.83,.9][v],x=(1-w)/2,z=8,h=30+a*3,depth=.91;feet(x,.04,w,depth,10);b(x,.04,w,depth,7,4,c.frame);b(x+.025,.15,w-.05,.75,11,6,c.fabric);b(x+.025,.43,w-.05,.47,17,2.2,c.body);for(let j=0;j<(v>=3?2:1);j++)b(x+.06+j*w*.45,.2,v>=3?w*.37:w-.12,.17,17,3.5,c.fabric);b(x+.025,.8,w-.05,.075,19.2,.6,c.fabric);
  if(a===0){for(const xx of [x,x+w-.04])b(xx,.04,.04,.065,0,h+2,c.frame);b(x,.04,w,.06,21,3,c.frame);b(x,.04,w,.06,h-2,4,c.frame);for(let j=0;j<4+v;j++)b(x+.06+j*(w-.12)/(3+v),.045,.025,.04,24,h-26,c.frame);}
  if(a===1){b(x,.04,w,.08,0,h,c.frame);b(x+.04,.125,w-.08,.008,19,h-22,c.body);b(x,.04,w,.08,h,2,c.frame);}
  if(a===2){for(const xx of [x,x+w-.035])b(xx,.045,.035,.04,0,h+4,c.detail);for(const zz of [21,h])b(x,.045,w,.035,zz,2,c.detail);for(let j=0;j<5;j++)b(x+.04+j*(w-.08)/4,.05,.018,.025,22,h-22,c.detail);for(const xx of [x,x+w-.035])b(xx,.89,.035,.035,0,23,c.detail);b(x,.89,w,.035,21,2,c.detail);}
  if(a===3){b(x,.04,w,.12,0,h,c.frame);b(x+.025,.165,w-.05,.025,17,h-19,c.body,1,8);for(let j=0;j<3;j++)b(x+.09+j*(w-.18)/2,.193,.012,.008,23,1,c.detail);}
  if(a===4){for(const xx of [x,x+w-.035])for(const yy of [.04,.9])b(xx,yy,.035,.035,0,61+v*2,c.frame);for(const yy of [.04,.9])b(x,yy,w,.035,60+v*2,2,c.frame);for(const xx of [x,x+w-.035])b(xx,.04,.035,.89,60+v*2,2,c.frame);b(x,.04,w,.065,0,30,c.frame);}
  if(v===2||v===4){b(x,.22,.035,.65,1,6,c.frame);for(let j=0;j<2;j++){b(x-.001,.25+j*.31,.015,.26,2,4,c.body);b(x-.018,.33+j*.31,.016,.09,4,1,c.detail);}}
  return out;
 }
 if(['sofa','lounge','bench','chair'].includes(k)){
  const single=k==='chair',w=.9+a*.02,x=(1-w)/2,d=k==='sofa'&&a===4?.44:.82+a*.025,y=.03,z=10,arm=single?.045:[.07,.09,.055,.11,.075][a],seats=single?1:a===0?2:3,back=single?28+v*3:20+v*2;feet(x,y,w,d,13);b(x,y,w,d,9,5,c.frame);b(x,y,w,.075,14,back,c.body,1,v===1?8:0);
  if(k==='bench'){for(let j=0;j<5;j++)b(x+.035,y+.07+j*.105,w-.07,.075,14,2,c.frame);if(v%2)for(let j=0;j<3;j++)b(x+.06+j*(w-.12)/2,y,.025,.04,17,back-3,c.frame);}
  else{for(let j=0;j<seats;j++){const sw=(w-arm*2-.03)/seats;b(x+arm+.012+j*sw,y+.1,sw-.015,d-.12,14,6,c.body,1,v===2?8:0);b(x+arm+.014+j*sw,y+.076,sw-.02,.07,22,back-9,c.body,1,v===2?8:0);}for(const xx of [x,x+w-arm]){b(xx,y+.035,arm,d-.055,13,14,c.body,1,v===2?8:0);b(xx,y+.035,arm,d-.055,27,1,c.fabric);}if(v===3||v===4)b(x+arm+.04,y+.16,.13,.1,20,8,c.fabric,1,8);if(v===4)b(x+w-arm-.17,y+.19,.12,.12,20,7,c.fabric,1,8);}
  if(a===4&&!single&&k!=='bench'){b(x+w*.56,y+.43,w*.4,.5,9,5,c.frame);b(x+w*.59,y+.43,w*.33,.5,14,6,c.body);feet(x+w*.56,y+.43,w*.4,.5,12);}
  return out;
 }
 if(k==='aquarium'){
  const w=[.85,.94,.68,.79,.55][a],d=[.56,.48,.65,.6,.55][a],x=(1-w)/2,y=(1-d)/2,z=[24,20,25,21,13][a],h=[30,29,35,37,53][a];
  if(v===3){feet(x,y,w,d,z);b(x,y,w,d,z-3,3,c.frame);b(x+.02,y+.02,w-.04,d-.04,7,2,c.frame);}else{b(x,y,w,d,0,z,c.frame);for(let j=0;j<(v===2?3:2);j++){const parts=v===2?3:2;b(x+.025+j*(w-.05)/parts,y+d+.001,(w-.07)/parts,.012,3,z-6,v===4?c.body:c.frame);handle(x+.07+j*(w-.05)/parts,y+d+.014,z*.65,.055);}if(v===1)for(const zz of [z*.35,z*.65])b(x+.02,y+d+.014,w-.04,.008,zz,.7,c.detail);}
  b(x,y,w,d,z,2.5,c.detail);b(x+.025,y+.025,w-.05,d-.05,z+2.5,1,c.fabric);b(x+.025,y+.025,w-.05,d-.05,z+3.5,h-6,c.water,.12,a===3?8:0);
  for(const xx of [x,x+w-.018])for(const yy of [y,y+d-.018])b(xx,yy,.018,.018,z+2,h-2,c.detail);b(x,y,w,d,z+h,2.5,c.detail);
  // Side panes sit behind the fish; fish and plants are solid, not coloured bricks in the lid.
  b(x,y+d-.012,w,.012,z+3,h-3,c.water,.15);b(x+w-.012,y,.012,d,z+3,h-3,c.water,.1);
  for(let j=0;j<3+v;j++){const xx=x+w*(.15+j*.7/(2+v)),yy=y+d*(.2+(j%2)*.45),ph=10+j%3*4;b(xx,yy,.012,.02,z+4,ph,'#477b53');b(xx-.025,yy,.065,.02,z+ph,.9,'#6f9c60');}
  for(let j=0;j<2+v%2;j++){const xx=x+w*(.28+j*.24),yy=y+d*.55,zz=z+h*(.4+(j%2)*.22);b(xx,yy,.09,.022,zz,3,j%2?'#eab157':'#cd785d',1,8);b(xx-.025,yy,.03,.025,zz-.5,4,'#dc9955');}
  return out;
 }
 if(['shelf','dresser','wardrobe','counter','desk','table'].includes(k)){
  const w=[.64,.76,.87,.93,.97][a],d=k==='shelf'||k==='wardrobe'?.4:k==='desk'?.62:.7,x=(1-w)/2,y=(1-d)/2,h=k==='shelf'?54+v*7:k==='wardrobe'?66+v*4:29+v;
  if(['desk','table'].includes(k)){feet(x+.03,y+.03,w-.06,d-.06,h);b(x,y,w,d,h,3,c.frame);if(k==='desk'){const dw=w*(v===3?.31:.26);b(x+.025,y+.025,dw,d-.05,0,h,c.frame);for(let j=0;j<2+v%2;j++){const zz=3+j*(h-5)/(2+v%2);b(x+.035,y+d-.018,dw-.02,.018,zz,8,c.body);handle(x+.07,y+d+.002,zz+4,.07);}if(v===4){b(x+w*.63,y+.025,w*.33,d-.05,0,h,c.frame);b(x+w*.65,y+d-.018,w*.29,.018,3,h-5,c.body);}}return out;}
  if(k==='shelf'){b(x,y,w,.035,0,h,c.frame);for(const xx of [x,x+w-.035])b(xx,y,.035,d,0,h,c.frame);const rows=3+v%3;for(let r=0;r<=rows;r++)b(x,y,w,d,r*(h-3)/rows,3,c.frame);for(let r=0;r<rows;r++)for(let j=0;j<4+a;j++){const xx=x+.06+j*(w-.12)/(4+a);b(xx,y+d*.44,.035,.19,3+r*(h-3)/rows,8+(j+r)%4*2,[c.body,c.fabric,'#ba8665','#6a8979'][j%4]);}if(v>=3){b(x,y+d-.025,w*.48,.025,3,h*.25,c.body);handle(x+w*.35,y+d,10,.06);}return out;}
  feet(x+.025,y+.025,w-.05,d-.05,5);b(x,y,w,d,4,h-4,c.frame);b(x-.005,y-.005,w+.01,d+.01,h,2,c.fabric);
  if(k==='wardrobe'||k==='counter'){const doors=a===4?3:2;for(let j=0;j<doors;j++){const ww=(w-.06)/doors;b(x+.025+j*ww,y+d+.001,ww-.012,.015,7,h-9,c.body);handle(x+.04+j*ww,y+d+.018,h*.55,.035);}}
  else{const rows=2+v%3;for(let j=0;j<rows;j++){const hh=(h-8)/rows,zz=6+j*hh;b(x+.025,y+d+.001,w-.05,.015,zz,hh-1,c.body);handle(x+w*.42,y+d+.018,zz+hh*.5,w*.16);}}
  return out;
 }
 if(k==='shower'){
  const w=.72+v*.035,d=.73+v*.025,x=(1-w)/2,y=(1-d)/2,h=64+v*3;
  b(x,y,w,d,0,a===3?8:3,c.fabric,1,a===1?8:0);
  if(a===0){b(x,y,w,.045,3,h,c.body);b(x+w-.025,y,.025,d,3,h,c.water,.24);b(x,y,.045,.12,3,h,c.frame);}
  if(a===1){b(x,y,w,.035,3,h,c.body);b(x,y,.035,d,3,h,c.body);b(x+w*.65,y+d*.28,w*.28,d*.7,3,h,c.water,.22,6);for(const xx of [x,x+w-.025])b(xx,y,.025,.025,3,h,c.detail);}
  if(a===2){b(x,y,w,.04,3,h,c.body);for(const xx of [x,x+w-.025])b(xx,y+d-.04,.025,.025,3,h,c.detail);b(x,y+d-.035,w,.025,h,2,c.detail);for(let j=0;j<8;j++)b(x+.02+j*(w-.04)/8,y+d-.04+(j%2)*.018,(w-.04)/8,.025,13+(j%3),h-14,c.fabric);}
  if(a===3){for(const yy of [y,y+d-.025])b(x,yy,w,.025,8,h,c.water,.22);for(const xx of [x,x+w-.025])b(xx,y,.025,d,8,h,c.water,.17);b(x+.02,y+.02,w-.04,.07,8,h,c.body);for(let j=0;j<4;j++)b(x+w*.55,y+.095,.07,.025,20+j*9,2,c.detail);b(x,y,w,d,h+8,3,c.frame);}
  if(a===4){for(let j=0;j<7;j++)b(x+j*(w-.035)/6,y,.035,.05,3,h,c.frame);for(let j=0;j<6;j++)b(x,y+.07+j*(d-.09)/6,w,.035,3,.9,c.frame);b(x+w*.65,y+.02,.1,.06,4,h-4,c.body);b(x,y+d-.06,w*.45,.06,3,17,c.frame);}
  b(x+w*.4,y+.05,.025,.035,27,h-29,c.detail);b(x+w*.4,y+.05,.025,.22,h-2,2,c.detail);b(x+w*.32,y+.18,.2,.16,h,1.7,c.detail,1,v===1||v===4?8:0);b(x+w*.55,y+.05,.1,.03,29,3,c.detail);if(v===1||v===3)b(x+.06,y+.08,.16,.14,3,13,c.frame);if(v===2)for(let j=0;j<3;j++)b(x+w*.78,y+.07,.06,.05,20+j*12,2,c.detail);
  return out;
 }
 if(k==='bath'){
  if(a===0){b(.06,.1,.88,.74,0,22+v,c.fabric,1,12);b(.13,.17,.74,.6,22+v,.6,c.water,1,12);b(.18,.13,.025,.025,23+v,11,c.detail);b(.18,.13,.14,.03,33+v,2,c.detail);return out;}
  const x=.06,y=.1,w=.88,d=.74,z=a===1?9:0,h=18+v*1.5;b(x,y,w,d,z,h,c.body,1,a===0||a===3?10:0);b(x+.13,y+.13,w-.26,d-.26,z+h,1,c.water,1,a===0?10:0);
  for(const xx of [x,x+w-.07])b(xx,y,.07,d,z,h+4,c.fabric,1,a===0?6:0);for(const yy of [y,y+d-.07])b(x,yy,w,.07,z,h+4,c.fabric,1,a===0?6:0);
  if(a===1)feet(x+.04,y+.04,w-.08,d-.08,10);if(a===2){b(.03,.04,.94,.08,0,h+8,c.frame);b(.03,.04,.08,.9,0,h+8,c.frame);}if(a===3){for(let j=0;j<9;j++)b(x+.025+j*.09,y+d-.01,.06,.015,z,h+1,c.frame);b(x-.015,y+d*.45,w+.03,.05,h+4,2,c.frame);}if(a===4){b(.04,.04,.38,.12,0,h+8,c.body);b(.04,.04,.12,.38,0,h+8,c.body);}
  b(.18,.13,.025,.025,z+h+3,11,c.detail);b(.18,.13,.14,.03,z+h+12,2,c.detail);return out;
 }
 if(k==='sink'){
  const w=a===3?.92:.6+v*.025,x=(1-w)/2,y=.22,h=27+v;
  if(a===0){b(x,y,w,.55,h,4,c.fabric);b(x+.04,y,.045,.05,h-9,9,c.detail);}
  if(a===1)b(.43,.28,.14,.22,0,h,c.fabric,1,8);
  if(a===2||a===3){feet(x,.2,w,.6,5);b(x,.2,w,.6,4,h-4,c.frame);for(let j=0;j<(a===3?3:2);j++){const ww=w/(a===3?3:2);b(x+.02+j*ww,.805,ww-.035,.018,6,h-8,c.body);handle(x+.05+j*ww,.83,h*.6,.07);}}
  if(a===4){for(const xx of [x,x+w-.03])b(xx,y,.03,.48,0,h,c.detail);b(x,y,w,.48,10,2,c.frame);b(x,y,w,.48,h,3,c.frame);}
  const count=a===3?2:1;for(let j=0;j<count;j++){const bx=x+.04+j*w/count,bw=w/count-.08;b(bx,y+.05,bw,.4,h+3,5,c.fabric,1,a===1||a===4?10:0);b(bx+.035,y+.09,bw-.07,.3,h+8,.8,c.water,1,a===1||a===4?10:0);b(bx+bw*.5,y,.025,.025,h+6,9,c.detail);b(bx+bw*.5,y,.025,.14,h+14,2,c.detail);}return out;
 }
 if(k==='trash'){
  const w=.4+v*.035,h=23+v*2,x=(1-w)/2;
  if(a===2){for(let j=0;j<2;j++){b(.08+j*.46,.27,.38,.47,0,h,c.frame);b(.07+j*.46,.26,.4,.49,h,3,j?c.fabric:c.body);b(.19+j*.46,.4,.15,.15,h+3,1,c.detail);}return out;}
  b(x,.24,w,.52,0,h,c.body,1,a===0||a===1?10:0);if(a!==0)b(x-.015,.225,w+.03,.55,h,3,c.frame,1,a===1?10:0);else{b(x+.04,.28,w-.08,.44,h,.8,c.detail,1,10);}
  if(a===1){b(x+w*.3,.77,w*.4,.09,0,2,c.detail);b(x+w*.4,.4,w*.2,.1,h+3,2,c.detail);}if(a===3){for(const xx of [x,x+w-.07])b(xx,.71,.07,.1,0,7,c.detail,1,8);b(x+.04,.18,w-.08,.04,h-3,4,c.detail);}if(a===4){b(.16,.15,.68,.04,0,h+10,c.frame);b(.14,.15,.04,.65,0,h+10,c.frame);b(.82,.15,.04,.65,0,h+10,c.frame);b(.14,.15,.72,.65,h+10,2,c.frame);handle(.32,.8,h+2,.3);}if((v===1||v===4)&&a>=3)for(let j=0;j<5;j++)b(x+.03+j*(w-.06)/5,.765,.02,.012,3,h-5,c.frame);return out;
 }
 if(k==='fridge'){
  const w=a===3?.86:a===4?.58:.69,d=.65,x=(1-w)/2,h=a===4?39+v*2:63+v*3;b(x,.16,w,d,3,h,c.body,1,a===0?8:0);feet(x+.025,.19,w-.05,d-.05,a===4?10:4);
  const handleZ=a===2?27:17;
  if(a===2||a===3){for(let j=0;j<2;j++){b(x+.015+j*w/2,.815,w/2-.025,.025,5,h-4,c.body);b(x+w/2+(j? .055:-.075),.85,.025,.025,handleZ,18,c.detail);}if(a===3){b(x+.09,.848,.12,.02,26,15,c.detail);b(x+.1,.871,.1,.02,29,7,c.water);}}
  else{const cut=a===1?20:h*.67;b(x+.015,.815,w-.03,.025,5,cut-3,c.body);b(x+.015,.815,w-.03,.025,cut+3,h-cut-2,c.body);if(a!==4)b(x+w-.09,.85,.025,.035,a===1?29:15,16,c.detail);else handle(x+.16,.85,27,.24);}
  if(a===0){b(x+.02,.84,w-.04,.025,h+1,2,c.detail);b(x+.09,.85,.15,.015,h*.8,1,c.fabric);}if(v===1||v===4)b(x+.06,.849,.12,.018,17,6,c.fabric);return out;
 }
 if(k==='lamp'){
  const h=a===1?26+v*2:47+v*3;b(.34,.3,.32,.32,0,3,c.frame,1,8);b(.48,.44,.035,.035,3,h,c.detail);
  if(a===0){b(.21,.17,.58,.58,h,12,c.body,1,8);b(.25,.21,.5,.5,h-.8,.8,c.fabric,1,8);}
  if(a===1){b(.48,.44,.035,.25,h-2,2,c.detail);b(.34,.56,.3,.27,h-4,8,c.body,1,8);}
  if(a===2){for(const xx of [.27,.7])for(const yy of [.24,.67])b(xx,yy,.025,.025,h-12,24,c.frame);b(.25,.22,.5,.5,h-13,2,c.frame);b(.25,.22,.5,.5,h+12,2,c.frame);b(.29,.26,.42,.42,h-10,20,c.fabric,.7);}
  if(a===3)for(const xx of [.18,.62]){b(xx,.46,.2,.025,h,2,c.detail);b(xx,.33,.23,.23,h+2,10,c.body,1,8);}
  if(a===4)b(.3,.27,.4,.4,h-4,20,c.fabric,1,12);return out;
 }
 if(k==='plant'){
  const pot=(x,y,w,d,h,round)=>{b(x,y,w,d,0,h,c.body,1,round?8:0);b(x+.03,y+.03,w-.06,d-.06,h,.8,c.frame,1,round?8:0);};
  if(a===0){feet(.28,.25,.44,.44,12);b(.26,.23,.48,.48,10,15,c.body,1,8);}if(a===1)pot(.08,.28,.84,.4,16,false);if(a===2)pot(.23,.22,.54,.54,25,true);if(a===3)for(const [x,y,h] of [[.12,.2,10],[.54,.2,19],[.32,.58,13]])pot(x,y,.32,.3,h,true);if(a===4){pot(.13,.17,.74,.6,17,false);for(let j=0;j<5;j++)b(.18+j*.14,.18,.02,.025,17,49,c.frame);for(let j=0;j<4;j++)b(.17,.18,.61,.02,25+j*10,1,c.frame);}
  for(let j=0;j<3+v;j++){const xx=.23+(j%3)*.22,yy=.34+Math.floor(j/3)*.22,h=19+v*2+(j%3)*5;b(xx,yy,.018,.018,16,h,'#507a45');b(xx-.07,yy-.04,.17,.1,16+h-6,3,'#719c58',1,6);b(xx-.035,yy-.08,.09,.19,16+h,2,'#96b774',1,6);}return out;
 }
 if(k==='rug'){
  b(.04,.04,.92,.92,0,.7,c.body,1,a===1?12:0);if(a===0)for(let j=0;j<3+v;j++)b(.06,.1+j*.8/(3+v),.88,.045,.7,.15,c.fabric);
  if(a===1)b(.16,.16,.68,.68,.7,.15,c.fabric,1,12);if(a===2)for(let j=0;j<5;j++)b(.08+j*.17,.06,.09,.88,.7,.15,j%2?c.frame:c.fabric);if(a===3)for(let x=0;x<4;x++)for(let y=0;y<4;y++)b(.06+x*.22,.06+y*.22,.21,.21,.7,.15,[c.body,c.frame,c.fabric][(x+y+v)%3]);if(a===4){for(const x of [.1,.86])b(x,.1,.04,.8,.7,.15,c.fabric);for(const y of [.1,.86])b(.1,y,.8,.04,.7,.15,c.fabric);}for(const box of out){const scale=1-v*.035;box.x=.5+(box.x-.5)*scale;box.y=.5+(box.y-.5)*scale;box.w*=scale;box.d*=scale;}return out;
 }

 if(k==='toilet'){
  const w=.5+v*.025,x=(1-w)/2,z=a===1?12:0;
  if(a!==1)b(x+.1,.32,w-.2,.34,z,17,c.fabric,1,a===0||a===2?8:0);else{b(x,.12,w,.08,0,44,c.body);b(x+.1,.2,w-.2,.2,18,7,c.fabric);}
  b(x,.3,w,.48,z+17,5,c.fabric,1,a===0||a===2?10:0);b(x+.06,.36,w-.12,.34,z+22,.8,c.water,1,10);
  if(a!==1){b(x+.03,.12,w-.06,.18,0,a===3?30:37+v,c.fabric);b(x+.015,.1,w-.03,.22,a===3?30:37+v,2,c.body);b(x+w-.09,.32,.035,.02,28,2,c.detail);}
  if(a===2){feet(x+.11,.37,w-.22,.27,6);b(x+.04,.12,.025,.025,37,7,c.detail);}if(a===4){b(x-.02,.1,w+.04,.25,39+v,3,c.fabric);b(x+.06,.14,w-.12,.13,42+v,.8,c.water);b(x+.06,.11,.02,.02,42+v,7,c.detail);}return out;
 }
 if(k==='stove'){
  const w=a===1?.94:a===4?.84:.7+v*.02,x=(1-w)/2,d=.67,h=29+v;feet(x+.03,.17,w-.06,d-.06,5);b(x,.14,w,d,4,h-4,c.body);b(x,.14,w,d,h,2,c.fabric);const burners=a===1?6:4;
  for(let j=0;j<burners;j++){const cols=burners/2,xx=x+.08+(j%cols)*(w-.14)/cols,yy=.25+Math.floor(j/cols)*.3;b(xx,yy,.13,.13,h+2,1,c.detail,1,a===2||a===3?10:0);if(a===0||a===4){b(xx-.02,yy+.05,.17,.025,h+3,.7,c.frame);b(xx+.05,yy-.02,.025,.17,h+3,.7,c.frame);}}
  const doors=a===1?2:1;for(let j=0;j<doors;j++){const ww=w/doors;b(x+.03+j*ww,.82,ww-.06,.018,8,15,c.detail);b(x+.06+j*ww,.844,ww-.12,.012,10,10,c.water,.3);handle(x+.08+j*ww,.87,25,ww-.16);}if(a===0||a===4){b(x,.14,w,.045,h,9,c.body);for(let j=0;j<4;j++)b(x+.1+j*(w-.2)/4,.195,.04,.025,h+4,2,c.detail);}if(a===3)b(x+.04,.83,w-.08,.02,4,3,c.frame);return out;
 }
 if(k==='tv'){
  const w=.7+v*.045,x=(1-w)/2,screen=(x,y,w,z,h,depth=.07)=>{b(x,y,w,depth,z,h,c.frame);b(x+.035,y+depth+.002,w-.07,.015,z+3,h-6,c.water);};
  if(a===0){feet(x,.22,w,.54,7);b(x,.22,w,.54,6,36,c.body,1,8);b(x+.04,.77,w-.16,.02,12,24,c.detail);b(x+.065,.793,w-.21,.012,14,20,c.water);for(const zz of [18,28])b(x+w-.08,.79,.025,.025,zz,3,c.fabric);b(.48,.35,.02,.02,42,14,c.detail);}
  if(a===1){b(.33,.3,.34,.3,0,2,c.detail);b(.48,.42,.04,.08,2,18,c.detail);screen(x,.35,w,20,36);}
  if(a>=2){feet(.05,.14,.9,.6,6);b(.04,.13,.92,.63,5,15,c.body);b(.08,.77,.38,.015,8,9,c.frame);b(.53,.77,.38,.015,8,9,c.frame);handle(.2,.795,12,.1);handle(.65,.795,12,.1);b(.45,.3,.1,.14,20,5,c.detail);screen(x,.24,w,25,a===4?43:33);if(a===3)for(const xx of [.03,.88]){b(xx,.13,.09,.4,20,45,c.frame);for(const zz of [30,45,60])b(xx,.13,.09,.42,zz,2,c.fabric);}if(a===4)for(const xx of [.03,.85]){b(xx,.18,.12,.35,20,35,c.detail);b(xx+.025,.535,.07,.012,28,19,c.frame);}}return out;
 }
 if(k==='fireplace'){
  const h=48+v*3;
  if(a===0||a===2){const w=a===2?.94:.78,x=(1-w)/2;b(x,.2,w,.56,0,h,c.body);b(x+.08,.765,w-.16,.012,6,h*.6,c.detail);b(x-.025,.18,w+.05,.6,h,4,c.fabric);for(const xx of [x,x+w-.07])b(xx,.76,.07,.025,0,h,c.frame);}
  if(a===1||a===4){feet(.25,.25,.5,.5,10);b(.22,.22,.56,.56,9,h-9,c.body,1,a===4?12:0);b(.3,.79,.4,.015,17,h-23,c.detail);b(.45,.4,.1,.1,h,23,c.frame,1,8);}
  if(a===3){b(.08,.08,.55,.55,0,h,c.body);b(.1,.64,.5,.025,7,h*.6,c.detail);b(.64,.1,.025,.5,7,h*.6,c.detail);b(.06,.06,.6,.6,h,3,c.fabric);}
  const yy=a===3?.67:.81;for(let j=0;j<3;j++)b(.32+j*.105,yy,.06,.02,8,8+(j%2)*9,j%2?'#f0c563':'#d97e3f');return out;
 }

 // Other object families retain their recognisable appliance / plumbing shapes.
 // Five real proportions and five finish constructions, with no decorative posts around them.
 const widths=[.72,.81,.9,.96,.86],depths=[.78,.88,.72,.94,.98],sx=widths[a],sy=depths[a],x=(1-sx)/2,y=(1-sy)/2,height=[.84,.93,1,1.08,1.14][v];
 for(const box of original){const copy={...box,material:box.alpha<1?'glass':Object.keys(c).map(key=>c[key]===box.c?item.materialChannels?.[key]:null).find(Boolean)||'paint',x:x+box.x*sx,y:y+box.y*sy,w:box.w*sx,d:box.d*sy,z:box.z*height,h:box.h*height};out.push(copy);}
 return out;
 }
 return {build};
})();


