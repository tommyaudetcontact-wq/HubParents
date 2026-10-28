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
   const offset=(source.imagePilot?.055:1.25)+Math.min(graphicLayer++,12)*(source.imagePilot?.007:.075),contour=points.map(p=>new T.Vector2(...p)),triangles=T.ShapeUtils.triangulateShape(contour,[]),vertices=[];
   function vertex(p){const world=source.imagePilot?62+(90+p.y-54)*30/39:90+p.y,x=p.x*(source.imagePilot?.78:1),levels=source.imagePilot?[62,68,76,84,88,91,93]:[54,60,68,76,85,90,93],widths=source.imagePilot?[9.6,8.9,10,13.7,12.7,9.6,4.5]:[12,11.4,11.8,15.1,17.6,14.5,4.5],depths=source.imagePilot?[6.87,6.45,7.33,7.25,5.77,4.23,3.7]:[7.4,6.8,7.2,8.1,8.9,7.1,3.7];let i=0;while(i<levels.length-2&&world>levels[i+1])i++;const t=clamp((world-levels[i])/(levels[i+1]-levels[i]),0,1),w=widths[i]+(widths[i+1]-widths[i])*t,d=depths[i]+(depths[i+1]-depths[i])*t,z=-d*Math.pow(Math.max(.01,1-Math.pow(Math.abs(x)/w,2.6)),1/2.6),q=source.imagePilot&&config.feminine&&root.CityThreeRiffImage?.shapePoint?root.CityThreeRiffImage.shapePoint([x,world,z],'shirt'):[x,world,z],surface=source.imagePilot?root.CityThreeRiffImage?.surfaceFront('shirt',q[0],q[1],source):null;vertices.push(q[0],source.imagePilot?q[1]-88.04:p.y,(surface==null?q[2]:surface)-offset);}
   const N=10;for(const ids of triangles){const a=contour[ids[0]],b=contour[ids[1]],c=contour[ids[2]],point=(i,j)=>a.clone().multiplyScalar(1-(i+j)/N).addScaledVector(b,i/N).addScaledVector(c,j/N);for(let i=0;i<N;i++)for(let j=0;j<N-i;j++){vertex(point(i,j));vertex(point(i+1,j));vertex(point(i,j+1));if(i+j<N-1){vertex(point(i+1,j));vertex(point(i+1,j+1));vertex(point(i,j+1));}}}
   const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(vertices,3));g.computeVertexNormals();if(g.attributes.normal.getZ(0)>0){const p=g.attributes.position.array;for(let i=0;i<p.length;i+=9)for(let k=0;k<3;k++)[p[i+3+k],p[i+6+k]]=[p[i+6+k],p[i+3+k]];g.computeVertexNormals();}return part(gear,g,color,name);
  }
  function modernFace(){
   const eye=config.signature==='danseur-ecarlate'?'#3d2922':look.features?.eyeColor||'#527e8e',front=(x,y,layer=.04)=>(root.CityThreeRiffImage?.surfaceFront('head',x,105.4+y,source)??-5)-layer;
   function disc(x,y,w,h,color,name,layer){const p=[x,y,front(x,y,layer)],ix=[],N=32;for(let j=0;j<=N;j++){const a=j/N*Math.PI*2,px=x+Math.cos(a)*w,py=y+Math.sin(a)*h;p.push(px,py,front(px,py,layer));}for(let j=1;j<=N;j++)ix.push(0,j+1,j);const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setIndex(ix);g.computeVertexNormals();part(head,g,color,name);}
   for(const side of [-1,1]){const x=side*(config.feminine?2.69:3.05),y=-.62;disc(x,y,config.feminine?.93:1.03,.43,'#f0ebe2','eye-white',.045);disc(x,y,.31,.34,eye,'iris',.065);disc(x,y,.15,.23,'#172535','pupil',.085);disc(x-.1,y+.12,.065,.075,'#fff6ed','eye-glint',.1);const brow=[[x-side*.88,.96],[x,1.18],[x+side*.82,.98]].map(([x,y])=>[x,y,front(x,y,.09)]);tube(head,brow,config.feminine?.12:.15,look.hairColor,'brow');}
   if(config.signature==='minuit-elegant'){const points=[[-4.1,-3],[-3.7,-6],[0,-8.2],[3.7,-6],[4.1,-3]].map(([x,y])=>[x,y,front(x,y,.15)]);tube(head,points,.38,look.hairColor,'beard');tube(head,[[-1.8,-4.7],[0,-4.5],[1.8,-4.7]].map(([x,y])=>[x,y,front(x,y,.13)]),.2,look.hairColor,'moustache');}
  }
  function backHair(sections,color){const N=32,p=[],ix=[],rows=sections.length;
   for(let shell=0;shell<2;shell++)for(const [y,w,d,shift]of sections)for(let j=0;j<=N;j++){const a=j/N*Math.PI;p.push((w-shell*.85)*Math.cos(a),y,shift+(d-shell*.85)*Math.sin(a));}
   const stride=N+1,layer=rows*stride;for(let shell=0;shell<2;shell++)for(let r=0;r<rows-1;r++)for(let j=0;j<N;j++){const a=shell*layer+r*stride+j,b=a+stride;if(!shell)ix.push(a,a+1,b,b,a+1,b+1);else ix.push(a,b,a+1,a+1,b,b+1);}
   for(const r of [0,rows-1])for(let j=0;j<N;j++){const a=r*stride+j,b=a+1;ix.push(a,a+layer,b,b,a+layer,b+layer);}for(const j of [0,N])for(let r=0;r<rows-1;r++){const a=r*stride+j,b=a+stride;ix.push(a,b,a+layer,b,b+layer,a+layer);}
   const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setIndex(ix);g.computeVertexNormals();return part(head,g,color,'hair-back');
  }
  function fitCloth(mesh,slot){if(!source.imagePilot||!config.feminine||!root.CityThreeRiffImage?.shapePoint)return;mesh.updateMatrix();mesh.geometry.applyMatrix4(mesh.matrix);mesh.position.set(0,0,0);mesh.rotation.set(0,0,0);mesh.scale.set(1,1,1);const p=mesh.geometry.attributes.position;for(let j=0;j<p.count;j++){const q=root.CityThreeRiffImage.shapePoint([p.getX(j),p.getY(j)+88.04,p.getZ(j)],slot);p.setXYZ(j,q[0],q[1]-88.04,q[2]);}mesh.geometry.computeVertexNormals();}
  function scalp(color,style){
   const p=[],ix=[],rows=28,cols=64;
   for(let r=0;r<=rows;r++)for(let j=0;j<=cols;j++){const a=j/cols*Math.PI*2,c=Math.cos(a),end=c>0?1.12+(1-c)*.51:1.63-c*.60,t=r/rows*end,curly=[2,3,14].includes(style),wave=curly?1+.035*Math.sin(a*15+t*5)*Math.sin(t*17+a*3):1,volume=style===14?1.12:1;p.push(Math.sin(a)*7.65*Math.sin(t)*wave*volume,-1.5+9.25*Math.cos(t)+(curly?.3*Math.sin(a*11+t*13)**2:0)+(style===14?1.4:0),1.15-Math.cos(a)*7.75*Math.sin(t)*wave*volume);}
   for(let r=0;r<rows;r++)for(let j=0;j<cols;j++){const a=r*(cols+1)+j,b=a+cols+1;ix.push(a,a+1,b,a+1,b+1,b);}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setIndex(ix);g.computeVertexNormals();return part(head,g,color,'hair-scalp');
  }
  function armoredHelmet(color){
   const rows=[[-8.5,5.4,5.3,0],[-6,7.1,6.5,0],[0,8.2,7.4,0],[5,8.0,7.4,.15],[8.2,6.5,6.4,.5],[9.4,1.3,2.8,.5]],N=24,positions=[],indices=[],power=v=>Math.sign(v)*Math.pow(Math.abs(v),.72);
   for(const [y,w,d,shift]of rows)for(let j=0;j<N;j++){const a=j*Math.PI*2/N;positions.push(power(Math.sin(a))*w,y,shift-power(Math.cos(a))*d);}
   for(let i=0;i<rows.length-1;i++)for(let j=0;j<N;j++){const a=i*N+j,b=i*N+(j+1)%N,c=a+N,d=b+N;indices.push(a,c,b,b,c,d);}for(const row of [0,rows.length-1])for(let j=1;j<N-1;j++)indices.push(row*N,row*N+j,row*N+j+1);
   const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();part(head,g,color,'helmet-shell');
   function patch(y0,y1,a0,a1,w,d,col,name){const p=[],ix=[],segments=16;for(let row=0;row<2;row++)for(let j=0;j<=segments;j++){const a=a0+(a1-a0)*j/segments;p.push(power(Math.sin(a))*w,row?y1:y0,.1-power(Math.cos(a))*d);}for(let j=0;j<segments;j++){const a=j,b=j+segments+1;ix.push(a,b,a+1,a+1,b,b+1);}const q=new T.BufferGeometry();q.setAttribute('position',new T.Float32BufferAttribute(p,3));q.setIndex(ix);q.computeVertexNormals();return part(head,q,col,name);}
   patch(.45,4.5,-1.17,1.17,8.34,7.58,config.helmet==='olive'?'#c8ae62':'#96d5de','gold-visor');
   patch(4.5,5.7,-1.15,1.15,8.35,7.65,color,'helmet-brow');
   for(const side of [-1,1]){patch(-5.7,.6,side<0?-1.3:.42,side<0?-.42:1.3,8.1,7.48,new T.Color(color).multiplyScalar(.83),'helmet-cheek');}const vent=plate(head,[[-2.4,-4.2],[-2,-5.6],[2,-5.6],[2.4,-4.2]],.12,'#263640','helmet-vent');vent.position.z=-6.85;
   patch(.25,.65,-1.18,1.18,8.36,7.62,'#2c3c30','visor-frame');
   const collar=new T.CylinderGeometry(5.2,4.7,1.6,20);part(head,collar,'#273b36','helmet-gasket').position.y=-8.6;
  }
  function face(){
   const robotic=['olive','cobalt','bat','claw'].includes(config.helmet),covered=config.hood||config.mask||robotic,fur=config.animal;
   head.userData.face={style:'sculpted-hero',skin:look.skinColor,eyeColor:look.features?.eyeColor||'#4c8293',covered:!!covered};
   if(['olive','cobalt'].includes(config.helmet))return;
   if(source.imagePilot&&!covered&&!fur){modernFace();return;}
   if(config.hood){const positions=[],indices=[],rows=24,cols=24;for(let r=0;r<=rows;r++){const phi=.12+r/rows*2.95;for(let n=0;n<=cols;n++){const a=-1.27+n/cols*2.54,x=5.7*Math.sin(phi)*Math.sin(a),y=-1+10.1*Math.cos(phi);positions.push(x,y,-5.1*Math.sin(phi)*Math.cos(a)-2);}}for(let r=0;r<rows;r++)for(let n=0;n<cols;n++){const a=r*(cols+1)+n,b=a+cols+1;indices.push(a,a+1,b,a+1,b+1,b);}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();part(head,g,'#eeeade','ghost-mask');for(const side of [-1,1])ellipsoid(head,side*2.25,1.8,-6.75,1.35,2.15,.35,'#202b40','mask-eye').rotation.z=side*.17;ellipsoid(head,0,-5.1,-6.2,1.5,3.1,.38,'#202b40','mask-mouth');return;}
   if(config.mask==='hockey'){ellipsoid(head,0,-1,-2.2,6.4,8.9,4.1,'#d8d9ce','hockey-mask');for(const side of [-1,1]){ellipsoid(head,side*2.9,3,-5.8,1.8,1.05,.48,'#263347','mask-eye');for(let n=0;n<4;n++)ellipsoid(head,side*(2.1+n*.75),-3.7-(n%2)*1.1,-5.65,.3,.36,.2,'#5b6469','mask-vent');}tube(head,[[-2,-5.5,-5.4],[0,-5.9,-5.8],[2,-5.5,-5.4]],.3,'#4b555f','mask-mouth');return;}
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
   const hair=look.hairColor,h=config.hair,long=[3,4,5,6,7].includes(h),cap=scalp(hair,h);
   if(long){const length=[4,5].includes(h)?14:[8,9].includes(h)?12:25;backHair([[5,7.3,8.2,1],[-1,8,8.6,1.2],[-length,8.2,4.2,4.4]],hair);for(const side of [-1,1])lock(head,[[side*6.4,3,1],[side*7.4,0,-.5],[side*7.8,-length*.6,.5],[side*7.2,-length,2.5]],h===7?1.6:1.3,.65,hair,'hair-side');}
   if([8,9].includes(h)){const high=h===8,rootPoint=[0,high?6:-3,high?7:8];for(let n=0;n<5;n++){const x=(n-2)*.8;lock(head,[[x+rootPoint[0],rootPoint[1],rootPoint[2]],[x,rootPoint[1]-5,12],[x+.5,-18,11.5],[x,-29,9]],1.15,.65,hair,'hair-ponytail');}}
   if([12,13].includes(h)){const count=h===13?2:1;for(let n=0;n<count;n++){const side=count===1?-1:n?1:-1,curve=new T.CatmullRomCurve3([[side*6.1,.5,4.7],[side*7.8,-7,3.4],[side*8.1,-18,1.5],[side*7.5,-28,.3]].map(p=>new T.Vector3(...p)));for(let strand=0;strand<3;strand++){const points=[];for(let j=0;j<=80;j++){const t=j/80,point=curve.getPoint(t),phase=t*Math.PI*12+strand*Math.PI*2/3,r=.66*(1-t*.35);point.x+=Math.cos(phase)*r;point.z+=Math.sin(phase)*r;points.push(point);}part(head,new T.TubeGeometry(new T.CatmullRomCurve3(points),96,.46,6,false),new T.Color(hair).multiplyScalar(.91+strand*.055),'hair-braid');}loft(head,[[-26.7,1.1,.9],[-27.7,1.0,.85]],config.signature==='aurore-vallees'?'#694d73':'#b8a270','braid-tie').position.set(side*7.5,0,.3);}}
   if(h===18)for(let n=0;n<9;n++){const x=(n-4)*1.7;lock(head,[[x*.8,2,6],[x,0,8],[x+Math.sin(n),-17,7.8],[x,-24-(n%3)*2,6.5]],.8,.7,hair,'hair-dreadlock');}
   if([2,3,14].includes(h)){for(let n=0;n<(h===14?4:3);n++){const x=-3.3+n*2.05;lock(head,[[x,4.4,-4.9],[x+.7,3.3,-5.5],[x+.25,2,-5.75],[x+.7,n===2?.55:1.3,-5.35]],.34,.19,hair,'hair-curl');}}
   if([10,11].includes(h))for(const side of h===11?[-1,1]:[0])ellipsoid(head,side*6,7,3,3.3,3.3,3.4,hair,'hair-bun');
   if(h===15)loft(head,[[6,1.8,6],[12,1,3.8],[14,.15,.2]],hair,'hair-mohawk');
   if(!config.hat&&[0,1,16,17].includes(h))for(let n=0;n<4;n++)lock(head,[[-5+n*2.4,6,1],[-4+n*2.2,10+n*.25,-1.5],[-3+n*2,8.5,-5],[-4.5+n*2,h===16?1.5:4,-6.1]],1.7,1.1,hair,'hair-quiff');
  }
  if(config.hood){loft(head,[[-10,8.3,7.2,1],[0,9.2,8.1,1],[9,7.1,7,1],[13,.2,.2,1]],'#242b36','hood','hood');for(const side of [-1,1])tube(head,[[side*3.8,11,-3.8],[side*6.6,5,-5.4],[side*6.8,-5,-4.8],[side*4.8,-11,-3.7]],1.25,'#303945','hood-rim');}
  if(config.helmet){const color={olive:'#687953',space:'#79628a',bat:'#2c3343',claw:'#344361',cobalt:'#527b9d'}[config.helmet];if(['olive','cobalt'].includes(config.helmet)){armoredHelmet(color);}else{loft(head,[[-8,6.0,5.7],[0,7.8,7.0],[7,6.5,6.2],[10,.3,.3]],color,'helmet-shell',false);loft(head,[[5,7.4,6.7],[8.4,5.7,5],[10,.2,.2]],color,'helmet-crown');
   if(['bat','claw'].includes(config.helmet))for(const side of [-1,1]){const g=new T.ConeGeometry(2.5,config.helmet==='bat'?12:10,4);const m=part(head,g,color,'mask-ear');m.position.set(side*6.7,11,0);m.rotation.z=-side*.2;}
   if(['olive','cobalt','bat','claw'].includes(config.helmet)){const full=['olive','cobalt'].includes(config.helmet),mask=plate(head,full?[[-6,6],[-7,1],[-5,-7],[0,-8],[5,-7],[7,1],[6,6]]:[[-6,6],[-7,0],[-4,-2],[0,-1],[4,-2],[7,0],[6,6]],1.3,color,'helmet-faceplate');mask.position.z=-6.65;if(full){const vent=plate(head,[[-3.7,-3],[-3,-4.2],[3,-4.2],[3.7,-3]],.3,'#2c3e48','helmet-vent');vent.position.z=-7.35;}}
   if(config.helmet==='olive'){const visor=ellipsoid(head,0,2.5,-7.05,5.5,1.8,.42,'#c8ae62','gold-visor');visor.material=new T.MeshStandardMaterial({color:'#c8ae62',metalness:.62,roughness:.23});visor.userData.ownedMaterial=true;}
   if(config.helmet==='space'){const glass=ellipsoid(head,0,1,-.3,8.6,10.7,9.2,'#9e8eae','space-dome');glass.material=new T.MeshStandardMaterial({color:'#bcb2d2',transparent:true,opacity:.2,depthWrite:false,roughness:.12});glass.userData.ownedMaterial=true;}
  }}
  if(config.hat){const type=config.hat,color=type==='red-cowboy'?'#c84f40':type==='cowboy'?(config.signature==='sherif-prairies'?'#9b6d42':'#75513a'):look.hairColor;
   if(type==='band'){loft(head,[[3.4,7.9,8.0,1],[4.8,7.7,7.9,1]],config.signature==='diva-amethyste'?'#65458d':'#393a3c','headband');}
   else if(type==='cowboy'||type==='red-cowboy'){
    const p=[],ix=[],segments=64;for(let ring=0;ring<2;ring++)for(let n=0;n<=segments;n++){const a=n/segments*Math.PI*2,x=Math.sin(a)*(ring?12:7.3),z=Math.cos(a)*(ring?10.4:7.7)+.7,y=3.9+(ring?1.7*Math.sin(a)**4-.5*Math.cos(a)**2:0);p.push(x,y,z);}for(let j=0;j<segments;j++){const a=j,b=a+segments+1;ix.push(a,b,a+1,a+1,b,b+1);}const count=p.length/3,top=ix.slice();for(let j=0;j<count;j++)p.push(p[j*3],p[j*3+1]-.45,p[j*3+2]);for(let j=0;j<top.length;j+=3)ix.push(top[j]+count,top[j+2]+count,top[j+1]+count);for(const ring of [0,1])for(let j=0;j<segments;j++){const a=ring*(segments+1)+j,b=a+1;ix.push(a,b,a+count,b,b+count,a+count);}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setIndex(ix);g.computeVertexNormals();part(head,g,color,'hat-brim');
    loft(head,[[3.8,7.4,7.8,.7],[8.8,6.6,6.6,.7],[11.4,5.3,5.7,.8],[12,4.7,4.8,.8],[11.4,.3,2.8,.8]],color,'hat-crown');loft(head,[[3.9,7.48,7.87,.7],[5.6,7.22,7.62,.7]],'#4a3026','hat-band');
    for(const side of [-1,1])lock(head,[[side*1.5,11.8,-4],[side*2.7,11.4,-.7],[side*1.4,11.9,4]],.45,.22,new T.Color(color).multiplyScalar(.82),'hat-crease');
   }else{
    const brim=part(head,new T.CylinderGeometry(type==='cap'?8.3:11.5,type==='cap'?8.3:11.5,.7,48),color,'hat-brim');brim.position.set(0,4.0,.7);brim.scale.z=type==='cap'?.98:.78;
    if(type==='cap'){loft(head,[[4,7.8,7.5,.7],[7,6.4,6.4,.7],[9,.2,.2,.7]],'#303b47','cap');ellipsoid(head,1,3.8,-7.2,6,.5,4,'#303b47','cap-peak');}
    else if(type==='witch'){const m=part(head,new T.ConeGeometry(7.6,24,32),'#503858','witch-hat');m.position.set(-2,16,.7);m.rotation.z=.17;loft(head,[[4.1,7.6,7.7,.7],[5.4,7.4,7.4,.7]],'#bd9758','hat-band');}
    else{loft(head,[[4,7.5,7.7,.7],[18,6.4,6.2,.7],[18.7,5.8,5.7,.7]],color,'hat-crown');loft(head,[[4.3,7.6,7.8,.7],[6.5,7.4,7.5,.7]],'#d7cbbb','hat-band');}}
  }
  if(config.crown){const frost=config.signature==='gardienne-givre',color=frost?'#d9c68a':'#d5b657',N=80,p=[],ix=[];
   for(let j=0;j<=N;j++){const a=j/N*Math.PI*2,peak=Math.max(0,Math.cos(a*5))**3,top=8.2+(frost?5.2:6.5)*peak;for(const [radius,y]of [[1,5.8],[1,top],[.945,5.8],[.945,top]])p.push(Math.sin(a)*7.6*radius,y,.8-Math.cos(a)*8.0*radius);}
   for(let j=0;j<N;j++){const a=j*4,b=a+4;ix.push(a,a+1,b,b,a+1,b+1,a+2,b+2,a+3,b+2,b+3,a+3,a+1,a+3,b+1,b+1,a+3,b+3,a,b,a+2,b,b+2,a+2);}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setIndex(ix);g.computeVertexNormals();const band=part(head,g,color,'crown-band');band.userData.parts=['crown-point'];
   const gem=ellipsoid(head,0,9.2,-7.5,1.05,1.6,.5,frost?'#6db9ce':'#629ad4','crown-jewel');for(const side of [-1,1])ellipsoid(head,side*6.7,8.6,-3.5,.65,.95,.35,'#c76c86','crown-side-jewel');
  }
  if(config.glasses){for(const side of [-1,1]){const m=ellipsoid(head,side*2.7,2.3,-6,2.4,1.8,.55,config.signature==='virtuose-pastel'?'#9f4351':'#343945','glasses');tube(head,[[side*5.2,2.5,-5.8],[side*6.8,2.7,-2],[side*6.5,2.5,1]],.35,'#c7c4ae','glasses-arm');}tube(head,[[-.7,2.5,-6.5],[.7,2.5,-6.5]],.25,'#c7c4ae','glasses-bridge');}
  if(config.animal){const fur=config.animal==='fox'?'#de873e':look.hairColor;for(const side of [-1,1]){const rabbit=config.animal==='rabbit',g=new T.ConeGeometry(rabbit?2:3,rabbit?14:8,config.animal==='panda'?16:4),m=part(head,g,fur,'animal-ear');m.position.set(side*5.7,rabbit?12:8,0);m.rotation.z=side*-.2;}ellipsoid(head,0,-2.2,-5.7,4,3,3.2,config.animal==='fox'?'#f0ca8c':look.skinColor,'animal-muzzle');ellipsoid(head,0,-1.2,-8.7,1.1,.9,.65,'#34363b','animal-nose');}
  const garment=new T.Group();group.add(garment);
  if(config.skirt){const gown=config.skirt==='gown'||config.skirt==='robe',color=config.skirt==='robe'?'#262d38':config.skirt==='gown'?look.topColor:look.bottomColor,bottom=gown?-51:config.skirt==='short'?-23:-36;
   const m=loft(garment,[[3,12.2,7.6],[0,13,8],[-12,15,9],[bottom,config.skirt==='robe'?18:gown?24:18.5,12]],color,'garment-skirt');
   const pos=m.geometry.attributes.position,colors=[];for(let n=0;n<pos.count;n++){const x=pos.getX(n),y=pos.getY(n)+56,z=pos.getZ(n),c=sample(source,x*.65,y,z,new T.Color(color));const shade=.93+.07*Math.cos(Math.atan2(z,x)*12);colors.push(c.r*shade,c.g*shade,c.b*shade);}m.geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));m.material=new T.MeshStandardMaterial({vertexColors:true,roughness:.9,side:T.DoubleSide});m.userData.ownedMaterial=true;
  }
  if(config.cape||config.coat){const color=config.cape||look.topColor;loft(gear,[[0,14.5,5,4],[-22,18,5.5,6],[-78,config.coat?20:27,7,8]],color,'cape',true);}
  if(config.armor){const col=config.armor,undersuit='#28382f';loft(gear,[[1,12.8,7.8],[-5,15,8.7],[-18,12.1,8],[-30,10.9,7.4]],col,'body-armor');
   for(const side of ['l','r']){
    function limb(from,to,sections,name,color=col,axis=-1){const g=new T.Group();group.add(g);loft(g,sections,color,name);attachments.push({group:g,from:side+from,to:side+to,axis});return g;}
    const upper=limb('s','e',[[-.5,3.4,3.6],[-3,5.6,5.2],[-8,5.4,5.1],[-14,3.9,4],[-16,3,3.4]],'upper-arm-armor');
    const fore=limb('e','h',[[-1,3.1,3.6],[-3,4.3,4.6],[-10,4,4.6],[-12.5,2.8,3.2]],'forearm-armor');
    for(const y of [-4,-7,-10]){const line=plate(fore,[[-2.3,y],[-2.3,y-.6],[2.3,y-.6],[2.3,y]],.25,undersuit,'gauntlet-vent');line.position.z=-4.45;}
    const glove=limb('h','e',[[.5,2.8,1.8],[-3.9,2.8,2],[-4.6,2.3,1.8]],'armored-glove',undersuit,1);attachments[attachments.length-1].hand=side;
    const handPlate=plate(glove,[[-2.3,-.8],[-2.8,-2],[-2.2,-4.6],[2.2,-4.6],[2.8,-2],[2.3,-.8]],.65,col,'glove-backplate');handPlate.position.z=1.9;for(const x of [-1.55,0,1.55]){const knuckle=plate(glove,[[x-.5,-4.1],[x-.5,-5.2],[x+.5,-5.2],[x+.5,-4.1]],.4,new T.Color(col).multiplyScalar(1.15),'glove-knuckle');knuckle.position.z=1.8;}
    for(const [part,z,y0,y1,w]of [[upper,5.0,-3,-11,3.5],[fore,4.45,-3.5,-10.5,2.8]]){const back=plate(part,[[-w,y0],[-w-.3,y0-1.5],[-w+.5,y1],[w-.5,y1],[w+.3,y0-1.5],[w,y0]],.45,new T.Color(col).multiplyScalar(.91),'rear-arm-plate');back.position.z=z;for(const y of [y0-2,y0-4]){const slit=plate(part,[[-w+.8,y],[-w+.8,y-.45],[w-.8,y-.45],[w-.8,y]],.18,undersuit,'rear-arm-vent');slit.position.z=z+.52;}}

    limb('l','k',[[-2,4.5,5],[-7,5.5,5.8],[-16,4.9,5.1],[-20,3.9,4.3]],'thigh-armor');
    const shin=limb('k','f',[[0,4.4,5],[-4,5.4,5.8],[-17,4.7,5.2],[-23,3.9,4.6]],'shin-armor');
    const knee=plate(shin,[[-3.6,1],[-4.1,-3],[0,-6],[4.1,-3],[3.6,1]],1.4,new T.Color(col).multiplyScalar(1.13),'knee-armor');knee.position.z=-5.4;const calf=plate(shin,[[-3.2,-6],[-3.7,-10],[-2.7,-20],[2.7,-20],[3.7,-10],[3.2,-6]],.55,new T.Color(col).multiplyScalar(.9),'rear-calf-plate');calf.position.z=5.15;
    const slit=plate(shin,[[-.7,-9],[-.7,-17],[.7,-17],[.7,-9]],.22,undersuit,'rear-calf-joint');slit.position.z=5.8;

   }
  }
  if(config.armor){const col=config.armor;loft(gear,[[-1,8,2.8,8.8],[-5,9.1,3.7,9.0],[-19,7.7,3.6,9.0],[-25,6.8,2.8,8.6]],col,'back-armor');for(const side of [-1,1]){const frame=plate(gear,[[-2.4,-6],[-2.8,-10],[-2,-19],[2,-19],[2.8,-10],[2.4,-6]],.8,new T.Color(col).multiplyScalar(.86),'back-module');frame.position.set(side*4.5,0,12.2);for(let y=-9;y>=-17;y-=2.4){const vent=plate(gear,[[-1.4,y],[-1.4,y-.7],[1.4,y-.7],[1.4,y]],.2,'#2c3b32','back-vent');vent.position.set(side*4.5,0,13.1);}}}
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
   case 'sherif-prairies':
    for(const x of [-12,-8,-4,0,4,8,12])rectGraphic(x,-2,.32,29,'#a77838','shirt-check');for(const y of [-4,-8,-12,-16,-20,-24,-28])rectGraphic(-12,y,24,.32,'#b17f3c','shirt-check');
    for(const side of [-1,1]){graphic([[side*4,-1],[side*11,-4],[side*10,-29],[side*3,-29]],'#eee8d7','western-vest');for(const [x,y]of [[6,-8],[8,-18],[5,-25]])graphic([[side*(x-1.1),y+.7],[side*(x+1.5),y],[side*(x+.6),y-2.6],[side*(x-1.2),y-1.8]],'#303337','vest-spot');}
    graphic([[-6,-1],[0,-5],[6,-1],[4,-6],[0,-11],[-2,-7]],'#b9473a','red-bandana');
    graphic([[7,-11],[7.7,-13],[10,-13.2],[8.3,-14.5],[9,-16.8],[7,-15.5],[5,-16.8],[5.6,-14.5],[4,-13.2],[6.2,-13]],'#d3aa4a','sheriff-star');break;
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
  if(config.armor){const col=config.armor,accent=config.helmet==='space'?'#98ba5c':config.helmet==='olive'?'#8a9c6f':config.helmet==='cobalt'?'#82b4ce':'#8798a8';
   for(const side of [-1,1]){const chest=plate(gear,[[side*.8,-5],[side*9.2,-4.2],[side*12,-8],[side*9,-16],[side*1.2,-15]],1.1,accent,'chest-plate');chest.position.z=-8.7;chest.rotation.y=-side*.18;const pocket=plate(gear,[[-2.6,0],[-3,-5.5],[3,-5.5],[2.6,0]],1.2,'#344237','armor-pocket');pocket.position.set(side*5,-24,-8.0);}
   for(const y of [-17,-20.0]){const abdomen=plate(gear,[[-6,y],[-5.3,y-2],[5.3,y-2],[6,y]],.7,new T.Color(col).multiplyScalar(.84),'abdominal-plate');abdomen.position.z=-8.4;}
   loft(gear,[[3,4.9,4.3],[7,4.7,4.2]],'#2b3b31','armored-neck-collar');
  }
  if(!config.skirt&&!config.cape){const belt=loft(gear,source.imagePilot?[[-25.8,11.3,7.25],[-27.4,11.45,7.3]]:[[-34,12.6,8.3],[-37,12.5,8.3]],'#344456','belt');fitCloth(belt,'pants');const buckle=plate(gear,[[-2,1],[-2,-1.5],[2,-1.5],[2,1]],.6,'#bdc7c5','belt-buckle');buckle.position.set(0,source.imagePilot?-26.6:-35,source.imagePilot?-7.35:-8.6);fitCloth(buckle,'pants');}
  if(['riff-nocturne','rockeur-fidelite','navigatrice-iles','eclat-scene'].includes(config.signature)){tube(gear,[[-5,-1,-6.9],[-3,-12,-9],[0,-16,-9.4],[3,-12,-9],[5,-1,-6.9]],.28,'#e0c787','necklace');ellipsoid(gear,0,-17,-9.5,1.4,2,.45,config.signature==='navigatrice-iles'?'#73c5c2':'#e0c787','pendant');}
  for(const side of [-1,1]){const foot=new T.Group();group.add(foot);if(config.armor){loft(foot,[[-2.6,4.5,8.6,-3.1],[.2,4.6,8.7,-3.1],[3.9,4.2,6.9,-2.4],[7,3.6,4.1,0]],config.armor,'armored-boot');const toe=plate(foot,[[-3.2,-.5],[-3.5,-2],[3.5,-2],[3.2,-.5]],.4,new T.Color(config.armor).multiplyScalar(.82),'boot-toe');toe.position.z=-11.2;}if(!source.imagePilot)loft(foot,[[-2.7,4.9,8.9,-3.5],[-1.2,5,9,-3.5]],new T.Color(look.shoeColor).lerp(new T.Color('#d4dfdd'),.28),'boot-sole');attachments.push({group:foot,from:side<0?'lf':'rf',to:side<0?'lk':'rk',axis:1,foot:config.armor?(side<0?'l':'r'):null});}
  if(!config.armor){const item=source.topItem,d=item?.design,long=d?.sleeve==='long'||!d&&[2,3,4].includes(item?.style)||d&&[2,3,4,5,6,7,8,9,12,14,15].includes(d.index);for(const side of ['l','r']){const cuff=new T.Group();group.add(cuff);loft(cuff,[[-.7,(long?3.7:4.8)*(config.feminine?.77:1),(long?3.7:4.8)*(config.feminine?.77:1)],[.7,(long?3.7:4.8)*(config.feminine?.77:1),(long?3.7:4.8)*(config.feminine?.77:1)]],new T.Color(look.topColor).multiplyScalar(.82),'sleeve-cuff');attachments.push({group:cuff,from:side+(long?'e':'s'),to:side+(long?'h':'e'),fraction:long?.75:.53});}}
  if(config.signature==='riff-nocturne'){for(const side of ['l','r']){const ink=new T.Group();group.add(ink);for(let n=0;n<3;n++)tube(ink,[[-2,-n*3,-3],[1,-2-n*3,-3.9],[2,-n*3,-3.1]],.3,'#48565a','tattoo');attachments.push({group:ink,from:side+'e',to:side+'h',fraction:.16});}}
  if(config.claws){const g=new T.Group();group.add(g);for(const x of [-1.7,0,1.7])tube(g,[[x,0,0],[x,-6,-1],[x,-16,-2]],.38,'#c1ccd0','claw');attachments.push({group:g,from:'rh',to:'re'});}
  // Coiffures and costume pieces share one draw call per material, rather than one per curl.
  function merge(parent){
   const list=parent.children.filter(m=>m.isMesh&&m.visible&&!m.userData.ownedMaterial&&!m.material.transparent&&!m.material.map);if(list.length<2)return;
   const positions=[],normals=[],colors=[],parts=[];
   for(const m of list){m.updateMatrix();const geometry=m.geometry.index?m.geometry.toNonIndexed():m.geometry.clone();geometry.applyMatrix4(m.matrix);positions.push(...geometry.attributes.position.array);normals.push(...geometry.attributes.normal.array);const color=m.material.color;for(let n=0;n<geometry.attributes.position.count;n++)colors.push(color.r,color.g,color.b);parts.push(m.name,...(m.userData.parts||[]));geometry.dispose();if(m.userData.ownedGeometry)m.geometry.dispose();m.removeFromParent();}
   const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new T.Float32BufferAttribute(normals,3));geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));
   const mesh=new T.Mesh(geometry,new T.MeshStandardMaterial({vertexColors:true,roughness:.76,envMapIntensity:.15}));mesh.name='costume-batch';mesh.userData.parts=parts;mesh.userData.ownedGeometry=mesh.userData.ownedMaterial=true;mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);
  }
  merge(head);merge(gear);for(const a of attachments)merge(a.group);
  function update(pose,scale,rig){head.scale.set(scale*(source.imagePilot?1:1.12*[1,1.07,.91,.98,1.03,.95,1.04,.96,1.01,.91,1.08,.98][config.faceIndex%12]),scale*(source.imagePilot?1:1.12),scale*(source.imagePilot?1:1.12));garment.scale.setScalar(scale);garment.position.set(pose.hip[0]*scale,pose.hip[2]*scale,-pose.hip[1]*scale);const torso=new T.Vector3(...[pose.chest[0]-pose.hip[0],pose.chest[2]-pose.hip[2],-(pose.chest[1]-pose.hip[1])]).normalize();garment.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),torso);for(const a of attachments){const start=pose[a.from],q=pose[a.to],p=a.fraction?start.map((v,n)=>v+(q[n]-v)*a.fraction):start;a.group.position.set(p[0]*scale,p[2]*scale,-p[1]*scale);a.group.scale.setScalar(scale);if(a.fixed){a.group.quaternion.identity();continue;}a.group.quaternion.setFromUnitVectors(new T.Vector3(0,a.axis||-1,0),new T.Vector3(q[0]-p[0],q[2]-p[2],-(q[1]-p[1])).normalize());if((a.hand||a.foot)&&rig){const bone=rig.bones[a.hand?(a.hand==='l'?11:12):(a.foot==='l'?13:14)];a.group.quaternion.copy(bone.quaternion).multiply(bone.userData.bindQuaternion.clone().invert());}}}
  return {config,update};
 }
 root.CityThreeIdentity={describe,sample,attach,signatures:Object.keys(costumes)};
})(typeof window==='undefined'?globalThis:window);
