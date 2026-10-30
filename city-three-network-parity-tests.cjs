'use strict';
const fs=require('node:fs'),vm=require('node:vm');
// Real City clients, input queues and host snapshots; only the GPU is omitted.
// Keep the 3D-active branches enabled, including zombie stick conversion and toy ticks.
let source=fs.readFileSync('city-multiplayer-sync-tests.cjs','utf8');
source=source.replace('sc.window=sc;vm.createContext(sc);',"sc.CityThree={active:()=>true,hide(){}};sc.CityThreeWeaponFX={handles:()=>true};sc.window=sc;vm.createContext(sc);");
source=source.replace("process.env.CITY_NETWORK_STRESS==='1'",'true');
vm.runInNewContext(source,{require,console,process,structuredClone,Buffer},{filename:'six-city-clients-with-3d-active.cjs'});
console.log('3D-active network parity: six clients, variable latency, walking, driving, weapons, minigames and host migration passed without a GPU dependency.');
