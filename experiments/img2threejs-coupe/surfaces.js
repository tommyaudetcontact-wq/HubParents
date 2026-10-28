import * as THREE from 'three';
const defaultStations=[[-2.2,.78,.735],[-2.06,.855,.785],[-1.7,.885,.815],[-1.35,.9,.85],[-.95,.875,.83],[-.61,.85,.835],[.0,.86,.85],[.9,.88,.87],[1.3,.91,.89],[1.75,.88,.85],[2.08,.85,.80],[2.2,.79,.775]];
const mix=(a,b,t)=>a+(b-a)*t,cat=(a,b,c,d,t)=>.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t);
function section(z,profile){const stations=profile?.stations||defaultStations;let n=0;while(n<stations.length-2&&z>stations[n+1][0])n++;const a=stations[Math.max(0,n-1)],b=stations[n],c=stations[n+1],d=stations[Math.min(stations.length-1,n+2)],t=Math.max(0,Math.min(1,(z-b[0])/(c[0]-b[0])));return [cat(a[1],b[1],c[1],d[1],t),cat(a[2],b[2],c[2],d[2],t)];}
function grid(n,m,point,skip){const pos=[],ix=[];for(let i=0;i<=n;i++)for(let j=0;j<=m;j++)pos.push(...point(i/n,j/m));for(let i=0;i<n;i++)for(let j=0;j<m;j++){if(skip?.((i+.5)/n,(j+.5)/m))continue;const a=i*(m+1)+j,b=a+m+1;ix.push(a,b,a+1,a+1,b,b+1);}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(ix);g.computeVertexNormals();return g;}
function arch(z){return Math.max(.21,...[-1.35,1.3].map(ax=>{const d=Math.abs(z-ax),r=.365;return d<r?.32+Math.sqrt(r*r-d*d):.21;}));}
export function buildCoupeSurface(d){const profile=d.profile,sectionAt=z=>section(z,profile),corner=profile?.cornerRadius??.1,bulge=t=>.88+.26*t-.18*t*t;
 if(d.kind==='side'){
  const outer=grid(144,10,(s,t)=>{const raw=mix(-2.2,2.2,s),[w,h]=sectionAt(raw),y=mix(arch(raw),h,t),z=raw+(s<.05?corner*(1-s/.05)**2:s>.95?-corner*((s-.95)/.05)**2:0);return [d.side*w*bulge((y-.21)/(h-.21)),y,z];},s=>{const z=mix(-2.2,2.2,s);return z>(profile?.doorOpening?.[0]??-.575)&&z<(profile?.doorOpening?.[1]??.895);});
  const shoulder=grid(48,12,(s,t)=>{const raw=mix(-2.2,-.61,s),[w,h]=sectionAt(raw),u=mix(profile.hoodHalfWidth,w*.96,t)/(w*.96),inner=mix(profile.hoodNoseHeight,profile.hoodCowlHeight,s),y=mix(inner,h,t)+.012*Math.sin(t*Math.PI),z=raw+corner*Math.pow(Math.abs(u),8)*(1-s)**2;return [d.side*mix(profile.hoodHalfWidth,w*.96,t),y,z];});return combine([outer,shoulder]);
 }
 if(d.kind==='sill')return grid(28,8,(s,t)=>{const z=mix(-.61,.93,s),[w,h]=sectionAt(z),y=mix(.195,.278,t),skin=w*bulge((y-.21)/(h-.21)),inset=.055*(1-t)**2;return [d.side*(skin-inset+.001),y,z];});
 if(d.kind==='innerDoor')return grid(24,10,(s,t)=>{const z=mix(-.58,.90,s),[w,h]=sectionAt(z),y=mix(.215,h-.014,t);return [d.side*(w*bulge((y-.21)/(h-.21))-.015),y,z];});
 if(d.kind==='door')return grid(28,12,(s,t)=>{const z=mix(d.z0-.008,d.z1+.008,s),[w,h]=sectionAt(z),y=mix(.215,h,t);return [d.side*w*bulge((y-.21)/(h-.21)),y,z];});
 if(d.kind==='deck')return grid(48,32,(s,t)=>{const raw=mix(d.z0,d.z1,s),u=t*2-1,[w,h]=sectionAt(raw);if(d.z0<0){const x=u*profile.hoodHalfWidth,z=raw+corner*Math.abs(x/(w*.96))**8*(1-s)**2,y=mix(profile.hoodNoseHeight,profile.hoodCowlHeight,s)+profile.hoodCrown*(1-u*u);return [x,y,z];}return [u*w*.96,h+.028*(1-u*u),raw-corner*Math.abs(u)**8*s*s];});
 if(d.kind==='roof')return closedSkin(grid(32,32,(s,t)=>{const z=mix(-.11,.78,s),u=t*2-1,end=Math.sin(s*Math.PI);return [u*(.674+.006*end),1.27+.075*(1-u*u)+.020*end,z];}),.024);
 if(d.kind==='floor')return grid(1,1,(s,t)=>[mix(-.77,.77,s),.195,mix(-2.08,2.08,t)]);
 if(d.kind==='end')return grid(32,8,(s,t)=>{const u=s*2-1,[w,h]=section(d.z);return [u*w*(.95+.01*t),mix(.20,d.z<0?profile.hoodNoseHeight+profile.hoodCrown*Math.max(0,1-(u*w*.96/profile.hoodHalfWidth)**2):h+.028*(1-u*u),t),d.z-Math.sign(d.z)*corner*Math.abs(u)**8];});
 if(d.kind==='quarter')return grid(20,12,(s,t)=>{const z=mix(1.18-.435*t,1.38-.60*t,s),lowW=sectionAt(z)[0]*.96;return [d.side*mix(lowW,.68,t),mix(.863,1.28,t),z];});
 if(d.kind==='windshield'||d.kind==='rearWindow'){const front=d.kind==='windshield';return grid(18,24,(s,t)=>{const u=s*2-1,w=mix(.827,.663,t),y=mix(.849,1.274,t)+.008*(1-u*u)*Math.sin(t*Math.PI),z=mix(front?-.603:1.353,front?-.105:.777,t);return [u*w,y,z];});}
 if(d.kind==='windowSide')return grid(18,14,(s,t)=>{const z=mix(mix(-.585,.446,s),mix(-.095,.446,s),t),x=d.side*mix(.839,.676,t),y=mix(.855,1.276,t);return [x,y,z];});
 if(d.kind==='windowQuarter')return grid(18,14,(s,t)=>{const z=mix(mix(.49,1.18,s),mix(.49,.745,s),t);return [d.side*mix(.85,.677,t),mix(.867,1.275,t),z];});
 if(d.kind==='well'){const r=profile?.wellRadius||.375,inner=profile?.wellInnerX||.61,outer=profile?.wellOuterX||.80,barrel=grid(40,8,(s,t)=>{const a=s*Math.PI;return [d.side*mix(inner,outer,t),.32+Math.sin(a)*r,d.axle+Math.cos(a)*r];}),disc=grid(40,10,(s,t)=>{const a=s*Math.PI;return [d.side*inner,.32+Math.sin(a)*r*t,d.axle+Math.cos(a)*r*t];});return combine([barrel,disc]);}
 if(d.kind==='bay'){const bottom=grid(1,1,(s,t)=>[mix(-.72,.72,s),.26,mix(-2.12,-.58,t)]),fire=grid(1,1,(s,t)=>[mix(-.78,.78,s),mix(.23,.84,t),-.57]),sides=[-1,1].map(sign=>grid(1,1,(s,t)=>[sign*.715,mix(.25,.74,t),mix(-2.1,-.59,s)]));return combine([bottom,fire,...sides]);}
 if(d.kind==='cargoBay'){const bottom=grid(1,1,(s,t)=>[mix(-.73,.73,s),.39,mix(1.04,2.13,t)]),back=grid(1,1,(s,t)=>[mix(-.74,.74,s),mix(.39,.77,t),2.13]),sides=[-1,1].map(side=>grid(1,1,(s,t)=>[side*.74,mix(.39,.82,t),mix(1.04,2.13,s)]));return combine([bottom,back,...sides]);}
 if(d.kind==='engineMount'){const g=bevelBox();g.scale(1.42,.10,.16);g.translate(0,.30,-1.26);return g;}
 if(d.kind==='engine'){const g=bevelBox();g.scale(.58,.30,.65);g.translate(0,.47,-1.26);return g;}
 if(d.kind==='frame')return frameStrip(d.points,d.side,d.width,d.depth);
 if(d.kind==='doorFrame'){const a=[d.side*.841,.850,-.580],b=[d.side*.679,1.266,-.093],c=[d.side*.679,1.266,.454];return combine([frameStrip([a,b],d.side,.018,.012),frameStrip([b,c],d.side,.018,.012)]);}
 if(d.kind==='spoke'){
  const shape=new THREE.Shape(),a=d.angle,coords=[[.05,a-.34],[.205,a-.12],[.205,a+.12],[.05,a+.34]];
  coords.forEach(([r,t],i)=>shape[i?'lineTo':'moveTo'](-r*Math.sin(t),r*Math.cos(t)));shape.closePath();
  const g=new THREE.ExtrudeGeometry(shape,{depth:.012,bevelEnabled:true,bevelThickness:.002,bevelSize:.002,bevelSegments:2,steps:1});g.rotateY(Math.PI/2);g.translate(d.side*.900-.006,.32,d.axle);return g;
 }
 throw Error('Unknown coupe surface '+d.kind);
}
export function bevelBox(){const g=new THREE.BoxGeometry(1,1,1,4,4,4),p=g.attributes.position;for(let n=0;n<p.count;n++){const v=new THREE.Vector3().fromBufferAttribute(p,n),inner=v.clone().clampScalar(-.42,.42);v.sub(inner).normalize().multiplyScalar(.08).add(inner);p.setXYZ(n,...v.toArray());}g.computeVertexNormals();return g;}
export function rimGeometry(){const g=new THREE.TorusGeometry(.485,.032,6,28);g.rotateX(Math.PI/2);return g;}

