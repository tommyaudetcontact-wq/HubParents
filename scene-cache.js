'use strict';
// Cache static stretches of the depth-sorted scene; actors and opening doors stay live.
window.SceneCache=(()=>{
 const order=Construction.sceneOrder,limit=6000000;
 function render(a,entities){if(a.pendingPlacement||typeof document.createElement!=='function')return order(a,entities).forEach(n=>n.draw());
  const nodes=order(a,entities),groups=[];let group=[];
  const flush=()=>{if(group.length){groups.push({nodes:group});group=[];}};
  for(const n of nodes){if(n.kind==='wall'&&n.run.type!=='door'||n.cacheKey)group.push(n);else{flush();groups.push({live:n});}}flush();
  const w=a.logicalWidth||a.c.width,h=a.logicalHeight||a.c.height,v=a.viewCamera||{zoom:1,x:0,y:0},density=a.renderDensity||1;
  const stamp=JSON.stringify([w,h,density,v,a.mode,a.wallView,a.room.size,a.room.zones,a.room.walls,a.room.removedWalls,a.room.doors,a.room.windows,a.room.items,a.room.wall,a.room.wallTexture,a.room.wallSecondary,a.room.wallMaterials,a.profile.furnitureColors,a.profile.furnitureMaterials,a.selected]);
  const keys=new Set();for(const g of groups)if(g.nodes){g.key=stamp+'|'+g.nodes.map(n=>n.kind==='wall'?n.run.id+':'+Math.round(Construction.wallOpacity(a,n.run)*20):n.cacheKey).join('|');keys.add(g.key);}
  const memo=a.sceneLayers||(a.sceneLayers=new Map());let pixels=0;for(const [key,layer] of memo){if(!keys.has(key))memo.delete(key);else pixels+=layer.width*layer.height;}
  for(const g of groups){if(g.live){g.live.draw();continue;}let layer=memo.get(g.key);const size=Math.ceil(w*density)*Math.ceil(h*density);if(!layer&&pixels+size<=limit){layer=document.createElement('canvas');layer.width=Math.ceil(w*density);layer.height=Math.ceil(h*density);const c=layer.getContext('2d');c.setTransform(density*v.zoom,0,0,density*v.zoom,density*(w/2+(v.x||0)-w/2*v.zoom),density*(h/2+(v.y||0)-h/2*v.zoom));const previous=a.ctx,capture=a.sceneCapture;a.ctx=c;a.sceneCapture=true;try{g.nodes.forEach(n=>n.draw());}finally{a.ctx=previous;a.sceneCapture=capture;}memo.set(g.key,layer);pixels+=size;}
   if(layer){const c=a.ctx;c.save();c.setTransform(density,0,0,density,0,0);c.drawImage(layer,0,0,w,h);c.restore();}else g.nodes.forEach(n=>n.draw());
  }a.sceneLayerPixels=pixels;
 }
 Construction.renderScene=render;
 return {render,limit};
})();
