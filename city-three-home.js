'use strict';
(function(root){
 const T=root.THREE;if(!T)return;
 function createFridge(ctx,b,item,room,finish){const group=new T.Group(),hinge=new T.Group(),base={...b,x:0,y:0},local={...item,x:0,y:0},p=(x,y,z)=>root.CityHomes.furniturePoint(base,local,x,y,z,room),body=finish?.fabric||'#f5f0e5',door=finish?.body||'#c5d5df',metal=finish?.detail||'#667b88';
  function cube(x,y,w,d,z,h,c){const lo=[[x,y],[x+w,y],[x+w,y+d],[x,y+d]].map(([x,y])=>p(x,y,z)),hi=[[x,y],[x+w,y],[x+w,y+d],[x,y+d]].map(([x,y])=>p(x,y,z+h)),faces=[{points:hi,color:c},{points:lo.slice().reverse(),color:c}];for(let n=0;n<4;n++)faces.push({points:[lo[n],lo[(n+1)%4],hi[(n+1)%4],hi[n]],color:c});return faces;}
  const shell=[cube(.18,.12,.64,.035,0,64,body),cube(.18,.12,.035,.70,0,64,body),cube(.785,.12,.035,.70,0,64,body),cube(.18,.12,.64,.70,0,2,body),cube(.18,.12,.64,.70,62,2,body),cube(.215,.16,.57,.012,2,60,'#aebfba')].flat();for(const z of [4,24,43])shell.push(...cube(.22,.18,.56,.62,z,1.4,'#dce7e2'));for(const [x,y,z,color]of [[.27,.39,5,'#d9bb72'],[.52,.32,5,'#85a6bf'],[.35,.40,25,'#83a772'],[.59,.45,25,'#c98d74']])shell.push(...cube(x,y,.10,.13,z,8,color));group.add(ctx.model(shell));
  const panel=ctx.model([cube(.18,.83,.64,.025,1,39,door),cube(.18,.83,.64,.025,41,22,door),cube(.72,.87,.035,.035,15,15,metal),cube(.72,.87,.035,.035,45,9,metal)].flat()),pivot=p(.18,.83,0);hinge.position.set(pivot.x*ctx.S,pivot.z*ctx.S,pivot.y*ctx.S);panel.position.copy(hinge.position).negate();hinge.add(panel);group.add(hinge);
  return {group,homeAppliance:'fridge',homeOwner:b.owner,homeItem:item.id,hinge,updateAction(action){const angle=action?.kind==='fridge'?Math.sin(Math.PI*Math.min(1,(action.time||0)/Math.max(.1,action.duration||3)))*1.3:0;hinge.rotation.y=-angle;}};
 }
 root.CityThreeHome={createFridge};
})(typeof window==='undefined'?globalThis:window);
