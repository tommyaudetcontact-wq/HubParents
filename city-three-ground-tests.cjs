'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ground=require('./city-three-ground'),stability=require('./city-three-stability'),C=require('./domain');
const sc={BrawlCore:C};sc.window=sc;vm.createContext(sc);vm.runInContext(fs.readFileSync('city-art.js','utf8'),sc);const faces=sc.CityArt.terrainGeometry(),before=JSON.stringify(faces),out=ground.flatten(faces),tiles=out.filter(f=>f.ground);assert.equal(JSON.stringify(faces),before);
const bounds=f=>({x:Math.min(...f.points.map(p=>p.x)),r:Math.max(...f.points.map(p=>p.x)),y:Math.min(...f.points.map(p=>p.y)),b:Math.max(...f.points.map(p=>p.y))}),boxes=tiles.map(bounds);
const disjoint=(a,b)=>[a,b].some(p=>p.some((q,i)=>{const r=p[(i+1)%p.length],axis=[-(r.y-q.y),r.x-q.x],project=v=>v.x*axis[0]+v.y*axis[1],x=a.map(project),y=b.map(project);return Math.max(...x)<=Math.min(...y)+1e-6||Math.max(...y)<=Math.min(...x)+1e-6;}));
for(let a=0;a<tiles.length;a++)for(let b=a+1;b<tiles.length;b++){const x=boxes[a],y=boxes[b];if(x.x<y.r-1e-7&&x.r>y.x+1e-7&&x.y<y.b-1e-7&&x.b>y.y+1e-7)assert(disjoint(tiles[a].points,tiles[b].points),'ground interiors never overlap');}
const inside=(f,x,y)=>{const p=f.points,sign=Math.sign(ground.area(p));return p.every((a,i)=>{const b=p[(i+1)%p.length];return ((b.x-a.x)*(y-a.y)-(b.y-a.y)*(x-a.x))*sign>=-1e-7;});},source=faces.filter(ground.polygon);
let seed=17;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
for(let n=0;n<12000;n++){const x=-7605+random()*12130,y=-1325+random()*5250,expected=source.findLast(f=>inside(f,x,y)),actual=tiles.find((f,i)=>x>=boxes[i].x&&x<=boxes[i].r&&y>=boxes[i].y&&y<=boxes[i].b&&inside(f,x,y));assert.equal(actual?.color,expected?.color,'2D paint order including octagonal circuit retained');}
for(const f of faces.filter(f=>!ground.polygon(f)))assert(out.includes(f),'ramps and raised surfaces retained');
const quad={points:[{x:0,y:0,z:0},{x:10,y:0,z:0},{x:10,y:10,z:0},{x:0,y:10,z:0}]};const stack=stability.layers(Array(80).fill(quad));assert.equal(new Set(stack.map(f=>f.points[0].z)).size,80,'decal layers never saturate at 32');
console.log('Real city ground: '+faces.length+' paint faces -> '+tiles.length+' disjoint polygons; 12,000 colour samples match including circuit, raised geometry retained, 80 decal layers distinct.');
