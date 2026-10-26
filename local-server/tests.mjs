import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
import {WebSocket} from 'ws';
import {createServer} from './server.mjs';
const require=createRequire(import.meta.url),{fixture}=require('../auth-test-support.cjs'),f=fixture();f.register('seed@example.test','Seed');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'brawl-local-test-'));fs.mkdirSync(path.join(root,'data'));fs.mkdirSync(path.join(root,'web'));fs.writeFileSync(path.join(root,'web/index.html'),'<h1>Test Brawl</h1>');
const data={settings:Object.fromEntries(f.props),sheets:Object.entries(f.sheets).map(([name,s])=>({name,headers:s.rows[0]})),rows:Object.entries(f.sheets).flatMap(([sheet,s])=>s.rows.slice(1).map((cells,i)=>({sheet,row_no:i+2,cells})))};fs.writeFileSync(path.join(root,'data/export-initial.json'),JSON.stringify(data));
let app=createServer({root,port:0}),sockets=[];await app.listen();let base='http://127.0.0.1:'+app.server.address().port;
const call=async(action,payload={})=>(await fetch(base+'/api',{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({action,player:'__parent__',...payload})})).json();
const next=ws=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('WebSocket timeout')),4000);ws.once('message',data=>{clearTimeout(timer);resolve(JSON.parse(data));});});
try{
 assert.equal((await fetch(base+'/data/brawl.sqlite')).status,404);assert.equal((await fetch(base+'/%2e%2e%2fdata/brawl.sqlite')).status,404);assert.equal((await fetch(base+'/api',{headers:{Origin:'https://invalid.example'}})).status,403);
 assert(!(await (await fetch(base+'/config.js')).text()).includes('supabase'));
 const salt='b'.repeat(32),proof='c'.repeat(64);let parent=await call('authRegister',{email:'local@example.test',name:'Local',salt,proof});assert(parent.ok,parent.error);
 const login=await call('authLogin',{email:'local@example.test',salt,proof});assert(login.ok,login.error);parent=login;
 const as=(action,payload={})=>call(action,{parentToken:parent.token,familyId:parent.familyId,...payload});const players=[];
 for(let i=0;i<2;i++){let r=await as('familyCreate',{patch:{name:'Local '+i,grade:4}});assert(r.ok,r.error);const profile=r.profiles.find(p=>p.name==='Local '+i);const child=await as('authPlayChild',{childId:profile.id});assert(child.ok,child.error);players.push(child);}
 const a=players[0],b=players[1];assert((await call('state',{player:a.profile.id,token:a.token})).ok);assert(!(await call('state',{player:a.profile.id,token:'wrong'})).ok);
 const keys=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),publicKey=await webcrypto.subtle.exportKey('jwk',keys.publicKey),rooms=[];
 for(const p of players){const r=await call('cityPartyAuto',{player:p.profile.id,token:p.token,publicKey});assert(r.ok,r.error);assert(r.realtimeTicket);rooms.push(r);const ws=new WebSocket(base.replace('http','ws')+'/realtime');sockets.push(ws);await new Promise(resolve=>ws.once('open',resolve));const message=next(ws);ws.send(JSON.stringify({topic:'realtime:city-'+r.room.id,event:'phx_join',payload:{localAuth:{ticket:r.realtimeTicket}},ref:'1'}));assert.equal((await message).payload.status,'ok');}
 assert.equal(rooms[0].room.id,rooms[1].room.id);
 const body=JSON.stringify({from:a.profile.id,seq:1,kind:'input',data:{x:1,y:0}}),signature=Buffer.from(await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},keys.privateKey,new TextEncoder().encode(body))).toString('base64'),received=next(sockets[1]);sockets[0].send(JSON.stringify({topic:'realtime:city-'+rooms[0].room.id,event:'broadcast',payload:{event:'game',payload:{body,signature}}}));assert.equal((await received).payload.payload.body,body);
 const unauth=new WebSocket(base.replace('http','ws')+'/realtime');sockets.push(unauth);await new Promise(resolve=>unauth.once('open',resolve));const denied=next(unauth);unauth.send(JSON.stringify({topic:'realtime:city-'+rooms[0].room.id,event:'phx_join',payload:{},ref:'1'}));assert.equal((await denied).payload.status,'error');
 assert(fs.readdirSync(path.join(root,'sauvegardes')).some(n=>n.endsWith('.sqlite')));for(const ws of sockets)ws.terminate();sockets=[];await app.close();app=createServer({root,port:0});await app.listen();base='http://127.0.0.1:'+app.server.address().port;assert((await call('state',{player:a.profile.id,token:a.token})).ok,'Accounts and child sessions survive a server restart');
 console.log('Local SQLite: import, parent login, two children, persisted sessions, denied access, protected data paths, automatic backup and authenticated realtime relay passed.');
}finally{for(const ws of sockets)ws.terminate();await app.close();}
