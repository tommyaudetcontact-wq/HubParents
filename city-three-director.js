'use strict';
(function(root){
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),delta=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
 let pose=null,drag=null,clock=0,lastLook=-10;
 function look(x,y,dt){if(!pose)return;pose.yaw+=clamp(x,-1,1)*dt*2.4;pose.pitch=clamp(pose.pitch+clamp(y,-1,1)*dt*.9,-.12,.8);lastLook=clock;}
 function bind(canvas,getActor){if(!canvas?.addEventListener)return;
  canvas.addEventListener('pointerdown',e=>{const a=getActor();if(!a||!root.CityCamera.enabled(a.id)||e.button>0)return;e.preventDefault();drag={id:e.pointerId,x:e.clientX,y:e.clientY};canvas.setPointerCapture?.(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId||!pose)return;e.preventDefault();look(-(e.clientX-drag.x)/400,(e.clientY-drag.y)/400,1);drag.x=e.clientX;drag.y=e.clientY;});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,e=>{if(drag?.id===e.pointerId)drag=null;});
 }
 function obstruction(start,end,actor){let fraction=1;
  for(const b of root.CityArt.buildings){if(root.CityBuildings&&!root.CityBuildings.solid(b))continue;
   // Interior walls are cut away by CityHomes; the exterior hull cannot enclose the camera.
   if(b.playerHome&&root.CityHomes?.inside(b))continue;
   const lo=[b.x-5,b.y-5,-5],hi=[b.x+b.w+5,b.y+b.d+5,b.h+5],s=[start.x,start.y,start.z],t=[end.x-start.x,end.y-start.y,end.z-start.z];
   if(s.every((v,i)=>v>=lo[i]&&v<=hi[i]))continue;
   let enter=0,leave=1;for(let i=0;i<3;i++){if(Math.abs(t[i])<.00001){if(s[i]<lo[i]||s[i]>hi[i]){enter=2;break;}}else{let a=(lo[i]-s[i])/t[i],z=(hi[i]-s[i])/t[i];if(a>z)[a,z]=[z,a];enter=Math.max(enter,a);leave=Math.min(leave,z);}}
   if(enter<=leave&&enter>=0&&enter<1)fraction=Math.min(fraction,Math.max(.02,enter-.025));
  }return fraction;
 }
 function camera(a,width,height,dt,coarse=false){dt=clamp(dt,0,.07);clock+=dt;
  if(!pose||Math.hypot(a.x-pose.x,a.y-pose.y)>350)pose={x:a.x,y:a.y,z:a.z||0,yaw:a.angle||0,pitch:.24,arm:1};
  const smooth=1-Math.exp(-dt*12);pose.x+=(a.x-pose.x)*smooth;pose.y+=(a.y-pose.y)*smooth;pose.z+=((a.z||0)-pose.z)*smooth;
  const speed=Math.abs(a.speed||0),driving=!!a.driving;
  if(driving&&speed>12&&clock-lastLook>1.6&&!drag){pose.yaw+=delta(a.angle||0,pose.yaw)*(1-Math.exp(-dt*2.5));pose.pitch+=(.22-pose.pitch)*(1-Math.exp(-dt*.8));}
  const fx=Math.sin(pose.yaw),fy=-Math.cos(pose.yaw),distance=driving?145+clamp(speed/10,0,35):92,target={x:pose.x,y:pose.y,z:pose.z+(driving?18:27)},cp=Math.cos(pose.pitch),sp=Math.sin(pose.pitch),end={x:target.x-fx*distance*cp,y:target.y-fy*distance*cp,z:target.z+distance*sp};
  const hit=obstruction(target,end,a);pose.arm=hit<pose.arm?hit:pose.arm+(hit-pose.arm)*(1-Math.exp(-dt*5));
  const eye={x:target.x+(end.x-target.x)*pose.arm,y:target.y+(end.y-target.y)*pose.arm,z:target.z+(end.z-target.z)*pose.arm},fov=64+(driving?clamp(speed/50,0,6):0),focal=height*.5/Math.tan(fov*Math.PI/360),far=coarse?1050:1450;
  const view=p=>{const x=p.x-eye.x,y=p.y-eye.y,z=(p.z||0)-eye.z,f=x*fx+y*fy;return {u:x*-fy+y*fx,v:f*sp+z*cp,d:f*cp-z*sp};},screen=p=>({x:width/2+p.u*focal/p.d,y:height/2-p.v*focal/p.d,depth:p.d,scale:focal/p.d});
  const visible=(p,r=40)=>{const q=view(p),hx=width/(2*focal),hy=height/(2*focal);return q.d+r>=8&&q.d-r<far&&Math.abs(q.u)<=q.d*hx+r*(1+hx)&&Math.abs(q.v)<=q.d*hy+r*(1+hy);};
  return {eye,target,pitch:pose.pitch,yaw:pose.yaw,fov,focal,far,width,height,view,screen,visible,project:(x,y,z=0)=>{const p=view({x,y,z});return p.d>8?screen(p):{x:-100000,y:-100000,depth:p.d,scale:0};}};
 }
 function transform(input,aim,id){if(!root.CityCamera.enabled(id)||!pose)return input;const x=aim?input.gunAimX||0:input.x,y=aim?input.gunAimY||0:input.y,fx=Math.sin(pose.yaw),fy=-Math.cos(pose.yaw),dx=-fy*x-fx*y,dy=fx*x-fy*y,sx=.94*dx+.342*dy,sy=.82*(-.342*dx+.94*dy),length=aim?Math.max(1,Math.hypot(sx,sy)):1;return aim?{...input,gunAimX:sx/length,gunAimY:sy/length}:{...input,x:sx,y:sy};}
 root.CityThreeDirector={camera,bind,look,transform,clear(){pose=null;drag=null;lastLook=-10;clock=0;},menu(){root.App.popup('<h2>Caméra</h2><p>Glisse sur le décor pour regarder autour de toi, à pied ou en véhicule. À la manette, utilise le stick droit.</p><p>La caméra se replace progressivement derrière le véhicule après un moment sans toucher à la vue.</p><button class="btn" data-camera="third">Recentrer la caméra</button>');}};
})(typeof window!=='undefined'?window:globalThis);
