'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const T=require('./vendor/three.min.js'),C=require('./domain.js'),{createCanvas}=require('C:/Users/recto/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas');
const scope={THREE:T,BrawlCore:C,atob,document:{createElement:()=>createCanvas(1,1),addEventListener(){},querySelectorAll:()=>[],getElementById:()=>null}};scope.window=scope;vm.createContext(scope);
for(const file of ['construction.js','apartment.js','character-art.js','character-rig.js','assets3d/brawl-character.js','city-three-character-identity.js','city-three-original-character.js'])vm.runInContext(fs.readFileSync(file,'utf8'),scope,{filename:file});
const I=scope.CityThreeIdentity,R=scope.CharacterRig,V=scope.CityThreeCharacter,materials=new Map(),ctx={S:.04,material(color){if(!materials.has(color))materials.set(color,new T.MeshStandardMaterial({color}));return materials.get(color);}},faces=new Set();
const required={'riff-nocturne':['cap','glasses'],'spectre-minuit':['hood','garment-skirt'],'ensorceleuse-prune':['witch-hat','garment-skirt'],'dame-haut-de-forme':['hat-crown','cape'],'veilleur-ardoise':['mask-ear','cape'],'princesse-rosee':['crown-point','garment-skirt'],'sentinelle-olive':['gold-visor','body-armor'],'mascotte-tropicale':['animal-ear','animal-muzzle']};
for(const skin of C.skins){
 const member={skin:skin.id,useCustomAppearance:false},source=R.source(member),before=source.front.toBuffer('image/png'),visual=V.create(ctx,member,source),parts=[];
 for(const q of [R.joints3d(),R.joints3d({moving:true,phase:1.3}),R.joints3d({riding:'scooter'})]){visual.update(V.retarget(q),{rigScale:.3},null);visual.group.updateMatrixWorld(true);visual.group.traverse(o=>{assert(o.matrixWorld.elements.every(Number.isFinite),skin.id);if(o.isMesh)assert([...o.geometry.attributes.position.array].every(Number.isFinite),skin.id);});}
 const face=visual.group.getObjectByName('original-face');assert(face,skin.id+' must use the original facial design');assert.equal(face.material.side,T.FrontSide,'Faces must not be visible through the rear of a head');faces.add(crypto.createHash('sha256').update(face.material.map.image.toBuffer('image/png')).digest('hex'));
 visual.group.traverse(o=>{parts.push(o.name,...(o.userData.parts||[]));});for(const part of required[skin.signature]||[])assert(parts.includes(part),skin.id+' lost '+part);
 if(skin.signature)assert(I.signatures.includes(skin.signature),'Missing costume definition '+skin.signature);
 assert.deepEqual(source.front.toBuffer('image/png'),before,'3D texturing must leave the original 2D art untouched');
 let calls=0;visual.group.traverse(o=>{if(o.isMesh&&o.visible)calls++;});assert(calls<30,skin.id+' excessive costume draw calls: '+calls);
 if(skin.signature==='spectre-minuit'){visual.update(V.retarget(R.joints3d()),{rigScale:.3},null);visual.group.updateMatrixWorld(true);const hits=new T.Raycaster(new T.Vector3(0,1.28,2),new T.Vector3(0,0,-1)).intersectObject(visual.group,true);assert(hits.length);assert.notEqual(hits[0].object.name,'original-face','The hood must obscure the mask from the rear');}
}
assert(faces.size>28,'Distinct original characters must not collapse into a generic face');
const hairShapes=new Set();for(let n=0;n<20;n++){const member={skin:'skin-neutral',useCustomAppearance:true,appearance:{...C.appearanceDefaults(),hair:'hair-'+n}},source=R.source(member),v=V.create(ctx,member,source);let count=0;v.group.traverse(o=>{if(o.isMesh)count+=o.geometry.attributes.position.count;});hairShapes.add(count);}
assert(hairShapes.size>=10,'Owned hairstyles need genuinely different volumes');
console.log('32 original skins: preserved 2D artwork, distinct face textures, costume landmarks, finite animated geometry, rear mask occlusion and bounded draw calls. Twenty hair choices retain varied silhouettes.');
