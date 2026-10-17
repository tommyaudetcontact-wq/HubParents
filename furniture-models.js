'use strict';
window.FurnitureModels=(()=>{
 function build(item,original){if(item.modelIndex===undefined)return original;const n=item.modelIndex,form=n%5,structure=Math.floor(n/5),k=item.kind,colors=item.finish||BrawlCore.furnitureDefault,out=[];
   const b=(x,y,w,d,z,h,c=colors.body,alpha=1,sides=0)=>out.push({x,y,w,d,z,h,c,alpha,sides});
   const leg=(x,y,h=18)=>b(x,y,.055,.055,0,h,colors.detail);
   const stand=(x,y,w,d,h,style)=>{if(style===0)b(x,y,w,d,0,h,colors.frame);if(style===1){b(x+.05,y+.05,w-.1,d-.1,0,3,colors.detail);b(x+w*.37,y+d*.37,w*.26,d*.26,3,h-3,colors.body);}if(style===2){b(x,y,w,d,0,h,colors.frame);b(x+.04,y+d+.002,w-.08,.012,3,Math.max(1,h-6),colors.body);b(x+w/2,y+d+.014,.02,.018,6,Math.max(1,h-12),colors.detail);}if(style===3){for(const xx of [x,x+w-.055])for(const yy of [y,y+d-.055])leg(xx,yy,h);b(x,y,w,d,h-3,3,colors.frame);}if(style===4){b(x,y,w,d,0,3,colors.detail);for(const xx of [x,x+w-.055])for(const yy of [y,y+d-.055])leg(xx,yy,h);b(x,y,w,d,h*.45,2,colors.frame);}b(x,y+d-.02,w,.02,h-2,2,colors.body);};
   const tank=(x,y,w,d,z,h,open=false,sides=0)=>{b(x,y,w,d,z,3,colors.detail,1,sides);b(x+.02,y+.02,w-.04,d-.04,z+3,h-5,colors.water,.2,sides);b(x+.035,y+.035,w-.07,d-.07,z+3,1,'#d8c69d',1,sides);if(!open)b(x,y,w,d,z+h-2,2,colors.detail,1,sides);for(let j=0;j<3;j++){const xx=x+w*(.2+j*.26),yy=y+d*(.2+(j%2)*.3);b(xx,yy,.018,.025,z+4,h*(.35+j*.1),'#4d976d');b(xx-.025,yy,.065,.025,z+h*.4,2,'#7cac69');b(xx+.02,yy+.025,.07,.035,z+h*(.5+j*.1),3,['#edb65e','#df806b','#7ca2cf'][j]);}b(x+.01,y+d-.015,w-.02,.012,z+3,h-5,colors.water,.18);};
   if(k==='aquarium'){
     if(n===0){stand(.08,.12,.84,.72,24,0);tank(.08,.12,.84,.72,24,34);}
     if(n===1){stand(.03,.2,.94,.58,20,2);tank(.03,.2,.94,.58,20,29,true);}
     if(n===2){stand(.22,.22,.56,.56,12,0);tank(.22,.22,.56,.56,12,67);}
     if(n===3){stand(.06,.15,.88,.65,22,0);tank(.06,.15,.39,.65,22,32);tank(.55,.15,.39,.65,22,42);}
     if(n===4){stand(.22,.22,.56,.56,18,1);tank(.22,.22,.56,.56,18,56,false,8);}
     if(n===5){stand(.08,.12,.84,.72,15,3);tank(.08,.12,.84,.72,15,23,true);}
     if(n===6){stand(.08,.08,.84,.84,8,0);tank(.08,.08,.84,.84,8,28,true,8);}
     if(n===7){for(const x of [.08,.84])for(const y of [.08,.84])leg(x,y,6);tank(.06,.06,.88,.88,6,20);b(.03,.03,.94,.94,27,2,colors.fabric,.65);}
     if(n===8){stand(.24,.24,.52,.52,34,1);tank(.2,.2,.6,.6,34,34);}
     if(n===9){stand(.06,.06,.88,.88,20,3);tank(.06,.06,.88,.35,20,30);tank(.06,.41,.35,.53,20,30);}
     if(n===10){stand(.04,.2,.92,.6,15,2);for(let j=0;j<3;j++)tank(.04+j*.32,.2,.28,.6,15,22+j*12);}
     if(n===11){stand(.04,.15,.92,.7,20,4);tank(.04,.15,.3,.7,20,38);tank(.66,.15,.3,.7,20,38);tank(.34,.3,.32,.25,44,12,true);}
     if(n===12){stand(.06,.12,.88,.76,13,2);tank(.06,.12,.88,.76,13,38,true);for(let j=0;j<4;j++)b(.2+j*.12,.3,.11,.22,17,10+j*4,'#8a9189');}
     if(n===13){stand(.05,.35,.9,.3,10,0);tank(.05,.35,.9,.3,10,66);for(let j=0;j<5;j++)b(.15+j*.15,.55,.015,.015,20,42,colors.fabric,.5);}
     if(n===14){stand(.08,.1,.84,.8,18,0);tank(.08,.1,.84,.8,18,16,true);b(.08,.1,.25,.8,34,15,colors.frame);for(let j=0;j<4;j++)b(.14,.22+j*.16,.06,.06,49,14+j*2,'#5d996f');}
     if(n===15){stand(.04,.1,.92,.8,12,3);tank(.04,.1,.28,.8,12,47);tank(.68,.1,.28,.8,12,47);tank(.32,.3,.36,.4,49,13);}
     if(n===16){stand(.18,.24,.64,.52,5,0);tank(.18,.24,.64,.52,5,22,true);b(.73,.3,.04,.12,27,11,colors.detail);}
     if(n===17){stand(.08,.1,.84,.8,27,4);tank(.08,.1,.84,.8,27,42,true);for(let j=0;j<4;j++)b(.14+j*.13,.18,.035,.04,31,46,'#648e59');}
     if(n===18){stand(.06,.08,.88,.84,22,2);tank(.06,.08,.88,.84,22,33);for(let j=0;j<4;j++){b(.2+j*.15,.4,.04,.04,27,14+j*2,'#cc7e8c');b(.17+j*.15,.4,.12,.04,36+j*2,3,'#db9a8e');}}
     if(n===19){stand(.18,.18,.64,.64,8,1);tank(.18,.18,.64,.64,8,66,false,12);}
     if(n===20){stand(.04,.1,.92,.8,6,3);tank(.05,.2,.9,.58,6,20);b(.02,.06,.96,.86,27,4,colors.frame);}
     if(n===21){stand(.07,.07,.86,.86,24,1);tank(.07,.07,.86,.86,24,35,false,8);}
     if(n===22){stand(.04,.12,.92,.76,13,4);for(let j=0;j<3;j++)tank(.04+j*.32,.12,.28,.76,13,18+j*14);}
     if(n===23){stand(.04,.12,.92,.76,14,0);tank(.13,.2,.74,.6,28,31);for(const x of [.04,.9])b(x,.12,.06,.76,14,66,colors.frame);b(.04,.12,.92,.76,80,3,colors.frame);}
     if(n===24){stand(.22,.22,.56,.56,23,1);tank(.12,.12,.76,.76,23,39,false,8);for(const x of [.07,.88])for(const y of [.07,.88]){b(x,y,.045,.045,0,70,colors.detail);b(x,y,.045,.045,53,3,colors.fabric);}}
     return out;
   }
   if(k==='bed'){
     const width=[.55,.88,.55,.76,.88][form],x=(1-width)/2,height=form===3?39:8;
     stand(x,.06,width,.88,height,structure%5);b(x+.03,.15,width-.06,.73,height,5,colors.fabric);b(x+.03,.43,width-.06,.45,height+5,3,colors.body);for(let j=0;j<(width>.7?2:1);j++)b(x+.06+j*width*.46,.2,width*.36,.17,height+5,4,colors.fabric);
     if(form===2){for(const xx of [x,x+width-.04])for(const yy of [.08,.88])b(xx,yy,.04,.04,0,54,colors.frame);b(x,.07,width,.83,44,4,colors.body);b(x+.04,.15,width-.08,.7,48,3,colors.fabric);for(let j=0;j<5;j++)b(x+width+.02,.42,.06,.025,5+j*8,2,colors.detail);}
     else if(form===4){for(const xx of [x,x+width-.035])for(const yy of [.06,.9])b(xx,yy,.035,.035,height,53,colors.frame);b(x,.06,width,.88,height+53,2,colors.fabric,.7);}
     if(structure===0)b(x,.06,width,.06,height,24,colors.frame);if(structure===1){for(let j=0;j<5;j++)b(x+.02+j*(width-.05)/5,.07,.025,.04,height+4,28,colors.detail);b(x,.07,width,.04,height+4,2,colors.detail);b(x,.07,width,.04,height+30,2,colors.detail);for(const xx of [x,x+width-.035])b(xx,.07,.035,.04,0,height+33,colors.detail);}if(structure===2){b(x,.06,width,.09,height,20,colors.frame);for(let j=0;j<3;j++)b(x+j*width/3,.06,width/3-.015,.09,height+20,5+j*4,colors.body);}if(structure===3){b(x,.06,width,.16,height,29,colors.frame);b(x+.03,.23,width-.06,.025,height+12,13,colors.detail);}if(structure===4){b(x,.05,width,.1,height,26,colors.body);for(const xx of [x,x+width-.07])b(xx,.05,.07,.1,height,33,colors.frame);}
     return out;
   }
   if(['sofa','chair','bench','lounge'].includes(k)){
     const seats=k==='chair'?1:[1,2,3,2,2][form],width=k==='chair'?[.5,.62,.72,.65,.58][form]:[.6,.88,.94,.9,.82][form],x=(1-width)/2;stand(x,.18,width,.64,9+structure*2,structure);const z=9+structure*2;
     for(let j=0;j<seats;j++)b(x+.04+j*(width-.08)/seats,.28,(width-.09)/seats-.02,.48,z,5,colors.body);b(x,.18,width,.08,z,22+structure*3+[0,12,-5,3,8][form],colors.body);if(k!=='bench')for(const xx of [x,x+width-.06])b(xx,.2,.06,.6,z,13,colors.frame);if(form===3)b(x,.62,width*.42,.3,z,5,colors.body);if(form===4)b(x+.06,.28,width*.4,.6,z,5,colors.fabric);if(structure===4)for(let j=0;j<seats;j++)b(x+.08+j*(width-.08)/seats,.2,.12,.12,z+7,8,colors.fabric);
     return out;
   }
   if(k==='rug'){
     const x=[.12,.05,.25,.06,.03][form],y=[.12,.27,.05,.06,.03][form],w=1-x*2,d=1-y*2;
     b(x,y,w,d,0,1,colors.body,1,form===2?12:form===4?8:0);if(form===3)b(.55,.45,.4,.48,1,1,colors.body);
     if(structure===0)b(x+.05,y+.05,w-.1,d-.1,1,1,colors.fabric,1,form===2?12:form===4?8:0);
     if(structure===1)for(let j=0;j<5;j++)b(x+.025,y+.03+j*(d-.06)/5,w-.05,.025,1,1,colors.fabric);
     if(structure===2)for(let j=0;j<3;j++)b(.4-j*.06,.4-j*.06,.2+j*.12,.2+j*.12,1+j*.3,.3,j%2?colors.body:colors.fabric);
     if(structure===3)for(let a=0;a<4;a++)for(let j=0;j<4;j++)if((a+j)%2)b(x+a*w/4,y+j*d/4,w/4,d/4,1,.4,colors.fabric);
     if(structure===4){b(x+.03,y+.03,w-.06,.03,1,1,colors.detail);b(x+.03,y+d-.06,w-.06,.03,1,1,colors.detail);for(let j=0;j<4;j++)b(x+.07+j*(w-.14)/4,y+.12,.025,d-.24,1,1,colors.fabric);}
     return out;
   }
   if(k==='plant'||k==='garden'){
     const pots=[1,2,3,4,2][form];for(let j=0;j<pots;j++){const size=pots===1?.55:pots===2?.33:.25,x=pots===1?.22:.08+(j%2)*.49,y=pots<=2?.28:.07+Math.floor(j/2)*.46,z=structure===4?10:0;if(z)stand(x,y,size,size,z,3);b(x,y,size,size,z,13+structure*2,colors.frame,1,structure===1?8:0);b(x+.025,y+.025,size-.05,size-.05,z+13+structure*2,1,colors.detail);for(let leaf=0;leaf<3+structure;leaf++){const xx=x+size*(.25+(leaf%3)*.2),yy=y+size*(.25+(leaf%2)*.3),height=15+(leaf*7+n*3)%25;b(xx,yy,.02,.02,z+14+structure*2,height,colors.body);b(xx-.03,yy-.03,.09,.08,z+height+10+structure*2,4,colors.body,1,structure===2?8:0);}}
     return out;
   }
   if(k==='lamp'){
     const h=[62,28,50,70,42][form];b(.27,.27,.46,.46,0,3,colors.frame,1,structure%2?12:0);b(.48,.48,.04,.04,3,h-3,colors.detail);const shades=form===2?3:1;for(let j=0;j<shades;j++){const x=shades===1?.2:.07+j*.24,w=shades===1?.6:.28,y=shades===1?.2:.38;b(x,y,w,shades===1?.6:.28,h-(j%2)*10,10+structure*2,colors.body,.95,structure===1?12:structure===2?8:0);b(x+.04,y+.04,w-.08,(shades===1?.6:.28)-.08,h-(j%2)*10-.5,.5,colors.fabric);}if(structure===3)for(const x of [.3,.67])b(x,.3,.025,.025,h-3,20,colors.frame);if(structure===4)b(.38,.38,.24,.24,h+10,5,colors.detail,1,8);
     return out;
   }
   // Five physical formats × five construction systems, within the same placement footprint.
   const sx=[.68,.94,.78,.85,.96][form],sy=[.7,.58,.88,.76,.94][form],ox=(1-sx)/2,oy=(1-sy)/2;
   for(const box of original){const copy={...box,x:ox+box.x*sx,y:oy+box.y*sy,w:box.w*sx,d:box.d*sy};if(form===1)copy.h*=.85;if(form===4)copy.h*=1.12;if(form===3&&box.x>.55)copy.y=Math.min(.98-copy.d,copy.y+.05);out.push(copy);}
   const height=Math.max(10,...out.map(b=>b.z+b.h));
   if(structure===1){for(const box of out)box.z+=6;b(.3,.28,.4,.44,0,6,colors.detail,1,8);}
   if(structure===2){b(ox,oy,sx,.16,0,8,colors.frame);for(let j=0;j<3;j++)b(ox+.04+j*(sx-.08)/3,oy+.165,(sx-.1)/3,.012,2,4,colors.body);}
   if(structure===3){for(const xx of [ox,ox+sx-.025])b(xx,oy,.025,sy,0,Math.min(13,height*.3),colors.detail);b(ox,oy,sx,.025,Math.min(13,height*.3),2,colors.detail);}
   if(structure===4){for(const xx of [ox,ox+sx-.035])b(xx,oy,.035,.04,0,height+4,colors.frame);b(ox,oy,sx,.04,height+4,2,colors.frame);}
   if(['table','desk','lamp','rug','fountain','plant','coffee','trash'].includes(k)&&form===2)for(const box of out)if(box.w>.2&&box.d>.2)box.sides=8;
   return out;
 }
 return {build};
})();
