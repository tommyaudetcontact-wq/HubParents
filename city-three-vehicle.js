'use strict';
(function(root){
 const T=root.THREE;if(!T)return;
 const rounded=new T.BoxGeometry(1,1,1,4,4,4),sphere=new T.SphereGeometry(1,14,10),cylinder=new T.CylinderGeometry(1,1,1,16),tube=new T.CylinderGeometry(1,1,1,8);
 {const p=rounded.attributes.position;for(let n=0;n<p.count;n++){const v=new T.Vector3().fromBufferAttribute(p,n),inner=v.clone().clampScalar(-.39,.39);v.sub(inner).normalize().multiplyScalar(.11).add(inner);p.setXYZ(n,v.x,v.y,v.z);}rounded.computeVertexNormals();}
 const up=new T.Vector3(0,1,0);
 function create(ctx,v,color,actor){const group=new T.Group(),body=new T.Group(),w=v.width*.7,l=v.length*.8,monster=v.heavy==='monster',wheels=[],moving=[],panels=[],windows=[];group.add(body);body.scale.setScalar(ctx.S);
  const paintColor=color,dark='#263946',silver='#b8cbd1',glass='#314b59',paintMaterial=new T.MeshPhysicalMaterial({color,side:T.DoubleSide,roughness:.48,metalness:.18,clearcoat:.48,clearcoatRoughness:.3}),glassMaterial=new T.MeshStandardMaterial({color:glass,roughness:.14,metalness:.35,side:T.DoubleSide,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
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
  function wheel(x,y,z,r,width){const g=new T.Group();g.position.set(x,y,z);body.add(g);const spin=new T.Group();g.add(spin);const half=width/2;const profile=[[r*.57,-half],[r*.79,-half-.08],[r*.95,-half+.15],[r,-half+.6],[r,half-.6],[r*.95,half-.15],[r*.79,half+.08],[r*.57,half]].map(p=>new T.Vector2(...p)),rubber=new T.LatheGeometry(profile,24),tire=new T.Mesh(rubber,ctx.material('#1d252b'));tire.rotation.z=Math.PI/2;tire.castShadow=true;tire.userData.ownedGeometry=true;spin.add(tire);
   for(const side of [-1,1]){const rim=shape(spin,cylinder,side*(half-.2),0,0,r*.58,.25,r*.58,'#3f4b52');rim.rotation.z=Math.PI/2;const lip=new T.Mesh(new T.TorusGeometry(r*.62,r*.065,6,24),ctx.material(silver));lip.rotation.y=Math.PI/2;lip.position.x=side*(half+.12);lip.userData.ownedGeometry=true;spin.add(lip);const hub=shape(spin,cylinder,side*(half+.2),0,0,r*.17,.22,r*.17,silver);hub.rotation.z=Math.PI/2;for(let n=0;n<5;n++){const a=n*Math.PI*2/5;rod(spin,[side*(half+.2),Math.cos(a)*r*.16,Math.sin(a)*r*.16],[side*(half+.13),Math.cos(a+.15)*r*.6,Math.sin(a+.15)*r*.6],r*.085,silver);}}
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
   // Original coachwork: independent panels, open wheel wells and an actual cabin.
   const classic=v.body==='classic',sport=['sport','coupe','convertible','rally'].includes(v.body),utility=['suv','van','minivan','bus'].includes(v.body),pickup=v.body==='pickup'||monster,boxy=['van','bus','wagon','minivan'].includes(v.body),r=monster?14:utility||pickup?5.8:4.7,base=monster?21:3.1,belt=base+(utility?10:sport?7.2:8.5),roof=belt+(utility?10.8:sport?6.5:8.3),front=classic?-.22:pickup?-.32:sport?-.31:-.43,back=pickup?.15:boxy?.8:sport?.42:.5,axles=[-l*.64,l*.65];
   function face(parent,pts,col){const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(pts.flat(),3));const ix=[];for(let i=1;i<pts.length-1;i++)ix.push(0,i,i+1);geo.setIndex(ix);geo.computeVertexNormals();const m=new T.Mesh(geo,col===color?paintMaterial:col===glass?glassMaterial:ctx.material(col));m.castShadow=m.receiveShadow=true;m.userData.ownedGeometry=true;parent.add(m);if(col===glass){const region=parent.userData.damagePanel??(pts.reduce((n,p)=>n+p[2],0)<0?0:1),center=new T.Vector3();for(const p of pts)center.add(new T.Vector3(...p));center.multiplyScalar(1/pts.length);const lines=[];for(let n=0;n<pts.length;n++){const point=new T.Vector3(...pts[n]).lerp(center,.42);lines.push(...center.toArray(),...point.toArray());}const crack=new T.LineSegments(new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(lines,3)),new T.LineBasicMaterial({color:'#b7d0d6',depthTest:true}));crack.userData.ownedGeometry=crack.userData.ownedMaterial=true;crack.renderOrder=1;crack.visible=false;parent.add(crack);windows.push({pane:m,crack,region});}return m;}
   const sideX=z=>w*(.96-.09*Math.pow(Math.abs(z/l),4)),beltY=z=>belt-(sport?1.6:classic?.5:1)*Math.pow(Math.abs(z/l),3),archY=z=>Math.max(base,...axles.map(ax=>{const d=Math.abs(z-ax),rr=r*1.13;return d<rr?r+Math.sqrt(rr*rr-d*d):base;}));
   // Side surfaces are tessellated around circular apertures, rather than deleting triangles.
   for(const side of [-1,1]){for(let n=0;n<72;n++){const z0=-l+n*l/36,z1=-l+(n+1)*l/36,mid=(z0+z1)/2;if(mid>front*l&&mid<back*l)continue;const y0=archY(z0),y1=archY(z1),top0=Math.max(y0+.2,beltY(z0)),top1=Math.max(y1+.2,beltY(z1));face(body,[[side*sideX(z0),y0,z0],[side*sideX(z1),y1,z1],[side*sideX(z1)*.985,top1,z1],[side*sideX(z0)*.985,top0,z0]],color);}
    box(body,side*w*.91,base+.8,(front+back)*l/2,1.4,1.6,(back-front)*l,color);
    for(const axle of axles){const points=[];for(let n=0;n<=28;n++){const a=n*Math.PI/28;points.push(new T.Vector3(side*w*.99,r+Math.sin(a)*r*1.15,axle+Math.cos(a)*r*1.15));}const geo=new T.TubeGeometry(new T.CatmullRomCurve3(points),28,.42,5,false),m=new T.Mesh(geo,ctx.material(classic?silver:dark));m.userData.ownedGeometry=true;body.add(m);}
   }
   box(body,0,base+.4,0,w*1.65,1.2,l*1.85,dark); // chassis and floor
   for(const z of axles){rod(body,[-w,r,z],[w,r,z],.65,dark);for(const side of [-1,1]){const wheelGroup=wheel(side*w*.95,r,z,r,monster?9:3.6);wheelGroup.userData.frontAxle=z<0;wheelGroup.userData.roadWheel=true;rod(body,[side*w*.65,base+2,z],[side*w*.9,r,z],.65,silver);}}
   function deck(index,z0,z1){const center=(z0+z1)*l/2;panel(index,p=>{const layers=10;for(let n=0;n<layers;n++){const a=z0*l+(z1-z0)*l*n/layers,b=z0*l+(z1-z0)*l*(n+1)/layers;for(let j=0;j<8;j++){const x0=-1+j/4,x1=x0+.25,crown=x=>.38*(1-x*x);face(p,[[sideX(a)*.96*x0,beltY(a)+crown(x0),a-center],[sideX(a)*.96*x1,beltY(a)+crown(x1),a-center],[sideX(b)*.96*x1,beltY(b)+crown(x1),b-center],[sideX(b)*.96*x0,beltY(b)+crown(x0),b-center]],color);}} },[0,0,center]);}
   deck(0,-1,front);deck(1,pickup?.9:back,1);
   box(body,0,belt-5,-l*.63,w*1.5,3,l*.32,dark);box(body,0,belt-4,-l*.63,w*.6,2,l*.25,silver);
   if(pickup){box(body,0,base+1,l*.55,w*1.55,1.4,l*.78,dark);for(const side of [-1,1])box(body,side*w*.88,belt-2,l*.58,2.2,5,l*.8,color);}
   const f=front*l,b=back*l,rf=f+l*(classic?.23:.16),rb=b-l*(boxy?.04:.18),rw=w*(utility?.79:.76),bottomW=w*.94;
   // Seats, dashboard and steering wheel stay inside when panels are lost.
   for(const z of [l*.02,...(pickup?[]:[l*.28])])for(const side of [-1,1]){box(body,side*w*.43,base+2.7,z,w*.62,2.8,l*.18,v.seatColor||'#46515e');const seat=box(body,side*w*.43,base+5.2,z+l*.06,w*.62,6,l*.07,v.seatColor||'#46515e');seat.rotation.x=-.12;box(body,side*w*.43,base+9,z+l*.07,w*.36,2,l*.06,dark);}
   box(body,0,belt-1,f+1,w*1.65,2,3,dark);const steering=new T.Mesh(new T.TorusGeometry(2,.3,6,16),ctx.material(dark));steering.position.set(-w*.4,belt+1,f+3);steering.rotation.x=-.8;steering.userData.ownedGeometry=true;body.add(steering);
   face(body,[[-bottomW,belt,f],[bottomW,belt,f],[rw,roof,rf],[-rw,roof,rf]],glass);
   if(v.body!=='convertible'){
    face(body,[[-rw,roof,rf],[rw,roof,rf],[rw,roof,rb],[-rw,roof,rb]],color);
    face(body,[[-rw,roof,rb],[rw,roof,rb],[bottomW,belt,b],[-bottomW,belt,b]],glass);
   }
   for(const side of [-1,1]){
    for(const [lo,hi]of [[f,rf],...(v.body==='convertible'?[]:[[b,rb]])])rod(body,[side*bottomW,belt,lo],[side*rw,roof,hi],.6,color);
    if(v.body!=='convertible'){rod(body,[side*rw,roof,rf],[side*rw,roof,rb],.55,color);rod(body,[side*bottomW,belt,f],[side*bottomW,belt,b],.5,silver);}
    const count=utility||['sedan','wagon','electric','compact'].includes(v.body)?2:1;
    for(let n=0;n<count;n++){const t0=n/count,t1=(n+1)/count,z0=f+(b-f)*t0,z1=f+(b-f)*t1;panel(side<0?2:3,p=>{
     face(p,[[side*bottomW,base+1,z0],[side*bottomW,base+1,z1],[side*bottomW,belt,z1],[side*bottomW,belt,z0]],color);
     rod(p,[side*(bottomW+.1),belt-2,z1-3],[side*(bottomW+.1),belt-2,z1-1],.3,classic?silver:dark);
     if(v.body!=='convertible'){const top0=rf+(rb-rf)*t0,top1=rf+(rb-rf)*t1;face(p,[[side*bottomW,belt+.5,z0+.6],[side*bottomW,belt+.5,z1-.6],[side*rw,roof-.6,top1-.5],[side*rw,roof-.6,top0+.5]],glass);if(n)rod(p,[side*bottomW,belt,z0],[side*rw,roof,top0],.6,dark);}
    });}
    panel(side<0?4:5,p=>{rod(p,[0,0,0],[side*2.5,0,-.2],.35,dark);box(p,side*2.8,0,0,2.8,1.7,3.1,color);box(p,side*2.8,0,.8,2.4,1.3,.2,silver);},[side*bottomW,belt+1,f+2]);
   }
   for(const z of [-l,l]){const frontEnd=z<0;face(body,[[-w*.87,base+1,z],[w*.87,base+1,z],[w*.87,beltY(z),z],[-w*.87,beltY(z),z]],color);box(body,0,base+1,z,w*1.84,1.3,1.8,classic?silver:dark);box(body,0,base+3,z+(frontEnd?-.2:.2),w*.85,2.8,.6,dark);
    for(const side of [-1,1]){if(classic&&frontEnd){for(const off of [.52,.77]){const lamp=shape(body,cylinder,side*w*off,belt-2.2,z-.45,1.5,.65,1.5,'#fff0ca');lamp.rotation.x=Math.PI/2;}}else box(body,side*w*.65,beltY(z)-2,z+(frontEnd?-.5:.5),w*(sport?.48:.43),sport?1.2:2,1,frontEnd?'#ecf4df':'#dc5350');}
   }
   box(body,0,base+2.5,l+.95,5,1.8,.2,'#e5e3d4');for(const x of [-w*.65,w*.65])rod(body,[x,base,l*.88],[x,base,l*1.02],.65,silver);
   if(classic){for(const side of [-1,1]){rod(body,[side*w*.95,base+2,-l*.4],[side*w*.95,base+2,l*.5],.4,silver);}}
   if(sport&&v.reward){for(const side of [-1,1])box(body,side*w*.65,belt+2,l*.8,.7,4,.8,dark);box(body,0,belt+4,l*.8,w*1.8,1,4,color);}
   if(actor.police){box(body,0,roof+1,0,w,1,4,dark);for(const side of [-1,1])box(body,side*w*.28,roof+2,0,w*.4,1.5,3,side<0?'#db605a':'#669be0');}
   if(actor.taxi)box(body,0,roof+2,0,w*.7,3,4,'#f7e6b2');
   body.userData.coachwork=true;
  }
  let aura=null;if(v.trail){const col={fire:'#ff8b40',ice:'#94ecff',electric:'#b19aff',neon:'#56fff0',dark:'#ae7cdd',rainbow:'#f3a0df'}[v.trail]||'#b8f8ee';aura=new T.Group();body.add(aura);for(const n of [0,1]){const ring=new T.Mesh(new T.TorusGeometry(1,.035+n*.018,6,48),new T.MeshBasicMaterial({color:col,transparent:true,opacity:.45-n*.17,depthWrite:false}));ring.rotation.x=Math.PI/2;ring.scale.set((w+2)*(1+n*.08),(l+2)*(1+n*.08),1);ring.position.y=1.2+n*.2;ring.userData.ownedGeometry=true;ring.userData.ownedMaterial=true;aura.add(ring);}}
  for(const item of windows){const holder=new T.Group();item.pane.parent.add(holder);holder.add(item.pane);}
  if(root.CityThreeBatches){for(const wheel of wheels)root.CityThreeBatches.merge(wheel);for(const panel of panels)root.CityThreeBatches.merge(panel.group);root.CityThreeBatches.merge(body);}
  const deform=[];body.traverse(o=>{if(o.isMesh&&o.geometry.attributes.position&&o.material===paintMaterial){if(!o.userData.ownedGeometry){o.geometry=o.geometry.clone();o.userData.ownedGeometry=true;}const p=o.geometry.attributes.position;deform.push({mesh:o,rest:p.array.slice(),panel:o.parent.userData.damagePanel});}});let wearStamp='',lastHeading=null,lastAt=0,poseTurn=0;
  function dent(a){const parts=a.damage?.parts||[],stamp=parts.join(',');if(stamp===wearStamp)return;wearStamp=stamp;
   for(const item of deform){const p=item.mesh.geometry.attributes.position,rest=item.rest;for(let n=0;n<p.count;n++){const x=rest[n*3],y=rest[n*3+1],z=rest[n*3+2],idx=item.panel??(Math.abs(z)>l*.42?(z<0?0:1):(x<0?2:3)),d=clampWear(parts[idx])/100,region=item.panel!==undefined?1:Math.min(1,Math.abs(idx<2?z/l:x/w)),ripple=.7+.3*Math.sin(z*.8+x*.63);p.setXYZ(n,x*(1-d*region*.14),y-d*region*(1.1+ripple),z-Math.sign(z)*d*region*(idx<2?l*.09:1.1));}p.needsUpdate=true;item.mesh.geometry.computeVertexNormals();item.mesh.geometry.computeBoundingSphere();}
  }
  function clampWear(n){return Math.max(0,Math.min(100,Number(n)||0));}
  function update(a){const now=root.performance?.now?.()||0,elapsed=lastAt&&now>lastAt?Math.max(.008,Math.min(.07,(now-lastAt)/1000)):1/60,delta=lastHeading===null?0:Math.atan2(Math.sin((a.angle||0)-lastHeading),Math.cos((a.angle||0)-lastHeading)),turn=a.turnRate??Math.max(-2.5,Math.min(2.5,delta/elapsed));poseTurn+=(turn-poseTurn)*(1-Math.exp(-elapsed*15));lastHeading=a.angle||0;lastAt=now;dent(a);for(const item of windows){const wear=clampWear(a.damage?.parts?.[item.region]);item.pane.visible=wear<85;item.crack.visible=wear>=45&&wear<85;}if(aura){const pulse=1+.025*Math.sin((root.performance?.now?.()||0)/350);aura.scale.setScalar(pulse);}const stages=root.CityDamage?.stages(a.damage)||[];for(const p of panels){const stage=stages[p.index]||0;p.group.visible=stage<3;if(p.index<2){p.group.rotation.x=stage===2?(p.index===0?-.24:.18):stage===1?-.025:0;p.group.scale.y=stage===2?.88:1;}else if(p.index<4){p.group.rotation.y=(p.index===2?-1:1)*(stage===2?.24:stage===1?.025:0);}}for(const wheel of wheels){wheel.rotation.x=a.wheelAngle||0;if(wheel.parent.userData.frontAxle)wheel.parent.rotation.y=-Math.max(-.48,Math.min(.48,poseTurn*.28))*Math.sign(a.speed||1);}for(const m of moving){if(m.kind==='kickflip')m.group.rotation.z=a.skateBoardRoll||0;else m.group.rotation.y=a.scooterWhipAngle||0;}const supported=body.userData.coachwork&&!a.rigidActive&&!a.rigidFlight&&!(a.z>1)&&!a.onRamp&&!a.onCourseRamp&&!a.onParkSurface,forward=(a.vx||0)*Math.sin(a.angle||0)-(a.vy||0)*Math.cos(a.angle||0);body.rotation.z=supported?Math.max(-.055,Math.min(.055,poseTurn*(a.speed||0)*.00022)):0;body.rotation.x=supported?Math.max(-.035,Math.min(.035,((a.speed||0)-forward)*.002)):0;body.position.y=v.hover?(v.hoverHeight||0)*ctx.S:0;}
  body.userData.paintMaterial=paintMaterial;body.userData.glassMaterial=glassMaterial;return {group,update};
 }
 function debrisFaces(p){const outline=root.CityDamage.geometry(p.i,p.w,p.l),thickness=p.i<4?.8:1.2,faces=[{points:outline.map(([x,y])=>({x,y,z:thickness})),color:p.color},{points:outline.map(([x,y])=>({x,y,z:0})).reverse(),color:'#46515a'}];for(let n=0;n<outline.length;n++){const a=outline[n],b=outline[(n+1)%outline.length];faces.push({points:[{x:a[0],y:a[1],z:0},{x:b[0],y:b[1],z:0},{x:b[0],y:b[1],z:thickness},{x:a[0],y:a[1],z:thickness}],color:p.color});}return faces;}
 root.CityThreeVehicle={create,debrisFaces};
})(typeof window==='undefined'?globalThis:window);
