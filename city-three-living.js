'use strict';
(function(root){
 const T=root.THREE;if(!T)return;
 function attach(ctx,rig){if(!rig)return {update(){}};let group=null,kind=null,hand=null;const data=root.BrawlRiffImage.bones;
  function clear(){if(!group)return;group.traverse(o=>{if(o.userData.ownedGeometry)o.geometry.dispose();});group.removeFromParent();group=null;}
  function mesh(geometry,color,x=0,y=0,z=0){const m=new T.Mesh(geometry,ctx.material(color));m.position.set(x,y,z);m.userData.ownedGeometry=true;group.add(m);return m;}
  return {update(actor){const next=['eat','read','stove'].includes(actor.homeAction?.kind)?actor.homeAction.kind:null;if(next!==kind){clear();kind=next;if(kind){group=new T.Group();group.name='living-prop:'+kind;hand=rig.bones[data.findIndex(d=>d.start===(kind==='stove'?'rh':'lh'))];hand.add(group);if(kind==='eat'){mesh(new T.CylinderGeometry(7,6.5,.6,24),'#ede5d3');for(let n=0;n<3;n++){const m=mesh(new T.SphereGeometry(1,12,8),['#81a56d','#d3a568','#bb826c'][n],(n-1)*3,.9,0);m.scale.set(2,1,2.7);}}else if(kind==='read'){for(const side of [-1,1]){const cover=mesh(new T.BoxGeometry(6,.7,10),'#54899d',side*3,.2,0),pages=mesh(new T.BoxGeometry(5.6,.6,9.6),'#f1e8d2',side*3,.8,0);cover.rotation.z=pages.rotation.z=-side*.15;}}else {mesh(new T.CylinderGeometry(.32,.38,12,10),'#b9a071',0,0,-4).rotation.x=Math.PI/2;const bowl=mesh(new T.SphereGeometry(1,12,8),'#b9a071',0,0,-10);bowl.scale.set(1.6,.45,2.2);}}}if(group){group.quaternion.copy(hand.quaternion).invert();if(kind==='read')group.quaternion.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),.55));}}};
 }
 root.CityThreeLiving={attach};
})(typeof window==='undefined'?globalThis:window);
