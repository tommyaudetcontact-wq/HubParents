'use strict';
// Original Brawl artwork supplies the face and costume markings. Volumes are authored here.
(function(root){
 const T=root.THREE,C=root.BrawlCore;if(!T||!C)return;
 const images=new WeakMap(),clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
 const costumes={
  'riff-nocturne':{hat:'cap',glasses:true},'eclat-scene':{skirt:'short'},
  'danseur-ecarlate':{},'minuit-elegant':{},'sentinelle-olive':{helmet:'olive',armor:'#687953'},
  'aurore-vallees':{skirt:'skirt'},'gardienne-givre':{skirt:'gown',cape:'#b8dfdf',crown:true},
  'etoile-rodeo':{hat:'cowboy'},'rebelle-amethyste':{skirt:'short'},'mascotte-tropicale':{animal:'fox'},
  'navigatrice-iles':{skirt:'skirt'},'patrouilleur-stellaire':{helmet:'space',armor:'#e5e9e2'},
  'sherif-prairies':{hat:'cowboy'},'capitaine-secours':{},'cavaliere-grenadine':{hat:'red-cowboy'},
  'virtuose-pastel':{hair:4,glasses:true},'hurleur-carmin':{mask:'hockey'},
  'spectre-minuit':{hood:true,skirt:'robe'},'forge-nocturne':{hat:'band'},'tisseur-carmin':{mask:'web'},
  'dame-haut-de-forme':{hat:'top',coat:true},'ensorceleuse-prune':{hat:'witch',skirt:'gown'},
  'veilleur-ardoise':{helmet:'bat',cape:'#2b3241'},'griffe-ambre':{helmet:'claw',claws:true},
  'moffet':{skirt:'skirt',hair:13},'diva-amethyste':{hair:13,hat:'band'},'idole-jade':{hair:11,skirt:'short'},
  'rockeur-fidelite':{hair:7},'vigile-cobalt':{helmet:'cobalt',armor:'#527b9d'},
  'veteran-acier':{hat:'band',armor:'#596774'},'princesse-rosee':{crown:true,skirt:'gown'}
 };
 function describe(member,source){const base=C.skins.find(s=>s.id===member.skin)||C.skins[0],look=source.look,top=C.catalog.find(i=>i.id===look.top),bottom=C.catalog.find(i=>i.id===look.bottom),head=C.catalog.find(i=>i.id===look.head),signature=base.signature,config={...(costumes[signature]||{})};
  if(!signature){if(top?.design?.cut==='dress'||top?.style===7)config.skirt='skirt';else if(bottom?.design?.cut==='skirt'||bottom?.style===3||bottom?.design?.gender==='feminine'&&[5,7].includes(bottom.design.index))config.skirt='short';const animals={6:'cat',7:'dog',8:'fox',9:'rabbit',10:'panda',11:'robot'};if(animals[head?.style])config.animal=animals[head.style];if(base.model==='cap')config.hat='cap';}
  return {...config,signature,hair:config.hair??Number(String(look.hair).match(/\d+/)?.[0]||0),feminine:look.presentation==='feminine',faceIndex:head?.face?.index??head?.style??0};
 }
 function pixels(source){let pair=images.get(source);if(pair)return pair;pair=['front','back','side'].map(key=>{const c=source[key];return c?c.getContext('2d').getImageData(0,0,c.width,c.height):null;});images.set(source,pair);return pair;}
 function sample(source,x,y,z,fallback){if(source.signature==='spectre-minuit')return new T.Color('#262d38');const pair=pixels(source),image=z>0?pair[1]:pair[0];if(!image)return fallback;let px,py;
  if(y>96)return fallback;
  if(Math.abs(x)>14&&y<78&&source.signature!=='riff-nocturne'&&!["sentinelle-olive","vigile-cobalt","veteran-acier","patrouilleur-stellaire","tisseur-carmin"].includes(source.signature)){const item=source.topItem,d=item?.design,long=d?.sleeve==='long'||!d&&[2,3,4].includes(item?.style)||d&&[2,3,4,5,6,7,8,9,12,14,15].includes(d.index);return new T.Color(y<54||!long?source.look.skinColor:source.look.topColor);}
  else if(Math.abs(x)>14&&y<72){px=220+x*1.8;py=170+(90-y)*2;}
  else{px=220+x*1.7;py=170+(90-y)*2;}
  px=clamp(Math.round(px),0,image.width-1);py=clamp(Math.round(py),0,image.height-1);const n=(py*image.width+px)*4,d=image.data;if(d[n+3]<210)return fallback;
  return new T.Color().setRGB(d[n]/255,d[n+1]/255,d[n+2]/255,T.SRGBColorSpace);
 }
 function attach(ctx,{member,source,head,gear,group}){
  const look=source.look,config=describe(member,source),attachments=[],S=ctx.S;
  group.userData.identity={skin:member.skin,signature:config.signature||null,...config};
  const material=color=>ctx.material(color),part=(parent,geometry,color,name)=>{const mesh=new T.Mesh(geometry,material(color));mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.ownedGeometry=true;parent.add(mesh);return mesh;};
  function ellipsoid(parent,x,y,z,w,h,d,color,name){const m=part(parent,new T.SphereGeometry(1,24,16),color,name);m.position.set(x,y,z);m.scale.set(w,h,d);return m;}
  function loft(parent,sections,color,name,backOnly=false){const vertices=[],uv=[],indices=[],sides=32,start=backOnly==='hood'?-Math.PI/4:0,span=backOnly==='hood'?Math.PI*1.5:backOnly?Math.PI:Math.PI*2;
   sections.forEach(([y,w,d,shift=0],r)=>{for(let n=0;n<=sides;n++){const a=start+n/sides*span;vertices.push(w*Math.cos(a),y,shift+d*Math.sin(a));uv.push(n/sides,r/(sections.length-1));}});
   for(let r=0;r<sections.length-1;r++)for(let n=0;n<sides;n++){const a=r*(sides+1)+n,b=a+sides+1;if(sections[1][0]>sections[0][0])indices.push(a,b,a+1,a+1,b,b+1);else indices.push(a,a+1,b,b,a+1,b+1);}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(vertices,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();const m=part(parent,g,color,name);m.material=material(color);return m;
  }
  function tube(parent,points,r,color,name){const curve=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p)));return part(parent,new T.TubeGeometry(curve,Math.max(8,points.length*4),r,8,false),color,name);}
  function facePatch(){if(!source.front)return;const image=root.document.createElement('canvas');image.width=256;image.height=320;const c=image.getContext('2d');const ghost=config.hood,top=ghost?82:92,height=ghost?100:76;c.drawImage(source.front,194,top,52,height,0,0,256,320);const texture=new T.CanvasTexture(image);texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=4;
   const positions=[],uv=[],indices=[],rows=24,cols=32;for(let r=0;r<=rows;r++){const phi=.19+r/rows*2.65;for(let n=0;n<=cols;n++){const a=-1.28+n/cols*2.56,x=6.9*Math.sin(phi)*Math.sin(a),y=(ghost?-.8:.6)+(ghost?12.2:8.6)*Math.cos(phi),nose=1.65*Math.exp(-(x*x/2.2+(y-.2)**2/6));positions.push(x,y,-6.4*Math.sin(phi)*Math.cos(a)-nose-.12);uv.push((x*3.2+26)/52,1-((128-top)-y*4)/height);}}
   for(let r=0;r<rows;r++)for(let n=0;n<cols;n++){const a=r*(cols+1)+n,b=a+cols+1;indices.push(a,a+1,b,a+1,b+1,b);}const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeVertexNormals();const m=new T.Mesh(geometry,new T.MeshStandardMaterial({map:texture,transparent:true,alphaTest:.15,roughness:.92,side:T.FrontSide,polygonOffset:true,polygonOffsetFactor:-1}));m.name='original-face';m.userData.ownedGeometry=m.userData.ownedMaterial=true;head.add(m);
  }
  facePatch();
  const masked=config.hood||config.helmet||config.mask||config.animal;
  if(!masked&&config.hair!==19){
   const hair=look.hairColor,h=config.hair,long=[3,4,5,6,7,8,9,12,13,18].includes(h),cap=loft(head,[[1.5,6.9,6.3,.3],[5,7.2,6.3,.2],[8,5.3,4.9,.2],[9.8,.3,.3,0]],hair,'hair-scalp');
   if(long){const length=[4,5].includes(h)?14:[8,9].includes(h)?12:25;loft(head,[[7,6.8,5,1.2],[0,7.8,5.4,1.6],[-length,8.2,3.8,3.4]],hair,'hair-back',true);for(const side of [-1,1])tube(head,[[side*5.4,5,0],[side*7,0,-1],[side*7.8,-length*.6,-.7],[side*7.1,-length,-.1]],h===7?1.8:1.3,hair,'hair-side');}
   if([8,9,12,13,18].includes(h)){const count=[12,13,18].includes(h)?(h===18?6:2):1;for(let n=0;n<count;n++){const x=count===1?0:(n-(count-1)/2)*3.8;for(let k=0;k<6;k++)ellipsoid(head,x+Math.sin(k*2.7)*.45,3-k*3.4,6.4+Math.sin(k*.4),h===18?1.25:1.8,2.3,1.9,hair,'hair-braid');}}
   if([2,3,14].includes(h)){cap.visible=false;for(let n=0;n<22;n++){const a=n*2.399,rad=Math.sqrt(n/22)*7.2;ellipsoid(head,Math.sin(a)*rad,5.5+Math.sqrt(Math.max(0,50-rad*rad))*.7,Math.cos(a)*rad*.8,2.2,2.4,2.2,hair,'hair-curl');}}
   if([10,11].includes(h))for(const side of h===11?[-1,1]:[0])ellipsoid(head,side*6,7,3,3.3,3.3,3.4,hair,'hair-bun');
   if(h===15)loft(head,[[6,1.8,6],[12,1,3.8],[14,.15,.2]],hair,'hair-mohawk');
   if([0,1,16,17].includes(h))for(let n=0;n<5;n++)tube(head,[[-5+n*2,7,-2],[-4+n*1.7,6,-5],[-5+n*1.7,h===16?1:4,-6.1]],.85,hair,'hair-fringe');
  }
  if(config.hood){loft(head,[[-10,8.3,7.2,1],[0,9.2,8.1,1],[9,7.1,7,1],[13,.2,.2,1]],'#242b36','hood','hood');for(const side of [-1,1])tube(head,[[side*3.8,11,-3.8],[side*6.6,5,-5.4],[side*6.8,-5,-4.8],[side*4.8,-11,-3.7]],1.25,'#303945','hood-rim');}
  if(config.helmet){const color={olive:'#687953',space:'#79628a',bat:'#2c3343',claw:'#344361',cobalt:'#527b9d'}[config.helmet];loft(head,[[-7,7.1,6.2],[0,7.8,6.9],[7,6.5,6.2],[10,.3,.3]],color,'helmet-shell',true);loft(head,[[5,7.4,6.7],[8.4,5.7,5],[10,.2,.2]],color,'helmet-crown');
   if(['bat','claw'].includes(config.helmet))for(const side of [-1,1]){const g=new T.ConeGeometry(2.5,config.helmet==='bat'?12:10,4);const m=part(head,g,color,'mask-ear');m.position.set(side*6.7,11,0);m.rotation.z=-side*.2;}
   if(config.helmet==='olive'){const visor=ellipsoid(head,0,2.5,-6.1,6.1,2.1,1.6,'#c8ae62','gold-visor');visor.material=new T.MeshStandardMaterial({color:'#c8ae62',metalness:.62,roughness:.23});visor.userData.ownedMaterial=true;}
   if(config.helmet==='space'){const glass=ellipsoid(head,0,1,-.3,8.3,10.3,7.9,'#9e8eae','space-dome');glass.material=new T.MeshStandardMaterial({color:'#bcb2d2',transparent:true,opacity:.2,depthWrite:false,roughness:.12});glass.userData.ownedMaterial=true;}
  }
  if(config.hat){const type=config.hat,color=type==='red-cowboy'?'#c84f40':type==='cowboy'?(config.signature==='sherif-prairies'?'#9b6d42':'#75513a'):look.hairColor;
   if(type==='band'){const m=loft(head,[[4.2,7.2,6.6],[6.3,7.2,6.6]],config.signature==='diva-amethyste'?'#65458d':'#393a3c','headband');}
   else{const brim=part(head,new T.CylinderGeometry(type==='cap'?7.8:11.5,type==='cap'?7.8:11.5,.7,48),color,'hat-brim');brim.position.set(0,6,0);brim.scale.z=type==='cap'?.92:.72;
    if(type==='cap'){loft(head,[[6,7.3,6.4],[9,5.6,5],[11,.2,.2]],'#303b47','cap');ellipsoid(head,1,5.8,-7.7,6,.5,4,'#303b47','cap-peak');}
    else if(type==='witch'){const m=part(head,new T.ConeGeometry(7.1,24,32),'#503858','witch-hat');m.position.set(-2,18,0);m.rotation.z=.17;loft(head,[[7,7.2,6.9],[8.4,6.9,6.6]],'#bd9758','hat-band');}
    else{loft(head,[[6,6.9,5.8],[type==='top'?20:15,6.2,5.1],[type==='top'?20.7:16,5.8,4.6]],color,'hat-crown');loft(head,[[6.5,7,5.9],[9,6.8,5.7]],type==='top'?'#d7cbbb':'#433b33','hat-band');}}
  }
  if(config.crown){const color='#d5b657';loft(head,[[5.7,7.3,6.5],[7.8,7.3,6.5]],color,'crown-band');for(let n=0;n<7;n++){const a=n/7*Math.PI*2,m=part(head,new T.ConeGeometry(1.8,n%2?4:6,4),color,'crown-point');m.position.set(Math.sin(a)*6.9,9.2,Math.cos(a)*6.2);}ellipsoid(head,0,7.7,-6.6,1.1,1.5,.4,'#c86889','crown-jewel');}
  if(config.glasses){for(const side of [-1,1]){const m=ellipsoid(head,side*2.7,2.3,-6,2.4,1.8,.55,config.signature==='virtuose-pastel'?'#9f4351':'#343945','glasses');tube(head,[[side*5.2,2.5,-5.8],[side*6.8,2.7,-2],[side*6.5,2.5,1]],.35,'#c7c4ae','glasses-arm');}tube(head,[[-.7,2.5,-6.5],[.7,2.5,-6.5]],.25,'#c7c4ae','glasses-bridge');}
  if(config.animal){const fur=config.animal==='fox'?'#de873e':look.hairColor;for(const side of [-1,1]){const rabbit=config.animal==='rabbit',g=new T.ConeGeometry(rabbit?2:3,rabbit?14:8,config.animal==='panda'?16:4),m=part(head,g,fur,'animal-ear');m.position.set(side*5.7,rabbit?12:8,0);m.rotation.z=side*-.2;}ellipsoid(head,0,-2.2,-5.7,4,3,3.2,config.animal==='fox'?'#f0ca8c':look.skinColor,'animal-muzzle');ellipsoid(head,0,-1.2,-8.7,1.1,.9,.65,'#34363b','animal-nose');}
  const garment=new T.Group();group.add(garment);
  if(config.skirt){const gown=config.skirt==='gown'||config.skirt==='robe',color=config.skirt==='robe'?'#262d38':config.skirt==='gown'?look.topColor:look.bottomColor,bottom=gown?-51:config.skirt==='short'?-23:-36;
   const m=loft(garment,[[3,12.2,7.6],[0,13,8],[-12,15,9],[bottom,config.skirt==='robe'?18:gown?24:18.5,12]],color,'garment-skirt');
   const pos=m.geometry.attributes.position,colors=[];for(let n=0;n<pos.count;n++){const x=pos.getX(n),y=pos.getY(n)+56,z=pos.getZ(n),c=sample(source,x*.65,y,z,new T.Color(color));const shade=.93+.07*Math.cos(Math.atan2(z,x)*12);colors.push(c.r*shade,c.g*shade,c.b*shade);}m.geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));m.material=new T.MeshStandardMaterial({vertexColors:true,roughness:.9,side:T.DoubleSide});m.userData.ownedMaterial=true;
  }
  if(config.cape||config.coat){const color=config.cape||look.topColor;loft(gear,[[0,14.5,5,4],[-22,18,5.5,6],[-78,config.coat?20:27,7,8]],color,'cape',true);}
  if(config.armor){const col=config.armor;loft(gear,[[1,13,8.2],[-5,16.3,8.8],[-22,12,8.4],[-33,11.7,8.2]],col,'body-armor');
   for(const side of [-1,1]){ellipsoid(gear,side*16,-1,0,6.8,4,8.2,col,'shoulder-armor');const g=new T.Group();group.add(g);loft(g,[[0,5.2,5.8],[-13,5.8,6.4],[-18,5,6]],col,'shin-armor');attachments.push({group:g,from:side<0?'lk':'rk',to:side<0?'lf':'rf'});}
  }
  if(config.claws){const g=new T.Group();group.add(g);for(const x of [-1.7,0,1.7])tube(g,[[x,0,0],[x,-6,-1],[x,-16,-2]],.38,'#c1ccd0','claw');attachments.push({group:g,from:'rh',to:'re'});}
  // Coiffures and costume pieces share one draw call per material, rather than one per curl.
  function merge(parent){const batches=new Map();for(const m of parent.children.slice()){if(!m.isMesh||!m.visible||m.userData.ownedMaterial||m.material.transparent)continue;let list=batches.get(m.material);if(!list)batches.set(m.material,list=[]);list.push(m);}for(const [material,list]of batches){if(list.length<2)continue;const positions=[],normals=[],parts=[];for(const m of list){m.updateMatrix();const geometry=m.geometry.index?m.geometry.toNonIndexed():m.geometry.clone();geometry.applyMatrix4(m.matrix);positions.push(...geometry.attributes.position.array);normals.push(...geometry.attributes.normal.array);parts.push(m.name);geometry.dispose();if(m.userData.ownedGeometry)m.geometry.dispose();m.removeFromParent();}const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new T.Float32BufferAttribute(normals,3));const mesh=new T.Mesh(geometry,material);mesh.name='costume-batch';mesh.userData.parts=parts;mesh.userData.ownedGeometry=true;mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);}}
  merge(head);merge(gear);for(const a of attachments)merge(a.group);
  function update(pose,scale){head.scale.setScalar(scale*1.12);garment.scale.setScalar(scale);garment.position.set(pose.hip[0]*scale,pose.hip[2]*scale,-pose.hip[1]*scale);const torso=new T.Vector3(...[pose.chest[0]-pose.hip[0],pose.chest[2]-pose.hip[2],-(pose.chest[1]-pose.hip[1])]).normalize();garment.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),torso);for(const a of attachments){const p=pose[a.from],q=pose[a.to];a.group.position.set(p[0]*scale,p[2]*scale,-p[1]*scale);a.group.scale.setScalar(scale);a.group.quaternion.setFromUnitVectors(new T.Vector3(0,-1,0),new T.Vector3(q[0]-p[0],q[2]-p[2],-(q[1]-p[1])).normalize());}}
  return {config,update};
 }
 root.CityThreeIdentity={describe,sample,attach,signatures:Object.keys(costumes)};
})(typeof window==='undefined'?globalThis:window);
