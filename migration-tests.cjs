'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {fixture}=require('./auth-test-support.cjs');
function setup(){
 const f=fixture();const Sheet=f.sheets.Profils.constructor;
 const old=f.ctx.PropertiesService.getScriptProperties;
 f.ctx.PropertiesService.getScriptProperties=()=>({...old(),getProperties:()=>Object.fromEntries(f.props)});
 f.sheets.Duels=new Sheet();f.sheets.Duels.appendRow(['id','hote','invite','statut','cree_ms']);
 f.props.set('CHILD_LOGIN_SALT','ab'.repeat(16));
 let calls=[];
 f.ctx.UrlFetchApp={fetch:(url,options)=>{calls.push({url,options});return {getContentText:()=>JSON.stringify(options?{ok:true,profiles:0}:{ok:true,installed:false})};}};
 const helper=fs.readFileSync('scripts/migrate-apps-script.gs.template','utf8');
 const api=vm.runInContext('(()=>{'+helper+'\nreturn {migrerVersSupabase,forwardMigrated};})()',f.ctx);
 return {...f,api,calls};
}
let f=setup();f.api.migrerVersSupabase();
let payload=JSON.parse(f.calls[0].options.payload);
assert.equal(payload.sheets.length,16);assert.equal(payload.properties.AUTH_PEPPER,f.props.get('AUTH_PEPPER'));assert.equal(payload.properties.CHILD_LOGIN_SALT,f.props.get('CHILD_LOGIN_SALT'));assert.equal(payload.properties.DB_ID,undefined);
assert(f.props.get('MIGRATED_ENDPOINT'));const calls=f.calls.length;f.api.migrerVersSupabase();assert.equal(f.calls.length,calls);
console.log('✓ Fresh export, credential allowlist and one-time redirection');
f=setup();f.props.delete('AUTH_PEPPER');assert.throws(()=>f.api.migrerVersSupabase(),/Secrets/);assert.equal(f.calls.length,0);assert.equal(f.props.get('MIGRATED_ENDPOINT'),undefined);
console.log('✓ Missing credentials stop the migration before sending data');
f=setup();f.ctx.UrlFetchApp.fetch=()=>{throw Error('network');};assert.throws(()=>f.api.migrerVersSupabase(),/network/);assert(f.props.get('SUPABASE_EXPORT_ATTEMPT'));assert(!f.props.get('MIGRATED_ENDPOINT'));f.ctx.UrlFetchApp.fetch=()=>({getContentText:()=>JSON.stringify({ok:true,installed:true})});f.api.migrerVersSupabase();assert(f.props.get('MIGRATED_ENDPOINT'));
console.log('✓ Recovery after a lost finalization response does not overwrite data');
console.log('3 migration bridge test groups passed.');
