/* Camera-only geometric mask fitting. Actual factory triangles, no image warping. */
const fs=require('node:fs'),vm=require('node:vm'),T=require('../../vendor/three.min.js');
const family=process.argv[2]||'pickup',dir=__dirname+'/families/'+family;
const spec=JSON.parse(fs.readFileSync(__dirname+'/sculpt-spec.json','utf8'));
const fit=JSON.parse(fs.readFileSync(dir+'/camera-fit.json','utf8'));
const reference=JSON.parse(fs.readFileSync(dir+'/silhouette-mask.json','utf8'));
const N=reference.size,scope={THREE:T};vm.createContext(scope);vm.runInContext(fs.readFileSync(__dirname+'/road-model.js','utf8'),scope);
const model=scope.BrawlRoadModel.create({...spec.roadFleetProfiles[family],family},'#888888',0),verts=[],tri=[];
model.group.updateMatrixWorld(true);model.group.traverse(m=>{if(!m.isMesh)return;const a=m.geometry.attributes.position,ix=m.geometry.index,start=verts.length;for(let i=0;i<a.count;i++)verts.push(new T.Vector3().fromBufferAttribute(a,i).applyMatrix4(m.matrixWorld));for(let i=0;i<(ix?.count||a.count);i++)tri.push(start+(ix?ix.getX(i):i));});
const camera=new T.PerspectiveCamera(fit.fov,1.5,.02,100),referenceMask=Uint8Array.from(reference.mask);
const initial=[fit.yaw,fit.pitch,fit.distance,fit.lookY,fit.offsetX];
const bounds=[[initial[0]-.18,initial[0]+.18],[0,.22],[initial[2]*.88,initial[2]*1.12],[initial[3]-.25,initial[3]+.25],[initial[4]-100,initial[4]+100]];
function measure(x){camera.position.set(Math.sin(x[0])*x[2],x[3]+Math.sin(x[1])*x[2],-Math.cos(x[0])*x[2]);camera.lookAt(0,x[3],0);camera.setViewOffset(1536,1024,x[4],0,1536,1024);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);const screen=verts.map(v=>{const n=v.clone().project(camera);return [(n.x+1)*N/2,(1-n.y)*N/2];}),mask=new Uint8Array(N*N);for(let k=0;k<tri.length;k+=3){const a=screen[tri[k]],b=screen[tri[k+1]],c=screen[tri[k+2]],minX=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0]))),maxX=Math.min(N-1,Math.ceil(Math.max(a[0],b[0],c[0]))),minY=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1]))),maxY=Math.min(N-1,Math.ceil(Math.max(a[1],b[1],c[1]))),det=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(det)<1e-8)continue;for(let y=minY;y<=maxY;y++)for(let xx=minX;xx<=maxX;xx++){const u=((b[1]-c[1])*(xx+.5-c[0])+(c[0]-b[0])*(y+.5-c[1]))/det,v=((c[1]-a[1])*(xx+.5-c[0])+(a[0]-c[0])*(y+.5-c[1]))/det;if(u>=0&&v>=0&&u+v<=1)mask[y*N+xx]=1;}}
 let inter=0,union=0;for(let i=0;i<mask.length;i++){if(mask[i]&&referenceMask[i])inter++;if(mask[i]||referenceMask[i])union++;}return {iou:inter/union,mask};}
function decode(x){return x.map((v,i)=>bounds[i][0]+Math.max(0,Math.min(1,v))*(bounds[i][1]-bounds[i][0]));}
function score(x){return 1-measure(decode(x)).iou+x.reduce((s,v)=>s+Math.max(0,-v,v-1)**2,0);}
let points=[initial,...initial.map((_,i)=>initial.map((v,j)=>v+(i===j?[.025,.02,.3,.03,12][i]:0)))].map(p=>{const x=p.map((v,i)=>(v-bounds[i][0])/(bounds[i][1]-bounds[i][0]));return {x,y:score(x)};});
const before=measure(initial).iou;
for(let k=0;k<180;k++){points.sort((a,b)=>a.y-b.y);const c=Array(5).fill(0);for(let j=0;j<5;j++)for(let i=0;i<5;i++)c[i]+=points[j].x[i]/5;const trial=s=>c.map((v,i)=>v+s*(v-points[5].x[i])),r=trial(1),yr=score(r);if(yr<points[0].y){const e=trial(2),ye=score(e);points[5]=ye<yr?{x:e,y:ye}:{x:r,y:yr};}else if(yr<points[4].y)points[5]={x:r,y:yr};else{const q=trial(yr<points[5].y?.5:-.5),yq=score(q);if(yq<Math.min(yr,points[5].y))points[5]={x:q,y:yq};else for(let j=1;j<6;j++){points[j].x=points[j].x.map((v,i)=>(v+points[0].x[i])/2);points[j].y=score(points[j].x);}}}
points.sort((a,b)=>a.y-b.y);const x=decode(points[0].x),after=measure(x).iou;
const out={...fit,yaw:x[0],pitch:x[1],distance:x[2],lookY:x[3],offsetX:x[4],silhouetteFit:{before,after,size:N,iterations:180,geometryModified:false},note:'Camera-only triangle-raster silhouette fit within documented local bounds. Actual browser capture and Tier1 diagnostics remain required.'};
fs.writeFileSync(dir+'/camera-fit-candidate.json',JSON.stringify(out,null,2));console.log(JSON.stringify({family,before,after,parameters:x}));
