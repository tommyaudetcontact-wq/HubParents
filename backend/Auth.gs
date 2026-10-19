/** Comptes parents et familles. Les jetons et codes sont stockés sous forme de hachages. */
let requestFamily=null,requestParent=null,requestFamilyMap=null,requestAuthRows=new Map();
const AUTH_SCHEMA=[
 ['AccesEnfants',['enfant_id','preuve_hachee','code_hache','modifie_iso']],
 ['Parents',['id','courriel','nom','sel','preuve_hachee','recuperation_hachee','cree_iso']],
 ['Familles',['id','nom','cree_iso']],
 ['ParentsFamilles',['parent_id','famille_id']],
 ['EnfantsFamilles',['enfant_id','famille_id']],
 ['Sessions',['jeton_hache','type','compte_id','famille_id','expire_ms']],
 ['InvitationsParents',['code_hache','famille_id','courriel','expire_ms','statut','cree_par']],
 ['ConnexionsEnfants',['code_hache','enfant_id','famille_id','expire_ms','statut']]
];
function authInstall(){if(properties().getProperty('AUTH_SCHEMA_VERSION')==='2'&&properties().getProperty('AUTH_PEPPER'))return;const db=activeDB();AUTH_SCHEMA.forEach(([name,headers])=>{const s=db.getSheetByName(name);if(s&&s.getLastRow()){const actual=s.getRange(1,1,1,headers.length).getValues()[0];if(headers.some((h,i)=>actual[i]!==h))throw Error('L’onglet '+name+' a des colonnes incompatibles. Aucune donnée n’a été effacée.');}});AUTH_SCHEMA.forEach(([name,headers])=>{let s=db.getSheetByName(name);if(!s){s=db.insertSheet(name);s.appendRow(headers);s.setFrozenRows(1);}else if(!s.getLastRow())s.appendRow(headers);});if(!properties().getProperty('AUTH_PEPPER'))properties().setProperty('AUTH_PEPPER',authSecret());properties().setProperty('AUTH_SCHEMA_VERSION','2');}
function authSheet(name){return activeDB().getSheetByName(name);}
function authRows(name){const s=authSheet(name);if(!s)return [];const length=s.getLastRow(),cached=requestAuthRows.get(name);if(cached?.length===length)return cached.rows;const rows=s.getDataRange().getValues().slice(1).map((values,i)=>({values,row:i+2}));requestAuthRows.set(name,{length,rows});return rows;}
function authSecret(){return Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,'');}
function authHash(value){return Utilities.base64Encode(Utilities.computeHmacSha256Signature(String(value),properties().getProperty('AUTH_PEPPER')));}
function authEqual(a,b){a=String(a||'');b=String(b||'');let n=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)n|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return n===0;}
function authEmail(value){const email=String(value||'').trim().toLowerCase();if(email.length>254||!/^\S+@\S+\.\S+$/.test(email))throw Error('Entre une adresse courriel valide.');return email;}
function authCredentials(req){if(!/^[a-f0-9]{32}$/.test(req.salt||'')||!/^[a-f0-9]{64}$/.test(req.proof||''))throw Error('Connexion invalide. Recharge l’application et réessaie.');}
function authThrottle(key,limit){const cache=CacheService.getScriptCache(),k='auth:'+digestKey(key),n=Number(cache.get(k)||0);if(n>=limit)throw Error('Trop de tentatives. Attends 15 minutes avant de réessayer.');cache.put(k,String(n+1),900);}
function authFamilyOf(id){if(!requestFamilyMap)requestFamilyMap=new Map(authRows('EnfantsFamilles').map(r=>[r.values[0],r.values[1]]));return requestFamilyMap.get(id)||'legacy';}
function authProfileAllowed(id){return requestFamily===null||authFamilyOf(id)===requestFamily;}
function authSameFamily(a,b){return authFamilyOf(a)===authFamilyOf(b);}
function authSession(token,type){if(typeof token!=='string'||token.length<40||token.length>200)return null;const hashed=digestKey(token);return authRows('Sessions').find(r=>r.values[0]===hashed&&r.values[1]===type&&Number(r.values[4])>Date.now())||null;}
function authMembership(parent,family){return authRows('ParentsFamilles').some(r=>r.values[0]===parent&&r.values[1]===family);}
function authNewSession(type,id,family){const token=authSecret();authSheet('Sessions').appendRow([digestKey(token),type,id,family,253402300799000]);return token;}
function authCleanSessions(){const s=authSheet('Sessions');authRows('Sessions').filter(r=>Number(r.values[4])<=Date.now()).reverse().forEach(r=>s.deleteRow(r.row));}
function authRevokeParent(id){const s=authSheet('Sessions');authRows('Sessions').filter(r=>r.values[1]==='parent'&&r.values[2]===id).reverse().forEach(r=>s.deleteRow(r.row));}
function authRevokeChild(id){const s=authSheet('Sessions');if(s)authRows('Sessions').filter(r=>r.values[1]==='child'&&r.values[2]===id).reverse().forEach(r=>s.deleteRow(r.row));}
function authScope(req){
 requestFamily=null;requestParent=null;
 if(req.parentToken){
   const session=authSession(req.parentToken,'parent');
   if(session){const parent=authRows('Parents').find(r=>r.values[0]===session.values[2]);if(!parent)throw Error('Reconnecte-toi à ton compte parent.');const family=req.familyId||session.values[3];if(!authMembership(parent.values[0],family))throw Error('Cette famille ne fait pas partie de ton compte.');requestParent=parent.values[0];requestFamily=family;return;}
   const old=properties().getProperty('PARENT_HASH');if(old&&authEqual(digestKey(req.parentToken),old)){requestParent='legacy';requestFamily='legacy';return;}
   throw Error('Ta session parent a expiré. Reconnecte-toi.');
 }
 authenticate(req.player,req.token);requestFamily=authFamilyOf(req.player);
}
function authParentInfo(id,family){const p=authRows('Parents').find(r=>r.values[0]===id);if(!p)throw Error('Compte parent introuvable.');const memberships=authRows('ParentsFamilles').filter(r=>r.values[0]===id).map(r=>r.values[1]),families=authRows('Familles').filter(r=>memberships.includes(r.values[0])).map(r=>({id:r.values[0],name:r.values[1]}));return {parent:{id,email:p.values[1],name:p.values[2]},families,familyId:family||families[0]?.id};}
function authInvite(code,email){const r=authRows('InvitationsParents').find(r=>authEqual(r.values[0],digestKey(String(code||'').trim()))&&r.values[4]==='pending'&&Number(r.values[3])>Date.now()&&r.values[2]===email);if(!r)throw Error('Invitation invalide, expirée ou prévue pour un autre courriel.');return r;}
function authJoin(parent,email,invite){const family=invite.values[1];if(!authMembership(parent,family))authSheet('ParentsFamilles').appendRow([parent,family]);authSheet('InvitationsParents').getRange(invite.row,5).setValue('accepted');return family;}
function handleAuthAction(req){
 if(!String(req.action).startsWith('auth'))return null;
 authInstall();const action=req.action;
 if(['authBegin','authRegister','authLogin','authRecover'].includes(action)){
   const email=authEmail(req.email);authThrottle(action+':'+email,action==='authBegin'?30:10);
   const existing=authRows('Parents').find(r=>r.values[1]===email);
   if(action==='authBegin')return {ok:true,salt:existing?existing.values[3]:authSecret().slice(0,32),iterations:600000};
   authCredentials(req);
   if(action==='authRegister'){
     if(existing)throw Error('Ce courriel a déjà un compte. Utilise Se connecter ou Mot de passe oublié.');
     const name=String(req.name||'').trim().slice(0,60);if(!name)throw Error('Indique ton prénom.');
     const invite=req.inviteCode?authInvite(req.inviteCode,email):null,id=Utilities.getUuid(),recovery=authSecret();
     let family=invite?.values[1];if(!family){family=Utilities.getUuid();authSheet('Familles').appendRow([family,sheetText(String(req.familyName||'Famille de '+name).trim().slice(0,80)),new Date().toISOString()]);}
     authSheet('Parents').appendRow([id,sheetText(email),sheetText(name),req.salt,authHash(req.proof),authHash(recovery),new Date().toISOString()]);
     authSheet('ParentsFamilles').appendRow([id,family]);if(invite)authSheet('InvitationsParents').getRange(invite.row,5).setValue('accepted');
     const token=authNewSession('parent',id,family);return {ok:true,token,recoveryCode:recovery,...authParentInfo(id,family)};
   }
   if(action==='authLogin'){
     if(!existing||existing.values[3]!==req.salt||!authEqual(existing.values[4],authHash(req.proof)))throw Error('Courriel ou mot de passe incorrect.');
     const invite=req.inviteCode?authInvite(req.inviteCode,email):null;
     const info=authParentInfo(existing.values[0]);if(invite)info.familyId=authJoin(existing.values[0],email,invite);
     if(!info.familyId){info.familyId=Utilities.getUuid();authSheet('Familles').appendRow([info.familyId,'Famille de '+existing.values[2],new Date().toISOString()]);authSheet('ParentsFamilles').appendRow([existing.values[0],info.familyId]);}
     authCleanSessions();return {ok:true,token:authNewSession('parent',existing.values[0],info.familyId),...authParentInfo(existing.values[0],info.familyId)};
   }
   if(!existing||!authEqual(existing.values[5],authHash(String(req.recoveryCode||'').trim())))throw Error('Courriel ou code de récupération incorrect.');
   const recovery=authSecret();authSheet('Parents').getRange(existing.row,4,1,3).setValues([[req.salt,authHash(req.proof),authHash(recovery)]]);authRevokeParent(existing.values[0]);const info=authParentInfo(existing.values[0]);return {ok:true,token:authNewSession('parent',existing.values[0],info.familyId),recoveryCode:recovery,...info};
 }
 if(action==='authChildBegin'){authThrottle('child-begin:'+authChildName(req.name).slice(0,60),60);return {ok:true,salt:authChildSalt(),iterations:600000};}
 if(action==='authChildLogin'){
  const name=authChildName(req.name);authThrottle('child-login:'+name,12);authCredentials(req);if(req.salt!==authChildSalt())throw Error('Prénom ou mot de passe incorrect.');
  const profiles=lobbyProfiles().slice(1).filter(r=>authChildName(r[1])===name),credentials=authRows('AccesEnfants');
  const matches=profiles.filter(p=>credentials.some(c=>c.values[0]===p[0]&&c.values[1]&&authEqual(c.values[1],authHash(p[0]+':'+req.proof))));
  const selected=req.childId?matches.find(p=>p[0]===req.childId):matches.length===1?matches[0]:null;
  if(!matches.length||req.childId&&!selected)throw Error('Prénom ou mot de passe incorrect.');
  if(!selected){const families=authRows('Familles');return {ok:true,choices:matches.map(p=>({id:p[0],name:p[1],grade:p[2],family:families.find(f=>f.values[0]===authFamilyOf(p[0]))?.values[1]||'Ma famille'}))};}
  requestFamily=authFamilyOf(selected[0]);const p=profileRecord(selected[0]).profile;return {ok:true,token:authNewSession('child',p.id,requestFamily),profile:publicProfile(p)};
 }
 if(action==='authChildMe'||action==='authChildLogout'){
  authenticate(req.player,req.token);requestFamily=authFamilyOf(req.player);const session=authSession(req.token,'child');
  if(action==='authChildLogout'){if(session)authSheet('Sessions').deleteRow(session.row);return {ok:true};}
  if(session)authSheet('Sessions').getRange(session.row,5).setValue(253402300799000);
  return {ok:true,profile:publicProfile(profileRecord(req.player).profile)};
 }
 if(action==='authChildConnect'){
   authThrottle('child:'+String(req.code||'').slice(0,80),10);
   const code=String(req.code||'').replace(/[\s-]/g,'').toUpperCase(),permanent=authRows('AccesEnfants').find(r=>r.values[2]&&authEqual(r.values[2],digestKey(code)));
   if(permanent){requestFamily=authFamilyOf(permanent.values[0]);const p=profileRecord(permanent.values[0]).profile;return {ok:true,token:authNewSession('child',p.id,requestFamily),profile:publicProfile(p)};}
   const r=authRows('ConnexionsEnfants').find(r=>authEqual(r.values[0],digestKey(code))&&r.values[4]==='pending'&&Number(r.values[3])>Date.now());
   if(!r)throw Error('Code enfant incorrect ou expiré. Demande un nouveau code au parent.');
   requestFamily=r.values[2];const p=profileRecord(r.values[1]).profile;authSheet('ConnexionsEnfants').getRange(r.row,5).setValue('used');return {ok:true,token:authNewSession('child',p.id,requestFamily),profile:publicProfile(p)};
 }
 authScope(req);
 if(!requestParent||requestParent==='legacy')throw Error('Connecte-toi avec ton compte parent.');
 if(action==='authMe'){const current=authSession(req.parentToken,'parent');if(current)authSheet('Sessions').getRange(current.row,5).setValue(253402300799000);return {ok:true,...authParentInfo(requestParent,requestFamily)};}
 if(action==='authLogout'){const r=authSession(req.parentToken,'parent');if(r)authSheet('Sessions').deleteRow(r.row);return {ok:true};}
 if(action==='authFamilyInfo'){
   const ids=authRows('ParentsFamilles').filter(r=>r.values[1]===requestFamily).map(r=>r.values[0]);
   return {ok:true,...authParentInfo(requestParent,requestFamily),parents:authRows('Parents').filter(r=>ids.includes(r.values[0])).map(r=>({id:r.values[0],name:r.values[2],email:r.values[1]})),invites:authRows('InvitationsParents').filter(r=>r.values[1]===requestFamily&&r.values[4]==='pending'&&Number(r.values[3])>Date.now()).map(r=>({id:r.row,email:r.values[2],expires:Number(r.values[3])}))};
 }
 if(action==='authInviteParent'){const email=authEmail(req.email);if(authRows('InvitationsParents').filter(r=>r.values[1]===requestFamily&&r.values[4]==='pending'&&Number(r.values[3])>Date.now()).length>=20)throw Error('Annule les invitations en attente avant d’en créer.');const code=authSecret().slice(0,24).toUpperCase(),expires=Date.now()+7*86400000;authSheet('InvitationsParents').appendRow([digestKey(code),requestFamily,sheetText(email),expires,'pending',requestParent]);return {ok:true,code,expires};}
 if(action==='authJoinFamily'){const parent=authRows('Parents').find(r=>r.values[0]===requestParent);const invite=authInvite(req.inviteCode,parent.values[1]);const family=authJoin(requestParent,parent.values[1],invite);return {ok:true,...authParentInfo(requestParent,family)};}
 if(action==='authCancelInvite'){const r=authRows('InvitationsParents').find(r=>r.row===Number(req.inviteId)&&r.values[1]===requestFamily);if(!r)throw Error('Invitation introuvable.');authSheet('InvitationsParents').getRange(r.row,5).setValue('cancelled');return {ok:true};}
 if(action==='authRemoveParent'){
   const members=authRows('ParentsFamilles').filter(r=>r.values[1]===requestFamily),r=members.find(r=>r.values[0]===req.parentId);if(!r)throw Error('Parent introuvable.');if(members.length<=1)throw Error('La famille doit conserver au moins un parent.');authSheet('ParentsFamilles').deleteRow(r.row);return {ok:true};
 }
 if(action==='authRenameFamily'){const name=String(req.name||'').trim().slice(0,80);if(!name)throw Error('Indique un nom de famille.');const r=authRows('Familles').find(r=>r.values[0]===requestFamily);authSheet('Familles').getRange(r.row,2).setValue(sheetText(name));return {ok:true,...authParentInfo(requestParent,requestFamily)};}
 if(action==='authChildCredentials'){
  const p=profileRecord(String(req.childId)).profile,table=authSheet('AccesEnfants'),old=authRows('AccesEnfants').find(r=>r.values[0]===p.id);let password=old?.values[1]||'',codeHash=old?.values[2]||'',code=null;
  if(req.proof){authCredentials(req);if(req.salt!==authChildSalt())throw Error('Recharge la connexion enfant.');password=authHash(p.id+':'+req.proof);}
  if(req.makeCode===true){code=authSecret().slice(0,16).toUpperCase();codeHash=digestKey(code);}
  if(!req.proof&&req.makeCode!==true)throw Error('Choisis un mot de passe ou crée un code.');
  const row=[p.id,password,codeHash,new Date().toISOString()];if(old)table.getRange(old.row,1,1,4).setValues([row]);else table.appendRow(row);
  authRevokeChild(p.id);return {ok:true,code:code,hasPassword:!!password,hasCode:!!codeHash};
 }
 if(action==='authChildCode'||action==='authPlayChild'){const p=profileRecord(String(req.childId)).profile;if(action==='authPlayChild')return {ok:true,profile:publicProfile(p),token:authNewSession('child',p.id,requestFamily)};const code=authSecret().slice(0,16).toUpperCase(),expires=Date.now()+10*60000;authSheet('ConnexionsEnfants').appendRow([digestKey(code),p.id,requestFamily,expires,'pending']);return {ok:true,code,expires};}
 if(action==='authRecoveryCode'){const recovery=authSecret(),r=authRows('Parents').find(r=>r.values[0]===requestParent);authSheet('Parents').getRange(r.row,6).setValue(authHash(recovery));return {ok:true,recoveryCode:recovery};}
 if(action==='authPassword'){
   authCredentials(req);const r=authRows('Parents').find(r=>r.values[0]===requestParent);authThrottle('change:'+requestParent,10);if(!authEqual(r.values[4],authHash(req.oldProof)))throw Error('Le mot de passe actuel est incorrect.');authSheet('Parents').getRange(r.row,4,1,2).setValues([[req.salt,authHash(req.proof)]]);authRevokeParent(requestParent);return {ok:true,token:authNewSession('parent',requestParent,requestFamily),...authParentInfo(requestParent,requestFamily)};
 }
 if(action==='authImportLegacy'){
   const h=properties().getProperty('PARENT_HASH');if(!h||!authEqual(digestKey(String(req.legacyKey||'')),h))throw Error('L’ancienne clé parent est incorrecte.');
   const rows=activeDB().getSheetByName('Profils').getDataRange().getValues().slice(1).filter(r=>r[0]&&authFamilyOf(r[0])==='legacy');rows.forEach(r=>authSheet('EnfantsFamilles').appendRow([r[0],requestFamily]));return {ok:true,count:rows.length};
 }
 throw Error('Action de compte inconnue.');
}

function authChildSalt(){let salt=properties().getProperty('CHILD_LOGIN_SALT');if(!salt){salt=authSecret().slice(0,32);properties().setProperty('CHILD_LOGIN_SALT',salt);}return salt;}
function authChildName(value){return String(value||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}
