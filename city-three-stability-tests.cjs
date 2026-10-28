'use strict';
const assert=require('node:assert/strict'),{layers,shadowAnchor}=require('./city-three-stability.js');
const quad=(x,y,w,h,z=0)=>({color:'#abc',points:[{x,y,z},{x:x+w,y,z},{x:x+w,y:y+h,z},{x,y:y+h,z}]});
const faces=[quad(0,0,10000,10000),quad(10,10,30,30),quad(10,10,10,10),quad(100,100,20,20)],saved=JSON.stringify(faces),out=layers(faces);
assert.equal(JSON.stringify(faces),saved);assert.equal(out[0].points[0].z,0);assert.equal(out[1].points[0].z,.04);assert.equal(out[2].points[0].z,.08);assert.equal(out[3].points[0].z,.04);
// Adjacent paving tiles must not climb a staircase as their source index grows.
const paving=Array.from({length:10000},(_,i)=>quad((i%100)*10,Math.floor(i/100)*10,10,10));assert(layers(paving).every(f=>f.points.every(p=>p.z===0)));
// The same layering works on the rear wall, in its outward direction.
const wall={surface:{normal:[0,-1,0]},points:[{x:0,y:5,z:0},{x:10,y:5,z:0},{x:10,y:5,z:10},{x:0,y:5,z:10}]};assert.equal(layers([wall,wall])[1].points[0].y,4.96);
const d=[-10,28,15],r=[15,0,10],len=Math.hypot(...r);for(let i=0;i<3;i++)r[i]/=len;const u=[28*r[2],15*r[0]+10*r[2],-28*r[0]],ul=Math.hypot(...u);for(let i=0;i<3;i++)u[i]/=ul;
let origin=shadowAnchor(0,0),moved=shadowAnchor(.00001,.00001);for(const axis of [r,u])assert(Math.abs(origin.reduce((s,n,i)=>s+(n-moved[i])*axis[i],0))<1e-10,'Subpixel movement must not scroll the shadow texture');
for(const p of [[0,0],[1000,-2000],[-110,.5]])assert(shadowAnchor(...p).every(Number.isFinite));
console.log('Stable coplanar paint layers: 10,000 adjacent tiles, outward walls, no input mutation; texel-aligned shadow projection passed.');
