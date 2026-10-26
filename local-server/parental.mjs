import {randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
export const defaultPolicy=()=>({voice:true,multiplayer:true,invites:true,weapons:true,dailyMinutes:0,quietEnabled:false,quietStart:1320,quietEnd:420});
export function createParental({db,enabled,upgrade}){
 const tickets=new Map(),attempts=new Map(),clocks=new Map(),cached=new Map(),now=()=>Date.now();
 const setting=k=>{const r=db.prepare('SELECT value FROM settings WHERE key=?').get(k);return r?.value;},put=(k,v)=>db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k,v);
 const family=id=>{const r=db.prepare("SELECT cells FROM sheet_rows WHERE sheet='EnfantsFamilles' AND json_extract(cells,'$[0]')=?").get(id);return r?JSON.parse(r.cells)[1]:null;};
 const load=id=>{const r=db.prepare("SELECT row_no,cells FROM sheet_rows WHERE sheet='Profils' AND json_extract(cells,'$[0]')=?").get(id);if(!r)return null;const cells=JSON.parse(r.cells);return {row:r.row_no,cells,p:upgrade(JSON.parse(cells[3]))};};
 const save=r=>{r.cells[3]=JSON.stringify(r.p);r.cells[4]=new Date().toISOString();db.prepare("UPDATE sheet_rows SET cells=? WHERE sheet='Profils' AND row_no=?").run(JSON.stringify(r.cells),r.row);cached.delete(r.p.id);};
 const policy=id=>{const c=cached.get(id);if(c&&c.until>now())return c.policy;const p={...defaultPolicy(),...(load(id)?.p.cityParental||{})};cached.set(id,{policy:p,until:now()+2000});return p;};
 const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto'}).format(new Date());
 function clock(id){let c=clocks.get(id);if(!c||c.day!==day()){const p=load(id)?.p._cityPlayClock;c={day:day(),seconds:p?.day===day()?p.seconds||0:0,at:now(),seen:now(),active:false};clocks.set(id,c);}return c;}
 function settle(c){const end=Math.min(now(),c.seen+60000);if(c.active)c.seconds+=Math.max(0,(end-c.at)/1000);c.at=now();if(now()-c.seen>60000)c.active=false;}
 function touch(id,active){if(!enabled||!id||id==='__parent__')return;const c=clock(id);settle(c);c.seen=now();if(active!==undefined)c.active=!!active;}
 function status(id){const p=policy(id),c=clock(id);settle(c);const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()),minute=Number(parts.find(x=>x.type==='hour').value)*60+Number(parts.find(x=>x.type==='minute').value),quiet=p.quietEnabled&&(p.quietStart<p.quietEnd?minute>=p.quietStart&&minute<p.quietEnd:minute>=p.quietStart||minute<p.quietEnd),remaining=p.dailyMinutes?Math.max(0,p.dailyMinutes*60-Math.floor(c.seconds)):null;return {policy:p,usedSeconds:Math.floor(c.seconds),remainingSeconds:remaining,blocked:quiet||remaining===0,reason:quiet?'Horaire de jeu fermé.':remaining===0?'Temps de jeu quotidien atteint.':''};}
 function can(id,feature){if(!enabled)return true;const s=status(id);return !s.blocked&&(feature==='play'||s.policy[feature]!==false)&&(feature!=='voice'||s.policy.multiplayer);}
 const publicProfile=p=>{const out={...p};delete out._cityPlayClock;return out;};
 const validTicket=(token,f)=>{const t=tickets.get(token);return t&&t.family===f&&t.until>now();};
 const ticket=f=>{const key=randomBytes(32).toString('hex');tickets.set(key,{family:f,until:now()+600000});return key;};
 const pinDigest=(f,proof)=>createHmac('sha256',setting('AUTH_PEPPER')).update(f+':'+proof).digest('hex');
 const pinInfo=f=>{try{return JSON.parse(setting('CITY_PARENT_PIN:'+f)||'null');}catch{return null;}};
 const profiles=f=>db.prepare("SELECT cells FROM sheet_rows WHERE sheet='EnfantsFamilles'").all().map(r=>JSON.parse(r.cells)).filter(r=>r[1]===f).map(r=>{const p=load(r[0])?.p;return p?{id:p.id,name:p.name,...status(p.id)}:null;}).filter(Boolean);
 async function handle(body,engine){if(!String(body.action).startsWith('cityParental'))return null;if(!enabled)return {ok:false,error:'Le contrôle parental du jeu autonome est désactivé.'};
  const auth=await engine.doPost({postData:{contents:JSON.stringify({...body,action:'state'})}});if(!auth.ok)return auth;const id=auth.profile.id,f=family(id);if(!f)return {ok:false,error:'Compte de jeu introuvable.'};
  const pin=pinInfo(f),base=()=>({ok:true,profile:publicProfile(load(id).p),pinConfigured:!!pinInfo(f),...status(id)});
  if(body.action==='cityParentalStatus')return base();
  if(body.action==='cityParentalPulse'){touch(id,body.active===true);flush([id]);return base();}
  if(body.action==='cityParentalBegin')return {ok:true,pinConfigured:!!pin,salt:pin?.salt||null};
  if(body.action==='cityParentalUnlock'){
   const a=attempts.get(f)||{hits:0,until:now()+900000};if(a.until<now()){a.hits=0;a.until=now()+900000;}if(a.hits>=6)return {ok:false,error:'Trop de tentatives de code parental. Réessaie dans quinze minutes.'};a.hits++;attempts.set(f,a);
   const hash=typeof body.proof==='string'&&/^[a-f0-9]{64}$/.test(body.proof)?pinDigest(f,body.proof):'';if(!pin||hash.length!==pin.digest.length||!timingSafeEqual(Buffer.from(hash),Buffer.from(pin.digest)))return {ok:false,error:'Code parental incorrect.'};attempts.delete(f);return {...base(),parentalToken:ticket(f),profiles:profiles(f)};
  }
  if(body.action==='cityParentalSetPin'){
   if(pin&&!validTicket(body.parentalToken,f))return {ok:false,error:'Déverrouille d’abord le contrôle parental. Un code oublié se réinitialise avec la récupération du compte.'};
   if(!pin){if(!body.parentToken)return {ok:false,error:'Connexion du responsable nécessaire.'};const check=await engine.doPost({postData:{contents:JSON.stringify({...body,action:'parentCheck'})}});if(!check.ok)return check;}
   if(!/^[a-f0-9]{32}$/.test(body.salt||'')||!/^[a-f0-9]{64}$/.test(body.proof||''))return {ok:false,error:'Code parental invalide.'};put('CITY_PARENT_PIN:'+f,JSON.stringify({salt:body.salt,digest:pinDigest(f,body.proof)}));for(const [k,v]of tickets)if(v.family===f)tickets.delete(k);return {...base(),parentalToken:ticket(f),profiles:profiles(f)};
  }
  if(body.action==='cityParentalSave'){
   if(!validTicket(body.parentalToken,f))return {ok:false,error:'Le contrôle parental est verrouillé.'};const p=body.policy,keys=['voice','multiplayer','invites','weapons','quietEnabled'];if(!p||keys.some(k=>typeof p[k]!=='boolean')||!Number.isInteger(p.dailyMinutes)||p.dailyMinutes<0||p.dailyMinutes>720||![p.quietStart,p.quietEnd].every(n=>Number.isInteger(n)&&n>=0&&n<1440))return {ok:false,error:'Réglages parentaux invalides.'};
   const clean=Object.fromEntries(Object.keys(defaultPolicy()).map(k=>[k,p[k]])),targets=body.all===true?profiles(f).map(p=>p.id):[body.targetId||id];if(targets.some(target=>family(target)!==f))return {ok:false,error:'Ce personnage ne fait pas partie de ton compte.'};
   for(const target of targets){const row=load(target);row.p.cityParental=clean;row.p.revision++;save(row);}if(body.all===true)put('CITY_PARENT_DEFAULT:'+f,JSON.stringify(clean));return {...base(),profiles:profiles(f),_policyChanged:targets};
  }
  return {ok:false,error:'Action parentale inconnue.'};
 }
 function gate(body,result){if(!enabled||!result.ok||String(body.action).startsWith('cityParental'))return null;const id=body.player;
  if(body.action==='familyUpdate')return 'Les anciens réglages de la plateforme sont désactivés dans le jeu autonome.';
  if(['familyCreate','familyDelete'].includes(body.action)){const f=body.familyId;if(pinInfo(f)&&!validTicket(body.parentalToken,f))return 'Code parental nécessaire pour créer ou supprimer un personnage.';if(body.action==='familyCreate'){let defaults;try{defaults=JSON.parse(setting('CITY_PARENT_DEFAULT:'+f)||'null');}catch{}if(defaults){const p=result.profiles?.at(-1);if(p){const r=load(p.id);r.p.cityParental=defaults;r.p.revision++;save(r);Object.assign(p,publicProfile(r.p));}}}return null;}
  if(body.parentToken||!id||id==='__parent__'||String(body.action).startsWith('auth'))return null;
  touch(id,true);if(!can(id,'play')&&!['state','cityPartyLeave'].includes(body.action))return status(id).reason;
  if(String(body.action).startsWith('cityParty')&&body.action!=='cityPartyLeave'&&!can(id,'multiplayer'))return 'Le multijoueur est bloqué par le contrôle parental.';
  if(/Invite/i.test(body.action)&&!can(id,'invites'))return 'Les invitations sont bloquées par le contrôle parental.';
  return null;
 }
 function resetRecovered(parentId){if(!enabled||!parentId)return;for(const r of db.prepare("SELECT cells FROM sheet_rows WHERE sheet='ParentsFamilles'").all()){const a=JSON.parse(r.cells);if(a[0]===parentId){db.prepare('DELETE FROM settings WHERE key=?').run('CITY_PARENT_PIN:'+a[1]);for(const [k,t]of tickets)if(t.family===a[1])tickets.delete(k);}}}
 function flush(ids){if(!enabled)return;for(const id of new Set(ids)){const c=clocks.get(id);if(!c)continue;settle(c);const r=load(id);if(r){r.p._cityPlayClock={day:c.day,seconds:c.seconds};save(r);}}for(const [k,t]of tickets)if(t.until<now())tickets.delete(k);}
 return {handle,gate,can,status,touch,flush,resetRecovered,policy};
}
