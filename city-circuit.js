'use strict';
(function(root){
 const C=root.BrawlCore||(typeof require==='function'?require('./domain.js'):null),t=C.cityMap.track;
 const oct=(x,y,w,h,r)=>[{x:x+r,y},{x:x+w-r,y},{x:x+w,y:y+r},{x:x+w,y:y+h-r},{x:x+w-r,y:y+h},{x:x+r,y:y+h},{x,y:y+h-r},{x,y:y+r}];
 const outer=oct(t.x+21,t.y+21,t.w-42,t.h-42,73),inner=oct(t.x+84,t.y+84,t.w-168,t.h-168,57);
 const center=oct(t.x+52.5,t.y+52.5,t.w-105,t.h-105,65),line={x:t.x+52.5,y:t.y+t.h*.6};
 const lap=[line,{x:line.x,y:t.y+118},...center.slice(0,8),{x:line.x,y:t.y+118},line];
 // Clockwise: left straight, top left, top, right, bottom, left, finish.
 lap.splice(2,10,center[0],center[1],center[2],center[3],center[4],center[5],center[6],line);
 function inside(p,poly){let v=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)v=!v;}return v;}
 function nearest(p,poly){let best=null;for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],dx=b.x-a.x,dy=b.y-a.y,u=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy))),x=a.x+u*dx,y=a.y+u*dy,d=Math.hypot(x-p.x,y-p.y);if(!best||d<best.d)best={x,y,d,dx,dy};}return best;}
 function constrain(a){const poly=!inside(a,outer)?outer:inside(a,inner)?inner:null;if(!poly)return;const p=nearest(a,poly),len=Math.hypot(p.dx,p.dy),ux=p.dx/len,uy=p.dy/len,along=(a.vx||0)*ux+(a.vy||0)*uy;Object.assign(a,{x:p.x,y:p.y,vx:ux*along,vy:uy*along});a.speed=a.vx*Math.sin(a.angle)-a.vy*Math.cos(a.angle);}
 function start(s,ids,actors,members){s.points=[line,...Array.from({length:3},()=>lap.slice(1)).flat()];s.phase='countdown';s.accepted=ids;s.countdown=3;s.elapsed=0;s.progress={};s.results=[];s.returns={};ids.forEach((id,n)=>{const a=actors[id],m=members.find(m=>m.id===id);s.returns[id]={x:a.x,y:a.y,driving:a.driving,loanVehicle:a.loanVehicle,loanId:a.loanId};Object.assign(a,{x:line.x+(n%2?19:-19),y:line.y+32+Math.floor(n/2)*50,angle:0,speed:0,vx:0,vy:0,driving:true,loanVehicle:null,loanId:null,vehicle:m?.vehicle,fuel:m?.cars?.[m.vehicle]?.fuel??600,recovery:(a.recovery||0)+1});s.progress[id]=1;});}
 function update(s,actors,dt){if(s?.phase==='countdown'){s.countdown-=dt;if(s.countdown<=0)s.phase='running';return;}if(s?.phase!=='running')return;s.elapsed+=dt;s.accepted=s.accepted.filter(id=>actors[id]);for(const id of s.accepted){const a=actors[id],n=s.progress[id];constrain(a);if(a.driving&&Math.hypot(a.x-s.points[n].x,a.y-s.points[n].y)<48){s.progress[id]++;if(s.progress[id]>=s.points.length){s.results.push({id,seconds:Math.round(s.elapsed*10)/10});s.winner=id;s.phase='finished';return;}}}if(!s.accepted.length||s.elapsed>600)s.phase='finished';}
 const exp={start,update,constrain,inside,outer,inner,lap,line,lapLength:lap.length-1};if(typeof module!=='undefined')module.exports=exp;else root.CityCircuit=exp;
})(typeof window!=='undefined'?window:globalThis);
