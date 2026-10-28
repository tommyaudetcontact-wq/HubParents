'use strict';
(function(root){const T=root.THREE;if(!T)return;
 function create(ctx){const g=new T.Group();g.name='cartoon-m16';
  function add(geometry,color,x,y,z,rx=0,ry=0,rz=0){const m=new T.Mesh(geometry,ctx.material(color));m.position.set(x,y,z);m.rotation.set(rx,ry,rz);m.castShadow=m.receiveShadow=true;m.userData.ownedGeometry=true;g.add(m);return m;}
  const box=(x,y,z,w,h,d,c,rx=0,ry=0,rz=0)=>add(new T.BoxGeometry(w,h,d),c,x,y,z,rx,ry,rz),cyl=(x,y,z,r,len,c)=>add(new T.CylinderGeometry(r,r,len,10),c,x,y,z,Math.PI/2),dark='#303c47',edge='#53616a',polymer='#354c50';
  box(0,3,-3,5.6,6,14,dark);box(0,6.7,-3,4.8,1.2,14,edge);box(0,-2.8,.5,2.8,7,4.5,polymer,0,0,-.12);box(0,1,10,3.7,3.5,13,polymer);
  // Readable shoulder stock with a sloped heel and a separate rubber butt plate.
  const profile=new T.Shape();profile.moveTo(-3,-1);profile.lineTo(3,-1);profile.lineTo(3,7);profile.lineTo(-3,5.5);profile.closePath();const stock=add(new T.ExtrudeGeometry(profile,{depth:8,bevelEnabled:true,bevelSize:.6,bevelThickness:.5,bevelSegments:1}),polymer,0,0,7);box(0,3.2,15,6.8,9.2,1.4,'#202b34');
  // Angular handguard, vents, exposed barrel, sight and muzzle.
  const handguard=cyl(0,4,-17,3.4,16,polymer);box(0,7.2,-17,4.2,1,15,edge);for(const side of [-1,1])for(let n=0;n<4;n++)box(side*3.15,4.4,-12-n*3,.65,1.7,1.4,'#202b34');cyl(0,4,-29,1.2,13,edge);cyl(0,4,-36,1.7,2.5,dark);
  box(0,7.5,-29,1.2,6,1.6,dark);box(0,10.2,-29,3,1.2,2,dark);box(-2,10,-3,1.2,4,10,dark);box(2,10,-3,1.2,4,10,dark);box(0,12.2,-3,5,1.4,11,edge);
  // Curved magazine and guard silhouette.
  box(0,-3,-6,3.6,8,5.8,'#627078',.1);box(0,-7,-7.4,3.5,4,5.2,'#627078',.3);for(let n=0;n<3;n++)box(1.9,-3-n*2.3,-6.6,.2,.5,4,'#46545e');
  const guard=add(new T.TorusGeometry(2,.35,6,12),edge,0,-2.1,-2.7,0,Math.PI/2);guard.scale.set(1,1.2,.8);
  g.userData.model='original-stylized-m16';return g;
 }
 root.CityThreeRifle={create};
})(typeof window==='undefined'?globalThis:window);
