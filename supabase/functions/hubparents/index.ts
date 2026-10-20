import postgres from 'npm:postgres@3.4.7';
import {Buffer} from 'node:buffer';
import {createHash, timingSafeEqual} from 'node:crypto';
import {runtime} from './runtime.js';
import {createEngine} from './engine.js';
import {selfTest} from './self-test.js';

const sql=postgres(Deno.env.get('SUPABASE_DB_URL')!,{prepare:false,max:3,connect_timeout:10,idle_timeout:20});
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Cache-Control':'no-store'};
const response=(data:unknown,status=200)=>Response.json(data,{status,headers:cors});
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const equal=(a:string,b:string)=>a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));

async function rateLimit(req:Request,body:Record<string,unknown>){
 const ip=req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown';
 const auth=String(body.action).startsWith('auth');
 const period=auth?900:60,limit=auth?120:600;
 const key=hash(`${ip}:${auth?'auth':'game'}:${Math.floor(Date.now()/(period*1000))}`);
 const [r]=await sql`insert into brawl_private.rate_limits(key,hits,expires_at) values(${key},1,now()+${period}*interval '1 second') on conflict(key) do update set hits=brawl_private.rate_limits.hits+1 returning hits`;
 if(r.hits>limit)throw Error('Trop de requêtes. Réessaie plus tard.');
 // Persistent cleanup stays bounded; no unbounded logs or expired cache growth.
 if(Math.random()<0.01){await sql`delete from brawl_private.rate_limits where expires_at<now()`;await sql`delete from brawl_private.cache where expires_at<now()`;}
}

Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(req.method==='GET'){
   try{const rows=await sql`select key from brawl_private.settings where key='AUTH_PEPPER'`;
     return response({ok:true,app:'HubParents',version:17,backend:'supabase',installed:rows.length===1});
   }catch{return response({ok:false,error:'Backend en préparation.'},503);}
 }
 if(req.method!=='POST')return response({ok:false,error:'Méthode invalide.'},405);
 try{
  const text=await req.text();if(text.length>2000000)return response({ok:false,error:'Requête trop volumineuse.'},413);
  const body=JSON.parse(text);if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Requête invalide.');
  await rateLimit(req,body);
  if(body.action==='migrationCheck'){
   const rows=await sql`select key,value from brawl_private.settings where key in ('MIGRATION_TOKEN_HASH','MIGRATION_EXPIRES','MIGRATION_COMPLETE')`;
   const settings=Object.fromEntries(rows.map(r=>[r.key,r.value]));
   if(typeof body.migrationToken!=='string'||body.migrationToken.length>200||settings.MIGRATION_COMPLETE||Date.now()>Number(settings.MIGRATION_EXPIRES)||!equal(hash(body.migrationToken),settings.MIGRATION_TOKEN_HASH||''))throw Error('Migration non autorisée.');
   return response(await selfTest(sql));
  }
  if(body.action==='migrationFinalize'){
   if(typeof body.migrationToken!=='string'||body.migrationToken.length>200)throw Error('Migration non autorisée.');
   const result=await sql.begin(async tx=>{
    await tx`select pg_advisory_xact_lock(7816017)`;
    const rows=await tx`select key,value from brawl_private.settings where key in ('MIGRATION_TOKEN_HASH','MIGRATION_EXPIRES','MIGRATION_COMPLETE')`;
    const settings=Object.fromEntries(rows.map(r=>[r.key,r.value]));
    if(settings.MIGRATION_COMPLETE||Date.now()>Number(settings.MIGRATION_EXPIRES)||!equal(hash(body.migrationToken),settings.MIGRATION_TOKEN_HASH||''))throw Error('Migration non autorisée ou déjà terminée.');
    const props=body.properties;
    if(!props||typeof props.AUTH_PEPPER!=='string'||props.AUTH_PEPPER.length<32)throw Error('Secret Apps Script manquant.');
    if(!Array.isArray(body.sheets)||body.sheets.length!==16)throw Error('Export de données incomplet.');
    const known=await tx`select name,headers from brawl_private.sheets`;
    const names=new Set<string>();
    for(const sheet of body.sheets){
      const expected=known.find(s=>s.name===sheet.name);
      if(!expected||names.has(sheet.name)||JSON.stringify(expected.headers)!==JSON.stringify(sheet.headers)||!Array.isArray(sheet.rows))throw Error('Structure de données incompatible.');
      names.add(sheet.name);
    }
    // Transfer a fresh snapshot and credentials together, once, atomically.
    for(const sheet of body.sheets){
      await tx`delete from brawl_private.rows where sheet=${sheet.name}`;
      for(let i=0;i<sheet.rows.length;i++)await tx`insert into brawl_private.rows(sheet,row_no,cells) values(${sheet.name},${i+2},${tx.json(sheet.rows[i])})`;
    }
    for(const [key,value]of Object.entries(props)){
      if(!/^(AUTH_PEPPER|CHILD_LOGIN_SALT|PARENT_HASH|PLAYER_[a-zA-Z0-9_-]{1,60})$/.test(key))continue;
      if(typeof value!=='string'||value.length>1000)throw Error('Secret invalide.');
      await tx`insert into brawl_private.settings(key,value) values(${key},${value}) on conflict(key) do update set value=excluded.value`;
    }
    await tx`insert into brawl_private.settings(key,value) values('MIGRATION_COMPLETE',${new Date().toISOString()})`;
    await tx`delete from brawl_private.settings where key in ('MIGRATION_TOKEN_HASH','MIGRATION_EXPIRES')`;
    return {ok:true,migrated:true,profiles:body.sheets.find((s:{name:string})=>s.name==='Profils')?.rows.length};
   });
   return response(result);
  }
  if(text.length>300000)throw Error('Requête trop volumineuse.');
  const result=await sql.begin(async tx=>{
   await tx`set local lock_timeout='10s'`;
   await tx`set local statement_timeout='15s'`;
   // Match legacy serialization while moving I/O off Sheets. Transactions also
   // make a two-profile trade atomic, including inventory and accepted status.
   await tx`select pg_advisory_xact_lock(7816017)`;
   const rows=await tx`select key,value from brawl_private.settings`;
   const settings=Object.fromEntries(rows.map(r=>[r.key,r.value]));
   if(!settings.AUTH_PEPPER)throw Error('Migration en cours. Utilise le site actuel pour le moment.');
   const services=runtime(tx,settings);await services.initialize();
   const engine=createEngine(services);
   const value=await engine.doPost({postData:{contents:text}});
   if(!value.ok)throw Error(value.error||'Action refusée.');
   return value;
  });
  return response(result);
 }catch(error){
  // PostgreSQL exception details can contain private parameters. Never send them.
  const message=error instanceof Error&&!(error as {code?:string}).code?error.message:'Le serveur ne peut pas terminer cette opération. Réessaie.';
  return response({ok:false,error:message});
 }
});
