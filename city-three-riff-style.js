'use strict';
// One modular pilot outfit. No account IDs, wardrobe UI or persistence changes.
(function(root){
 const T=root.THREE;if(!T)return;
 function attach(ctx,{member,source,head,gear,group}){
  const look=source.look,anchors=[],slots={};
  function slot(parent,name){const g=new T.Group();g.name=name;g.userData.slot=name;parent.add(g);slots[name]=g;return g;}
  const face=slot(head,'face-details'),hair=slot(head,'hair'),cap=slot(head,'headwear'),glasses=slot(head,'eyewear'),accessories=slot(gear,'accessories'),shirt=slot(gear,'shirt-details');
  const material=color=>color?.isMaterial?color:ctx.material(color?.isColor?'#'+color.getHexString():color);
  function part(parent,geometry,color,name){const mesh=new T.Mesh(geometry,material(color));mesh.name=name;mesh.userData.ownedGeometry=true;mesh.userData.ownedMaterial=!!color?.isMaterial;mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);return mesh;}
  function ellipsoid(parent,x,y,z,w,h,d,color,name){const m=part(parent,new T.SphereGeometry(1,16,10),color,name);m.position.set(x,y,z);m.scale.set(w,h,d);return m;}
  function tube(parent,points,r,color,name){return part(parent,new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))),Math.max(12,points.length*5),r,8,false),color,name);}
  function loft(parent,sections,color,name,back=false){const positions=[],indices=[],N=32;sections.forEach(([y,w,d,shift=0],r)=>{for(let n=0;n<=N;n++){const a=n/N*(back?Math.PI:Math.PI*2);positions.push(w*Math.cos(a),y,shift+d*Math.sin(a));}});for(let r=0;r<sections.length-1;r++)for(let n=0;n<N;n++){const a=r*(N+1)+n,b=a+N+1;if(sections[1][0]>sections[0][0])indices.push(a,b,a+1,a+1,b,b+1);else indices.push(a,a+1,b,b,a+1,b+1);}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();return part(parent,g,color,name);}
  function plate(parent,points,depth,color,name,bevel=.1){const shape=new T.Shape();points.forEach(([x,y],i)=>i?shape.lineTo(x,y):shape.moveTo(x,y));shape.closePath();return part(parent,new T.ExtrudeGeometry(shape,{depth,bevelEnabled:true,bevelSegments:2,bevelSize:bevel,bevelThickness:bevel,steps:1,curveSegments:12}),color,name);}
  const gold=new T.MeshStandardMaterial({color:'#d2b77a',metalness:.68,roughness:.31}),lensMaterial=new T.MeshPhysicalMaterial({color:'#15202d',roughness:.2,metalness:.24,clearcoat:.8,clearcoatRoughness:.15});
  // Eye volumes remain behind the separate eyewear, so no painted face is needed.
  for(const side of [-1,1]){
   const x=side*3;
   ellipsoid(face,x,2.3,-5.2,1.45,.7,.28,'#f8efdd','eye-white');ellipsoid(face,x,2.25,-5.46,.5,.58,.1,'#705b46','iris');ellipsoid(face,x,2.25,-5.55,.22,.4,.05,'#172334','pupil');
   tube(face,[[x-side*1.5,4.4,-4.9],[x,4.65,-5.2],[x+side*1.4,4.2,-4.8]],.22,'#302b31','brow');ellipsoid(face,side*6.45,-.1,0,.3,.9,.55,'#bd8b70','ear-inner');
   const frame=plate(glasses,[[-2.3,.85],[-1.9,1.15],[1.9,1.15],[2.35,.7],[1.9,-1.1],[-1.65,-1.1]],.32,'#262d35','glasses',.16);frame.position.set(side*2.9,2.15,-6.1);frame.rotation.y=side*-.1;
   const lens=plate(glasses,[[-1.95,.63],[-1.65,.86],[1.55,.86],[1.98,.52],[1.6,-.82],[-1.4,-.82]],.08,lensMaterial,'sunglass-lens',.1);lens.position.set(side*2.9,2.15,-6.3);lens.rotation.y=side*-.1;
   tube(glasses,[[side*5.1,2.6,-5.9],[side*6.2,2.7,-2.5],[side*6.1,2.2,.3]],.18,'#262d35','glasses-arm');
  }
  tube(glasses,[[-.65,2.65,-6.2],[0,2.8,-6.35],[.65,2.65,-6.2]],.18,'#262d35','glasses-bridge');
  tube(face,[[-2.05,-4.0,-6.12],[-.4,-4.2,-6.35],[1.7,-3.85,-6.15]],.115,'#8f5f54','smile');ellipsoid(face,0,-4.55,-6.0,1.45,.17,.18,'#cc9a7d','lower-lip');
  for(const side of [-1,1])ellipsoid(face,side*.55,-1.35,-6.95,.21,.12,.1,'#916450','nostril');
  head.userData.face={style:'sculpted-hero',variant:'riff-pilot-v1',skin:look.skinColor,covered:false};
  // Large hair locks and a separate sideways baseball cap are independent modules.
  loft(hair,[[1.2,6.1,4.7,.1],[4.3,6.6,5.2,.1],[6.2,5.1,4.3,.1]],'#302b31','hair-back',true);
  for(let n=0;n<4;n++){const m=loft(hair,[[0,1.1,.6],[1.4,1.4,.8],[3,.1,.1]],'#302b31','hair-lock');m.position.set(-3.8+n*2,2.5,-4.7);m.rotation.z=-.38+n*.04;m.rotation.x=-.2;}
  cap.rotation.y=-1.2;cap.rotation.z=.035;
  loft(cap,[[4.7,6.6,5.5,.2],[7,6,5.2,.2],[9.2,4.1,3.6,.2],[9.9,.15,.15,.2]],'#252a32','cap');
  loft(cap,[[4.5,6.7,5.6,.2],[5.15,6.7,5.6,.2]],'#181f2a','cap-band');
  const peak=plate(cap,[[-5,-3],[-6.2,-6.6],[-4.1,-9.8],[.5,-10.8],[5.5,-7.6],[5.2,-3]],.35,'#252a32','cap-peak',.18);peak.rotation.x=Math.PI/2;peak.position.y=4.7;
  tube(cap,[[0,9.9,.2],[0,8.7,-3],[0,7,-4.7],[0,5,-5.4]],.065,'#454a52','cap-seam');
  // Deliberately restrained clothing details, all attached to the common rig.
  const collar=part(shirt,new T.TorusGeometry(3.05,.28,8,32),'#1c222c','crew-neck');collar.rotation.x=Math.PI/2;collar.position.y=3.0;
  for(const side of [-1,1]){
   const ink=slot(group,'tattoo-'+side);for(let n=0;n<2;n++)tube(ink,[[-1.8,-2-n*4,-2.7],[.6,-4.3-n*4,-3.3],[2,-2.5-n*4,-2.7]],.27,'#4c5155','tattoo');anchors.push({group:ink,from:side<0?'le':'re',to:side<0?'lh':'rh',fraction:.2,axis:-1});
  }
  tube(accessories,[[-4.6,0,-5.9],[-3,-11.3,-8.4],[0,-15.4,-8.5],[3,-11.3,-8.4],[4.6,0,-5.9]],.17,gold,'necklace');
  const pendant=plate(accessories,[[-.9,.6],[.9,.6],[.9,-2.2],[-.9,-2.2]],.32,gold,'pendant',.12);pendant.position.set(0,-16.2,-8.65);
  // Batching stays inside a module: future hats/hair/shirts can be replaced independently.
  function batch(parent){const batches=new Map();for(const m of parent.children){if(!m.isMesh)continue;const key=m.userData.ownedMaterial?m.material:null;let list=batches.get(key);if(!list)batches.set(key,list=[]);list.push(m);}for(const [custom,list]of batches){if(list.length<2)continue;const pos=[],norm=[],colors=[],names=[];for(const m of list){m.updateMatrix();const g=m.geometry.index?m.geometry.toNonIndexed():m.geometry.clone();g.applyMatrix4(m.matrix);pos.push(...g.attributes.position.array);norm.push(...g.attributes.normal.array);if(!custom)for(let n=0;n<g.attributes.position.count;n++)colors.push(m.material.color.r,m.material.color.g,m.material.color.b);names.push(m.name);g.dispose();m.geometry.dispose();m.removeFromParent();}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('normal',new T.Float32BufferAttribute(norm,3));if(!custom)g.setAttribute('color',new T.Float32BufferAttribute(colors,3));const mat=custom||new T.MeshStandardMaterial({vertexColors:true,roughness:.72,envMapIntensity:.15}),m=new T.Mesh(g,mat);m.name='module-batch';m.userData.parts=names;m.userData.ownedGeometry=m.userData.ownedMaterial=true;m.castShadow=m.receiveShadow=true;parent.add(m);}}

  Object.values(slots).forEach(batch);
  group.userData.identity={skin:member.skin,signature:'riff-nocturne',pilot:'riff-pilot-v1',modular:true};
  function update(pose,scale){head.scale.setScalar(scale*.9);head.position.add(new T.Vector3(0,-3*scale,0).applyQuaternion(head.quaternion));for(const a of anchors){const p=pose[a.from],q=pose[a.to],f=a.fraction||0;a.group.position.set((p[0]+(q[0]-p[0])*f)*scale,(p[2]+(q[2]-p[2])*f)*scale,-(p[1]+(q[1]-p[1])*f)*scale);a.group.scale.setScalar(scale);a.group.quaternion.setFromUnitVectors(new T.Vector3(0,a.axis,0),new T.Vector3(q[0]-p[0],q[2]-p[2],-(q[1]-p[1])).normalize());}}
  return {update};
 }
 root.CityThreeRiffStyle={attach};
})(typeof window==='undefined'?globalThis:window);
