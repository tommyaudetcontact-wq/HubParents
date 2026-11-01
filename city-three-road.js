'use strict';
(function(root){
 const T=root.THREE;if(!T)return;
 const family=v=>({convertible:'sedan',rally:'compact',truck:'pickup',sedan:'sedan',compact:'compact',electric:'compact',wagon:'suv',suv:'suv',minivan:'van',pickup:'pickup',van:'van',bus:'bus'})[v.body];
 const eligible=v=>!v.tank&&!!family(v);
 function profile(v){const familyId=family(v),p={...root.BrawlRoadProfiles[familyId],family:familyId};
  if(v.body==='convertible'){Object.assign(p,{doors:2,openTop:true,roof:1.32,roofFront:-.5,front:-.93,back:1.3,roofBack:1.02});if(v.id==='car-azur')Object.assign(p,{twoSeat:true,halfLength:2.12,halfWidth:.93,back:.9,roofBack:.75,front:-1.01,roofFront:-.58,roof:1.27,belt:.78,axles:[-1.35,1.34]});if(v.id==='car-rosalie')Object.assign(p,{halfLength:2.4,halfWidth:1.0,roof:1.42,belt:.88,front:-.85,roofFront:-.35,back:1.45,roofBack:1.2,axles:[-1.54,1.5]});}
  if(v.body==='rally')Object.assign(p,{rally:true,radius:.35,belt:.93,roof:1.46});
  if(v.heavy==='monster')Object.assign(p,{monster:true,doors:2,base:.81,belt:1.5,roof:2.18,radius:.68,tireWidth:.40,halfWidth:1.03,roofFront:-.8,roofBack:.54,front:-1.14,back:.62});
  if(v.body==='truck')Object.assign(p,{cargoTruck:v.id==='car-routier',cargoHeight:2.65,doors:2,halfLength:3.1,halfWidth:1.12,base:.6,belt:1.4,roof:2.05,roofFront:-1.4,roofBack:-.2,front:-1.8,back:.1,axles:[-2.0,2.1],radius:.48,tireWidth:.28});return p;}
 function create(ctx,v,color,actor={}){
  const id=family(v),p=profile(v),model=root.BrawlRoadModel.create(p,color,3,{interactions:true,optimize:true}),group=new T.Group(),k=v.heavy&&v.heavy!=='monster'?1:1.4,fx=v.width*.7/p.halfWidth,fz=v.length*.8/p.halfLength,fy=fx;
  group.add(model.group);model.group.scale.set(fx*k*ctx.S,fy*k*ctx.S,fz*k*ctx.S);
  model.group.traverse(m=>{if(m.isMesh){m.userData.ownedGeometry=true;m.userData.ownedMaterial=true;}});
  const lift=Math.max(0,(p.roof-1.36)*.6+(p.belt-.81)*.5),dash=Math.max(0,p.belt-.81),cabin={scale:k,w:p.halfWidth*fx,l:p.halfLength*fz,base:(p.base??.2)*fy,belt:p.belt*fy,roof:p.roof*fy,front:p.front*fz,back:p.back*fz,seatX:(id==='bus'?1:-1)*p.halfWidth*.43*fx,seatY:(.485+lift)*fy,seatZ:(p.front+.65)*fz,steeringZ:(p.front+.30)*fz,handY:(.85+dash)*fy,handSpan:.11*fx,footZ:(p.front+.06)*fz,footY:((p.base??.2)+.14)*fy};
  let aura=null;
  if(v.trail){aura=new T.Mesh(new T.TorusGeometry(1,.035,6,48),new T.MeshBasicMaterial({color:{fire:'#ff8b40',ice:'#94ecff',electric:'#b19aff',neon:'#56fff0',dark:'#ae7cdd',rainbow:'#f3a0df'}[v.trail]||'#b8f8ee',transparent:true,opacity:.45,depthWrite:false}));aura.rotation.x=Math.PI/2;aura.scale.set(v.width*.7*k*ctx.S*1.25,v.length*.8*k*ctx.S*1.05,1);aura.position.y=.02;aura.userData.ownedGeometry=aura.userData.ownedMaterial=true;group.add(aura);}
  function update(a){model.update({...a,steer:-Math.max(-.48,Math.min(.48,(a.turnRate||0)*.25))*Math.sign(a.speed||1),emitFragments:false});if(aura)aura.material.opacity=.4+.06*Math.sin((root.performance?.now?.()||0)/350);}
  group.userData.fleet={family:id,vehicle:v.id,workshop:true};update(actor);return {group,update,cabin,panels:model.panels,wheels:model.wheels,fleet:true,road:true,model};
 }
 root.CityThreeRoad={create,eligible,family,profile};
})(typeof window==='undefined'?globalThis:window);
