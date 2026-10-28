'use strict';
// Image-driven Riff only. Immutable procedural surfaces; shared semantic game poses.
(function(root){
 const T=root.THREE,data=root.BrawlRiffImage;if(!T||!data)return;const up=new T.Vector3(0,1,0),v=p=>new T.Vector3(p[0],p[2],-p[1]),game=p=>[p.x,-p.z,p.y];
 const decode=(s,Type)=>{const raw=root.atob(s),b=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)b[i]=raw.charCodeAt(i);return new Type(b.buffer);};
 const geometry=data.parts.map(p=>{const g=new T.BufferGeometry();for(const [key,type,size]of [['position','positions',3],['normal','normals',3],['skinIndex','skinIndex',4],['skinWeight','skinWeight',4],['tattooCoord','tattooCoord',3]]){if(!p[type])continue;g.setAttribute(key,new T.BufferAttribute(decode(p[type],key==='skinIndex'?Uint16Array:Float32Array),size));}g.setIndex(new T.BufferAttribute(decode(p.indices,Uint32Array),1));if(p.gripDelta){g.morphTargetsRelative=true;g.morphAttributes.position=[new T.BufferAttribute(decode(p.gripDelta,Float32Array),3)];g.morphAttributes.normal=[new T.BufferAttribute(decode(p.gripNormalDelta,Float32Array),3)];}g.computeBoundingSphere();return g;});
 function ink(material){material.onBeforeCompile=s=>{s.vertexShader='attribute vec3 tattooCoord;varying vec3 vTattooCoord;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n vTattooCoord=tattooCoord;');s.fragmentShader='varying vec3 vTattooCoord;\n'+s.fragmentShader;s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\n vec3 p=vTattooCoord;float x=p.x+.30;float upper=1.234-abs(x)*1.45;float a=1.-smoothstep(.006,.009,abs(p.y-upper));float arc=abs(length(vec2(x/.046,(p.y-1.116)/.067))-1.);float b=1.-smoothstep(.12,.20,arc);float band=1.-smoothstep(.008,.012,abs(p.y-(1.17+.018*sin(x*48.))));float mask=max(a,max(b,band))*step(.0,p.z)*step(1.035,p.y)*step(p.y,1.25);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.075,.065,.065),mask*.88);');};material.customProgramCacheKey=()=> 'riff-image-tribal-v1';}
 function retarget(input,actor={},weaponPose=null){
  if(input.rigidFrames){
   const rest=data.rest,frames=input.rigidFrames,q={},rotation=k=>new T.Quaternion().fromArray(frames[k]),body=rotation('hip'),at=(origin,a,b)=>game(v(origin).add(v(a).sub(v(b)).applyQuaternion(body)));
   q.hip=at(input.hip,rest.hip,root.BrawlOriginalCharacter.rest.hip);
   const end=(start,key,a,b)=>game(v(start).addScaledVector(up.clone().applyQuaternion(rotation(key)),v(rest[a]).distanceTo(v(rest[b]))));
   q.chest=end(q.hip,'hip','hip','chest');q.head=end(q.chest,'chest','chest','head');
   for(const side of ['l','r']){q[side+'s']=at(q.chest,rest[side+'s'],rest.chest);q[side+'l']=at(q.hip,rest[side+'l'],rest.hip);
    for(const [a,b]of [['s','e'],['e','h'],['l','k'],['k','f']])q[side+b]=end(q[side+a],side+a,side+a,side+b);
   }
   Object.defineProperty(q,'rigidFrames',{value:frames});Object.defineProperty(q,'orientation',{value:input.orientation});return q;
  }
  const old=root.BrawlOriginalCharacter.rest,rest=data.rest,q=Object.fromEntries(Object.entries(input).map(([k,p])=>[k,p.slice()])),bodyAxis=v(input.chest).sub(v(input.hip)).normalize(),bodyRotation=new T.Quaternion().setFromUnitVectors(up,bodyAxis),offset=(a,b)=>v(a).sub(v(b)).applyQuaternion(bodyRotation),length=(a,b)=>v(rest[a]).distanceTo(v(rest[b]));
  q.hip=game(v(input.hip).add(offset(rest.hip,old.hip)));q.chest=game(v(q.hip).add(offset(rest.chest,rest.hip)));const neckAxis=v(input.head).sub(v(input.chest)).normalize();q.head=game(v(q.chest).addScaledVector(neckAxis,length('chest','head')));
  function ik(a,end,pole,l1,l2){const start=v(a),target=v(end),axis=target.clone().sub(start),distance=Math.max(.00001,axis.length()),d=Math.min(distance,l1+l2-.00001);axis.normalize();target.copy(start).addScaledVector(axis,d);const bend=v(pole).sub(start);bend.addScaledVector(axis,-bend.dot(axis));if(bend.lengthSq()<1e-8){bend.set(0,0,1).addScaledVector(axis,-axis.z);if(bend.lengthSq()<1e-8)bend.set(1,0,0);}bend.normalize();const along=(l1*l1-l2*l2+d*d)/(2*d),height=Math.sqrt(Math.max(0,l1*l1-along*along));return {middle:game(start.clone().addScaledVector(axis,along).addScaledVector(bend,height)),end:game(target)};}
  for(const side of ['l','r']){q[side+'s']=game(v(q.chest).add(offset(rest[side+'s'],rest.chest)));q[side+'l']=game(v(q.hip).add(offset(rest[side+'l'],rest.hip)));const contactRide=actor.riding===true||actor.riding==='scooter',hand=contactRide?input[side+'h'].slice():game(v(input[side+'h']).add(offset(rest[side+'h'],old[side+'h']))),foot=contactRide?input[side+'f'].slice():game(v(input[side+'f']).add(offset(rest[side+'f'],old[side+'f'])));const arm=ik(q[side+'s'],hand,game(v(input[side+'e']).add(offset(rest[side+'e'],old[side+'e']))),length(side+'s',side+'e'),length(side+'e',side+'h')),leg=ik(q[side+'l'],foot,game(v(input[side+'k']).add(offset(rest[side+'k'],old[side+'k']))),length(side+'l',side+'k'),length(side+'k',side+'f'));q[side+'e']=arm.middle;q[side+'h']=arm.end;q[side+'k']=leg.middle;q[side+'f']=leg.end;}
  if(actor.riding==='skateboard'&&!input.orientation){
   const yaw=1.20,turn=new T.Quaternion().setFromAxisAngle(up,yaw),frame=bodyRotation.clone().multiply(turn),at=(origin,delta)=>game(v(origin).add(v(delta).applyQuaternion(frame))),delta=(a,b)=>game(v(a).sub(v(b))),grabbing=actor.skateGrab||actor.skateAutoGrab;
   Object.defineProperty(q,'bodyYaw',{value:yaw});
   if(!grabbing&&!actor.skateFlipRate&&!actor.skateCatching){const model=root.BrawlCore?.vehicles.find(v=>v.id===(actor.loanVehicle||actor.vehicle)),floor=(2.55+(model?.hover?model.hoverHeight||0:0))/(actor.rigScale||.3)+3.6,rise=floor+length('ll','lk')+length('lk','lf')+(rest.hip[2]-rest.ll[2])-.1-q.hip[2];for(const k of ['hip','chest','head'])q[k][2]+=rise;}
   for(const [side,sign]of [['l',-1],['r',1]]){q[side+'s']=at(q.chest,delta(rest[side+'s'],rest.chest));q[side+'l']=at(q.hip,delta(rest[side+'l'],rest.hip));
    let hand=grabbing||weaponPose?input[side+'h'].slice():at(q.hip,delta(rest[side+'h'],rest.hip));if(!grabbing&&!weaponPose)hand[1]+=sign*3;
    const foot=grabbing||actor.skateFlipRate||actor.skateCatching?input[side+'f'].slice():[q[side+'l'][0],q[side+'l'][1]+sign*2,(2.55+((root.BrawlCore?.vehicles.find(v=>v.id===(actor.loanVehicle||actor.vehicle)))?.hoverHeight||0))/(actor.rigScale||.3)+3.6],armPole=at(q[side+'s'],[sign*9,8,-17]),legPole=at(q[side+'l'],[sign*2,18,-18]);
    const arm=ik(q[side+'s'],hand,armPole,length(side+'s',side+'e'),length(side+'e',side+'h')),leg=ik(q[side+'l'],foot,legPole,length(side+'l',side+'k'),length(side+'k',side+'f'));q[side+'e']=arm.middle;q[side+'h']=arm.end;q[side+'k']=leg.middle;q[side+'f']=leg.end;
   }
  }
  if((actor.riding===true||actor.riding==='scooter')&&!input.orientation){
   const scale=actor.rigScale||.3,scooter=actor.riding==='scooter',model=root.BrawlCore?.vehicles.find(v=>v.id===(actor.loanVehicle||actor.vehicle)),span=(model?.length||28)*.8,barY=scooter?6.2/scale:span*.45/scale,barZ=(scooter?22:20)/scale;
   q.hip=[0,scooter?-2:-span*.13/scale,67];const lean=scooter?10:21;q.chest=[0,q.hip[1]+lean,q.hip[2]+Math.sqrt(length('hip','chest')**2-lean**2)];q.head=[0,q.chest[1]+2,q.chest[2]+length('chest','head')];
   const frame=new T.Quaternion().setFromUnitVectors(up,v(q.chest).sub(v(q.hip)).normalize());
   for(const [side,sign]of [['l',-1],['r',1]]){q[side+'s']=game(v(q.chest).add(v(rest[side+'s']).sub(v(rest.chest)).applyQuaternion(frame)));q[side+'l']=game(v(q.hip).add(v(rest[side+'l']).sub(v(rest.hip)).applyQuaternion(frame)));
    const hand=[sign*(scooter?4.7:7)/scale,barY-3.4,barZ+1.9],foot=scooter?[sign*2,side==='l'?7:-7,3.45/scale+3.6]:[sign*6/scale,3,9/scale+3.6],arm=ik(q[side+'s'],hand,[sign*25,q.chest[1]+9,q.chest[2]-14],length(side+'s',side+'e'),length(side+'e',side+'h')),leg=ik(q[side+'l'],foot,[sign*20,22,40],length(side+'l',side+'k'),length(side+'k',side+'f'));q[side+'e']=arm.middle;q[side+'h']=arm.end;q[side+'k']=leg.middle;q[side+'f']=leg.end;
   }
  }
  if(weaponPose?.kind==='smg'&&!input.orientation&&!actor.riding){
   q.chest[1]+=3;q.head[1]+=3;const frame=new T.Quaternion().setFromUnitVectors(up,v(q.chest).sub(v(q.hip)).normalize());
   for(const side of ['l','r'])q[side+'s']=game(v(q.chest).add(v(rest[side+'s']).sub(v(rest.chest)).applyQuaternion(frame)));
   const height=q.chest[2]-88.04,depth=q.chest[1]-3;
   for(const [side,target,pole]of [['r',[7,16+depth,75+height],[24,6+depth,68+height]],['l',[2,32+depth,78+height],[-22,14+depth,67+height]]]){const arm=ik(q[side+'s'],target,pole,length(side+'s',side+'e'),length(side+'e',side+'h'));q[side+'e']=arm.middle;q[side+'h']=arm.end;}
  }
  // The old 2D gait has poles that switch sides of a straight limb. Author a stable 3D gait instead.
  const moving=Math.hypot(actor.vx||0,actor.vy||0)>1;
  if(moving&&!actor.riding&&!input.orientation&&weaponPose?.kind!=='worker-hammer'&&!(weaponPose?.kind==='poop'&&weaponPose.poopWindup>0)&&root.CharacterRig&&root.CityThreeCharacter){
   const expected=root.CityThreeCharacter.retarget(root.CharacterRig.joints3d({phase:actor.walkPhase||0,moving:true,weapon:weaponPose}));
   const standard=Object.keys(data.rest).every(k=>expected[k]&&input[k]&&v(expected[k]).distanceTo(v(input[k]))<.0001);
   if(standard&&root.CityThreeLocomotion){
    const gait=root.CityThreeLocomotion.sample(data.rest,actor);if(!weaponPose)return gait;
    const kind=weaponPose.kind,two=['smg','vacuum','missile','flame','soldiers','blackhole','soccer','hammer'].includes(kind),throwable=['beer','dance','lease','poop'].includes(kind),hands={l:two,r:kind!=='belch'};
    Object.defineProperty(gait,'weaponHands',{value:hands});
    if(kind==='hammer'&&weaponPose.hammerTime>0||kind==='belch'&&weaponPose.belchTime>0){
     const shift=game(v(gait.hip).sub(v(q.hip)));for(const key of ['chest','head','ls','rs','le','re','lh','rh'])gait[key]=q[key].map((x,i)=>x+shift[i]);return gait;
    }
    if(kind==='belch')return gait;
    for(const [side,sign]of [['l',-1],['r',1]]){if(!hands[side])continue;
     const target=two?game(v(q[side+'h']).sub(v(q.chest)).add(v(gait.chest))):throwable?[13,gait.hip[1]+5,gait.hip[2]+7]:[10,gait.chest[1]+24,gait.chest[2]-12];
     if(two)target[1]-=2; // Keep the rigid two-hand grip inside both arms' reach through shoulder sway.
     const arm=ik(gait[side+'s'],target,[sign*25,gait.chest[1]+5,gait.chest[2]-16],length(side+'s',side+'e'),length(side+'e',side+'h'));gait[side+'e']=arm.middle;gait[side+'h']=arm.end;
    }
    return gait;
   }
  }

  if(input.orientation)Object.defineProperty(q,'orientation',{value:input.orientation});return q;
 }
 function create(ctx,source){
  const group=new T.Group();group.name='riff-image-avatar';group.userData.structure={version:'riff-image-v1',skeleton:'shared-game-semantic-pose',slots:['body','head','hair','headwear','eyewear','shirt','pants','shoes','accessories'],customizationUI:false};const slots={};for(const name of group.userData.structure.slots){const g=new T.Group();g.name=name;g.userData.slot=name;group.add(g);slots[name]=g;}
  const armature=new T.Group();armature.name='riff-image-skeleton';group.add(armature);const bones=data.bones.map((d,i)=>{const b=new T.Bone(),a=v(d.a),end=v(d.b);b.name='riff-bone-'+i;b.position.copy(a);b.userData.bindDirection=end.sub(a).normalize();b.quaternion.setFromUnitVectors(up,b.userData.bindDirection);b.userData.bindQuaternion=b.quaternion.clone();armature.add(b);return b;});group.updateMatrixWorld(true);const skeleton=new T.Skeleton(bones),meshes=[];
  data.parts.forEach((p,i)=>{const mat=new T.MeshStandardMaterial({...p.material,envMapIntensity:.15});if(p.tattoo)ink(mat);const m=new T.SkinnedMesh(geometry[i],mat);m.name=p.slot+'-surface-'+i;m.userData.parts=p.parts;m.userData.handSide=p.parts.includes('arm-l')?'l':p.parts.includes('arm-r')?'r':null;m.userData.ownedMaterial=true;m.userData.sharedSkeleton=i>0;m.frustumCulled=false;m.castShadow=m.receiveShadow=true;slots[p.slot].add(m);m.bind(skeleton,new T.Matrix4());meshes.push(m);});
  if(source.role&&source.role!=='hockey'){slots.headwear.visible=false;slots.hair.visible=false;}
  group.userData.identity={signature:'riff-nocturne',pilot:'riff-image-v1',modular:true};
  let headRotation=new T.Quaternion(),lastTime=null,grips={l:0,r:0};function update(input,actor,weaponPose){const pose=retarget(input,actor,weaponPose);const now=root.performance?.now?.()||Date.now(),dt=lastTime===null?1/60:Math.min(.05,Math.max(0,(now-lastTime)/1000));lastTime=now;const gripping=!input.orientation&&(actor.riding===true||actor.riding==='scooter'||!!weaponPose);const runGrip=!input.orientation&&!actor.riding&&(!weaponPose||pose.weaponHands)?Math.max(0,Math.min(.9,(Math.hypot(actor.vx||0,actor.vy||0)-55)/50*.9)):0;for(const side of ['l','r']){const held=pose.weaponHands?pose.weaponHands[side]:gripping;grips[side]+=(Math.max(Number(held),runGrip)-grips[side])*(1-Math.exp(-dt*12));}for(const m of meshes)if(m.morphTargetInfluences)m.morphTargetInfluences[0]=grips[m.userData.handSide||'r'];group.scale.setScalar(ctx.S*(actor.rigScale||.3));for(let i=0;i<bones.length;i++){const yaw=new T.Quaternion().setFromAxisAngle(up,i===2?0:pose.jointYaw?.[data.bones[i].start]??pose.bodyYaw??0),def=data.bones[i],a=v(pose[def.start]),b=def.end?v(pose[def.end]):a.clone().add(v(def.b).sub(v(def.a)));if(def.hand){const handHeld=!input.orientation&&(pose.weaponHands?pose.weaponHands[def.hand]:gripping);const axis=handHeld?new T.Vector3(0,actor.riding||def.hand==='l'?-.08:-1,actor.riding||def.hand==='l'?-1:-.08).normalize():v(pose[def.hand+'h']).sub(v(pose[def.hand+'e'])).normalize();b.copy(a).addScaledVector(axis,8);}bones[i].position.copy(a);bones[i].quaternion.setFromUnitVectors(bones[i].userData.bindDirection.clone().applyQuaternion(yaw),b.sub(a).normalize()).multiply(yaw).multiply(bones[i].userData.bindQuaternion);if(pose.rigidFrames?.[def.start])bones[i].quaternion.fromArray(pose.rigidFrames[def.start]);if(def.foot&&pose.footRotations){bones[i].quaternion.setFromEuler(new T.Euler(...pose.footRotations[def.foot],'YXZ')).multiply(bones[i].userData.bindQuaternion);}else if(def.foot){const calf=bones[def.foot==='l'?6:10],flat=actor.riding&&!input.orientation;bones[i].quaternion.copy(flat?new T.Quaternion().setFromAxisAngle(up,actor.riding==='skateboard'?1.20:0).multiply(bones[i].userData.bindQuaternion):calf.quaternion.clone().multiply(calf.userData.bindQuaternion.clone().invert()).multiply(bones[i].userData.bindQuaternion));}if(i===2){if(pose.orientation){bones[i].quaternion.set(...pose.orientation);headRotation.copy(bones[i].quaternion);}else{const idle=Math.hypot(actor.vx||0,actor.vy||0)<=1&&!actor.riding&&!weaponPose,target=bones[i].quaternion.clone();if(idle)target.multiply(new T.Quaternion().setFromEuler(new T.Euler(0,.48,.105,'YXZ')));headRotation.slerp(target,1-Math.exp(-dt*10));bones[i].quaternion.copy(headRotation);}}}group.updateMatrixWorld(true);skeleton.update();return pose;}
  return {group,update,meshes,bones,skeleton};
 }
 root.CityThreeRiffImage={create,retarget,stats:()=>({vertices:data.vertices,triangles:data.triangles,batches:data.parts.length,modular:true,origin:'img2threejs image-driven original'})};
})(typeof window==='undefined'?globalThis:window);
