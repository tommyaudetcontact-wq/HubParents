'use strict';
(function(root){
 const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
 function step(a,i,dt,car,boost=0){dt=clamp(dt,0,.0334);const throttle=clamp(-(i.y||0),-1,1),steer=clamp(i.x||0,-1,1),brake=!!i.brake;let speed=a.speed||0,angle=a.angle||0,vx=a.vx??Math.sin(angle)*speed,vy=a.vy??-Math.cos(angle)*speed;
 speed+=(throttle*(throttle<0&&speed>10?360:250)-speed*(brake?5.8:.7))*dt;const max=car.speed*(1+.12*boost);speed=clamp(speed,-max*.34,max);if(Math.abs(speed)<.4&&Math.abs(throttle)<.05)speed=0;
 angle+=steer*(brake?2.9:2.15)*Math.min(1,Math.abs(speed)/50)*dt*(speed<0?-1:1);const grip=1-Math.exp(-(brake?5:13)*dt),tx=Math.sin(angle)*speed,ty=-Math.cos(angle)*speed;vx+=(tx-vx)*grip;vy+=(ty-vy)*grip;
 return {...a,angle,speed,vx,vy,x:a.x+vx*dt,y:a.y+vy*dt};}
 function collide(a,buildings,size){const radius=a.driving?17:9;let hit=false;for(const b of buildings){const qx=clamp(a.x,b.x,b.x+b.w),qy=clamp(a.y,b.y,b.y+b.d),dx=a.x-qx,dy=a.y-qy,d=Math.hypot(dx,dy);if(d>=radius)continue;hit=true;if(d>.001){a.x=qx+dx/d*(radius+.2);a.y=qy+dy/d*(radius+.2);}else{const edges=[[Math.abs(a.x-b.x),b.x-radius,a.y],[Math.abs(a.x-b.x-b.w),b.x+b.w+radius,a.y],[Math.abs(a.y-b.y),a.x,b.y-radius],[Math.abs(a.y-b.y-b.d),a.x,b.y+b.d+radius]].sort((x,y)=>x[0]-y[0]);a.x=edges[0][1];a.y=edges[0][2];}}a.x=clamp(a.x,radius,size.width-radius);a.y=clamp(a.y,radius,size.height-radius);if(hit){a.speed*=.15;a.vx=(a.vx||0)*-.15;a.vy=(a.vy||0)*-.15;}return a;}
 const api={step,collide};if(typeof module!=='undefined')module.exports=api;else root.CityDriving=api;
})(typeof window!=='undefined'?window:globalThis);
