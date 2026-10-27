'use strict';
(function(root){
 const T=root.THREE;if(!T)return;
 function merge(group){
  const batches=new Map(),children=group.children.filter(o=>o.isMesh&&!o.isSkinnedMesh&&!Array.isArray(o.material));
  for(const child of children){child.updateMatrix();const geometry=child.geometry,index=geometry.index,position=geometry.getAttribute('position'),normal=geometry.getAttribute('normal');if(!normal)continue;const key=child.material.uuid;let batch=batches.get(key);if(!batch){batch={material:child.material,positions:[],normals:[]};batches.set(key,batch);}const transform=new T.Matrix3().getNormalMatrix(child.matrix),p=new T.Vector3(),n=new T.Vector3();for(let i=0;i<(index?.count||position.count);i++){const v=index?index.getX(i):i;p.fromBufferAttribute(position,v).applyMatrix4(child.matrix);n.fromBufferAttribute(normal,v).applyMatrix3(transform).normalize();batch.positions.push(p.x,p.y,p.z);batch.normals.push(n.x,n.y,n.z);}child.removeFromParent();if(child.userData.ownedGeometry)geometry.dispose();}
  for(const b of batches.values()){const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(b.positions,3));geometry.setAttribute('normal',new T.Float32BufferAttribute(b.normals,3));const mesh=new T.Mesh(geometry,b.material);mesh.castShadow=mesh.receiveShadow=true;mesh.userData.ownedGeometry=true;group.add(mesh);}
  return group;
 }
 root.CityThreeBatches={merge};
})(typeof window==='undefined'?globalThis:window);
