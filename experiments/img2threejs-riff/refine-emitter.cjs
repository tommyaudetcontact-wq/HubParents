// Correct the upstream tube emitter: attachment metadata must not replace explicit curved geometry.
const fs=require('fs');const file='experiments/img2threejs-riff/createRiffModel.ts';let src=fs.readFileSync(file,'utf8');const spec=JSON.parse(fs.readFileSync('experiments/img2threejs-riff/sculpt-spec.json'));
for(const [i,c] of spec.componentTree.entries()){if(c.primitive!=='tube')continue;const id=c.id.replace(/[^a-zA-Z0-9_]/g,'_');const re=new RegExp(`const endpoint_${id}_${i} = makeAttachmentEndpoint\\([^;]+;`);if(!re.test(src))throw Error('Missing tube adapter '+c.id);src=src.replace(re,`const endpoint_${id}_${i} = null; // authored tubePath already in model coordinates`);}
// Interpolate loft contours smoothly before meshing. Radii remain positive and inside station envelopes.
const marker='  const stations = sweep.stations;';if(!src.includes(marker))throw Error('Missing loft helper');src=src.replace(marker,`  const input = sweep.stations;
  const stations: TaperedStation[] = [];
  for(let i=0;i<input.length-1;i++){
    const a=input[Math.max(0,i-1)], b=input[i], c=input[i+1], d=input[Math.min(input.length-1,i+2)];
    for(let n=0;n<4;n++){const t=n/4;const interp=(x:number,y:number,z:number,w:number)=>.5*((2*y)+(-x+z)*t+(2*x-5*y+4*z-w)*t*t+(-x+3*y-3*z+w)*t*t*t);
      stations.push({position:b.position.map((v,k)=>interp(a.position[k],v,c.position[k],d.position[k])) as [number,number,number],rx:Math.max(0,interp(a.rx,b.rx,c.rx,d.rx)),rz:Math.max(0,interp(a.rz,b.rz,c.rz,d.rz)),twist:interp(a.twist||0,b.twist||0,c.twist||0,d.twist||0)});
    }
  }stations.push(input[input.length-1]);`);
