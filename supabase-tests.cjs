'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {fixture}=require('./auth-test-support.cjs');
let count=0;
async function test(name,fn){await fn();count++;console.log('✓ '+name);}
async function setup(){
 const f=fixture();
 const runtime=fs.readFileSync('supabase/functions/hubparents/runtime.js','utf8');
 const array=runtime.slice(runtime.indexOf('export async function asyncArray'),runtime.indexOf('export function runtime')).replace('export ','');
 const code=fs.readFileSync('supabase/functions/hubparents/engine.js','utf8').replace(/^import .*;$/gm,'').replace('export function createEngine','function createEngine');
 const create=vm.runInContext('(()=>{'+array+code+'\nreturn createEngine;})()',f.ctx);
 const engine=create(f.ctx);
 const call=async(action,payload={})=>{const r=await engine.doPost({postData:{contents:JSON.stringify({action,player:'__parent__',...payload})}});return typeof r==='string'?JSON.parse(r):r;};
 const register=async(email,name)=>{const begin=await call('authBegin',{email});return call('authRegister',{email,name,salt:begin.salt,proof:f.derive('Solide!42',begin.salt)});};
 return {...f,call,register,as:(p,a,payload={})=>call(a,{parentToken:p.token,familyId:p.familyId,...payload})};
}
(async()=>{
 const f=await setup();let parent,child,token;
 await test('Async backend: parent registration and persisted family',async()=>{parent=await f.register('supabase@example.test','Parent');assert(parent.ok,parent.error);assert(parent.token);const me=await f.as(parent,'authMe');assert(me.ok,me.error);assert.equal(me.parent.email,'supabase@example.test');});
 await test('Parent creates and lists a child without unresolved Promises',async()=>{const r=await f.as(parent,'familyCreate',{patch:{name:'Test',grade:4}});assert(r.ok,r.error);child=r.profiles[0];assert(child.id);assert.equal(child.name,'Test');const list=await f.as(parent,'familyList');assert.equal(list.profiles.length,1);assert.equal(list.profiles[0].id,child.id);});
 await test('Child login, password check, token and family isolation',async()=>{const begin=await f.call('authChildBegin',{name:'Test'});const proof=f.derive('Enfant!42',begin.salt);assert((await f.as(parent,'authChildCredentials',{childId:child.id,salt:begin.salt,proof,makeCode:true})).ok);const login=await f.call('authChildLogin',{name:'test',salt:begin.salt,proof});assert(login.ok,login.error);token=login.token;assert.equal((await f.call('state',{player:child.id,token})).profile.id,child.id);assert.equal((await f.call('state',{player:child.id,token:'wrong'})).ok,false);const other=await f.register('other@example.test','Autre');assert.equal((await f.as(other,'familyUpdate',{childId:child.id,revision:child.revision,patch:{coins:9999}})).ok,false);});
 await test('Study answer rewards are computed on the server and idempotent',async()=>{const q=await f.call('challenge',{player:child.id,token,skill:'add'});assert(q.ok,q.error);const internal=JSON.parse(f.sheets.Profils.rows.find(r=>r[0]===child.id)[3]);const answer=await f.call('answer',{player:child.id,token,challengeId:q.question.id,requestId:'test-answer',answer:String(internal._challenge.answer)});assert(answer.ok,answer.error);const replay=await f.call('answer',{player:child.id,token,challengeId:q.question.id,requestId:'test-answer',answer:String(internal._challenge.answer)});assert.equal(replay.profile.coins,answer.profile.coins);});
 await test('Large profiles remain readable without adding Sheets fragments',async()=>{const p=f.sheets.Profils.rows.find(r=>r[0]===child.id);const profile=JSON.parse(p[3]);profile.notes='x'.repeat(100000);p[3]=JSON.stringify(profile);const state=await f.call('state',{player:child.id,token});assert(state.ok,state.error);assert.equal(state.profile.notes.length,100000);});
 await test('Invalid requests cannot manufacture parent privileges',async()=>{assert.equal((await f.call('familyList',{player:child.id,token})).ok,false);assert.equal((await f.call('event',{player:child.id,token,event:{type:'study',id:'fake'}})).ok,false);});
 console.log(count+' Supabase adapter test groups passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
