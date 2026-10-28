'use strict';
(function(root){
 // Resolve coplanar paint layers in geometry, without changing shared materials.
 // Coordinates here are game units (one unit is .04 metres in the renderer).
 function layers(faces){
  const planes=new Map(),cell=128,epsilon=.0001;
  return (faces||[]).map(face=>{
   const p=face.points;if(face.line||!p||p.length<3)return face;
   const a=p[0],u=[p[1].x-a.x,p[1].y-a.y,p[1].z-a.z];let n,length=0;
   for(let i=2;i<p.length&&length<epsilon;i++){const v=[p[i].x-a.x,p[i].y-a.y,p[i].z-a.z];n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];length=Math.hypot(...n);}
   if(length<epsilon)return face;n=n.map(v=>v/length);
   if((n.find(v=>Math.abs(v)>epsilon)||0)<0)n=n.map(v=>-v);
   const dot=q=>n[0]*q.x+n[1]*q.y+n[2]*q.z,d=dot(a);
   if(p.some(q=>Math.abs(dot(q)-d)>.002))return face;
   const key=n.map(v=>Math.round(v*10000)).join(':')+':'+Math.round(d*1000);
   let plane=planes.get(key);if(!plane){plane={cells:new Map(),large:[]};planes.set(key,plane);}
   const drop=n.findIndex(v=>Math.abs(v)===Math.max(...n.map(Math.abs))),axes=['x','y','z'].filter((_,i)=>i!==drop),xs=p.map(q=>q[axes[0]]),ys=p.map(q=>q[axes[1]]),box={x:Math.min(...xs),y:Math.min(...ys),r:Math.max(...xs),b:Math.max(...ys),rank:0};
   const x0=Math.floor(box.x/cell),x1=Math.floor(box.r/cell),y0=Math.floor(box.y/cell),y1=Math.floor(box.b/cell),large=(x1-x0+1)*(y1-y0+1)>64,candidates=new Set(plane.large);
   if(large){for(const values of plane.cells.values())for(const q of values)candidates.add(q);}else for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)for(const q of plane.cells.get(x+':'+y)||[])candidates.add(q);
   for(const q of candidates)if(box.x<q.r-epsilon&&box.r>q.x+epsilon&&box.y<q.b-epsilon&&box.b>q.y+epsilon)box.rank=Math.max(box.rank,q.rank+1);
   if(large)plane.large.push(box);else for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){const k=x+':'+y;if(!plane.cells.has(k))plane.cells.set(k,[]);plane.cells.get(k).push(box);}
   if(!box.rank)return face;
   let sign=1;const outward=face.surface?.normal;if(outward&&outward.reduce((s,v,i)=>s+v*n[i],0)<0)sign=-1;
   const lift=Math.min(box.rank,32)*.04*sign;
   return {...face,points:p.map(q=>({...q,x:q.x+n[0]*lift,y:q.y+n[1]*lift,z:q.z+n[2]*lift}))};
  });
 }
 function shadowAnchor(x,y,mapSize=1024){
  const norm=v=>{const d=Math.hypot(...v);return v.map(n=>n/d);},d=norm([-10,28,15]),r=norm([d[2],0,-d[0]]),u=[d[1]*r[2],d[2]*r[0]-d[0]*r[2],-d[1]*r[0]],p=[x,0,y],dot=v=>v.reduce((s,n,i)=>s+n*p[i],0),step=40/mapSize;
  const a=Math.round(dot(r)/step)*step,b=Math.round(dot(u)/step)*step,c=dot(d);
  return r.map((v,i)=>v*a+u[i]*b+d[i]*c);
 }
 const api={layers,shadowAnchor};if(typeof module!=='undefined')module.exports=api;else root.CityThreeStability=api;
})(typeof window!=='undefined'?window:globalThis);
