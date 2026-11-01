'use strict';
(function(root){
 const T=root.THREE;if(!T)return;
 const family=v=>({sedan:'sedan',compact:'compact',electric:'compact',wagon:'suv',suv:'suv',minivan:'van',pickup:'pickup',van:'van',bus:'bus'})[v.body];
 const eligible=v=>!v.tank&&!!family(v)&&v.heavy!=='monster';
 function create(ctx,v,color,actor={}){
  const id=family(v),p={...root.BrawlRoadProfiles[id],family:id},model=root.BrawlRoadModel.create(p,color,3,{interactions:true,optimize:true}),group=new T.Group(),k=v.heavy?1:1.4,fx=v.width*.7/p.halfWidth,fz=v.length*.8/p.halfLength,fy=fx;
  group.add(model.group);model.group.scale.set(fx*k*ctx.S,fy*k*ctx.S,fz*k*ctx.S);
  model.group.traverse(m=>{if(m.isMesh){m.userData.ownedGeometry=true;m.userData.ownedMaterial=true;}});
  const lift=Math.max(0,(p.roof-1.36)*.6+(p.belt-.81)*.5),dash=Math.max(0,p.belt-.81),cabin={scale:k,w:p.halfWidth*fx,l:p.halfLength*fz,base:(p.base??.2)*fy,belt:p.belt*fy,roof:p.roof*fy,front:p.front*fz,back:p.back*fz,seatX:(id==='bus'?1:-1)*p.halfWidth*.43*fx,seatY:(.485+lift)*fy,seatZ:(p.front+.65)*fz,steeringZ:(p.front+.30)*fz,handY:(.85+dash)*fy,handSpan:.11*fx,footZ:(p.front+.06)*fz,footY:((p.base??.2)+.14)*fy};
  let aura=null;
  if(v.trail){aura=new T.Mesh(new T.TorusGeometry(1,.035,6,48),new T.MeshBasicMaterial({color:{fire:'#ff8b40',ice:'#94ecff',electric:'#b19aff',neon:'#56fff0',dark:'#ae7cdd',rainbow:'#f3a0df'}[v.trail]||'#b8f8ee',transparent:true,opacity:.45,depthWrite:false}));aura.rotation.x=Math.PI/2;aura.scale.set(v.width*.7*k*ctx.S*1.25,v.length*.8*k*ctx.S*1.05,1);aura.position.y=.02;aura.userData.ownedGeometry=aura.userData.ownedMaterial=true;group.add(aura);}
  function update(a){model.update({...a,steer:-Math.max(-.48,Math.min(.48,(a.turnRate||0)*.25))*Math.sign(a.speed||1),emitFragments:false});if(aura)aura.material.opacity=.4+.06*Math.sin((root.performance?.now?.()||0)/350);}
  group.userData.fleet={family:id,vehicle:v.id,workshop:true};update(actor);return {group,update,cabin,panels:model.panels,wheels:model.wheels,fleet:true,road:true,model};
 }
 root.CityThreeRoad={create,eligible,family};
})(typeof window==='undefined'?globalThis:window);
