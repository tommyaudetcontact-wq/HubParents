import {runtime} from './runtime.js';
import {createEngine} from './engine.js';
import {randomUUID} from 'node:crypto';

class RollbackCheck extends Error {constructor(checks){super('rollback-check');this.checks=checks;}}
// Runs against the actual SQL adapter and always rolls its transaction back.
// Access is gated by the expiring migration token; disabled after finalization.
export async function selfTest(sql){
 try{
  await sql.begin(async tx=>{
   await tx`select pg_advisory_xact_lock(7816017)`;
   const settings=Object.fromEntries((await tx`select key,value from brawl_private.settings`).map(r=>[r.key,r.value]));
   settings.AUTH_PEPPER='local-check-'+randomUUID();settings.CHILD_LOGIN_SALT='ab'.repeat(16);
   const services=runtime(tx,settings);await services.initialize();const engine=createEngine(services),checks=[];
   const call=async(action,payload={})=>{
    const result=await engine.doPost({postData:{contents:JSON.stringify({action,player:'__parent__',...payload})}});
    if(!result.ok)throw Error('Test '+action+' : '+result.error);return result;
   };
   const parent=await call('authRegister',{email:randomUUID()+'@example.invalid',name:'Migration Test',salt:'ab'.repeat(16),proof:'cd'.repeat(32)});
   const as=(action,payload={})=>call(action,{parentToken:parent.token,familyId:parent.familyId,...payload});
   const me=await as('authMe');if(!me.parent.id)throw Error('Compte parent invalide.');checks.push('parent-auth');
   const created=await as('familyCreate',{patch:{name:'Migration Test',grade:4}}),child=created.profiles[0];
   if(!child?.id)throw Error('Profil enfant invalide.');checks.push('family-create');
   const access=await as('authPlayChild',{childId:child.id});
   const state=await call('state',{player:child.id,token:access.token});
   if(state.profile.id!==child.id)throw Error('Session enfant invalide.');checks.push('child-session');
   await as('familyUpdate',{childId:child.id,revision:state.profile.revision,patch:{name:'Migration Updated'}});
   const updated=await call('state',{player:child.id,token:access.token});if(updated.profile.name!=='Migration Updated')throw Error('Écriture du profil invalide.');checks.push('profile-update');
   await call('challenge',{player:child.id,token:access.token,skill:'add'});checks.push('study-challenge');
   await as('familyDelete',{childId:child.id,confirmName:'Migration Updated'});checks.push('archive-and-delete');
   const denied=await engine.doPost({postData:{contents:JSON.stringify({action:'state',player:child.id,token:access.token})}});
   if(denied.ok)throw Error('Session supprimée encore autorisée.');checks.push('revoked-session');
   throw new RollbackCheck(checks);
  });
 }catch(error){if(error instanceof RollbackCheck)return {ok:true,checks:error.checks,rolledBack:true};throw error;}
 throw Error('Le test doit toujours être annulé.');
}
