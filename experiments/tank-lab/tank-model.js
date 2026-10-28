'use strict';
(function(root){
 const T=root.THREE;
 function armor(rings){
  const p=[],indices=[];
  for(const {y,w,front,rear,cut=2}of rings)p.push(-w+cut,y,front,w-cut,y,front,w,y,front+cut,w,y,rear-cut,w-cut,y,rear,-w+cut,y,rear,-w,y,rear-cut,-w,y,front+cut);
  for(let row=0;row<rings.length-1;row++)for(let k=0;k<8;k++){const a=row*8+k,b=row*8+(k+1)%8,c=a+8,d=b+8;indices.push(a,c,b,b,c,d);}
  for(const end of [0,(rings.length-1)*8])for(let k=1;k<7;k++)indices.push(end,end+k,end+k+1);
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setIndex(indices);const flat=g.toNonIndexed();flat.computeVertexNormals();g.dispose();return flat;
 }
 function bevel(){const g=new T.BoxGeometry(1,1,1,2,2,2),p=g.attributes.position;for(let i=0;i<p.count;i++){const v=new T.Vector3().fromBufferAttribute(p,i),c=v.clone().clampScalar(-.43,.43);v.sub(c).normalize().multiplyScalar(.07).add(c);p.setXYZ(i,v.x,v.y,v.z);}g.computeVertexNormals();return g;}
 function create(options={}){
  const S=options.S??.04,w=(options.width||30)*.7,l=(options.length||53)*.8,group=new T.Group(),body=new T.Group(),turret=new T.Group(),gun=new T.Group(),owned=new Set(),materials=new Set();group.add(body);body.scale.setScalar(S);body.add(turret);turret.position.set(0,21,-2);turret.add(gun);gun.position.set(0,3,-13);
  const mat=(color,roughness=.65,metalness=.15)=>{const m=new T.MeshStandardMaterial({color,roughness,metalness,side:T.DoubleSide});materials.add(m);return m;},paint=mat(options.color||'#7d9869',.48,.22),edge=mat('#53674b'),dark=mat('#263138',.82),rubber=mat('#242a2c',.9),metal=mat('#9ca8a4',.4,.5),accent=mat('#c1cd9e',.6),lens=mat('#a5ced6',.23,.3);
  function mesh(g,m,parent=body){owned.add(g);const o=new T.Mesh(g,m);o.castShadow=o.receiveShadow=true;parent.add(o);return o;}
  function box(parent,x,y,z,a,b,c,m=paint,rotation=null){const g=bevel();g.scale(a,b,c);if(rotation)g.applyMatrix4(new T.Matrix4().makeRotationFromEuler(new T.Euler(...rotation)));g.translate(x,y,z);return mesh(g,m,parent);}
  const hull=mesh(armor([{y:6,w:w*.60,front:-l*.86,rear:l*.85},{y:12,w:w*.76,front:-l,rear:l*.94},{y:20.8,w:w*.70,front:-l*.78,rear:l*.84}]),paint);hull.name='sloped-hull';
  mesh(armor([{y:0,w:w*.50,front:-l*.37,rear:l*.32,cut:4},{y:9.2,w:w*.49,front:-l*.30,rear:l*.27,cut:4},{y:11.5,w:w*.36,front:-l*.22,rear:l*.22,cut:3}]),paint,turret).name='armored-turret';
  const ring=new T.CylinderGeometry(w*.49,w*.49,1.4,32);ring.translate(0,21, -2);mesh(ring,dark);
  const barrelEnd=-(options.length||53)*1.25,barrelLength=Math.abs(barrelEnd-(-15));
  const barrel=new T.CylinderGeometry(1.12,1.48,barrelLength,16,1,true);barrel.rotateX(Math.PI/2);barrel.translate(0,0,-barrelLength/2);mesh(barrel,edge,gun).name='cannon-barrel';
  const bore=new T.Mesh(new T.RingGeometry(.74,1.12,16),metal);bore.position.z=-barrelLength;bore.rotation.y=Math.PI;gun.add(bore);owned.add(bore.geometry);
  const inside=new T.CylinderGeometry(.74,.74,3,16,1,true);inside.rotateX(Math.PI/2);inside.translate(0,0,-barrelLength+1.5);mesh(inside,dark,gun);
  const endDark=new T.CircleGeometry(.74,16);endDark.translate(0,0,-barrelLength+3);mesh(endDark,dark,gun);
  box(gun,0,0,.9,7.4,6.8,5.5,paint);
  const trackCenter=8.3,r=7.3,a=l*.70,loop=4*a+2*Math.PI*r,trackWidth=w*.30,trackX=w-trackWidth/2,linkCount=58,pitch=loop/linkCount;
  const linkGeometry=bevel();linkGeometry.scale(trackWidth,.95,pitch*.94);owned.add(linkGeometry);
  const padGeometry=bevel();padGeometry.scale(trackWidth*.94,.38,pitch*.26);owned.add(padGeometry);
  const links=new T.InstancedMesh(linkGeometry,edge,linkCount*2),pads=new T.InstancedMesh(padGeometry,metal,linkCount*2);links.name='moving-track-links';pads.name='track-grousers';links.castShadow=pads.castShadow=true;links.receiveShadow=pads.receiveShadow=true;links.instanceMatrix.setUsage(T.DynamicDrawUsage);pads.instanceMatrix.setUsage(T.DynamicDrawUsage);body.add(links,pads);
  function trackPoint(distance){let s=((distance%loop)+loop)%loop;if(s<2*a)return {y:trackCenter+r,z:-a+s,angle:0};s-=2*a;if(s<Math.PI*r){const t=s/r;return {y:trackCenter+r*Math.cos(t),z:a+r*Math.sin(t),angle:t};}s-=Math.PI*r;if(s<2*a)return {y:trackCenter-r,z:a-s,angle:Math.PI};const t=Math.PI+(s-2*a)/r;return {y:trackCenter+r*Math.cos(t),z:-a+r*Math.sin(t),angle:t};}
  for(const side of [-1,1]){const positions=[],indices=[],steps=96;for(let i=0;i<=steps;i++){const p=trackPoint(i/steps*loop);for(const [x,radial]of [[-trackWidth*.44,-.70],[trackWidth*.44,-.70],[trackWidth*.44,.10],[-trackWidth*.44,.10]])positions.push(side*trackX+x,p.y+Math.cos(p.angle)*radial,p.z+Math.sin(p.angle)*radial);}for(let i=0;i<steps;i++)for(let k=0;k<4;k++){const a=i*4+k,b=i*4+(k+1)%4,c=a+4,d=b+4;indices.push(a,b,c,b,d,c);}const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();mesh(geometry,rubber).name='continuous-track-backing-'+side;}
  const wheelGeometry=new T.CylinderGeometry(1,1,1,18,1);wheelGeometry.rotateZ(Math.PI/2);owned.add(wheelGeometry);const wheels=new T.InstancedMesh(wheelGeometry,dark,12),caps=new T.InstancedMesh(wheelGeometry,paint,12);wheels.castShadow=caps.castShadow=true;body.add(wheels,caps);const boltGeometry=new T.CylinderGeometry(.48,.48,.34,6);boltGeometry.rotateZ(Math.PI/2);owned.add(boltGeometry);const bolts=new T.InstancedMesh(boltGeometry,metal,72);body.add(bolts);
  const scratch=new T.Object3D();let shotAge=99,wheelAngle=0;
  function place(instance,index,x,y,z,sx,sy,sz,rotation=0){scratch.position.set(x,y,z);scratch.rotation.set(rotation,0,0);scratch.scale.set(sx,sy,sz);scratch.updateMatrix();instance.setMatrixAt(index,scratch.matrix);}
  function animateTracks(angle){
   for(let side=0;side<2;side++){const sign=side?-1:1;for(let i=0;i<linkCount;i++){const p=trackPoint(i*pitch+angle*r),n=side*linkCount+i;place(links,n,sign*trackX,p.y,p.z,1,1,1,p.angle);place(pads,n,sign*trackX,p.y+Math.cos(p.angle)*.69,p.z+Math.sin(p.angle)*.69,1,1,1,p.angle);}
    for(let i=0;i<6;i++){const z=-a+i*2*a/5,rad=i===0||i===5?6.1:4.9,n=side*6+i;place(wheels,n,sign*trackX,trackCenter,z,trackWidth*.91,rad,rad,angle);place(caps,n,sign*(trackX+trackWidth*.46),trackCenter,z,.65,rad*.71,rad*.71,angle);for(let k=0;k<6;k++){const t=k*Math.PI/3+angle;place(bolts,n*6+k,sign*(trackX+trackWidth*.48+.38),trackCenter+Math.cos(t)*rad*.48,z+Math.sin(t)*rad*.48,1,1,1);}}
   }
   for(const o of [links,pads,wheels,caps,bolts])o.instanceMatrix.needsUpdate=true;
  }
  // Upper fenders connect to the hull, with the tracks visible from front and rear.
  for(const side of [-1,1])box(body,side*trackX,17.6,0,trackWidth+1,1.25,2*(a+r*.65),paint);
  // Stamped armor panels and anchored equipment: every component intersects its mounting surface.
  function cylinder(parent,x,y,z,radius,height,material,rotation=null,open=false){const g=new T.CylinderGeometry(radius,radius,height,20,1,open);if(rotation)g.applyMatrix4(new T.Matrix4().makeRotationFromEuler(new T.Euler(...rotation)));g.translate(x,y,z);return mesh(g,material,parent);}
  function rod(parent,a,b,radius,material){const from=new T.Vector3(...a),to=new T.Vector3(...b),delta=to.clone().sub(from),g=new T.CylinderGeometry(radius,radius,delta.length(),8);g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize()));g.translate(...from.add(to).multiplyScalar(.5).toArray());return mesh(g,material,parent);}
  const optics=mat('#4a777f',.21,.25),red=mat('#b7473d',.45,.15),lamp=mat('#e4debb',.28,.1),hardware=mat('#5f6e65',.45,.3);
  const fittings=new T.Group();body.add(fittings);fittings.name='hull-fittings';
  // Split side armor leaves the suspension and moving track links visible below.
  for(const side of [-1,1]){
   for(let i=0;i<4;i++){
    const z=-a*.73+i*a*.49,plate=box(fittings,side*(trackX+trackWidth*.57),17.9,z,1.2,5.2,a*.46,paint,[0,0,side*.08]);plate.name='side-armor-'+side+'-'+i;
    for(const end of [-1,1])cylinder(fittings,side*(trackX+trackWidth*.68),18.7,z+end*a*.15,.42,.32,metal,[0,0,Math.PI/2]);
    box(fittings,side*(trackX+trackWidth*.59),15.9,z,.3,.36,a*.43,edge);
   }
   const cheek=armor([{y:.6,w:3.0,front:-l*.37,rear:-l*.09,cut:1.4},{y:7.3,w:2.8,front:-l*.27,rear:-l*.10,cut:1.3}]);cheek.translate(side*w*.29,0,0);mesh(cheek,edge,turret).name='sloped-turret-cheek-'+side;
   box(turret,side*w*.44,4.8,3.0,1.4,4.3,l*.30,paint,[0,side*.04,0]);
   for(let i=0;i<3;i++)cylinder(turret,side*w*.48,5.0,-.4+i*3.0,.38,.35,metal,[0,0,Math.PI/2]);
   // Headlights, housings and actual tow-loop mountings.
   box(fittings,side*w*.55,21.35,-l*.755,3.4,2.25,2.5,edge);
   box(fittings,side*w*.55,21.42,-l*.786,2.5,1.25,.35,lamp);
   box(fittings,side*w*.44,11.5,-l*.987,2.4,2.2,.8,edge);
   const hook=new T.TorusGeometry(1.0,.25,8,16);hook.translate(side*w*.44,11.3,-l*1.005);mesh(hook,metal,fittings);
   // Rear lifting eyes and tail lamps follow the sloped rear face.
   box(fittings,side*w*.61,15.0,l*.915,2.6,1.6,1.2,edge);
   box(fittings,side*w*.61,15.0,l*.934,1.75,.8,.25,red);
   cylinder(fittings,side*w*.54,13.3,l*.942,1.30,3.5,hardware,[Math.PI/2,0,0],true);
   const bore=new T.CircleGeometry(.94,16);bore.translate(side*w*.54,13.3,l*.942+1.70);mesh(bore,dark,fittings);
  }
  // Driver hatch, inset rim, hinge and handhold.
  const driverX=-w*.27,driverZ=-l*.575;
  cylinder(fittings,driverX,21.15,driverZ,3.45,.9,edge);cylinder(fittings,driverX,21.63,driverZ,3.03,.55,paint);
  box(fittings,driverX+3.0,21.8,driverZ,1.4,.8,3.0,hardware);
  rod(fittings,[driverX-.8,21.9,driverZ],[driverX-.8,23.0,driverZ],.18,hardware);rod(fittings,[driverX+.8,21.9,driverZ],[driverX+.8,23.0,driverZ],.18,hardware);rod(fittings,[driverX-.8,23.0,driverZ],[driverX+.8,23.0,driverZ],.18,hardware);
  box(fittings,driverX,21.9,driverZ-2.7,3.0,1.1,.65,dark);box(fittings,driverX,22.0,driverZ-3.1,2.2,.45,.18,optics);
  // Engine grilles are seated on the rear deck, not suspended over it.
  for(const side of [-1,1]){box(fittings,side*w*.28,20.91,l*.58,w*.45,.28,l*.34,dark);for(let i=0;i<8;i++)box(fittings,side*w*.28,21.12,l*.44+i*l*.039,w*.41,.26,.48,hardware);}
  box(fittings,0,20.95,l*.32,w*1.22,.3,.65,edge);
  // Low commander's cupola, viewports and hatch hardware.
  const cupX=w*.16,cupZ=l*.09;cylinder(turret,cupX,12.2,cupZ,3.8,1.8,edge);cylinder(turret,cupX,13.15,cupZ,3.25,.60,paint);
  for(let i=0;i<6;i++){const angle=i*Math.PI/3;box(turret,cupX+Math.sin(angle)*3.7,12.4,cupZ+Math.cos(angle)*3.7,1.65,.75,.32,dark,[0,angle,0]);box(turret,cupX+Math.sin(angle)*3.9,12.43,cupZ+Math.cos(angle)*3.9,1.10,.36,.10,optics,[0,angle,0]);}
  box(turret,cupX,13.65,cupZ,2.2,.7,.65,hardware);
  // A second recessed hatch and a sight beside the cannon.
  cylinder(turret,-w*.17,11.7,l*.08,2.35,.75,edge);cylinder(turret,-w*.17,12.1,l*.08,1.95,.35,paint);
  box(turret,-w*.17,12.65,-l*.15,2.6,2.7,2.8,edge);box(turret,-w*.17,12.65,-l*.186,1.7,1.15,.25,optics);
  cylinder(turret,-w*.34,10.5,l*.16,1.05,1.3,hardware);rod(turret,[-w*.34,10.5,l*.16],[-w*.34,23.0,l*.16],.10,dark);
  for(const z of [-barrelLength*.18,-barrelLength*.52])cylinder(gun,0,0,z,1.56,.7,hardware,[Math.PI/2,0,0]);
  // Recessed split seams make armor joins readable without outlined cartoon borders.
  for(const side of [-1,1])rod(fittings,[side*w*.61,20.86,-l*.72],[side*w*.61,20.86,-l*.42],.055,edge);
  // Extra track plates are bolted directly against the front glacis.
  const glacisTilt=-Math.atan2(8.8,l*.22);
  for(const side of [-1,1]){box(fittings,side*w*.27,16.75,-l*.89,4.4,.7,4.8,edge,[glacisTilt,0,0]);for(const off of [-1,1])box(fittings,side*w*.27+off*1.45,17.13,-l*.89,.44,.6,3.8,hardware,[glacisTilt,0,0]);}
  box(turret,0,3.6,l*.325,w*.75,1.0,2.0,edge);
  for(const side of [-1,1]){box(turret,side*w*.23,5.1,l*.333,3.8,4.2,2.7,paint);box(turret,side*w*.23,7.1,l*.337,2.6,.4,1.8,hardware);}
  function mergeStatic(parent){const groups=new Map();for(const o of [...parent.children]){if(!o.isMesh||o.isInstancedMesh)continue;o.updateMatrix();let b=groups.get(o.material);if(!b){b=[];groups.set(o.material,b);}const g=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone();g.applyMatrix4(o.matrix);b.push(g);o.removeFromParent();owned.delete(o.geometry);o.geometry.dispose();}for(const [m,geometries]of groups){const positions=[],normals=[];for(const g of geometries){positions.push(...g.attributes.position.array);normals.push(...g.attributes.normal.array);g.dispose();}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('normal',new T.Float32BufferAttribute(normals,3));mesh(g,m,parent);}}
  for(const g of [fittings,gun,turret,body])mergeStatic(g);
  const flashMaterial=new T.MeshBasicMaterial({color:'#ffe6a0',transparent:true,opacity:.9,depthWrite:false,side:T.DoubleSide});materials.add(flashMaterial);const flashGeometry=new T.ConeGeometry(2.2,5.3,7);flashGeometry.rotateX(-Math.PI/2);flashGeometry.translate(0,0,-barrelLength-2.5);owned.add(flashGeometry);const flash=new T.Mesh(flashGeometry,flashMaterial);flash.visible=false;gun.add(flash);
  let aimYaw=0,aimPitch=0;
  function aim(yaw,pitch){aimYaw=Number.isFinite(yaw)?yaw:aimYaw;aimPitch=Math.max(-5*Math.PI/180,Math.min(25*Math.PI/180,Number.isFinite(pitch)?pitch:aimPitch));}
  function update(actor={},dt=1/60){wheelAngle=Number.isFinite(actor.wheelAngle)?actor.wheelAngle:wheelAngle;animateTracks(-wheelAngle);shotAge+=Math.max(0,dt);const kick=shotAge<.24?Math.sin(Math.PI*shotAge/.24)*2.0:0;turret.rotation.y=aimYaw;gun.rotation.x=aimPitch;gun.position.set(0,3-kick*Math.sin(aimPitch),-13+kick*Math.cos(aimPitch));flash.visible=shotAge<.10;flashMaterial.opacity=Math.max(0,1-shotAge/.10);}
  function fire(){shotAge=0;}
  function reset(){shotAge=99;wheelAngle=0;aimYaw=0;aimPitch=0;update({wheelAngle:0},0);}
  function dispose(){for(const g of owned)g.dispose();for(const m of materials)m.dispose();for(const o of [links,pads,wheels,caps,bolts])o.dispose();}
  update({},0);return {group,body,turret,gun,update,fire,reset,dispose,trackPoint,trackLoop:loop,trackRadius:r,trackCenter,links,pads,wheels,caps,bolts,aim,muzzle:()=>{group.updateMatrixWorld(true);return new T.Vector3(0,0,-barrelLength).applyMatrix4(gun.matrixWorld);},muzzleDirection:()=>{group.updateMatrixWorld(true);return new T.Vector3(0,0,-1).transformDirection(gun.matrixWorld);},materials:{paint,edge,dark,metal,accent,lens},build:{mesh,box,armor,mat,owned}};
 }
 root.BrawlTankModel={create};
})(typeof window==='undefined'?globalThis:window);
