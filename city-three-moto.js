'use strict';
(function(root){
 const T=root.THREE;
 function eligible(v){return v.body==='motorcycle'&&!v.scooter&&!v.skateboard;}
 function create(ctx,v,color,actor={}){
  const model=root.BrawlMotoModel.create({S:ctx.S,kind:v.motorcycleKind||'cross',color}),mount=model.mount(),geometry=new Set(),materials=new Set(),deform=[];let heading=null,at=0,steer=0,stamp='';
  model.group.traverse(o=>{if(o.geometry&&!geometry.has(o.geometry)){geometry.add(o.geometry);o.userData.ownedGeometry=true;}if(o.material&&!materials.has(o.material)){materials.add(o.material);o.userData.ownedMaterial=true;}if(o.isMesh&&o.material.color?.getHexString()===new T.Color(color).getHexString())deform.push({mesh:o,rest:o.geometry.attributes.position.array.slice()});});
  let aura;if(v.trail){const c={fire:'#ffae64',electric:'#87dffa',dark:'#b596ef'}[v.trail]||'#acf0ea';aura=new T.Mesh(new T.TorusGeometry(1,.035,6,48),new T.MeshBasicMaterial({color:c,transparent:true,opacity:.45,depthWrite:false}));aura.rotation.x=-Math.PI/2;aura.scale.set(8,23,1);aura.position.y=.5;aura.userData.ownedGeometry=aura.userData.ownedMaterial=true;model.body.add(aura);}
  function update(a){const now=root.performance?.now?.()||0,dt=at?Math.max(.008,Math.min(.07,(now-at)/1000)):1/60,turn=heading===null?0:Math.atan2(Math.sin((a.angle||0)-heading),Math.cos((a.angle||0)-heading))/dt;heading=a.angle||0;at=now;steer+=(-Math.max(-.4,Math.min(.4,turn*.18))*Math.sign(a.speed||1)-steer)*(1-Math.exp(-dt*12));model.update({...a,steer});Object.assign(mount,model.mount());
   const wear=a.damage?.parts||[],next=wear.join(':');if(next!==stamp){stamp=next;for(const item of deform){const p=item.mesh.geometry.attributes.position,r=item.rest;for(let i=0;i<p.count;i++){const x=r[i*3],y=r[i*3+1],z=r[i*3+2],damage=Math.min(100,wear[z<0?0:1]||0)/100;p.setXYZ(i,x*(1-damage*.1),y-Math.max(0,y-10)*damage*.17,z*(1-damage*.12));}p.needsUpdate=true;item.mesh.geometry.computeVertexNormals();item.mesh.geometry.computeBoundingSphere();}}
   if(aura)aura.material.opacity=.34+.1*Math.sin(now/250);
  }
  return {group:model.group,update,mount,motorcycle:true,model};
 }
 root.CityThreeMoto={create,eligible};
})(typeof window!=='undefined'?window:globalThis);
