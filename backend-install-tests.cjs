'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path');
process.chdir(__dirname);let count=0;
const test=(name,fn)=>{fn();count++;console.log('✓ '+name);};
class Sheet{
 constructor(){this.rows=[];}
 appendRow(r){this.rows.push([...r]);return this;}
 getLastRow(){return this.rows.length;}
 setFrozenRows(n){this.frozen=n;return this;}
 autoResizeColumns(){return this;}
 getDataRange(){return {getValues:()=>this.rows.map(r=>r.slice())};}
 getRange(row,col,n=1,m=1){const range={getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>this.rows[row-1+i]?.[col-1+j]??'')),setValues:values=>{values.forEach((r,i)=>{this.rows[row-1+i]??=[];r.forEach((v,j)=>this.rows[row-1+i][col-1+j]=v);});return range;},setBackground:()=>range,setFontColor:()=>range,setFontWeight:()=>range};return range;}
}
function fixture(){
 const sheets={},props=new Map(),logs=[];let locked=false;
 const db={getId:()=>'blank-sheet',getSheetByName:n=>sheets[n],insertSheet:n=>sheets[n]=new Sheet(),setSpreadsheetTimeZone:tz=>db.timezone=tz};
 const context={console:{log:s=>logs.push(s),error:s=>logs.push(s)},Date,Math,Intl,Map,Set,JSON,Error,Number,String,Array,RegExp,
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k),setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k)})},
 Utilities:{DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,s)=>crypto.createHash('sha256').update(s).digest(),base64Encode:b=>Buffer.from(b).toString('base64'),getUuid:()=>crypto.randomUUID(),computeHmacSha256Signature:(s,k)=>crypto.createHmac('sha256',k).update(s).digest(),formatDate:()=> '2026-10-16'},
 LockService:{getScriptLock:()=>({waitLock:()=>locked=true,hasLock:()=>locked,releaseLock:()=>locked=false})},
 CacheService:{getScriptCache:()=>({get:()=>null,put:()=>{}})},SpreadsheetApp:{getActiveSpreadsheet:()=>db,openById:()=>db,flush:()=>{}},
 ContentService:{MimeType:{JSON:'json'},createTextOutput:s=>({setMimeType:()=>s})}};
 vm.createContext(context);vm.runInContext(fs.readFileSync('Code-complet.gs','utf8'),context);
 return {context,sheets,props,logs,db,locked:()=>locked};
}
test('Le fichier unique contient exactement les huit modules actuels',()=>{const combined=fs.readFileSync('Code-complet.gs','utf8').replace(/\r\n/g,'\n');for(const n of ['Domain.gs','Handwriting.gs','Trades.gs','Accounts.gs','Lobby.gs','Auth.gs','Stats.gs','Code.gs'])assert(combined.includes(fs.readFileSync('backend/'+n,'utf8').replace(/\r\n/g,'\n')),n);new vm.Script(combined);});
test('Feuille vierge : quinze onglets, en-têtes, fuseau et aucun enfant fictif',()=>{const f=fixture();f.context.initializeBrawl();assert.equal(Object.keys(f.sheets).length,15);for(const s of Object.values(f.sheets)){assert.equal(s.rows.length,1);assert.equal(s.frozen,1);}assert.equal(f.props.get('DB_ID'),'blank-sheet');assert.equal(f.props.get('DB_SCHEMA'),'3');assert.equal(f.db.timezone,'America/Toronto');assert.equal(f.locked(),false);assert(f.logs.some(s=>s.startsWith('CLÉ PARENT')));});
test('Réinstallation : conservation des clés et des lignes existantes',()=>{const f=fixture();f.context.initializeBrawl();f.sheets.Profils.appendRow(['enfant','Prénom',4,'{}','date']);const key=f.props.get('PARENT_HASH');f.context.initializeBrawl();assert.equal(f.props.get('PARENT_HASH'),key);assert.equal(f.sheets.Profils.rows.length,2);assert.equal(f.logs.filter(s=>s.startsWith('CLÉ PARENT')).length,1);});
test('Onglet existant vide : initialisé ; onglet incompatible : refus sans remplacement',()=>{const f=fixture();f.sheets.Profils=new Sheet();f.context.initializeBrawl();assert.equal(f.sheets.Profils.rows[0][0],'id');const bad=fixture();bad.sheets.Journal=new Sheet();bad.sheets.Journal.appendRow(['ancienne colonne']);assert.throws(()=>bad.context.initializeBrawl(),/incompatibles/);assert.equal(Object.keys(bad.sheets).length,1);assert.equal(bad.sheets.Journal.rows[0][0],'ancienne colonne');assert.equal(bad.locked(),false);assert(!bad.props.has('DB_ID'));});
test('Refus de relier silencieusement le projet à une autre feuille',()=>{const f=fixture();f.props.set('DB_ID','other');assert.throws(()=>f.context.initializeBrawl(),/autre feuille/);assert.equal(Object.keys(f.sheets).length,0);});
test('Statut public sans secret et création parent du premier vrai compte',()=>{const f=fixture();assert.equal(JSON.parse(f.context.doGet()).installed,false);f.context.initializeBrawl();const status=JSON.parse(f.context.doGet());assert.equal(status.installed,true);assert.equal(status.version,15);assert(!JSON.stringify(status).includes(f.props.get('PARENT_HASH')));const parentKey=f.logs.find(s=>s.startsWith('CLÉ PARENT')).split(' : ')[1];const call=req=>JSON.parse(f.context.doPost({postData:{contents:JSON.stringify({player:'__parent__',...req})}}));assert.equal(call({action:'familyCreate',parentToken:'wrong',childId:'lea',patch:{name:'Léa',grade:4}}).ok,false);const created=call({action:'familyCreate',parentToken:parentKey,childId:'lea',patch:{name:'Léa',grade:4}});assert.equal(created.ok,true,created.error);assert(created.childKey);assert.equal(created.profiles.length,1);const state=call({action:'state',player:'lea',token:created.childKey});assert.equal(state.ok,true,state.error);assert.equal(state.profile.name,'Léa');assert.equal(f.locked(),false);});
test('GitHub Pages : URL publique configurée, assets relatifs et sans compilation',()=>{const config=fs.readFileSync('dist/config.js','utf8'),html=fs.readFileSync('dist/index.html','utf8');assert(config.includes('AKfycbziXa-o9976ZENF-xSvwYBgdQsdQmfhydRLGzo3aC6DCmqnSvjr2ccOSFfvPPEBDpyv'));assert(!/parentToken|childKey/.test(config));assert(html.indexOf('src="config.js"')<html.indexOf('src="app.js"'));assert(fs.existsSync('dist/.nojekyll'));for(const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)){assert(!match[1].startsWith('/'));if(!match[1].includes(':'))assert(fs.existsSync(path.join('dist',match[1])),match[1]);}});
console.log(count+' groupes de tests installation réussis. Google et GitHub simulés ; aucune connexion externe.');
