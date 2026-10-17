'use strict';
/* Furniture is designed by function: all supports meet the floor, trim belongs
   to the object, and variants change the construction rather than adding cages. */
window.FurnitureModels=(()=>{
 function build(item,original){if(item.modelIndex===undefined)return original;const n=item.modelIndex,a=n%5,v=Math.floor(n/5),k=item.kind,c=item.finish||BrawlCore.furnitureDefault,out=[];
 const b=(x,y,w,d,z,h,color=c.body,alpha=1,sides=0)=>{if(w>0&&d>0&&h>0)out.push({x,y,w,d,z,h,c:color,alpha,sides});},leg=(x,y,h=16,w=.045)=>b(x,y,w,w,0,h,c.frame),feet=(x,y,w,d,h=16)=>{for(const xx of [x,x+w-.045])for(const yy of [y,y+d-.045])leg(xx,yy,h);},handle=(x,y,z,w=.12)=>b(x,y,w,.02,z,1.2,c.detail);
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
  const single=k==='chair',w=single?[.52,.58,.6,.56,.66][a]:[.72,.86,.93,.9,.95][a],x=(1-w)/2,d=k==='lounge'?.84:.62,y=.15,z=10,arm=single?.045:[.07,.09,.055,.11,.075][a],seats=single?1:a===0?2:3,back=single?28+v*3:20+v*2;feet(x,y,w,d,13);b(x,y,w,d,9,5,c.frame);b(x,y,w,.075,14,back,c.body,1,v===1?8:0);
  if(k==='bench'){for(let j=0;j<5;j++)b(x+.035,y+.07+j*.105,w-.07,.075,14,2,c.frame);if(v%2)for(let j=0;j<3;j++)b(x+.06+j*(w-.12)/2,y,.025,.04,17,back-3,c.frame);}
  else{for(let j=0;j<seats;j++){const sw=(w-arm*2-.03)/seats;b(x+arm+.012+j*sw,y+.1,sw-.015,d-.12,14,6,c.body,1,v===2?8:0);b(x+arm+.014+j*sw,y+.076,sw-.02,.07,22,back-9,c.body,1,v===2?8:0);}for(const xx of [x,x+w-arm]){b(xx,y+.035,arm,d-.055,13,14,c.body,1,v===2?8:0);b(xx,y+.035,arm,d-.055,27,1,c.fabric);}if(v===3||v===4)b(x+arm+.04,y+.16,.13,.1,20,8,c.fabric,1,8);if(v===4)b(x+w-arm-.17,y+.19,.12,.12,20,7,c.fabric,1,8);}
  if(a===4&&!single&&k!=='bench'){b(x+w*.56,y+.45,w*.4,.34,9,5,c.frame);b(x+w*.59,y+.45,w*.33,.34,14,6,c.body);feet(x+w*.56,y+.45,w*.4,.34,12);}
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
 // Other object families retain their recognisable appliance / plumbing shapes.
 // Five real proportions and five finish constructions, with no decorative posts around them.
 const widths=[.72,.81,.9,.96,.86],depths=[.78,.88,.72,.94,.98],sx=widths[a],sy=depths[a],x=(1-sx)/2,y=(1-sy)/2,height=[.84,.93,1,1.08,1.14][v];
 for(const box of original){const copy={...box,x:x+box.x*sx,y:y+box.y*sy,w:box.w*sx,d:box.d*sy,z:box.z*height,h:box.h*height};out.push(copy);}
 return out;
 }
 return {build};
})();
