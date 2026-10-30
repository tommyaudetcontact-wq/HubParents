'use strict';
(function(root){
 const T=root.THREE;if(!T||!root.BrawlCoupeAsset)return;
 const clamp=n=>Math.max(0,Math.min(100,Number(n)||0));
 const doorIds=side=>['door-','door-liner-','door-frame-','window-','b-pillar-','handle-'].map(p=>p+side);
 function region(id){if(id==='hood')return 0;if(id==='trunk')return 1;for(const [side,n]of [['left',2],['right',3]]){if(doorIds(side).includes(id))return n;if(id==='mirror-'+side||id==='mirror-stalk-'+side)return n+2;}return -1;}
 function eligible(v,a={},personal=false){return personal&&!a.loanVehicle&&!a.riding&&!v.heavy&&!v.tank&&['sport','coupe','classic'].includes(v.body);}
 function palette(color){const out={};for(const p of root.BrawlCoupeAsset.materials){out[p.id]=new T.MeshStandardMaterial({color:p.id==='paint'?color:p.color,roughness:p.roughness,metalness:p.metalness,side:T.DoubleSide,transparent:p.opacity<1,opacity:p.opacity,depthWrite:p.opacity>=1});}return out;}
 function bucket(parent,id){const g=new T.Group();g.name=id;parent.add(g);return g;}
 function create(ctx,v,color){
  const group=new T.Group(),body=bucket(group,'coupe-body'),parts=root.BrawlCoupeAsset.parts(),mats=palette(color),panels=Array.from({length:6},(_,i)=>bucket(body,'coupe-panel-'+i)),fixed=bucket(body,'coupe-shell'),glass=[],wheels=[];
  const fx=v.width*.7/.94,fz=v.length*.8/2.2,fy=Math.max(16.5,fx),k=1.4;body.scale.set(fx*k*ctx.S,fy*k*ctx.S,fz*k*ctx.S);
  for(const axle of ['front','rear'])for(const side of ['left','right']){const steering=bucket(body,'coupe-steer-'+axle+'-'+side),roll=bucket(steering,'coupe-wheel-'+axle+'-'+side);steering.position.set(side==='left'?-.82:.82,.32,axle==='front'?-1.35:1.30);wheels.push({axle,side,steering,roll});}
  for(const p of parts){if(/^(seat-|headrest-)/.test(p.id))p.geometry.translate(0,0,-.17);let parent=fixed;const n=region(p.id),wheel=wheels.find(w=>p.id.endsWith(w.axle+'-'+w.side)||p.id.startsWith('spoke-'+w.axle+'-'+w.side+'-'));
   if(wheel&&/^(tire|rim|hub|spoke)-/.test(p.id)){parent=wheel.roll;p.geometry.translate(-wheel.steering.position.x,-.32,-wheel.steering.position.z);}
   else if(p.material==='glass'){const pane=bucket(n>=0?panels[n]:fixed,p.id);parent=pane;glass.push({group:pane,index:p.id==='windshield'?0:p.id==='rear-window'||p.id.startsWith('window-quarter-')?1:p.id.endsWith('left')?2:3});}
   else if(n>=0)parent=panels[n];
   const mesh=new T.Mesh(p.geometry,mats[p.material]);mesh.name=p.id;mesh.userData.ownedGeometry=true;mesh.castShadow=p.material!=='glass';mesh.receiveShadow=true;parent.add(mesh);
  }
  if(root.CityThreeBatches){for(const w of wheels)root.CityThreeBatches.merge(w.roll);for(const p of panels)root.CityThreeBatches.merge(p);root.CityThreeBatches.merge(fixed);}
  const deform=[];for(const container of [fixed,...panels])container.traverse(mesh=>{if(mesh.isMesh)deform.push({mesh,rest:mesh.geometry.attributes.position.array.slice(),region:container===fixed?-1:panels.indexOf(container)});});
  let stamp='',lastAngle=null,lastAt=0,turn=0;
  function update(a){
   const wear=Array.from({length:6},(_,i)=>clamp(a.damage?.parts?.[i])),next=wear.join(',');
   if(stamp!==next){stamp=next;for(const p of deform){const attr=p.mesh.geometry.attributes.position,rest=p.rest;for(let i=0;i<attr.count;i++){
     const x=rest[i*3],y=rest[i*3+1],z=rest[i*3+2],f=wear[0]/100*Math.max(0,Math.min(1,(-z-.65)/1.55)),r=wear[1]/100*Math.max(0,Math.min(1,(z-.95)/1.25));let nx=x*(1-.035*(f+r)),ny=y-.075*(f+r),nz=z+.32*(f-r);
     if(p.region===0||p.region===1){const t=Math.max(0,Math.min(1,p.region===0?(-z-.61)/1.59:(z-1.35)/.85));ny+=.31*(wear[p.region]/100)**2*Math.sin(Math.PI*t)**2;}
     const side=x<0?2:3;if(p.region===side||p.region===-1&&Math.abs(x)>.7){const d=wear[side]/100*Math.exp(-((z-.12)**2/.30+(y-.52)**2/.12));nx-=Math.sign(x)*.20*d;}
     attr.setXYZ(i,nx,ny,nz);
    }attr.needsUpdate=true;p.mesh.geometry.computeVertexNormals();p.mesh.geometry.computeBoundingSphere();}
   }
   for(let i=0;i<panels.length;i++)panels[i].visible=wear[i]<100&&(i<4||wear[i-2]<100);
   // Quarter panes belong to the fixed body. Only main door panes detach with the door.
   for(const pane of glass)pane.group.visible=wear[pane.index]<85;
   const now=root.performance?.now?.()||0,dt=lastAt?Math.max(.008,Math.min(.07,(now-lastAt)/1000)):1/60,delta=lastAngle===null?0:Math.atan2(Math.sin((a.angle||0)-lastAngle),Math.cos((a.angle||0)-lastAngle));turn+=((a.turnRate??delta/dt)-turn)*(1-Math.exp(-dt*15));lastAngle=a.angle||0;lastAt=now;
   for(const w of wheels){w.roll.rotation.x=a.wheelAngle||0;w.steering.rotation.y=w.axle==='front'?-Math.max(-.48,Math.min(.48,turn*.28))*Math.sign(a.speed||1):0;}
  }
  const cabin={coupe:true,scale:k,w:.95*fx,l:v.length*.8,base:.20*fy,belt:.86*fy,roof:1.31*fy,front:-.61*fz,back:1.35*fz,steeringZ:-.25*fz,seatX:-.38*fx,seatY:.52*fy,seatZ:.18*fz,handSpan:.11*fx,handY:.87*fy,footZ:-.10*fz,footY:.25*fy};
  let aura;if(v.trail){aura=new T.Mesh(new T.TorusGeometry(1,.025,6,48),new T.MeshBasicMaterial({color:{fire:'#ff8b40',ice:'#94ecff',electric:'#b19aff',neon:'#56fff0',dark:'#ae7cdd',rainbow:'#f3a0df'}[v.trail]||'#b8f8ee',transparent:true,opacity:.4,depthWrite:false}));aura.rotation.x=-Math.PI/2;aura.scale.set(v.width*.7*k*ctx.S*1.2,v.length*.8*k*ctx.S*1.12,1);aura.position.y=.04;aura.userData.ownedGeometry=true;aura.userData.ownedMaterial=true;group.add(aura);}
  // Mark each unique palette once so normal scene cleanup disposes it without touching shared materials.
  for(const mat of Object.values(mats)){const owner=body.getObjectByProperty('material',mat);if(owner)owner.userData.ownedMaterial=true;else mat.dispose();}
  update({});return {group,update,cabin,coupe:true,panels,wheels};
 }
 function createDebris(ctx,p){const parts=root.BrawlCoupeAsset.parts(),mats=palette(p.color),group=new T.Group(),ids=p.i===0?['hood']:p.i===1?['trunk']:p.i===2?doorIds('left').concat(['mirror-left','mirror-stalk-left']):p.i===3?doorIds('right').concat(['mirror-right','mirror-stalk-right']):p.i===4?['mirror-left','mirror-stalk-left']:p.i===5?['mirror-right','mirror-stalk-right']:[];
  for(const part of parts){if(!ids.includes(part.id)){part.geometry.dispose();continue;}const m=new T.Mesh(part.geometry,mats[part.material]);m.userData.ownedGeometry=true;m.castShadow=m.receiveShadow=true;group.add(m);}
  const scale=new T.Vector3(p.w/.94*ctx.S,Math.max(16.5*1.4,p.w/.94)*ctx.S,p.l/2.2*ctx.S);for(const m of group.children)m.geometry.scale(scale.x,scale.y,scale.z);group.updateMatrixWorld(true);const center=new T.Box3().setFromObject(group).getCenter(new T.Vector3());for(const m of group.children)m.geometry.translate(-center.x,-center.y,-center.z);
  root.CityThreeBatches?.merge(group);for(const mat of Object.values(mats)){const owner=group.getObjectByProperty('material',mat);if(owner)owner.userData.ownedMaterial=true;else mat.dispose();}return group;
 }
 root.CityThreeCoupe={create,createDebris,eligible,region};
})(typeof window==='undefined'?globalThis:window);