// final files written once below
// Smooth variable-radius profile fields: the spec owns the contours, not hidden generated constants.
const pantsSpec=spec.componentTree.find(c=>c.id==='pants').geometryDescriptor.branchedLoft;
if(pantsSpec){
 src=src.replace('readonly primitives: readonly SdfPrimitive[];', 'readonly primitives: readonly SdfPrimitive[]; readonly authoredLofts?: number[][][]; readonly blendRadius?: number; readonly authoredVolumes?: SdfPrimitive[];');
 src=src.replace('  const sample = sdfSample(descriptor);', `  const sample: SdfFunction = descriptor.authoredLofts ? (point) => {
    const values=descriptor.authoredLofts!.map((rings)=>{const y=point.y;let i=0;while(i<rings.length-2&&y>rings[i+1][0])i++;
      const a=rings[Math.max(0,i-1)],b=rings[i],c=rings[i+1],d=rings[Math.min(rings.length-1,i+2)],t=Math.max(0,Math.min(1,(y-b[0])/(c[0]-b[0])));
      const f=(k:number)=>{const q=.5*(2*b[k]+(-a[k]+c[k])*t+(2*a[k]-5*b[k]+4*c[k]-d[k])*t*t+(-a[k]+3*b[k]-3*c[k]+d[k])*t*t*t);return Math.max(Math.min(b[k],c[k]),Math.min(Math.max(b[k],c[k]),q));};
      const rx=f(3),rz=f(4),radial=(Math.hypot((point.x-f(1))/rx,(point.z-f(2))/rz)-1)*Math.min(rx,rz);
      return Math.max(radial,rings[0][0]-y,y-rings[rings.length-1][0]);
    });for(const v of descriptor.authoredVolumes??[])values.push(sdfPrimitive(point,v));return values.reduce((a,b)=>smin(a,b,descriptor.blendRadius??.014));
  } : sdfSample(descriptor);`);
 const m=src.match(/const mesh_pants_\d+Geometry = endpoint_pants_\d+[\s\S]*?;/);
 if(!m)throw Error('pants geometry missing');
 const name=m[0].match(/const (\w+) =/)[1];src=src.replace(m[0],`const ${name} = polygonizeSdf(${JSON.stringify({primitives:[],authoredLofts:pantsSpec.lofts,blendRadius:pantsSpec.blendRadius,resolution:pantsSpec.resolution,bounds:pantsSpec.bounds})});`);
}
for(const comp of spec.componentTree){const field=comp.geometryDescriptor.connectedHand;if(!field)continue;const id=comp.id.replace(/[^a-zA-Z0-9_]/g,'_');const re=new RegExp('const (mesh_'+id+'_\\d+Geometry) = endpoint_'+id+'_\\d+[\\s\\S]*?;');const m=src.match(re);if(!m)throw Error('connected arm missing '+comp.id);src=src.replace(m[0],`const ${m[1]} = polygonizeSdf(${JSON.stringify({primitives:[],authoredLofts:field.lofts,authoredVolumes:field.volumes,blendRadius:field.blendRadius,resolution:field.resolution,bounds:field.bounds})});`);}
// Footwear is not a sharp blade: allow a small authored outsole bevel.
src=src.replace('ovalHoles?: { cx: number; cy: number; rx: number; ry: number }[] }','ovalHoles?: { cx: number; cy: number; rx: number; ry: number }[]; bevelEnabled?: boolean; bevelSize?: number; bevelThickness?: number; bevelSegments?: number }');
src=src.replace('    bevelEnabled: false,','    bevelEnabled: profile.bevelEnabled??false, bevelSize:profile.bevelSize??0, bevelThickness:profile.bevelThickness??0, bevelSegments:profile.bevelSegments??1,');
// Standalone image-driven sculpt constraints; appended before runtime publication.
const insert=`
  // Head planes are deformed on ONE surface in model coordinates.
  // Fit the cap to the rounded occiput; the skull must remain inside the cloth shell.
  const capFit=meshes['cap'].userData.sculptComponent.geometryDescriptor.backFit;
  if(capFit){const p=meshes['cap'].geometry.getAttribute('position');for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i);if(z<capFit.centreZ)p.setZ(i,z-capFit.depth*Math.exp(-(((y-capFit.centreY)/capFit.heightRadius)**2))*Math.min(1,(capFit.centreZ-z)/.065));}p.needsUpdate=true;meshes['cap'].geometry.computeVertexNormals();}
  const faceSpec = meshes['head'].userData.sculptComponent.geometryDescriptor.faceSculpt;
  const headGeom = meshes['head'].geometry;
  const hp = headGeom.getAttribute('position');
  for(let i=0;i<hp.count;i++){
    let x=hp.getX(i),y=hp.getY(i),z=hp.getZ(i);
    if(z<-.02){const round=faceSpec.backRoundness;z-=round.depth*Math.exp(-Math.pow((y-round.centreY)/round.heightRadius,2))*THREE.MathUtils.smoothstep(-z,.02,.075);hp.setXYZ(i,x,y,z);}
    if(z>-.005){const bump=(p:number[])=>p[4]*Math.exp(-Math.pow((x-p[0])/p[2],2)-Math.pow((y-p[1])/p[3],2));
      const gate=THREE.MathUtils.smoothstep(z,-.005,.035);
      z+=gate*(bump(faceSpec.nose)+bump(faceSpec.bridge)+bump(faceSpec.lipRidge)+faceSpec.cheeks.reduce((v:number,p:number[])=>v+bump(p),0));
      hp.setXYZ(i,x,y,z);
    }
  }headGeom.computeVertexNormals();
  {
    const spec=meshes['fringe-back'].userData.sculptComponent.geometryDescriptor.rearHair,rings=spec.rings,N=spec.radialSegments,positions:number[]=[],indices:number[]=[];
    for(let layer=0;layer<2;layer++)for(let r=0;r<rings.length;r++){const [y,w,d,z]=rings[r];for(let j=0;j<=N;j++){const a=j/N*Math.PI,t=layer?spec.thickness:0;positions.push((w-t)*Math.cos(a),y+(r===0?-.003*Math.sin(a*8)**2:0),z-(d-t)*Math.sin(a));}}
    const stride=N+1,offset=rings.length*stride;
    for(let r=0;r<rings.length-1;r++)for(let j=0;j<N;j++){const a=r*stride+j,b=a+stride;indices.push(a,a+1,b,a+1,b+1,b);const c=a+offset,d=b+offset;indices.push(c,d,c+1,c+1,d,d+1);}
    for(let r=0;r<rings.length-1;r++)for(const j of [0,N]){const a=r*stride+j,b=a+stride,c=a+offset,d=b+offset;indices.push(a,b,c,b,d,c);}
    for(const r of [0,rings.length-1])for(let j=0;j<N;j++){const a=r*stride+j,b=a+offset;indices.push(a,b,a+1,a+1,b,b+1);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();meshes['fringe-back'].geometry.dispose();meshes['fringe-back'].geometry=g;
  }
  root.updateMatrixWorld(true);
  const imageHeadIds=IMAGE_HEAD_IDS;
  const hmat=new THREE.Matrix4().makeTranslation(0,1.7,0).multiply(new THREE.Matrix4().makeRotationY(.48)).multiply(new THREE.Matrix4().makeRotationZ(-.105)).multiply(new THREE.Matrix4().makeScale(1.18,1.07,1.1)).multiply(new THREE.Matrix4().makeTranslation(0,-1.718,0));
  for(const id of imageHeadIds){const mesh=meshes[id];if(!mesh)continue;const m=new THREE.Matrix4().copy(mesh.matrixWorld).invert().multiply(hmat).multiply(mesh.matrixWorld);mesh.geometry.applyMatrix4(m);mesh.geometry.computeVertexNormals();}
  // A conforming shader marking has no floating geometry or visible thickness.
  const inkMesh=meshes['arm-r'];inkMesh.geometry.setAttribute('tattooCoord',inkMesh.geometry.getAttribute('position').clone());
  const inkMaterial=inkMesh.material.clone();inkMesh.material=inkMaterial;
  inkMaterial.onBeforeCompile=(shader:any)=>{
    shader.vertexShader='attribute vec3 tattooCoord;varying vec3 vTattooCoord;\\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\\n vTattooCoord=tattooCoord;');
    shader.fragmentShader='varying vec3 vTattooCoord;\\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\\n vec3 p=vTattooCoord; float x=p.x+.30; float upper=1.234-abs(x)*1.45; float a=1.-smoothstep(.006,.009,abs(p.y-upper));float arc=abs(length(vec2(x/.046,(p.y-1.116)/.067))-1.);float b=1.-smoothstep(.12,.20,arc);float band=1.-smoothstep(.008,.012,abs(p.y-(1.17+.018*sin(x*48.))));float mask=max(a,max(b,band))*step(.0,p.z)*step(1.035,p.y)*step(p.y,1.25);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.075,.065,.065),mask*.88);');
  };
  inkMaterial.customProgramCacheKey=()=> 'riff-image-tribal-v1';
  for(const id of ['shirt','sleeve-l','sleeve-r','arm-l','arm-r','hand-l','hand-r','necklace','pendant']){const mesh=meshes[id];if(!mesh)continue;const a=mesh.geometry.getAttribute('position');for(let i=0;i<a.count;i++)a.setX(i,a.getX(i)*.86);a.needsUpdate=true;mesh.geometry.computeVertexNormals();}
  for(const [side,splay]of [['l',.065],['r',-.02]] as const){
    for(const id of Object.keys(meshes)){if(!(id==='pants-'+side||id==='shoe-'+side||id==='sole-'+side||id.startsWith('lace-'+side+'-')))continue;
      const mesh=meshes[id],attr=mesh.geometry.getAttribute('position'),inv=mesh.matrixWorld.clone().invert(),v=new THREE.Vector3();
      for(let i=0;i<attr.count;i++){v.fromBufferAttribute(attr,i).applyMatrix4(mesh.matrixWorld);v.x+=splay*Math.max(0,1-v.y/.98);v.applyMatrix4(inv);attr.setXYZ(i,v.x,v.y,v.z);}attr.needsUpdate=true;mesh.geometry.computeVertexNormals();
    }
  }
`;
const headIds=JSON.stringify(spec.headModule.components);src=src.replace('  root.userData.sculptRuntime =',insert.replace('IMAGE_HEAD_IDS',headIds)+'\n  root.userData.sculptRuntime =');
src=src.replace('stations: TaperedStation[]; radialSegments?: number; capEnds?: boolean','stations: TaperedStation[]; radialSegments?: number; capEnds?: boolean; fixedFrame?: string');
src=src.replace('    n.normalize();',"    if(sweep.fixedFrame==='horizontal'){normals.push(new THREE.Vector3(0,0,1));binormals.push(new THREE.Vector3(1,0,0));carried=new THREE.Vector3(0,0,1);continue;}\n    n.normalize();");
fs.writeFileSync(file,src);fs.writeFileSync(file.replace('.ts','.js'),require('module').stripTypeScriptTypes(src));
