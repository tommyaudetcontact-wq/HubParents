'use strict';
(function(root){
 const T=root.THREE;if(!T)return;
 const rounded=new T.BoxGeometry(1,1,1,4,4,4),sphere=new T.SphereGeometry(1,14,10),cylinder=new T.CylinderGeometry(1,1,1,16),tube=new T.CylinderGeometry(1,1,1,8);
 {const p=rounded.attributes.position;for(let n=0;n<p.count;n++){const v=new T.Vector3().fromBufferAttribute(p,n),inner=v.clone().clampScalar(-.39,.39);v.sub(inner).normalize().multiplyScalar(.11).add(inner);p.setXYZ(n,v.x,v.y,v.z);}rounded.computeVertexNormals();}
 const up=new T.Vector3(0,1,0);
 function create(ctx,v,color,actor){const group=new T.Group(),body=new T.Group(),w=v.width*.7,l=v.length*.8,monster=v.heavy==='monster',wheels=[],moving=[],panels=[];group.add(body);body.scale.setScalar(ctx.S);
  const paintColor=color,dark='#263946',silver='#b8cbd1',glass='#314b59',paintMaterial=new T.MeshPhysicalMaterial({color,side:T.DoubleSide,roughness:.48,metalness:.18,clearcoat:.48,clearcoatRoughness:.3}),glassMaterial=new T.MeshStandardMaterial({color:glass,roughness:.14,metalness:.35,side:T.DoubleSide});
  function shape(parent,geometry,x,y,z,width,height,depth,color,glow=false){const m=new T.Mesh(geometry,color===paintColor?paintMaterial:color===glass?glassMaterial:ctx.material(color,glow));m.position.set(x,y,z);m.scale.set(width,height,depth);m.castShadow=m.receiveShadow=true;parent.add(m);return m;}
  const box=(p,x,y,z,a,b,c,col)=>shape(p,rounded,x,y,z,a,b,c,col),ball=(p,x,y,z,a,b,c,col)=>shape(p,sphere,x,y,z,a,b,c,col);
  function rod(p,a,b,r,col){const from=new T.Vector3(...a),to=new T.Vector3(...b),d=to.clone().sub(from),m=shape(p,tube,...from.add(to).multiplyScalar(.5).toArray(),r,d.length(),r,col);m.quaternion.setFromUnitVectors(up,d.normalize());return m;}
  function shell(parent,width,length,bottom,height,color,profile='body'){
   if(profile==='car'){
    const stations=[[-1,.88,.84],[-.88,.97,.96],[-.64,1,1],[-.36,1,1],[.38,1,1],[.72,.99,.98],[.9,.97,.91],[1,.88,.81]],positions=[],indices=[];
    for(const [z,span,top]of stations){const edge=width*span,low=bottom,high=bottom+height*top,bevel=Math.min(1.2,height*.14);for(const [x,y]of [[-edge*.94,low],[-edge,low+bevel],[-edge,high-bevel],[-edge*.93,high],[edge*.93,high],[edge,high-bevel],[edge,low+bevel],[edge*.94,low]])positions.push(x,y,z*length);}
    for(let n=0;n<stations.length-1;n++)for(let k=0;k<8;k++){const a=n*8+k,b=n*8+(k+1)%8,c=(n+1)*8+k,d=(n+1)*8+(k+1)%8,radius=monster?15:v.heavy?7:5,arch=[a,b,c,d].some(i=>Math.abs(positions[i*3])>width*.72&&[-l*.66,l*.64].some(axle=>Math.hypot(positions[i*3+2]-axle,positions[i*3+1]-radius)<radius+.8));if(!arch)indices.push(a,b,c,b,d,c);}for(const offset of [0,(stations.length-1)*8])for(let n=1;n<7;n++)indices.push(offset,offset+n,offset+n+1);
    const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();const mesh=new T.Mesh(geometry,paintMaterial);mesh.castShadow=mesh.receiveShadow=true;mesh.userData.ownedGeometry=true;parent.add(mesh);return mesh;
   }
   if(profile==='cabin'){const positions=[-width,bottom,-length,width,bottom,-length,width,bottom,length,-width,bottom,length,-width*.87,bottom+height,-length*.65,width*.87,bottom+height,-length*.65,width*.87,bottom+height,length*.78,-width*.87,bottom+height,length*.78],geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setIndex([0,4,5,0,5,1,2,6,7,2,7,3,4,7,6,4,6,5,0,1,2,0,2,3]);geometry.computeVertexNormals();const m=new T.Mesh(geometry,glassMaterial);m.castShadow=m.receiveShadow=true;m.userData.ownedGeometry=true;parent.add(m);return m;}

   const positions=[],indices=[],rings=profile==='car'?48:24,sides=24;
   for(let n=0;n<=rings;n++){const t=n/rings,z=(t*2-1)*length,end=Math.pow(Math.sin(t*Math.PI),.16),roof=profile==='cabin'?Math.pow(Math.sin(t*Math.PI),.45):1;
    for(let k=0;k<=sides;k++){const a=k/sides*Math.PI*2,c=Math.cos(a),si=Math.sin(a),x=Math.sign(c)*Math.pow(Math.abs(c),.36)*width*(.5+.5*end),y=bottom+height*roof*.5+Math.sign(si)*Math.pow(Math.abs(si),.4)*height*.5*roof;positions.push(x,y,z);}
   }
   for(let n=0;n<rings;n++)for(let k=0;k<sides;k++){const a=n*(sides+1)+k,b=a+sides+1;const arch=profile==='car'&&[a,b,a+1].some(i=>{const x=positions[i*3],y=positions[i*3+1],z=positions[i*3+2],radius=monster?15:v.heavy?7:5;return Math.abs(x)>width*.72&&[-l*.66,l*.64].some(axle=>Math.hypot(z-axle,y-radius)<radius+1);});if(!arch)indices.push(a,b,a+1,a+1,b,b+1);}for(const offset of [0,rings*(sides+1)])for(let k=1;k<sides-1;k++)indices.push(offset,offset+k,offset+k+1);
   const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();const m=new T.Mesh(geometry,profile==='cabin'?glassMaterial:paintMaterial);m.castShadow=m.receiveShadow=true;m.userData.ownedGeometry=true;parent.add(m);return m;
  }
  function wheel(x,y,z,r,width){const g=new T.Group();g.position.set(x,y,z);body.add(g);const spin=new T.Group();g.add(spin);const half=width/2;const profile=[[r*.57,-half],[r*.79,-half-.08],[r*.95,-half+.15],[r,-half+.6],[r,half-.6],[r*.95,half-.15],[r*.79,half+.08],[r*.57,half]].map(p=>new T.Vector2(...p)),rubber=new T.LatheGeometry(profile,32),tire=new T.Mesh(rubber,ctx.material('#1d252b'));tire.rotation.z=Math.PI/2;tire.castShadow=true;tire.userData.ownedGeometry=true;spin.add(tire);
   for(const side of [-1,1]){const rim=shape(spin,cylinder,side*(half-.2),0,0,r*.58,.25,r*.58,'#3f4b52');rim.rotation.z=Math.PI/2;const lip=new T.Mesh(new T.TorusGeometry(r*.62,r*.065,8,32),ctx.material(silver));lip.rotation.y=Math.PI/2;lip.position.x=side*(half+.12);lip.userData.ownedGeometry=true;spin.add(lip);const hub=shape(spin,cylinder,side*(half+.2),0,0,r*.17,.22,r*.17,silver);hub.rotation.z=Math.PI/2;for(let n=0;n<5;n++){const a=n*Math.PI*2/5;rod(spin,[side*(half+.2),Math.cos(a)*r*.16,Math.sin(a)*r*.16],[side*(half+.13),Math.cos(a+.15)*r*.6,Math.sin(a+.15)*r*.6],r*.085,silver);}}
   if(monster)for(let n=0;n<18;n++){const a=n*Math.PI/9,m=box(spin,0,Math.cos(a)*r,Math.sin(a)*r,width*1.02,r*.11,r*.2,'#354149');m.rotation.x=a;}wheels.push(spin);return g;
  }
  function panel(index,build,pivot){const p=new T.Group();p.userData.damagePanel=index;if(pivot)p.position.set(...pivot);body.add(p);build(p);panels.push({index,group:p});return p;}
  if(v.tank){
   shell(body,w*.82,l*.9,8,12,color);box(body,0,18,0,w*1.7,3,l*1.7,color);
   for(const side of [-1,1]){box(body,side*w,8,0,9,15,l*1.9,dark);for(let n=0;n<7;n++)wheel(side*(w+3),8,-l*.77+n*l*1.54/6,5.2,6);for(let n=0;n<22;n++)for(const y of [1,15])box(body,side*w,y,-l*.9+n*l*1.8/21,10,1.4,2.3,'#52605b');box(body,side*w,17,0,11,2,l*1.92,color);}
   const turret=new T.Group();body.add(turret);shell(turret,w*(v.tankKind==='scorpion'?.46:.62),l*.36,20,v.tankKind==='bastion'?11:8,color);rod(turret,[0,25,-l*.22],[0,25,-l*1.4],2.1,'#53665d');box(turret,0,25,-l*1.43,5,5,6,dark);const hatch=shape(turret,cylinder,0,31,2,6,1.5,6,v.accent);for(const x of [-w*.55,w*.55])box(body,x,18,-l*.86,3,2.2,2,'#f3df9f');for(let n=0;n<5;n++)box(body,0,20,l*(.45+n*.07),w*.9,1,1.2,dark);rod(turret,[-w*.4,27,l*.17],[-w*.4,40,l*.17],.25,dark);if(v.tankKind==='spectre')for(const side of [-1,1])box(turret,side*w*.58,25,0,1,2,l*.4,v.accent);
  }else if(v.heavy==='truck'){
   box(body,0,5,0,w*1.8,5,l*1.95,dark);box(body,0,15,-l*.6,w*1.9,23,l*.66,color);box(body,0,35,-l*.6,w*1.9,3,l*.66,color);box(body,0,27,-l*.945,w*1.65,11,1,glass);
   for(const side of [-1,1]){panel(side<0?2:3,p=>{box(p,0,0,0,1.6,15,l*.5,color);box(p,0,12,0,1.1,10,l*.43,glass);box(p,side*.7,2,l*.1,1.2,1.7,4,silver);},[side*w*.92,14,-l*.56]);panel(side<0?4:5,p=>{rod(p,[0,0,0],[side*5,0,0],.7,dark);box(p,side*5,0,0,2.5,6,4,dark);},[side*w,27,-l*.82]);box(body,side*w*.6,10,-l*.95,5,3,1,'#f4e3bc');}
   panel(0,p=>box(p,0,0,0,w*1.7,8,2,color),[0,14,-l*.95]);box(body,0,8,-l,w*1.95,3,3,silver);box(body,0,13,-l-.5,w*.65,4,1,dark);
   box(body,0,24,l*.31,w*1.93,32,l*1.08,color);box(body,0,41,l*.31,w*1.96,2,l*1.09,'#d2dcda');for(const side of [-1,1])for(let n=0;n<5;n++)box(body,side*w*.98,12+n*6,l*.31,.7,.7,l*1.02,v.accent||'#afc6c6');panel(1,p=>{for(const side of [-1,1]){box(p,side*w*.46,0,0,w*.88,27,1.3,'#c6d0c9');box(p,side*w*.25,0,1,.8,23,.8,silver);}},[0,25,l*.86]);
   for(const z of [-l*.7,l*.43,l*.72])for(const x of [-w*.93,w*.93])wheel(x,7,z,7,5);for(const side of [-1,1])box(body,side*w*.65,7,l*.9,4,2,1,'#c95856');
  }else if(v.heavy==='coach'){
   box(body,0,5,0,w*1.95,6,l*1.95,dark);box(body,0,22,0,w*1.93,29,l*1.97,color);box(body,0,37,0,w*1.94,3,l*1.97,'#d8e2d9');
   for(const z of [-l*.72,l*.65])for(const x of [-w-1,w+1])wheel(x,7,z,7,5);
   box(body,0,28,-l*.99,w*1.7,13,1,glass);box(body,0,28,l*.99,w*1.7,11,1,glass);for(const side of [-1,1]){for(let n=0;n<7;n++)box(body,side*w*.98,29,-l*.7+n*l*.22,.8,11,l*.18,glass);box(body,side*w*.99,16,0,.6,3,l*1.85,v.accent||'#dce8d7');rod(body,[side*w,30,-l*.9],[side*(w+4),29,-l*.95],.7,dark);box(body,side*(w+4),28,-l*.95,2.5,5,3.5,dark);for(const z of [-l*.98,l*.98])box(body,side*w*.68,12,z,5,3,1.5,z<0?'#fff0bc':'#d15e5c');}box(body,0,21,-l-1,w*.8,3,1,dark);for(const z of [-l,l])box(body,0,7,z,w*1.95,2,2,silver);
  }else if(v.body==='motorcycle'){
   if(v.skateboard||v.scooter){
    const deck=new T.Group();body.add(deck);moving.push({kind:v.skateboard?'kickflip':'tailwhip',group:deck});
    if(v.skateboard){
     // Thin maple deck, round plan shape and upturned nose/tail; grip and underside are separate.
     const positions=[],indices=[],groups=[],N=36;
     for(let n=0;n<=N;n++){const z=-9+n*18/N,t=Math.max(0,(Math.abs(z)-6.4)/2.6),span=Math.max(.025,2.4*Math.sqrt(Math.max(0,1-t*t))),y=2.2+1.05*Math.max(0,(Math.abs(z)-5.8)/3.2)**2;
      for(const [x,h]of [[-span,.32],[0,.23],[span,.32],[span,-.25],[0,-.32],[-span,-.25]])positions.push(x,y+h,z);
     }
     for(let material=0;material<3;material++){const start=indices.length;for(let n=0;n<N;n++)for(let k=0;k<6;k++){const surface=k<2?0:k===2||k===5?1:2;if(surface!==material)continue;const a=n*6+k,b=n*6+(k+1)%6,c=a+6,d=b+6;indices.push(a,c,b,b,c,d);}groups.push([start,indices.length-start,material]);}
     const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setIndex(indices);for(const group of groups)g.addGroup(...group);g.computeVertexNormals();
     const plank=new T.Mesh(g,[ctx.material('#303844'),ctx.material('#b89b71'),paintMaterial]);plank.userData.ownedGeometry=true;plank.castShadow=plank.receiveShadow=true;deck.add(plank);
     for(const z of [-6,6]){rod(deck,[-3.1,.75,z],[3.1,.75,z],.22,silver);rod(deck,[0,.75,z],[0,2,z],.34,silver);for(const x of [-2.8,2.8])wheel(x,.75,z,.75,.9);}
     for(const z of [-2,2]){const stripe=box(deck,0,1.85,z,4.1,.08,1.1,v.accent||'#eee7d8');stripe.rotation.y=.25;}
    }else{
     box(deck,0,3,0,3.8,.7,14,color);box(deck,0,3.4,0,3.3,.15,12.8,'#33434b');
     for(const z of [-6,6])wheel(0,1.5,z,1.5,1.2);
     rod(body,[0,1.5,-6],[0,22,-6.2],.45,silver);rod(body,[-5,22,-6.2],[5,22,-6.2],.4,dark);
     for(const x of [-4.7,4.7])box(body,x,22,-6.2,2.9,1.05,1.1,dark);
    }
   }
   else{const r=7;wheel(0,r,-l*.68,r,4);wheel(0,r,l*.65,r,5);rod(body,[0,r,l*.65],[0,17,0],1.2,silver);rod(body,[0,17,0],[0,r,-l*.68],1.2,silver);rod(body,[0,r,-l*.68],[0,r,l*.65],1.1,dark);box(body,0,14,l*.13,w*.9,4,l*.8,dark);const tank=shell(body,w*.58,l*.3,13,6,color);tank.position.z=-l*.25;box(body,0,11,l*.7,w*.6,7,l*.45,color);for(const x of [-3,3])rod(body,[x,r,-l*.68],[x,20,-l*.5],.8,silver);rod(body,[-8,20,-l*.45],[8,20,-l*.45],.5,dark);for(const x of [-7,7])box(body,x,20,-l*.45,4.2,1.25,1.4,dark);if(v.motorcycleKind!=='ninja')ball(body,0,21,-l*.65,3.1,2.8,1.3,'#f5e7b5');rod(body,[4,9,l*.55],[5,10,l*.85],1.5,silver);if(v.motorcycleKind==='ninja'){const outline=[[.38,15,-l*.68],[.58,23,-l*.45],[.82,18,-l*.08],[.52,8,-l*.05],[.45,10,-l*.52]],positions=[],indices=[];for(const side of [-1,1])for(const [width,y,z]of outline)positions.push(side*w*width,y,z);for(let n=1;n<4;n++)indices.push(0,n+1,n,5,5+n,5+n+1);for(let n=0;n<5;n++){const j=(n+1)%5;indices.push(n,j,n+5,j,j+5,n+5);}const fairingGeometry=new T.BufferGeometry();fairingGeometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));fairingGeometry.setIndex(indices);fairingGeometry.computeVertexNormals();const fairing=new T.Mesh(fairingGeometry,paintMaterial);fairing.userData.ownedGeometry=true;fairing.castShadow=true;body.add(fairing);const screen=box(body,0,24,-l*.37,w*.82,5,1,glass);screen.rotation.x=-.6;const lamp=box(body,0,17,-l*.67,w*.85,2,1,'#f5e7b5');lamp.rotation.x=-.35;for(const side of [-1,1])box(body,side*w*.86,16,-l*.14,.7,2,8,v.accent||'#d2e0d4');}else if(v.motorcycleKind==='chopper'){for(const side of [-1,1])rod(body,[side*3,7,l*.2],[side*5,7,l*.9],1.7,silver);box(body,0,16,l*.43,w*.9,9,3,dark);}}
  }else{
   const sporty=['sport','coupe','rally'].includes(v.body),tall=['suv','van','minivan','bus','truck'].includes(v.body)||v.heavy==='coach',pickup=v.body==='pickup'||monster,r=monster?15:v.heavy?7:5,h=monster?27:tall?15:sporty?9:11,roof=h+(tall?12:sporty?6:8),zFront=-l*.38,zBack=pickup?l*.05:l*.48;
   box(body,0,monster?22:5,0,w*1.9,monster?5:5,l*1.95,dark);shell(body,w*.97,l*.98,h*.2,h*.82,color,'car');
   for(const z of [-l*.66,l*.64])for(const x of [-(monster?w+1:w*.9),monster?w+1:w*.9]){wheel(x,r,z,r,monster?10:v.heavy?5:3.5);if(!monster){const arch=new T.Mesh(new T.TorusGeometry(r+1.2,.45,6,28,Math.PI),ctx.material(dark));arch.userData.ownedGeometry=true;arch.position.set(Math.sign(x)*w*.97,r,z);arch.rotation.y=Math.PI/2;body.add(arch);}}
   panel(0,p=>{box(p,0,0,0,w*1.85,2.5,l*.6,color);},[0,h,-l*.68]);panel(1,p=>box(p,0,0,0,w*1.85,2.5,l*(pickup?.85:.42),color),[0,h,pickup?l*.55:l*.78]);
   // Interior remains when doors and engine panels are torn away.
   box(body,0,h-.8,-l*.65,w*1.55,2,l*.52,'#293a43');for(const x of [-w*.35,w*.35])box(body,x,h-3,-l*.65,3,3,l*.35,silver);
   box(body,0,h+1,l*.78,w*1.5,2,l*.3,'#36454c');const canopy=shell(body,w*.78,(zBack-zFront)*.63,h,roof-h,glass,'cabin');canopy.position.z=(zFront+zBack)/2;
   if(v.body!=='convertible')box(body,0,roof+1,(zFront+zBack)/2,w*1.4,2.5,(zBack-zFront)*.88,color);else{canopy.removeFromParent();canopy.geometry.dispose();const windshield=box(body,0,h+4,zFront,w*1.5,8,1,glass);windshield.rotation.x=-.3;for(const side of [-1,1]){box(body,side*w*.35,h+1,0,w*.52,3,9,v.seatColor||'#b7a28b');box(body,side*w*.35,h+4,5,w*.52,9,2.5,v.seatColor||'#b7a28b');}}
   for(const side of [-1,1]){
    for(const front of (v.body==='convertible'?[true]:[true,false])){const center=(zFront+zBack)/2,span=(zBack-zFront)*.63;rod(body,[side*w*.78,h,center+(front?-span:span)],[side*w*.68,roof,center+(front?-span*.65:span*.78)],1.5,color);}
    const count=['sedan','compact','electric','wagon','suv','minivan','van','bus'].includes(v.body)?2:1;for(let n=0;n<count;n++){const length=(zBack-zFront)/count,front=zFront+n*length;panel(side<0?2:3,p=>{box(p,0,0,length/2,1.8,h*.75,length-.8,color);box(p,0,h*.52,length/2,1.3,1.8,length-.5,color);box(p,side*.6,2,length*.75,1.1,1.4,4,silver);if(v.body!=='convertible'){const center=(zFront+zBack)/2,span=(zBack-zFront)*.63,u=n/count,t=(n+1)/count,lo=f=>center-span+2*span*f,hi=f=>center-span*.65+span*1.43*f,positions=[-side*w*.15,h*.43,lo(u)-front,-side*w*.15,h*.43,lo(t)-front,-side*w*.25,roof-h*.57,hi(t)-front,-side*w*.25,roof-h*.57,hi(u)-front],geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setIndex([0,1,2,0,2,3]);geometry.computeVertexNormals();const pane=new T.Mesh(geometry,glassMaterial);pane.userData.ownedGeometry=true;pane.castShadow=true;p.add(pane);} },[side*w*.93,h*.57,front]);}if(count===2)rod(body,[side*w*.78,h,(zFront+zBack)/2],[side*w*.68,roof,(zFront+zBack)/2],1.5,color);
    panel(side<0?4:5,p=>{rod(p,[0,0,0],[side*4,0,0],.65,dark);box(p,side*4,0,0,3.5,3,4.5,color);box(p,side*4.5,0,.3,1,2.4,3,silver);},[side*w,h+3,zFront+2]);
    for(const z of [-l*.94,l*.94]){if(v.body==='classic')ball(body,side*w*.62,h*.62,z,3,1.8,1.1,z<0?'#f7e4ad':'#c95856');else box(body,side*w*.64,h*.72,z,w*.47,2.2,1.2,z<0?'#f7e4ad':'#c95856');}
   }
   for(const z of [-l,l])box(body,0,h*.35,z,w*1.98,1.8,1.7,dark);box(body,0,h*.45,l+1.1,7,3,.35,'#e5e3d4');for(const x of [-w*.75,w*.75])rod(body,[x,h*.24,l*.97],[x,h*.24,l*1.06],1.1,silver);box(body,0,h*.6,-l-1,w*.8,3,1,dark);for(const x of [-w*.3,0,w*.3])box(body,x,h*.6,-l-1.7,1,2.3,.6,silver);
   if(sporty){for(const side of [-1,1]){const lamp=new T.Mesh(new T.TorusGeometry(2,.48,6,20),ctx.material('#d85a59',true));lamp.userData.ownedGeometry=true;lamp.position.set(side*w*.59,h*.63,l*.945);body.add(lamp);}}if(sporty||v.reward){for(const side of [-1,1])box(body,side*w*.65,h+3,l*.8,1,7,1,dark);box(body,0,h+7,l*.8,w*1.9,1.3,5,color);}
   if(actor.police){box(body,0,roof+3,0,w*.95,2,5,dark);ball(body,-w*.25,roof+4,0,w*.22,2.4,2,'#db605a');ball(body,w*.25,roof+4,0,w*.22,2.4,2,'#669be0');for(const side of [-1,1])box(body,side*(w+.3),h*.66,0,.4,4,l*.65,'#29485f');}
   if(actor.taxi)box(body,0,roof+3,0,w*.7,4,5,'#f7e6b2');
  }
  let aura=null;if(v.trail){const col={fire:'#ff8b40',ice:'#94ecff',electric:'#b19aff',neon:'#56fff0',dark:'#ae7cdd',rainbow:'#f3a0df'}[v.trail]||'#b8f8ee';aura=new T.Group();body.add(aura);for(const n of [0,1]){const ring=new T.Mesh(new T.TorusGeometry(1,.035+n*.018,6,48),new T.MeshBasicMaterial({color:col,transparent:true,opacity:.45-n*.17,depthWrite:false}));ring.rotation.x=Math.PI/2;ring.scale.set((w+2)*(1+n*.08),(l+2)*(1+n*.08),1);ring.position.y=1.2+n*.2;ring.userData.ownedGeometry=true;ring.userData.ownedMaterial=true;aura.add(ring);}}
  if(root.CityThreeBatches){for(const wheel of wheels)root.CityThreeBatches.merge(wheel);for(const panel of panels)root.CityThreeBatches.merge(panel.group);root.CityThreeBatches.merge(body);}
  function update(a){if(aura){const pulse=1+.025*Math.sin((root.performance?.now?.()||0)/350);aura.scale.setScalar(pulse);}const stages=root.CityDamage?.stages(a.damage)||[];for(const p of panels){const stage=stages[p.index]||0;p.group.visible=stage<3;if(p.index<2){p.group.rotation.x=stage===2?(p.index===0?-.65:.55):stage===1?-.1:0;p.group.scale.y=stage===2?.6:1;}else if(p.index<4){p.group.rotation.y=(p.index===2?-1:1)*(stage===2?.72:stage===1?.18:0);}}for(const wheel of wheels)wheel.rotation.x=a.wheelAngle||0;for(const m of moving){if(m.kind==='kickflip')m.group.rotation.z=a.skateBoardRoll||0;else m.group.rotation.y=a.scooterWhipAngle||0;}body.position.y=v.hover?(v.hoverHeight||0)*ctx.S:0;}
  body.userData.paintMaterial=paintMaterial;body.userData.glassMaterial=glassMaterial;return {group,update};
 }
 root.CityThreeVehicle={create};
})(typeof window==='undefined'?globalThis:window);
