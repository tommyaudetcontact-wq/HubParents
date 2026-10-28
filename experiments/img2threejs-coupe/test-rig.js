import * as THREE from 'three';
import * as CANNON from './cannon-es.js';

// Standalone mechanical fixture. It does not change game handling or saved data.
export class CoupeTestRig {
  constructor(model, scene, host) {
    this.model=model;this.scene=scene;this.host=host;
    this.runtime=model.userData.sculptRuntime;this.debris=[];this.wheels=[];
    this.speed=0;this.steer=0;this.damage=0;this.hitCount=0;
    this.world=new CANNON.World({gravity:new CANNON.Vec3(0,-9.81,0)});
    this.world.allowSleep=true;
    const mat=new CANNON.Material('sheet-metal');this.physicsMaterial=mat;
    this.world.defaultContactMaterial.friction=.55;
    this.world.defaultContactMaterial.restitution=.16;
    const ground=new CANNON.Body({mass:0,material:mat,shape:new CANNON.Plane()});
    ground.quaternion.setFromEuler(-Math.PI/2,0,0);ground.position.y=.003;this.world.addBody(ground);
    this.rest=new Map();
    for(const [id,mesh] of Object.entries(this.runtime.meshes)) {
      const a=mesh.geometry.attributes.position;
      this.rest.set(id,{mesh,positions:a.array.slice(),visible:mesh.visible});
    }
    model.updateMatrixWorld(true);
    for(const axle of ['front','rear'])for(const side of ['left','right']) {
      const holder=new THREE.Group(),roll=new THREE.Group();
      holder.position.set(side==='left'?-.82:.82,.32,axle==='front'?-1.35:1.30);
      model.add(holder);holder.add(roll);model.updateMatrixWorld(true);
      const ids=Object.keys(this.runtime.nodes).filter(id=>id===`tire-${axle}-${side}`||id===`rim-${axle}-${side}`||id===`hub-${axle}-${side}`||id.startsWith(`spoke-${axle}-${side}-`));
      for(const id of ids)roll.attach(this.runtime.nodes[id]);
      this.wheels.push({holder,roll,front:axle==='front',ids});
    }
    host.replaceChildren();
    this.button('Roues : démarrer / arrêter',()=>this.speed=this.speed?0:9);
    const label=document.createElement('label');label.textContent='Braquage ';
    const slider=document.createElement('input');slider.type='range';slider.min='-30';slider.max='30';slider.value='0';slider.setAttribute('aria-label','Braquage');slider.oninput=()=>this.steer=Number(slider.value)*Math.PI/180;label.append(slider);host.append(label);
    this.button('Impact avant',()=>this.dent('front'));
    this.button('Impact côté',()=>this.dent('side'));
    this.button('Briser les vitres',()=>this.breakGlass());
    this.button('Arracher une porte',()=>this.detachDoor());
    this.button('Tout réparer',()=>{this.repair();slider.value='0';});
    this.readout=document.createElement('output');this.readout.style.width='100%';this.readout.setAttribute('aria-label','État des essais');host.append(this.readout);
    this.report();
  }
  button(text,fn){const b=document.createElement('button');b.textContent=text;b.onclick=()=>{fn();this.report();};this.host.append(b);}
  report(){this.readout.textContent=`Essais locaux · impacts ${this.hitCount} · débris physiques ${this.debris.length} · ${this.wheels.length} roues articulées`;}
  dent(zone){
    this.hitCount++;this.damage=Math.min(1,this.damage+.22);
    for(const id of zone==='front'?['hood','nose','fender-left','fender-right']:['door-right','fender-right']) {
      const entry=this.rest.get(id);if(!entry||!entry.mesh.visible)continue;
      const a=entry.mesh.geometry.attributes.position,rest=entry.positions;
      for(let i=0;i<a.count;i++) {
        const x=rest[i*3],y=rest[i*3+1],z=rest[i*3+2];
        const fall=zone==='front'?Math.exp(-((z+1.96)**2/.25+x*x/.9)):Math.exp(-((z-.12)**2/.30+(y-.52)**2/.12));
        const amount=this.damage*fall;
        a.setXYZ(i,x-(zone==='side'?.19*amount:0),y-(zone==='front'?.15*amount:0),z+(zone==='front'?.30*amount:0));
      }
      a.needsUpdate=true;entry.mesh.geometry.computeVertexNormals();entry.mesh.geometry.computeBoundingSphere();
    }
    if(this.hitCount>=3)this.breakGlass(['windshield']);
  }
  addDebris(mesh,velocity,spin) {
    this.scene.add(mesh);mesh.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(mesh),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
    // Give thin sheet/glass pieces a small collision thickness.
    const shape=new CANNON.Box(new CANNON.Vec3(Math.max(.018,size.x/2),Math.max(.018,size.y/2),Math.max(.018,size.z/2)));
    const body=new CANNON.Body({mass:Math.max(.15,size.x*size.y*size.z*18),material:this.physicsMaterial,shape});
    body.position.set(center.x,center.y,center.z);body.quaternion.set(mesh.quaternion.x,mesh.quaternion.y,mesh.quaternion.z,mesh.quaternion.w);
    body.velocity.set(...velocity);body.angularVelocity.set(...spin);body.linearDamping=.15;body.angularDamping=.2;body.sleepSpeedLimit=.12;body.sleepTimeLimit=1;
    this.world.addBody(body);mesh.position.copy(center);this.debris.push({mesh,body});
  }
  detachDoor(){
    const side=['right','left'].find(side=>this.rest.get('door-'+side)?.mesh.visible);if(!side)return;
    const original=this.rest.get('door-'+side).mesh;original.updateWorldMatrix(true,false);
    const geometry=original.geometry.clone(),box=new THREE.Box3().setFromBufferAttribute(geometry.attributes.position),center=box.getCenter(new THREE.Vector3());geometry.translate(-center.x,-center.y,-center.z);
    const door=new THREE.Mesh(geometry,original.material);door.position.copy(center).applyMatrix4(original.matrixWorld);door.castShadow=true;door.receiveShadow=true;
    this.addDebris(door,[side==='right'?1.4:-1.4,1.5,.7],[1.2,.4,2]);original.visible=false;
  }
  breakGlass(only){
    const ids=only||['windshield','rear-window','window-left','window-right','window-quarter-left','window-quarter-right'];
    for(const id of ids){const original=this.rest.get(id)?.mesh;if(!original?.visible)continue;original.visible=false;original.updateWorldMatrix(true,false);
      const box=new THREE.Box3().setFromObject(original),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
      for(let i=0;i<8;i++){
        const shard=new THREE.Mesh(new THREE.TetrahedronGeometry(.035+(i%3)*.008),new THREE.MeshStandardMaterial({color:'#9bb7c1',transparent:true,opacity:.65,metalness:.1,roughness:.22}));
        shard.position.copy(center).add(new THREE.Vector3(Math.sin(i*2.4)*size.x*.35,Math.cos(i*1.7)*size.y*.32,Math.sin(i)*size.z*.3));shard.castShadow=true;
        this.addDebris(shard,[Math.sin(i*2.4)*1.6,1+i*.08,Math.cos(i*1.7)*1.6],[i*.5,2,1]);
      }
    }
  }
  repair(){
    for(const {mesh,positions,visible}of this.rest.values()){mesh.geometry.attributes.position.array.set(positions);mesh.geometry.attributes.position.needsUpdate=true;mesh.geometry.computeVertexNormals();mesh.geometry.computeBoundingSphere();mesh.visible=visible;}
    this.clearDebris();this.speed=0;this.steer=0;this.damage=0;this.hitCount=0;for(const w of this.wheels){w.roll.rotation.set(0,0,0);w.holder.rotation.set(0,0,0);}
  }
  clearDebris(){for(const {mesh,body}of this.debris){this.world.removeBody(body);this.scene.remove(mesh);mesh.geometry.dispose();if(!Object.values(this.runtime.meshes).some(m=>m.material===mesh.material))mesh.material.dispose();}this.debris=[];}
  update(dt){for(const w of this.wheels){w.roll.rotation.x-=this.speed/.323*dt;w.holder.rotation.y=w.front?this.steer:0;}this.world.step(1/60,dt,4);for(const d of this.debris){d.mesh.position.copy(d.body.position);d.mesh.quaternion.copy(d.body.quaternion);}}
  dispose(){this.clearDebris();this.host.replaceChildren();}
}
