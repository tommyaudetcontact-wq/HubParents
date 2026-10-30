'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
// Run the existing gameplay assertions with the renderer reported active. This catches
// presentation guards accidentally placed in the shared tick rather than the painter.
const inventory=fs.readFileSync('city-inventory-tests.cjs','utf8').replace('const api=scope.CityInventory;',"scope.CityThree={active:()=>true};scope.CityThreeWeaponFX={handles:()=>true};const api=scope.CityInventory;");
vm.runInNewContext(inventory,{require,console,process,Buffer},{filename:'inventory-in-active-3d.cjs'});
const prefix=inventory.split('const h=fixture();')[0];
vm.runInNewContext(prefix+`
const kinds=['smg','soccer','bubble','rage','gravity','blackhole','dance','soldiers','beer','poop','lease','belch','hammer'];
for(const kind of kinds){const a=fixture(),b=fixture();b.scope.CityThree.active=()=>false;for(const f of [a,b]){f.a.inventoryItem=kind;f.b.y=f.ped.y=f.car.y=1000;assert(f.api.request());}const clean=f=>JSON.stringify(f.api.inspect().shots.map(({id,local,...q})=>q));for(let n=0;n<900;n++){a.api.tick(.02);b.api.tick(.02);assert.equal(clean(a),clean(b),kind+' must simulate identically in 2D and active 3D');}assert.equal(a.api.inspect().shots.length,0,kind+' must finish instead of freezing');}
console.log('13 weapon lifecycles: identical shared trajectories, delays and expiry with active 3D versus 2D.');
`,{require,console,process,Buffer},{filename:'weapon-renderer-parity.cjs'});
const scope={CityThree:{renderMini(){}},BrawlCore:{}};scope.window=scope;vm.createContext(scope);vm.runInContext(fs.readFileSync('city-three-games.js','utf8'),scope);
for(const kind of ['zombie','laser','hockey','fight','street-rage','tennis','sumo']){const p={hp:100,input:{x:.3,y:-.4}},saved=JSON.stringify(p),m=scope.CityThreeGames.motion(p,{kind});assert(Math.hypot(m.vx,m.vy)>40,kind+' analog movement must animate');assert.equal(JSON.stringify(p),saved);const stop=scope.CityThreeGames.motion({...p,ragdoll:1},{kind});assert.equal(stop.vx,0);assert.equal(stop.vy,0);}
console.log('Minigame presentation: analog walk/jog velocities, incapacitation and immutable player state passed.');

