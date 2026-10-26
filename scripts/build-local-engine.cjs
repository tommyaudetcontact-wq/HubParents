/* Rebuild the async server adapter from the reviewed domain and Apps Script sources.
 * npm install --prefix <tools-dir> acorn@8 astring@1
 * node scripts/build-local-engine.cjs
 */
const fs=require('node:fs'),path=require('node:path');
let buildRequire=require;try{buildRequire.resolve('acorn');buildRequire.resolve('astring');}catch{buildRequire=require('node:module').createRequire(path.join(__dirname,'../.private/build-tools/resolve.cjs'));}const {parse}=buildRequire('acorn'),{generate}=buildRequire('astring');
const root=path.resolve(__dirname,'..'),out=path.join(root,'backend-engine');
const read=name=>fs.readFileSync(path.join(root,'backend',name+'.gs'),'utf8').replace(/\r\n/g,'\n');
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'package.json'),JSON.stringify({type:'module'})+'\n');const domain=read('Domain');
fs.writeFileSync(path.join(out,'domain.js'),domain+'\nexport { BrawlCore };\n');
const handwriting=read('Handwriting'),handlerStart=handwriting.indexOf('function handleWritingCheck');
if(handlerStart<0)throw Error('Missing handwriting handler');
const source=['Code','Auth','Accounts','Lobby','Stats','Trades','City','CityActivities','CityLiving','CityFire','WordLists'].map(read).join('\n')+'\n'+handwriting.slice(handlerStart);
const ast=parse(source,{ecmaVersion:'latest',sourceType:'script'});
// Installation helpers remain in GAS. They cannot be called by an API action.
const skip=new Set(['initializeBrawl','createPlayer','rotateParentKey','rotatePlayerKey','archiveLegacyWorkbook']);
ast.body=ast.body.filter(n=>!(n.type==='FunctionDeclaration'&&skip.has(n.id.name)));
// These overrides store large profiles directly in SQLite, without Sheet fragments.
ast.body=ast.body.filter(n=>!(n.type==='FunctionDeclaration'&&['encodeProfile','sheetText'].includes(n.id.name)));
const names=new Set();
function walk(n,visit){if(!n||typeof n!=='object')return;visit(n);for(const [key,value]of Object.entries(n)){if(['start','end'].includes(key))continue;if(Array.isArray(value))value.forEach(v=>walk(v,visit));else if(value&&typeof value==='object')walk(value,visit);}}
walk(ast,n=>{if(n.type==='FunctionDeclaration')names.add(n.id.name);if(n.type==='VariableDeclarator'&&n.id.type==='Identifier'&&['ArrowFunctionExpression','FunctionExpression'].includes(n.init?.type))names.add(n.id.name);});
const methods=new Set(['getLastRow','getValues','appendRow','setValues','setValue','deleteRow','insertSheet','get','put','remove','setProperty','deleteProperty']);
const collections=new Set(['map','filter','find','findIndex','some','every','forEach']);
const awaitNode=node=>({type:'AwaitExpression',argument:node});
function hasOwnAwait(n){let result=false;function scan(x){if(!x||typeof x!=='object')return;if(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(x.type))return;if(x.type==='AwaitExpression')result=true;for(const v of Object.values(x)){if(Array.isArray(v))v.forEach(scan);else if(v&&typeof v==='object')scan(v);}}scan(n);return result;}
function transform(n){
 if(!n||typeof n!=='object')return n;
 for(const [key,value]of Object.entries(n)){if(Array.isArray(value))n[key]=value.map(transform);else if(value&&typeof value==='object')n[key]=transform(value);}
 if(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(n.type))n.async=n.type==='FunctionDeclaration'||hasOwnAwait(n.body);
 if(n.type!=='CallExpression')return n;
 const c=n.callee;
 if(c.type==='MemberExpression'&&!c.computed&&collections.has(c.property.name)){
   const fn=n.arguments[0],async=fn?.async||(fn?.type==='Identifier'&&names.has(fn.name));
   if(async)return awaitNode({type:'CallExpression',callee:{type:'Identifier',name:'asyncArray'},arguments:[{type:'Literal',value:c.property.name},c.object,fn],optional:false});
 }
 if(c.type==='Identifier'&&names.has(c.name)||c.type==='MemberExpression'&&!c.computed&&methods.has(c.property.name))return awaitNode(n);
 return n;
}
transform(ast);
const rendered=generate(ast);
// Ensure the output parses with await confined to async functions.
parse(rendered,{ecmaVersion:'latest',sourceType:'module'});
fs.writeFileSync(path.join(out,'engine.js'),`// Generated locally by scripts/build-local-engine.cjs. No cloud services are used.\nimport {BrawlCore} from './domain.js';\nimport {asyncArray} from './runtime.js';\n${handwriting.slice(0,handlerStart)}\nexport function createEngine(services) {\nconst {Utilities,PropertiesService,SpreadsheetApp,CacheService,LockService,ContentService}=services;\nconst sheetText=value=>value;\nconst encodeProfile=JSON.stringify;\n${rendered}\nreturn {doGet,doPost};\n}\n`);
fs.writeFileSync(path.join(out,'runtime.js'),"export {asyncArray} from '../local-server/runtime.js';\n");console.log('Moteur SQLite local reconstruit; syntaxe vérifiée.');
