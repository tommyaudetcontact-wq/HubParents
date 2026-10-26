"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),C=require('./domain');
C.setCityStandalone(true);let html='',page='home',catalog=false,closed=0,backCatalogue=0;const events={};
const modal={open:true,querySelector:()=>page?{dataset:{hubPage:page}}:null};
const sc={BrawlCore:C,App:{profile:()=>({id:'ui'}),popup:h=>html=h,closeModal:()=>{modal.open=false;closed++;},catalogOpen:()=>catalog,backCityCatalog:()=>{catalog=false;backCatalogue++;}},CityNetwork:{room:()=>null},document:{getElementById:id=>id==='modal'?modal:null,addEventListener:(n,f)=>(events[n]??=[]).push(f)}};sc.window=sc;vm.createContext(sc);
vm.runInContext(fs.readFileSync('city-navigation.js','utf8'),sc);vm.runInContext(fs.readFileSync('city-ui.js','utf8'),sc);
sc.CityNavigation.mount({stop(){}});sc.App.popup=h=>{html=h;page=/<section[^>]+data-hub-page="([^"]+)"/.exec(h)?.[1]||null;};
sc.CityNavigation.menu('sports');assert(sc.CityUI.back());assert.equal(page,'activities');assert(sc.CityUI.back());assert.equal(page,'home');assert.equal(sc.CityUI.back(),false,'At root, native/gamepad back may close the menu');
page=null;catalog=true;assert(sc.CityUI.back());assert.equal(closed,1,'A product dialog returns to its catalogue without losing the city');assert(catalog);
modal.open=false;assert(sc.CityUI.back());assert.equal(backCatalogue,1,'Native back navigates the catalogue before leaving it');
for(const category of ['vehicles','style','furniture','cards','companions'])assert(sc.CityUI.catalogHome().includes('data-arg="shop/'+category+'"'));
assert(sc.CityUI.roomsHTML('bath').includes('aria-pressed="true"'));assert.deepEqual(Array.from(sc.CityUI.roomKinds('bath')),['bath','shower','sink','toilet']);assert.equal(sc.CityUI.roomKinds('unknown').length,0);
sc.CityNavigation.menu('settings');for(const name of ['Contrôle parental','Mises à jour','Sons','Déconnexion'])assert(html.includes(name));
// A drawer category must open the inventory, even after the global close-tools listener runs.
const inventory={hidden:true,innerHTML:'',querySelector:()=>null,querySelectorAll:()=>[]},stage={classList:{add(){},toggle(){},remove(){},contains:()=>false}},apt={c:{parentElement:stage},mode:'furnish'},profile=C.upgrade(C.makeProfile('drawer','Test',4));profile.inventory=[];
sc.document.getElementById=id=>id==='room-controls'?inventory:null;sc.document.querySelector=()=>null;sc.document.querySelectorAll=()=>[];sc.App.toast=message=>{throw Error(message);};sc.App.apartment=()=>apt;sc.App.profile=()=>profile;sc.Apartment={prototype:{setMode(){},click(){}}};sc.HouseDraft={paint(){}};sc.setInterval=()=>1;sc.queueMicrotask=()=>{};
vm.runInContext(fs.readFileSync('sim-house-ui.js','utf8'),sc);const group={dataset:{sim:'inventory-group',arg:'bath'}},target={closest:selector=>selector==='[data-sim]'||selector.includes('[data-sim="inventory-group"]')||selector==='#sim-drawer'||selector==='button'?group:null};for(const click of events.click)click({target});assert.equal(inventory.hidden,false,'Selecting a category must not immediately hide the inventory');assert(inventory.innerHTML.includes('Rechercher dans mes meubles'));
C.setCityStandalone(false);assert.equal(sc.CityUI.back(),false,'The legacy platform keeps its own navigation');console.log('City menus: every catalogue category, bathroom grouping, nested back navigation, safe product-dialog return, catalogue back, account/parental controls and legacy isolation passed.');
