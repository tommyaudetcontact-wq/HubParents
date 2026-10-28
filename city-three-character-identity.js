'use strict';
// Original Brawl identities, redesigned as sculpted, colorful heroic 3D characters.
(function(root){
 const T=root.THREE,C=root.BrawlCore;if(!T||!C)return;
 const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
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
 // Broad authored color blocks replace the old projected illustration and its baked shadows.
 function sample(source,x,y,z,fallback){const sig=source.signature,col=hex=>new T.Color(hex);
  if(y>96){if(sig==='spectre-minuit')return col('#252e42');if(sig==='sentinelle-olive')return col('#637556');if(sig==='tisseur-carmin')return col('#bf3f50');if(sig==='vigile-cobalt')return col('#657a88');if(sig==='veilleur-ardoise'&&y>102)return col('#303c55');if(sig==='griffe-ambre'&&y>104)return col('#34486b');return fallback;}
  if(sig==='spectre-minuit')return col('#252e42');
  return fallback;

 }
 function attach(ctx,{member,source,head,gear,group}){
  if(source.pilot&&root.CityThreeRiffStyle)return root.CityThreeRiffStyle.attach(ctx,{member,source,head,gear,group});
  const look=source.look,config=describe(member,source),attachments=[],S=ctx.S;
  group.userData.identity={skin:member.skin,signature:config.signature||null,...config};
  const material=color=>ctx.material(color?.isColor?'#'+color.getHexString():color),part=(parent,geometry,color,name)=>{const mesh=new T.Mesh(geometry,material(color));mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.ownedGeometry=true;parent.add(mesh);return mesh;};
  function ellipsoid(parent,x,y,z,w,h,d,color,name){const m=part(parent,new T.SphereGeometry(1,16,10),color,name);m.position.set(x,y,z);m.scale.set(w,h,d);return m;}
  function loft(parent,sections,color,name,backOnly=false){const vertices=[],uv=[],indices=[],sides=32,start=backOnly==='hood'?-Math.PI/4:0,span=backOnly==='hood'?Math.PI*1.5:backOnly?Math.PI:Math.PI*2;
   sections.forEach(([y,w,d,shift=0],r)=>{for(let n=0;n<=sides;n++){const a=start+n/sides*span;const hairline=name==='hair-scalp'?Math.max(0,-Math.sin(a))*(r===0?5.5:r===1?2.7:r===2?.6:0):0;vertices.push(w*Math.cos(a),y+hairline,shift+d*Math.sin(a));uv.push(n/sides,r/(sections.length-1));}});
   for(let r=0;r<sections.length-1;r++)for(let n=0;n<sides;n++){const a=r*(sides+1)+n,b=a+sides+1;if(sections[1][0]>sections[0][0])indices.push(a,b,a+1,a+1,b,b+1);else indices.push(a,a+1,b,b,a+1,b+1);}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(vertices,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();const m=part(parent,g,color,name);m.material=material(color);return m;
  }
  function tube(parent,points,r,color,name){const curve=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p)));return part(parent,new T.TubeGeometry(curve,Math.max(8,points.length*4),r,8,false),color,name);}
  function almond(parent,x,y,z,w,h,color,name,tilt=0){const shape=new T.Shape();shape.moveTo(-w,0);shape.quadraticCurveTo(-w*.3,h,w,0);shape.quadraticCurveTo(w*.15,-h*.72,-w,0);const g=new T.ExtrudeGeometry(shape,{depth:.18,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.09,bevelThickness:.08,curveSegments:12});const m=part(parent,g,color,name);m.position.set(x,y,z);m.rotation.z=tilt;m.rotation.y=Math.PI;return m;}
  function plate(parent,points,depth,color,name){const shape=new T.Shape();points.forEach(([x,y],i)=>i?shape.lineTo(x,y):shape.moveTo(x,y));shape.closePath();return part(parent,new T.ExtrudeGeometry(shape,{depth,bevelEnabled:true,bevelSize:.65,bevelThickness:.55,bevelSegments:2,steps:1}),color,name);}
  function lock(parent,points,width,depth,color,name){const curve=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))),pos=[],indices=[],rows=10,sides=12;for(let r=0;r<=rows;r++){const t=r/rows,p=curve.getPoint(t),tangent=curve.getTangent(t),axis=new T.Vector3(0,0,1).cross(tangent).normalize();if(axis.lengthSq()<.1)axis.set(1,0,0);const binormal=tangent.clone().cross(axis).normalize(),radius=Math.max(.025,Math.sin((t*.92+.08)*Math.PI)*Math.pow(1-t,.23));for(let n=0;n<=sides;n++){const a=n/sides*Math.PI*2,v=p.clone().addScaledVector(axis,Math.cos(a)*width*radius).addScaledVector(binormal,Math.sin(a)*depth*radius);pos.push(v.x,v.y,v.z);}}for(let r=0;r<rows;r++)for(let n=0;n<sides;n++){const a=r*(sides+1)+n,b=a+sides+1;indices.push(a,b,a+1,a+1,b,b+1);}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setIndex(indices);g.computeVertexNormals();return part(parent,g,color,name);}
  let graphicLayer=0;
  function graphic(points,color,name){
   const offset=1.25+graphicLayer++*.075,contour=points.map(p=>new T.Vector2(...p)),triangles=T.ShapeUtils.triangulateShape(contour,[]),vertices=[];
   function vertex(p){const y=p.y,world=90+y,levels=[54,60,68,76,85,90,93],widths=[12,11.4,11.8,15.1,17.6,14.5,4.5],depths=[7.4,6.8,7.2,8.1,8.9,7.1,3.7];let i=0;while(i<levels.length-2&&world>levels[i+1])i++;const t=clamp((world-levels[i])/(levels[i+1]-levels[i]),0,1),w=widths[i]+(widths[i+1]-widths[i])*t,d=depths[i]+(depths[i+1]-depths[i])*t,z=-d*Math.pow(Math.max(.01,1-Math.pow(Math.abs(p.x)/w,2.6)),1/2.6)-offset;vertices.push(p.x,y,z);}
   const N=10;for(const ids of triangles){const a=contour[ids[0]],b=contour[ids[1]],c=contour[ids[2]],point=(i,j)=>a.clone().multiplyScalar(1-(i+j)/N).addScaledVector(b,i/N).addScaledVector(c,j/N);for(let i=0;i<N;i++)for(let j=0;j<N-i;j++){vertex(point(i,j));vertex(point(i+1,j));vertex(point(i,j+1));if(i+j<N-1){vertex(point(i+1,j));vertex(point(i+1,j+1));vertex(point(i,j+1));}}}
   const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(vertices,3));g.computeVertexNormals();const m=part(gear,g,color,name);const normal=g.attributes.normal;if(normal.getZ(0)>0){for(let i=0;i<g.attributes.position.count;i+=3){for(let k=0;k<3;k++){const a=g.attributes.position.array[i*3+3+k];g.attributes.position.array[i*3+3+k]=g.attributes.position.array[i*3+6+k];g.attributes.position.array[i*3+6+k]=a;}}g.computeVertexNormals();}return m;
  }
  function face(){
   const robotic=['olive','cobalt','bat','claw'].includes(config.helmet),covered=config.hood||config.mask||robotic,fur=config.animal;
   head.userData.face={style:'sculpted-hero',skin:look.skinColor,eyeColor:look.features?.eyeColor||'#4c8293',covered:!!covered};
   if(config.hood){const positions=[],indices=[],rows=24,cols=24;for(let r=0;r<=rows;r++){const phi=.12+r/rows*2.95;for(let n=0;n<=cols;n++){const a=-1.27+n/cols*2.54,x=5.7*Math.sin(phi)*Math.sin(a),y=-1+10.1*Math.cos(phi);positions.push(x,y,-5.1*Math.sin(phi)*Math.cos(a)-2);}}for(let r=0;r<rows;r++)for(let n=0;n<cols;n++){const a=r*(cols+1)+n,b=a+cols+1;indices.push(a,a+1,b,a+1,b+1,b);}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();part(head,g,'#eeeade','ghost-mask');for(const side of [-1,1])ellipsoid(head,side*2.25,1.8,-6.75,1.35,2.15,.35,'#202b40','mask-eye').rotation.z=side*.17;ellipsoid(head,0,-5.1,-6.2,1.5,3.1,.38,'#202b40','mask-mouth');return;}
   if(config.mask==='hockey'){for(const side of [-1,1]){ellipsoid(head,side*2.9,3,-5.8,1.8,1.05,.48,'#263347','mask-eye');for(let n=0;n<4;n++)ellipsoid(head,side*(2.1+n*.75),-3.7-(n%2)*1.1,-5.65,.3,.36,.2,'#5b6469','mask-vent');}tube(head,[[-2,-5.5,-5.4],[0,-5.9,-5.8],[2,-5.5,-5.4]],.3,'#4b555f','mask-mouth');return;}
   if(config.mask==='web'||robotic&&config.helmet!=='olive'){for(const side of [-1,1])almond(head,side*3,2.8,robotic?-9.8:-5.85,2.25,1.1,'#edf5f3','mask-eye',side*.18);if(config.mask==='web'){for(const y of [-4,0,4,7])tube(head,[[-5.9,y+.8,-3.7],[-3,y-.5,-5.3],[0,y-1,-6.1],[3,y-.5,-5.3],[5.9,y+.8,-3.7]],.1,'#6c3046','mask-web');for(const side of [-1,0,1])tube(head,[[side*2,8,-2.8],[side*2.8,4,-5.4],[side*3,-1,-6.1],[side*2.6,-6,-4]],.1,'#6c3046','mask-web');}return;}
   if(config.helmet==='olive')return;
   const eyeColor=look.features?.eyeColor||'#527e8e',skin=look.skinColor;
   for(const side of [-1,1]){const x=side*3.0,eyeY=2.2+(look.features?.eyes===1?.2:0),eyeW=[1.65,1.85,1.6,1.7,1.65,1.75][look.features?.eyes||0],eyeH=[.87,1,.64,.9,.6,.8][look.features?.eyes||0],depth=-5.85;
    ellipsoid(head,x,eyeY,depth,eyeW,eyeH,.52,'#fff7e8','eye-white');ellipsoid(head,x,eyeY-.03,depth-.48,.66,eyeH*.86,.16,eyeColor,'iris');ellipsoid(head,x,eyeY-.02,depth-.62,.3,eyeH*.61,.08,'#192d40','pupil');ellipsoid(head,x-.17,eyeY+.22,depth-.7,.18,.17,.05,'#ffffff','eye-glint');
    tube(head,[[x-side*1.6,eyeY+.05,depth+.1],[x-side*.6,eyeY+.82,depth-.25],[x+side*.9,eyeY+.67,depth-.15],[x+side*1.65,eyeY+.1,depth+.1]],.16,config.feminine?'#654a59':'#946b58','upper-lid');
    const brow=loft(head,[[5.0,1.6,.28],[4.6,1.7,.32]],look.hairColor,'brow');brow.position.set(x,[0,.4,-.4,.2,-.2,.65][look.features?.brows||0],-5.5);brow.rotation.z=side*(config.feminine?.12:-.09);
    ellipsoid(head,side*7.05,-.2,-.05,.45,1.25,.7,new T.Color(skin).multiplyScalar(.83),'ear-inner');
   }
   if(config.signature==='minuit-elegant'){tube(head,[[-5.4,-3.8,-4.9],[-4.8,-6,-5.5],[0,-8.5,-5.8],[4.8,-6,-5.5],[5.4,-3.8,-4.9]],.65,look.hairColor,'beard');tube(head,[[-2,-3.8,-6.75],[0,-3.4,-7],[2,-3.8,-6.75]],.28,look.hairColor,'moustache');}
   tube(head,[[-2.3,-4.5,-6.75],[0,-4.85,-6.95],[2.3,-4.3,-6.7]],.18,config.feminine?'#ad6577':'#9b6c62','mouth');ellipsoid(head,0,-5.15,-6.65,1.75,.28,.3,new T.Color(skin).multiplyScalar(.92),'lower-lip');
   for(const side of [-1,1])ellipsoid(head,side*.75,-1.5,-8.45*[1,.75,1.22,.9,1.08,.7][look.features?.nose||0]*(config.feminine?.86:1),.32,.18,.16,'#a97964','nostril');
  }
  face();
  const masked=config.hood||config.helmet||config.mask||config.animal;
  if(!masked&&config.hair!==19){
   const hair=look.hairColor,h=config.hair,long=[3,4,5,6,7,8,9,12,13,18].includes(h),cap=loft(head,[[1.5,6.9,6.3,.3],[5,7.2,6.3,.2],[8,5.3,4.9,.2],[9.8,.3,.3,0]],hair,'hair-scalp');
   if(long){const length=[4,5].includes(h)?14:[8,9].includes(h)?12:25;loft(head,[[7,6.8,5,1.2],[0,7.8,5.4,1.6],[-length,8.2,3.8,3.4]],hair,'hair-back',true);for(const side of [-1,1])tube(head,[[side*5.4,5,0],[side*7,0,-1],[side*7.8,-length*.6,-.7],[side*7.1,-length,-.1]],h===7?1.8:1.3,hair,'hair-side');}
   if([8,9,12,13,18].includes(h)){const count=[12,13,18].includes(h)?(h===18?6:2):1;for(let n=0;n<count;n++){const x=count===1?0:(n-(count-1)/2)*3.8;for(let k=0;k<6;k++)ellipsoid(head,x+Math.sin(k*2.7)*.45,3-k*3.4,6.4+Math.sin(k*.4),h===18?1.25:1.8,2.3,1.9,hair,'hair-braid');}}
   if([2,3,14].includes(h)){cap.visible=false;for(let n=0;n<22;n++){const a=n*2.399,rad=Math.sqrt(n/22)*7.2;ellipsoid(head,Math.sin(a)*rad,5.5+Math.sqrt(Math.max(0,50-rad*rad))*.7,Math.cos(a)*rad*.8,2.2,2.4,2.2,hair,'hair-curl');}}
   if([10,11].includes(h))for(const side of h===11?[-1,1]:[0])ellipsoid(head,side*6,7,3,3.3,3.3,3.4,hair,'hair-bun');
   if(h===15)loft(head,[[6,1.8,6],[12,1,3.8],[14,.15,.2]],hair,'hair-mohawk');
   if([0,1,16,17].includes(h))for(let n=0;n<4;n++)lock(head,[[-5+n*2.4,6,1],[-4+n*2.2,10+n*.25,-1.5],[-3+n*2,8.5,-5],[-4.5+n*2,h===16?1.5:4,-6.1]],1.7,1.1,hair,'hair-quiff');
  }
  if(config.hood){loft(head,[[-10,8.3,7.2,1],[0,9.2,8.1,1],[9,7.1,7,1],[13,.2,.2,1]],'#242b36','hood','hood');for(const side of [-1,1])tube(head,[[side*3.8,11,-3.8],[side*6.6,5,-5.4],[side*6.8,-5,-4.8],[side*4.8,-11,-3.7]],1.25,'#303945','hood-rim');}
  if(config.helmet){const color={olive:'#687953',space:'#79628a',bat:'#2c3343',claw:'#344361',cobalt:'#527b9d'}[config.helmet];loft(head,[[-7,7.1,6.2],[0,7.8,6.9],[7,6.5,6.2],[10,.3,.3]],color,'helmet-shell',true);loft(head,[[5,7.4,6.7],[8.4,5.7,5],[10,.2,.2]],color,'helmet-crown');
   if(['bat','claw'].includes(config.helmet))for(const side of [-1,1]){const g=new T.ConeGeometry(2.5,config.helmet==='bat'?12:10,4);const m=part(head,g,color,'mask-ear');m.position.set(side*6.7,11,0);m.rotation.z=-side*.2;}
   if(['olive','cobalt','bat','claw'].includes(config.helmet)){const full=['olive','cobalt'].includes(config.helmet),mask=plate(head,full?[[-6,6],[-7,1],[-5,-7],[0,-8],[5,-7],[7,1],[6,6]]:[[-6,6],[-7,0],[-4,-2],[0,-1],[4,-2],[7,0],[6,6]],1.3,color,'helmet-faceplate');mask.position.z=-9.1;if(full){const vent=plate(head,[[-3.7,-3],[-3,-4.2],[3,-4.2],[3.7,-3]],.3,'#2c3e48','helmet-vent');vent.position.z=-9.8;}}
   if(config.helmet==='olive'){const visor=ellipsoid(head,0,2.5,-9.9,5.9,1.9,.45,'#c8ae62','gold-visor');visor.material=new T.MeshStandardMaterial({color:'#c8ae62',metalness:.62,roughness:.23});visor.userData.ownedMaterial=true;}
   if(config.helmet==='space'){const glass=ellipsoid(head,0,1,-.3,8.6,10.7,9.2,'#9e8eae','space-dome');glass.material=new T.MeshStandardMaterial({color:'#bcb2d2',transparent:true,opacity:.2,depthWrite:false,roughness:.12});glass.userData.ownedMaterial=true;}
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
   for(const side of [-1,1]){const shoulder=plate(gear,[[-5,1],[-7,-2],[-5,-7],[4,-8],[7,-3],[4,1]],9,col,'shoulder-armor');shoulder.position.set(side*16,1,-4.5);shoulder.rotation.z=-side*.14;const g=new T.Group();group.add(g);loft(g,[[0,5.2,5.8],[-13,5.8,6.4],[-18,5,6]],col,'shin-armor');attachments.push({group:g,from:side<0?'lk':'rk',to:side<0?'lf':'rf'});}
  }
  const rectGraphic=(x,y,w,h,color,name)=>graphic([[x,y],[x+w,y],[x+w,y-h],[x,y-h]],color,name);
  const lapels=[[-11,-2],[-7,-1],[0,-20],[7,-1],[11,-2],[6,-20],[0,-28],[-6,-20]];
  switch(config.signature){
   case 'minuit-elegant':case 'dame-haut-de-forme':graphic([[-5,-1],[0,-5],[5,-1],[3,-15],[-3,-15]],'#f1e9dc','shirt-front');graphic(lapels,'#475269','lapels');graphic([[-1,-6],[1,-6],[2,-17],[0,-20],[-2,-17]],'#1d293c','tie');break;
   case 'danseur-ecarlate':graphic(lapels,'#26364b','lapels');break;
   case 'eclat-scene':case 'gardienne-givre':graphic([[-7,-1],[0,-8],[7,-1],[5,-10],[0,-13],[-5,-10]],'#eaf4ee','dress-collar');break;
   case 'aurore-vallees':graphic([[-6,-1],[-14,-5],[-13,-24],[-7,-21],[-8,-7],[0,-11],[8,-7],[7,-21],[13,-24],[14,-5],[6,-1]],'#ad6285','cropped-jacket');break;
   case 'etoile-rodeo':graphic(lapels,'#b89c6f','western-lapels');break;
   case 'rebelle-amethyste':graphic([[-7,-1],[0,-6],[7,-1],[4,-13],[2,-25],[0,-28],[-2,-25],[-4,-13]],'#c4689e','blouse');break;
   case 'navigatrice-iles':rectGraphic(-11,-6,22,2,'#eed7ad','top-band');break;
   case 'sherif-prairies':for(const side of [-1,1])graphic([[side*4,-1],[side*11,-4],[side*10,-29],[side*3,-29]],'#eee8d7','western-vest');break;
   case 'cavaliere-grenadine':graphic([[-11,-2],[0,-9],[11,-2],[10,-10],[0,-15],[-10,-10]],'#d85847','western-yoke');break;
   case 'virtuose-pastel':rectGraphic(-11,-4,22,11,'#7bc4c4','pastel-yoke');rectGraphic(-11,-15,22,6,'#ecdcaf','pastel-band');for(const x of [-10,3])rectGraphic(x,-26,7,4,'#9674aa','jacket-pocket');break;
   case 'hurleur-carmin':rectGraphic(-.5,-2,1,35,'#30394c','zipper');rectGraphic(-10,-6,6,8,'#e7d1af','work-pocket');break;
   case 'forge-nocturne':for(const side of [-1,1])graphic([[side*5,-1],[side*8,-1],[side*11,-33],[side*8,-33]],'#c34858','red-strap');break;
   case 'tisseur-carmin':ellipsoid(gear,0,-15,-9.4,2.1,3.5,.5,'#273449','spider');for(const side of [-1,1])for(let n=0;n<3;n++)tube(gear,[[side,-14+n,-9.3],[side*5,-11+n*2,-8.9],[side*7,-15+n*3,-8.4]],.3,'#273449','spider-leg');break;
   case 'veilleur-ardoise':graphic([[-10,-9],[-5,-12],[-2,-9],[0,-13],[2,-9],[5,-12],[10,-9],[7,-17],[3,-16],[0,-19],[-3,-16],[-7,-17]],'#303e57','wing-emblem');break;
   case 'griffe-ambre':for(const side of [-1,1])graphic([[side*7,-1],[side*14,-5],[side*8,-13],[side*4,-7]],'#3d5b8e','blue-yoke');break;
   case 'diva-amethyste':rectGraphic(-7,-10,14,20,'#f1e8d5','white-blouse');break;
   case 'idole-jade':graphic([[-12,-1],[-10,-1],[11,-20],[10,-22]],'#2d455c','diagonal-strap');break;
  }
  if(config.armor){const accent=config.helmet==='space'?'#98ba5c':config.helmet==='olive'?'#8a9c6f':config.helmet==='cobalt'?'#82b4ce':'#8798a8',chest=plate(gear,[[-11,-5],[-13,-9],[-9,-18],[9,-18],[13,-9],[11,-5]],1,accent,'chest-plate');chest.position.z=-9;for(const side of [-1,1]){const pocket=plate(gear,[[-3,0],[-3,-6],[3,-6],[3,0]],1.5,'#344557','armor-pocket');pocket.position.set(side*5,-23,-9.5);}}
  if(!config.skirt&&!config.cape){loft(gear,[[-34,12.6,8.3],[-37,12.5,8.3]],'#344456','belt');const buckle=plate(gear,[[-2,1],[-2,-1.5],[2,-1.5],[2,1]],.6,'#bdc7c5','belt-buckle');buckle.position.set(0,-35,-8.6);}
  if(['riff-nocturne','rockeur-fidelite','navigatrice-iles','eclat-scene'].includes(config.signature)){tube(gear,[[-5,-1,-6.9],[-3,-12,-9],[0,-16,-9.4],[3,-12,-9],[5,-1,-6.9]],.28,'#e0c787','necklace');ellipsoid(gear,0,-17,-9.5,1.4,2,.45,config.signature==='navigatrice-iles'?'#73c5c2':'#e0c787','pendant');}
  for(const side of [-1,1]){const foot=new T.Group();group.add(foot);loft(foot,[[-2.7,4.9,8.9,-3.5],[-1.2,5,9,-3.5]],new T.Color(look.shoeColor).lerp(new T.Color('#d4dfdd'),.28),'boot-sole');attachments.push({group:foot,from:side<0?'lf':'rf',to:side<0?'lk':'rk',axis:1});}
  if(!config.armor){const item=source.topItem,d=item?.design,long=d?.sleeve==='long'||!d&&[2,3,4].includes(item?.style)||d&&[2,3,4,5,6,7,8,9,12,14,15].includes(d.index);for(const side of ['l','r']){const cuff=new T.Group();group.add(cuff);loft(cuff,[[-.7,(long?3.7:4.8)*(config.feminine?.77:1),(long?3.7:4.8)*(config.feminine?.77:1)],[.7,(long?3.7:4.8)*(config.feminine?.77:1),(long?3.7:4.8)*(config.feminine?.77:1)]],new T.Color(look.topColor).multiplyScalar(.82),'sleeve-cuff');attachments.push({group:cuff,from:side+(long?'e':'s'),to:side+(long?'h':'e'),fraction:long?.75:.53});}}
  if(config.signature==='riff-nocturne'){for(const side of ['l','r']){const ink=new T.Group();group.add(ink);for(let n=0;n<3;n++)tube(ink,[[-2,-n*3,-3],[1,-2-n*3,-3.9],[2,-n*3,-3.1]],.3,'#48565a','tattoo');attachments.push({group:ink,from:side+'e',to:side+'h',fraction:.16});}}
  if(config.claws){const g=new T.Group();group.add(g);for(const x of [-1.7,0,1.7])tube(g,[[x,0,0],[x,-6,-1],[x,-16,-2]],.38,'#c1ccd0','claw');attachments.push({group:g,from:'rh',to:'re'});}
  // Coiffures and costume pieces share one draw call per material, rather than one per curl.
  function merge(parent){
   const list=parent.children.filter(m=>m.isMesh&&m.visible&&!m.userData.ownedMaterial&&!m.material.transparent&&!m.material.map);if(list.length<2)return;
   const positions=[],normals=[],colors=[],parts=[];
   for(const m of list){m.updateMatrix();const geometry=m.geometry.index?m.geometry.toNonIndexed():m.geometry.clone();geometry.applyMatrix4(m.matrix);positions.push(...geometry.attributes.position.array);normals.push(...geometry.attributes.normal.array);const color=m.material.color;for(let n=0;n<geometry.attributes.position.count;n++)colors.push(color.r,color.g,color.b);parts.push(m.name);geometry.dispose();if(m.userData.ownedGeometry)m.geometry.dispose();m.removeFromParent();}
   const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new T.Float32BufferAttribute(normals,3));geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));
   const mesh=new T.Mesh(geometry,new T.MeshStandardMaterial({vertexColors:true,roughness:.76,envMapIntensity:.15}));mesh.name='costume-batch';mesh.userData.parts=parts;mesh.userData.ownedGeometry=mesh.userData.ownedMaterial=true;mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);
  }
  merge(head);merge(gear);for(const a of attachments)merge(a.group);
  function update(pose,scale){head.scale.set(scale*1.12*[1,1.07,.91,.98,1.03,.95,1.04,.96,1.01,.91,1.08,.98][config.faceIndex%12],scale*1.12,scale*1.12);garment.scale.setScalar(scale);garment.position.set(pose.hip[0]*scale,pose.hip[2]*scale,-pose.hip[1]*scale);const torso=new T.Vector3(...[pose.chest[0]-pose.hip[0],pose.chest[2]-pose.hip[2],-(pose.chest[1]-pose.hip[1])]).normalize();garment.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),torso);for(const a of attachments){const start=pose[a.from],q=pose[a.to],p=a.fraction?start.map((v,n)=>v+(q[n]-v)*a.fraction):start;a.group.position.set(p[0]*scale,p[2]*scale,-p[1]*scale);a.group.scale.setScalar(scale);if(a.fixed){a.group.quaternion.identity();continue;}a.group.quaternion.setFromUnitVectors(new T.Vector3(0,a.axis||-1,0),new T.Vector3(q[0]-p[0],q[2]-p[2],-(q[1]-p[1])).normalize());}}
  return {config,update};
 }
 root.CityThreeIdentity={describe,sample,attach,signatures:Object.keys(costumes)};
})(typeof window==='undefined'?globalThis:window);
