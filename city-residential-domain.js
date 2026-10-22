'use strict';
(function(C){
 if(Object.prototype.hasOwnProperty.call(C,'configureResidential'))return;
 const M=C.cityMap,coreX=[100,650,1200,1750],coreY=[100,550,1000,1450],segments=[];
 const edge=(x,y,u,v)=>segments.push({a:{x,y},b:{x:u,y:v}});
 const colors=['#e5ceb0','#a9c4c4','#cfb5bd','#e1d6bb'],roofs=['#6a7e83','#817080','#718677','#8c7770'];
 M.minX=-7580;M.residential={layoutVersion:3,revision:'',roads:[],lots:[],entry:{x:-300,y:1000}};
 C.configureResidential=(members=[])=>{const homes=members.slice(0,6).sort((a,b)=>a.id.localeCompare(b.id)),key=JSON.stringify(homes.map(h=>[h.id,h.size]));if(M.residential.revision===key)return false;const lots=Array.from({length:8},(_,n)=>{const owner=n>=2?homes[n-2]:null,extent=owner?Math.max(7,Math.min(40,owner.size||14))*40:0,w=extent||325,d=extent||305;return {id:'lot-'+n,n,npc:n<2,owner:owner?.id||null,w,d,extent,house:{w:245,d:170,h:76,color:colors[n%4],roof:roofs[n%4]}};});
 const rowWidths=[0,1].map(row=>lots.slice(row*4,row*4+4).reduce((sum,l)=>sum+l.w+32,0)),left=-300-Math.max(...rowWidths)-160,ys=[100];
 for(let row=0;row<2;row++){const group=lots.slice(row*4,row*4+4),front=ys[row]+Math.max(...group.map(l=>l.d))+160;ys.push(front);let right=-380;for(const l of group){l.x=right-l.w;l.y=front-80-l.d;l.frontY=front;l.house.x=l.x+(l.w-l.house.w)/2;l.house.y=front-160-l.house.d;right=l.x-32;}}
 segments.length=0;for(const x of coreX)for(let n=1;n<coreY.length;n++)edge(x,coreY[n-1],x,coreY[n]);for(const y of coreY)for(let n=1;n<coreX.length;n++)edge(coreX[n-1],y,coreX[n],y);
 edge(100,100,-300,100);
 const junctions=ys;for(const x of [left,-300])for(let n=1;n<junctions.length;n++)edge(x,junctions[n-1],x,junctions[n]);for(const y of ys)edge(left,y,-300,y);
 Object.assign(M.residential,{revision:key,x:left-80,y:20,w:-220-(left-80),h:Math.max(ys.at(-1),1000)+60,roads:segments.slice(24),lots,streetX:[left,-300],streetY:ys});M.roadsX=[...coreX,left,-300];M.roadsY=[...new Set([...coreY,...junctions])];return true;
 };
 C.configureResidential();
 const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),snap=p=>{let best=null;for(const e of segments){const dx=e.b.x-e.a.x,dy=e.b.y-e.a.y,t=Math.max(0,Math.min(1,((p.x-e.a.x)*dx+(p.y-e.a.y)*dy)/(dx*dx+dy*dy))),q={x:e.a.x+dx*t,y:e.a.y+dy*t},d=distance(p,q);if(!best||d<best.d)best={...q,d};}return {x:best.x,y:best.y};};
 C.cityRoadSnap=snap;
 C.cityRoute=(origin,target)=>{const start=snap(origin),end=snap(target),nodes=[],add=p=>{let n=nodes.findIndex(q=>distance(q,p)<.01);if(n<0){n=nodes.length;nodes.push({...p});}return n;};segments.forEach(e=>{add(e.a);add(e.b);});const a=add(start),b=add(end),links=nodes.map(()=>[]);for(const e of segments){const list=nodes.map((p,n)=>({p,n})).filter(({p})=>Math.abs((p.x-e.a.x)*(e.b.y-e.a.y)-(p.y-e.a.y)*(e.b.x-e.a.x))<.01&&p.x>=Math.min(e.a.x,e.b.x)-.01&&p.x<=Math.max(e.a.x,e.b.x)+.01&&p.y>=Math.min(e.a.y,e.b.y)-.01&&p.y<=Math.max(e.a.y,e.b.y)+.01).sort((u,v)=>distance(e.a,u.p)-distance(e.a,v.p));for(let n=1;n<list.length;n++){const u=list[n-1].n,v=list[n].n;links[u].push(v);links[v].push(u);}}const cost=nodes.map(()=>Infinity),prev=[],done=new Set();cost[a]=0;while(done.size<nodes.length){let u=-1;for(let n=0;n<nodes.length;n++)if(!done.has(n)&&(u<0||cost[n]<cost[u]))u=n;if(u<0||!Number.isFinite(cost[u])||u===b)break;done.add(u);for(const v of links[u]){const next=cost[u]+distance(nodes[u],nodes[v]);if(next<cost[v]){cost[v]=next;prev[v]=u;}}}const route=[];for(let n=b;n!==undefined;n=prev[n])route.unshift({...nodes[n]});return route;};
 const trafficRoute=C.cityTrafficRoute;C.cityTrafficRoute=(seed,cycle=0,origin={x:100,y:100})=>{const route=trafficRoute(seed,cycle,origin),m=M.residential,left=m.streetX[0],bottom=m.streetY.at(-1),waypoints=cycle%2?[{x:left,y:100},{x:left,y:bottom},{x:-300,y:bottom}]:[{x:-300,y:bottom},{x:left,y:bottom},{x:left,y:100}];let last=route.at(-1);for(const target of [...waypoints,{x:1750,y:1450}]){route.push(...C.cityRoute(last,target).slice(1));last=target;}return route;};
 C.cityPlaces.push({id:'residential',name:'Les Jardins · quartier résidentiel',x:-300,y:1000},{id:'hockey',name:'Aréna des Jardins · hockey 3 contre 3',x:4370,y:2710});
 C.residentialSegments=segments;
})(typeof BrawlCore!=='undefined'?BrawlCore:require('./domain.js'));
