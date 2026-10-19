'use strict';
const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
class Sheet{constructor(){this.rows=[];}appendRow(r){this.rows.push([...r]);return this;}getLastRow(){return this.rows.length;}setFrozenRows(){return this;}autoResizeColumns(){return this;}deleteRow(n){this.rows.splice(n-1,1);}getDataRange(){return {getValues:()=>this.rows.map(r=>r.slice())};}getRange(row,col,n=1,m=1){const range={getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>this.rows[row-1+i]?.[col-1+j]??'')),setValue:v=>{this.rows[row-1][col-1]=v;return range;},setValues:a=>{a.forEach((r,i)=>{this.rows[row-1+i]??=[];r.forEach((v,j)=>this.rows[row-1+i][col-1+j]=v);});return range;},setBackground:()=>range,setFontColor:()=>range,setFontWeight:()=>range};return range;}}
function fixture(){const sheets={},props=new Map(),cache=new Map();let now=Date.parse('2026-10-16T15:00:00Z'),locked=false;class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const db={getId:()=>'sheet',getSheetByName:n=>sheets[n],insertSheet:n=>sheets[n]=new Sheet(),setSpreadsheetTimeZone(){}};
 const ctx={console:{log(){},error(){}},Date:Clock,Math,Intl,Map,Set,JSON,Error,Number,String,Array,RegExp,
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k),setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k)})},
 Utilities:{DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,s)=>crypto.createHash('sha256').update(s).digest(),computeHmacSha256Signature:(s,k)=>crypto.createHmac('sha256',k).update(s).digest(),base64Encode:b=>Buffer.from(b).toString('base64'),getUuid:()=>crypto.randomUUID(),formatDate:()=>new Clock().toISOString().slice(0,10)},
 LockService:{getScriptLock:()=>({waitLock:()=>locked=true,hasLock:()=>locked,releaseLock:()=>locked=false})},CacheService:{getScriptCache:()=>({get:k=>cache.get(k)?.expires>now?cache.get(k).value:null,put:(k,v,ttl)=>cache.set(k,{value:v,expires:now+ttl*1000})})},
 SpreadsheetApp:{getActiveSpreadsheet:()=>db,openById:()=>db,flush(){}},ContentService:{MimeType:{JSON:'json'},createTextOutput:s=>({setMimeType:()=>s})}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('Code-complet.gs','utf8'),ctx);ctx.initializeBrawl();
 const call=(action,payload={})=>JSON.parse(ctx.doPost({postData:{contents:JSON.stringify({action,player:'__parent__',...payload})}}));
 const derive=(password,salt)=>crypto.pbkdf2Sync(password,Buffer.from(salt,'hex'),600000,32,'sha256').toString('hex');
 const register=(email,name,extra={})=>{const salt=crypto.randomBytes(16).toString('hex');return call('authRegister',{email,name,salt,proof:derive('Mon mot de passe solide!',salt),...extra});};
 const as=(p,action,payload={})=>call(action,{parentToken:p.token,familyId:p.familyId,...payload});
 return {ctx,call,register,as,derive,sheets,props,cache,advance:n=>now+=n,locked:()=>locked};
}

module.exports={fixture};
