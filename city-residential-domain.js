'use strict';
(function(C){
 const M=C.cityMap,coreX=[100,650,1200,1750],coreY=[100,550,1000,1450],X=[2050,2600,3150,3700,4250],Y=[2850,3300,3750],segments=[];
 const edge=(x,y,u,v)=>segments.push({a:{x,y},b:{x:u,y:v}});
 for(const x of coreX)for(let n=1;n<coreY.length;n++)edge(x,coreY[n-1],x,coreY[n]);
 for(const y of coreY)for(let n=1;n<coreX.length;n++)edge(coreX[n-1],y,coreX[n],y);
 edge(1750,1450,1750,2850);edge(1750,2850,2050,2850);
 for(const x of X)for(let n=1;n<Y.length;n++)edge(x,Y[n-1],x,Y[n]);
 for(const y of Y)for(let n=1;n<X.length;n++)edge(X[n-1],y,X[n],y);
 M.residential={x:1980,y:2780,w:2340,h:1040,roads:segments.slice(24),lots:Array.from({length:8},(_,n)=>({id:'lot-'+n,n,npc:n<2,x:X[n%4]+90,y:Y[Math.floor(n/4)]+90,w:370,d:300,house:{x:X[n%4]+105,y:Y[Math.floor(n/4)]+105,w:245,d:170,h:66,color:['#e5ceb0','#a9c4c4','#cfb5bd','#e1d6bb'][n%4],roof:['#6a7e83','#817080','#718677','#8c7770'][n%4]}}))};
 M.roadsX=[...new Set([...M.roadsX,...X])];M.roadsY=[...new Set([...M.roadsY,...Y])];
 const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),snap=p=>{let best=null;for(const e of segments){const dx=e.b.x-e.a.x,dy=e.b.y-e.a.y,t=Math.max(0,Math.min(1,((p.x-e.a.x)*dx+(p.y-e.a.y)*dy)/(dx*dx+dy*dy))),q={x:e.a.x+dx*t,y:e.a.y+dy*t},d=distance(p,q);if(!best||d<best.d)best={...q,d};}return {x:best.x,y:best.y};};
 C.cityRoadSnap=snap;
 C.cityRoute=(origin,target)=>{const start=snap(origin),end=snap(target),nodes=[],add=p=>{let n=nodes.findIndex(q=>distance(q,p)<.01);if(n<0){n=nodes.length;nodes.push({...p});}return n;};segments.forEach(e=>{add(e.a);add(e.b);});const a=add(start),b=add(end),links=nodes.map(()=>[]);for(const e of segments){const list=nodes.map((p,n)=>({p,n})).filter(({p})=>Math.abs((p.x-e.a.x)*(e.b.y-e.a.y)-(p.y-e.a.y)*(e.b.x-e.a.x))<.01&&p.x>=Math.min(e.a.x,e.b.x)-.01&&p.x<=Math.max(e.a.x,e.b.x)+.01&&p.y>=Math.min(e.a.y,e.b.y)-.01&&p.y<=Math.max(e.a.y,e.b.y)+.01).sort((u,v)=>distance(e.a,u.p)-distance(e.a,v.p));for(let n=1;n<list.length;n++){const u=list[n-1].n,v=list[n].n;links[u].push(v);links[v].push(u);}}const cost=nodes.map(()=>Infinity),prev=[],done=new Set();cost[a]=0;while(done.size<nodes.length){let u=-1;for(let n=0;n<nodes.length;n++)if(!done.has(n)&&(u<0||cost[n]<cost[u]))u=n;if(u<0||!Number.isFinite(cost[u])||u===b)break;done.add(u);for(const v of links[u]){const next=cost[u]+distance(nodes[u],nodes[v]);if(next<cost[v]){cost[v]=next;prev[v]=u;}}}const route=[];for(let n=b;n!==undefined;n=prev[n])route.unshift({...nodes[n]});return route;};
 const trafficRoute=C.cityTrafficRoute;C.cityTrafficRoute=(seed,cycle=0,origin={x:100,y:100})=>{const route=trafficRoute(seed,cycle,origin),waypoints=cycle%2?[{x:2050,y:3750},{x:4250,y:3750},{x:4250,y:2850}]:[{x:4250,y:2850},{x:4250,y:3750},{x:2050,y:3750}];let last=route.at(-1);for(const target of [...waypoints,{x:1750,y:1450}]){route.push(...C.cityRoute(last,target).slice(1));last=target;}return route;};
 C.cityPlaces.push({id:'residential',name:'Les Jardins · quartier résidentiel',x:2050,y:2850},{id:'hockey',name:'Aréna des Jardins · hockey 3 contre 3',x:4370,y:2710});
 C.residentialSegments=segments;
})(typeof BrawlCore!=='undefined'?BrawlCore:require('./domain.js'));
