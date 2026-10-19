process.chdir(__dirname);
const assert=require('node:assert/strict'),R=require('./dist/handwriting-engine.js');let count=0;
function test(n,f){f();count++;console.log('✓ '+n);}
// Tracés de test indépendants des modèles du moteur.
const A=[[[20,88],[35,50],[51,12],[65,50],[82,90]],[[33,57],[49,58],[68,57]]];
const seven=[[[22,14],[48,13],[78,14],[69,32],[55,58],[39,89]]];
const one=[[[37,28],[52,13],[51,50],[50,90]]];
const circle=[Array.from({length:41},(_,i)=>[50+28*Math.cos(i/40*Math.PI*2),50+39*Math.sin(i/40*Math.PI*2)])];
test('Reconnaît une lettre détachée écrite en plusieurs traits',()=>{const r=R.evaluate(A,'A');assert(r.accepted,JSON.stringify(r));assert.equal(r.recognized,'A');});
test('Ordre et sens des traits indépendants de la reconnaissance',()=>{assert(R.evaluate(A.slice().reverse().map(s=>s.slice().reverse()),'A').accepted);});
test('Translation, taille et petites irrégularités tolérées',()=>{const small=A.map(s=>s.map(([x,y],i)=>[x*.65+11+(i%2)*.7,y*.65+12]));assert(R.evaluate(small,'A').accepted);});
test('Refuse une autre lettre plutôt que valider la cible attendue',()=>{const r=R.evaluate(A,'H');assert(!r.accepted);assert.equal(r.recognized,'A');});
test('Un A sans barre centrale reste à compléter',()=>{assert(!R.evaluate([A[0]],'A').accepted);});
test('Distingue les chiffres 1, 7 et 0',()=>{assert(R.evaluate(one,'1').accepted);assert(R.evaluate(seven,'7').accepted);assert(R.evaluate(circle,'0').accepted);assert(!R.evaluate(seven,'1').accepted);assert(!R.evaluate(circle,'8').accepted);});
test('Une case vide, un point et une page griffonnée sont refusés',()=>{assert(!R.evaluate([],'A').accepted);assert(!R.evaluate([[[50,50]]],'A').accepted);const zig=[Array.from({length:90},(_,i)=>[i%2?90:10,5+i])];assert(!R.evaluate(zig,'A').accepted);});
test('Un mot/nombre est vérifié caractère par caractère',()=>{const good=R.evaluateWord([one,seven,circle],'170');assert(good.accepted,JSON.stringify(good));const bad=R.evaluateWord([one,circle,circle],'170');assert(!bad.accepted);assert(bad.results[0].accepted);assert(!bad.results[1].accepted);assert(bad.results[2].accepted);});
test('Les points et accents manquants ne sont pas ignorés',()=>{const iWithoutDot=[[[50,36],[50,89]]];assert(!R.evaluate(iWithoutDot,'i').accepted);const plainE=[[[23,61],[76,61],[73,46],[57,35],[41,36],[25,48],[22,65],[29,82],[46,89],[63,86],[75,78]]];assert(R.evaluate(plainE,'e').accepted);assert(!R.evaluate(plainE,'é').accepted);const accented=plainE.concat([[[44,17],[58,5]]]);assert(R.evaluate(accented,'é').accepted);});
test('Points invalides, surcharges et mots non pris en charge refusés',()=>{assert.throws(()=>R.evaluate([[[Infinity,5]]],'A'));assert.throws(()=>R.evaluateWord([A],'AA'));assert.throws(()=>R.evaluateWord(Array(17).fill(A),'A'.repeat(17)));assert(!R.evaluate(A,'@').accepted);});
test('La compression des points préserve la forme envoyée au serveur',()=>{const dense=A.map(s=>s.flatMap((a,i)=>{if(!i)return [a];const b=s[i-1];return Array.from({length:40},(_,j)=>[b[0]+(a[0]-b[0])*(j+1)/40,b[1]+(a[1]-b[1])*(j+1)/40]);}));const reduced=R.compact(dense);assert(reduced.every(s=>s.length<=30));assert(R.evaluate(reduced,'A').accepted);});
test('L’atelier se rend sans dépendre d’un profil global initialisé et propose les mots par cases',()=>{const vm=require('node:vm'),fs=require('node:fs'),C=require('./dist/domain.js'),listeners=[];const scope={window:{},document:{addEventListener:(type,f)=>listeners.push(type)},HandwritingRecognizer:R,BrawlCore:C,Date,Intl,crypto:require('node:crypto').webcrypto};vm.createContext(scope);vm.runInContext(fs.readFileSync('./dist/handwriting-ui.js','utf8'),scope);const ui=scope.window.HandwritingUI,p=C.upgrade(C.makeProfile('test','Test',4));assert(ui.html(p).includes('hw-pad-0'));ui.setKind('word');const html=ui.html(p);assert.equal((html.match(/id="hw-pad-/g)||[]).length,4);assert(html.includes('une lettre dans chaque case'));ui.setKind('digit');assert(ui.html(p).includes('Écrire 0'));assert(listeners.includes('change')&&listeners.includes('click')&&listeners.includes('submit'));});
console.log(count+' groupes de tests de reconnaissance réussis.');