function combine(gs){const p=[],n=[];for(const g of gs){const flat=g.index?g.toNonIndexed():g;for(const v of flat.attributes.position.array)p.push(v);for(const v of flat.attributes.normal.array)n.push(v);g.dispose();}const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geo.setAttribute('normal',new THREE.Float32BufferAttribute(n,3));return geo;}

function closedSkin(g,thickness){const p=Array.from(g.attributes.position.array),ix=Array.from(g.index.array),count=p.length/3,edges=new Map();for(let i=0;i<count;i++)p.push(p[i*3],p[i*3+1]-thickness,p[i*3+2]);const top=ix.slice();for(let i=0;i<top.length;i+=3){ix.push(top[i+2]+count,top[i+1]+count,top[i]+count);for(let k=0;k<3;k++){const a=top[i+k],b=top[i+(k+1)%3],key=Math.min(a,b)+':'+Math.max(a,b),e=edges.get(key);if(e)e.count++;else edges.set(key,{a,b,count:1});}}for(const e of edges.values())if(e.count===1)ix.push(e.a,e.a+count,e.b,e.b,e.a+count,e.b+count);const o=new THREE.BufferGeometry();o.setAttribute('position',new THREE.Float32BufferAttribute(p,3));o.setIndex(ix);o.computeVertexNormals();return o;}

function frameStrip(points,side,width,depth){
 const a=new THREE.Vector3(...points[0]),b=new THREE.Vector3(...points[1]),t=b.clone().sub(a).normalize();
 const n=new THREE.Vector3(side,0,0).addScaledVector(t,-side*t.x).normalize(),cross=n.clone().cross(t).normalize();
 const g=bevelBox();g.scale(depth,a.distanceTo(b)+.012,width);g.applyMatrix4(new THREE.Matrix4().makeBasis(n,t,cross));g.translate(...a.add(b).multiplyScalar(.5).toArray());return g;
}
