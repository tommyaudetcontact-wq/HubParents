/** Brawl Académie — API liée à une NOUVELLE feuille Google Sheets.
 * Installer les huit fichiers backend OU le fichier Code-complet.gs, jamais les deux.
 * Exécuter initializeBrawl() depuis le script lié à la feuille.
 * Les secrets sont dans ScriptProperties, jamais dans la feuille ni le frontend.
 */
const TZ = 'America/Toronto';
function sheetText(value){return typeof value==='string'&&value.startsWith('=')?"'"+value:value;}
function jsonResponse(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function doGet() { return jsonResponse({ok:true,app:'Brawl Académie',version:16,batches:true,visits:true,notifications:true,accounts:true,duels:true,childLogin:true,shortCodes:true,installed:!!properties().getProperty('DB_ID'),message:'Utiliser POST pour les requêtes authentifiées.'}); }
function digestKey(token) { return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(token))); }
function properties() { return PropertiesService.getScriptProperties(); }
function isParent(token) { if(requestParent)return true;const h=properties().getProperty('PARENT_HASH');return !!h&&typeof token==='string'&&digestKey(token)===h; }
function authenticate(id,token) { const session=authSession(token,'child');if(session&&session.values[2]===id&&session.values[3]===authFamilyOf(id))return;const h=properties().getProperty('PLAYER_'+id);if(!h||typeof token!=='string'||digestKey(token)!==h)throw Error('Ta connexion enfant a expiré. Demande un nouveau code au parent.'); }
let requestDB=null;
function activeDB(){if(requestDB)return requestDB;const id=properties().getProperty('DB_ID');if(!id)throw Error('Exécute initializeBrawl dans Apps Script.');return requestDB=SpreadsheetApp.openById(id);}
function profileRecord(id){if(!authProfileAllowed(id))throw Error('Ce compte ne fait pas partie de ta famille.');const sheet=activeDB().getSheetByName('Profils'),cache=CacheService.getScriptCache(),key='profile-row:'+digestKey(id);let row=Number(cache.get(key)||0),values=null;
 if(row>1&&row<=sheet.getLastRow()){values=sheet.getRange(row,1,1,5).getValues()[0];if(String(values[0])!==id)values=null;}
 if(!values){const count=sheet.getLastRow();if(count>1){const ids=sheet.getRange(2,1,count-1,1).getValues(),index=ids.findIndex(r=>String(r[0])===id);if(index>=0){row=index+2;values=sheet.getRange(row,1,1,5).getValues()[0];cache.put(key,String(row),1800);}}}
 if(!values)throw Error('Profil introuvable.');return {sheet,row,profile:BrawlCore.upgrade(decodeProfile(values[3]))};}

function saveRecord(record) {record.sheet.getRange(record.row,1,1,5).setValues([[record.profile.id,sheetText(record.profile.name),record.profile.grade,encodeProfile(record.profile),new Date().toISOString()]]);SpreadsheetApp.flush();}
function publicProfile(p){const x=BrawlCore.clone(p);delete x._cityPlayClock;delete x._challenge;delete x._lastAnswer;delete x._lastWriting;delete x._studyClock;delete x._houseClock;delete x._dictationRun;delete x._visitUse;delete x._simTimeLedger;delete x._learningCompleted;return x;}
function publicQuestion(q){const x=BrawlCore.clone(q);delete x.answer;delete x.speech;delete x.explanation;return x;}
function doPost(e) {
  const lock=LockService.getScriptLock();
  try {
    if(!e||!e.postData||e.postData.contents.length>300000)throw Error('Requête invalide.');
    requestFamily=null;requestParent=null;requestFamilyMap=null;requestAuthRows=new Map();requestDB=null;
    const req=JSON.parse(e.postData.contents);if(typeof req.player!=='string'||req.player.length>100)throw Error('Profil invalide.');
    // Limitation par profil, y compris les clés incorrectes. Le quota n'est pas un compteur de récompense.
    const cache=CacheService.getScriptCache(),rateKey='rate:'+req.player+':'+Math.floor(Date.now()/60000);
    const rate=Number(cache.get(rateKey)||0);if(rate>=180)throw Error('Trop de requêtes. Réessaie dans une minute.');cache.put(rateKey,String(rate+1),60);
    // Read-only connection polls do not queue behind unrelated game saves.
    if(req.action==='duelSync'&&!req.answer&&(req.candidates===undefined||Array.isArray(req.candidates)&&req.candidates.length===0)){authScope(req);return jsonResponse(handleDuelAction(req));}
    lock.waitLock(15000);
    const auth=handleAuthAction(req);if(auth)return jsonResponse(auth);
    authScope(req);
    const city=typeof handleCityAction==='function'?handleCityAction(req):null;if(city)return jsonResponse(city);
    const wordLists=typeof handleWordLists==='function'?handleWordLists(req):null;if(wordLists)return jsonResponse(wordLists);
    if(req.action==='statsDirectory')return jsonResponse(statsDirectory(req));
    if(req.action==='parentCheck'){if(!isParent(req.parentToken))throw Error('Clé parent incorrecte.');return jsonResponse({ok:true});}
    const family=handleFamilyAction(req);if(family)return jsonResponse(family);
    const batch=handleBatchAction(req);if(batch)return jsonResponse(batch);
    const visit=handleVisitBatch(req);if(visit)return jsonResponse(visit);
    const social=handleSocialAction(req);if(social)return jsonResponse(social);
    const duel=handleDuelAction(req);if(duel)return jsonResponse(duel);
    const lobby=handleLobbyAction(req);if(lobby)return jsonResponse(lobby);
    if(!isParent(req.parentToken))authenticate(req.player,req.token);
    const record=profileRecord(req.player),day=Utilities.formatDate(new Date(),TZ,'yyyy-MM-dd');let p=record.profile;
    const fireDuty=typeof handleCityFire==='function'?handleCityFire(req,record,day):null;if(fireDuty)return jsonResponse(fireDuty);
    const living=typeof handleCityLiving==='function'?handleCityLiving(req,record,day):null;if(living)return jsonResponse(living);
    if(req.action==='housePulse'){p=BrawlCore.housePulse(p,Date.now(),req.active===true);record.profile=p;saveRecord(record);return jsonResponse({ok:true,profile:publicProfile(p)});}
    if(req.action==='studyPulse'){p=BrawlCore.studyPulse(p,day,Date.now(),req.active===true,req.skill);record.profile=p;saveRecord(record);return jsonResponse({ok:true,profile:publicProfile(p)});}
    if(req.action==='writingCheck')return jsonResponse(handleWritingCheck(req,record,day));
    const tradeResult=handleTradeAction(req,record);if(tradeResult)return jsonResponse(tradeResult);
    if(req.action==='state')return jsonResponse({ok:true,profile:publicProfile(p)});
    if(req.action==='parentCheck'){if(!isParent(req.parentToken))throw Error('Clé parent incorrecte.');return jsonResponse({ok:true});}
    if(req.action==='challenge') {
      if(!BrawlCore.studyEnabled(p,req.skill))throw Error('Cette activité n’est pas dans ton programme.');
      if(!BrawlCore.skills.some(s=>s.id===req.skill))throw Error('Activité inconnue.');
      let dictation=null;if(req.skill==='dictation'){const prepared=BrawlCore.prepareDictation(p,day);p=prepared.profile;dictation=prepared.run;if(dictation.index>=dictation.words.length){record.profile=p;saveRecord(record);return jsonResponse({ok:true,finished:true,total:dictation.words.length,missed:dictation.missed,profile:publicProfile(p)});}}
      const q=BrawlCore.question(req.skill,p.grade,undefined,dictation?[dictation.words[dictation.index]]:undefined,['digits','numbers','large'].includes(req.numberMode)?req.numberMode:'digits',req.mathOptions);if(dictation){q.dictationIndex=dictation.index;q.dictationTotal=dictation.words.length;}q.id=Utilities.getUuid();q.attempts=0;q.created=Date.now();p._challenge=q;record.profile=p;saveRecord(record);
      return jsonResponse({ok:true,question:publicQuestion(q)});
    }
    if(req.action==='answer') {
      if(typeof req.requestId!=='string'||req.requestId.length>100||String(req.answer).length>300)throw Error('Réponse invalide.');
      if(p._lastAnswer&&p._lastAnswer.id===req.requestId)return jsonResponse({...p._lastAnswer.result,profile:publicProfile(p)});
      const q=p._challenge;if(!q||q.id!==req.challengeId||Date.now()-q.created>3600000)throw Error('Cette question a expiré. Demande la suivante.');
      if(q.done)throw Error('Question déjà terminée.');const correct=BrawlCore.correct(q,req.answer),first=q.attempts===0;q.attempts++;
      if(correct){q.done=true;p=BrawlCore.apply(p,{type:'study',skill:q.skill,id:q.id,first},day,false);if(q.skill==='dictation')p=BrawlCore.advanceDictation(p,day,q.dictationIndex);}
      const result={ok:true,correct,explanation:correct||q.attempts>=2?q.explanation:''};p._lastAnswer={id:req.requestId,result};record.profile=p;saveRecord(record);return jsonResponse({...result,profile:publicProfile(p)});
    }
    if(req.action==='speak'||req.action==='copyWord'||req.action==='reveal') {
      const q=p._challenge;if(!q||q.id!==req.challengeId||Date.now()-q.created>3600000)throw Error('Cette question a expiré.');
      if(req.action==='speak'||req.action==='copyWord'){if(req.action==='copyWord'){q.attempts=Math.max(1,q.attempts);record.profile=p;saveRecord(record);}if(!['dictation','number-dictation'].includes(q.skill))throw Error('Ce mode ne propose pas de dictée.');return jsonResponse({ok:true,word:q.answer});}
      q.done=true;if(q.skill==='dictation')p=BrawlCore.advanceDictation(p,day,q.dictationIndex,true);record.profile=p;saveRecord(record);return jsonResponse({ok:true,explanation:q.explanation});
    }
    if(req.action==='event') {
      const ev=req.event;if(['carUse','cityWorkReward'].includes(ev?.type))throw Error('Utilise la séance de conduite.');if(!ev||typeof ev.id!=='string')throw Error('Action invalide.');
      if(ev.type==='study')throw Error('Les récompenses de pratique sont calculées par le serveur.');
      const privileged=['reviewTask','addTask','dictationList'].includes(ev.type);if(privileged&&!isParent(req.parentToken))throw Error('Clé parent nécessaire.');
      if(ev.type==='writing')throw Error('La récompense d’écriture exige la reconnaissance du tracé par le serveur.');
      if(ev.type==='room'&&!p.seen.includes(ev.id)&&ev.revision!==p.revision)throw Error('Le plan a changé sur un autre appareil. Actualise le profil avant de continuer.');
      const replay=p.seen.includes(ev.id);p=BrawlCore.apply(p,ev,day,isParent(req.parentToken));record.profile=p;saveRecord(record);
      // Le profil constitue le journal faisant autorité. Un audit indisponible ne rejoue pas le paiement.
      if(!replay){try{activeDB().getSheetByName('Journal').appendRow([new Date().toISOString(),p.id,sheetText(ev.id),ev.type,p.coins,p.xp,p.revision]);}catch(auditError){console.error('Journal indisponible : '+auditError.message);}}
      return jsonResponse({ok:true,profile:publicProfile(p)});
    }
    throw Error('Action inconnue.');
  }catch(err){return jsonResponse({ok:false,error:err.message||String(err)});}finally{requestFamily=null;requestParent=null;requestFamilyMap=null;requestAuthRows=new Map();requestDB=null;if(lock.hasLock())lock.releaseLock();}
}
/** Installation idempotente : aucun profil de démonstration, aucune donnée effacée. */
function initializeBrawl() {
  const lock=LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const ss=SpreadsheetApp.getActiveSpreadsheet();
    if(!ss)throw Error('Ouvre ta feuille Google Sheets puis Extensions > Apps Script pour installer ce code.');
    const props=properties(),bound=props.getProperty('DB_ID');
    if(bound&&bound!==ss.getId())throw Error('Ce projet est déjà lié à une autre feuille. Utilise le projet Apps Script de cette feuille.');
    const schema=[
      ['Profils',['id','prenom','annee','etat_json','maj_iso']],
      ['Journal',['date_iso','profil_id','requete_id','action','pieces_apres','xp_apres','revision']],
      ['EtatsProfils',['version_id','fragment','json']],
      ['ProfilsArchives',['id','prenom','annee','etat_archive','suppression_iso']],
      ['Echanges_V2',['id','de','vers','carte_offerte','carte_demandee','statut','cree_iso']],
      ['Lobby',['profil','derniere_presence','actif']],
      ['Invitations',['id','de','vers','offre','reponse','statut','cree_ms']]
    ];
    // Contrôler toutes les feuilles avant toute modification de structure.
    schema.forEach(([name,headers])=>{
      const sheet=ss.getSheetByName(name);
      if(sheet&&sheet.getLastRow()>0){const actual=sheet.getRange(1,1,1,headers.length).getValues()[0];if(headers.some((h,i)=>actual[i]!==h))throw Error('En-têtes incompatibles dans '+name+'. Aucune colonne n’a été remplacée.');}
    });
    schema.forEach(([name,headers])=>{
      const sheet=ss.getSheetByName(name)||ss.insertSheet(name);
      if(sheet.getLastRow()===0)sheet.appendRow(headers);
      sheet.setFrozenRows(1);
      sheet.getRange(1,1,1,headers.length).setBackground('#189b57').setFontColor('#ffffff').setFontWeight('bold');
      sheet.autoResizeColumns(1,headers.length);
    });
    ss.setSpreadsheetTimeZone(TZ);
    props.setProperty('DB_ID',ss.getId());
    if(!props.getProperty('PARENT_HASH')){
      const key=Utilities.getUuid()+Utilities.getUuid();
      props.setProperty('PARENT_HASH',digestKey(key));
      console.log('CLÉ PARENT — conserve-la en lieu sûr : '+key);
    }else console.log('La clé parent existante est conservée. Si tu l’as perdue, exécute rotateParentKey.');
    authInstall();props.setProperty('DB_SCHEMA','3');
    console.log('Installation terminée : 14 onglets prêts. Inscription parent disponible dans l’application. Aucun enfant fictif créé. Ajoute tes enfants dans l’espace parent de l’application.');
  } finally {if(lock.hasLock())lock.releaseLock();}
}
/** À appeler depuis l'éditeur Apps Script avec vos propres paramètres. */
function createPlayer(id,name,grade,avatar) {
  if(!/^[a-z0-9_-]{1,60}$/i.test(id)||![4,5].includes(grade)||!name)throw Error('Paramètres du profil invalides.');
  const sheet=activeDB().getSheetByName('Profils');const rows=sheet.getDataRange().getValues();if(rows.slice(1).some(r=>String(r[0])===id))throw Error('Identifiant déjà utilisé.');
  const p=BrawlCore.upgrade(BrawlCore.makeProfile(id,String(name).slice(0,30),grade,avatar||'🦊')),key=Utilities.getUuid()+Utilities.getUuid();
  sheet.appendRow([id,sheetText(p.name),p.grade,encodeProfile(p),new Date().toISOString()]);properties().setProperty('PLAYER_'+id,digestKey(key));console.log('PROFIL '+id+' — CLÉ PERSONNELLE : '+key);
}
function rotateParentKey(){const key=Utilities.getUuid()+Utilities.getUuid();properties().setProperty('PARENT_HASH',digestKey(key));console.log('NOUVELLE CLÉ PARENT : '+key);}
function rotatePlayerKey(id){profileRecord(id);const key=Utilities.getUuid()+Utilities.getUuid();properties().setProperty('PLAYER_'+id,digestKey(key));console.log('NOUVELLE CLÉ '+id+' : '+key);}
/** Archivage non destructif des anciennes feuilles, exécuté seulement par le propriétaire.
 * SOURCE_ID = l'identifiant du Google Sheets obtenu après import de l'ancien XLSX.
 * Les montants réels, anciennes cartes et plans ne sont pas convertis sans décision humaine.
 */
function archiveLegacyWorkbook(sourceId) {
  const source=SpreadsheetApp.openById(sourceId),target=activeDB();if(source.getId()===target.getId())throw Error('Choisis une autre feuille source.');
  source.getSheets().forEach(s=>{const name=('Archive_'+s.getName()).slice(0,90);if(target.getSheetByName(name))throw Error('Archive déjà présente : '+name);s.copyTo(target).setName(name);});
  console.log('Archives copiées. Aucune économie ni collection n’a été fusionnée automatiquement.');
}
/** Sessions : ouverture légère, validation et écriture groupées à la fin. */
function houseFingerprint(p){return digestKey(JSON.stringify([p.room,p.household,p.sim,p.needs,p.appearance,p.furnitureColors,p.furnitureMaterials,p.supplies]));}
function handleBatchAction(req){
 if(!['learningStart','learningFinish','houseStart','houseBatch'].includes(req.action))return null;
 if(requestParent)throw Error('Connecte ton profil enfant.');
 const record=profileRecord(req.player),p=record.profile,now=Date.now(),cache=CacheService.getScriptCache(),day=Utilities.formatDate(new Date(),TZ,'yyyy-MM-dd');
 if(req.action==='houseStart'||req.action==='learningStart'){
  const id=Utilities.getUuid(),house=req.action==='houseStart',grant={player:p.id,created:now,revision:p.revision,skill:house?'house':req.skill,questions:[]};if(house)grant.houseStamp=houseFingerprint(p);
  if(!house){if(req.skill!=='writing'&&!BrawlCore.skills.some(s=>s.id===req.skill)||!BrawlCore.studyEnabled(p,req.skill))throw Error('Activité indisponible.');if(req.skill!=='writing'){let words=req.skill==='dictation'?(p.dictation?.[BrawlCore.weekOf(day)]||[]):null;if(words&&!words.length)throw Error('Ton parent doit ajouter les mots de la semaine.');if(words){const prepared=BrawlCore.prepareDictation(p,day);grant.dictationOffset=prepared.run.index;grant.dictationWords=prepared.run.words;grant.missed=prepared.run.missed;words=words.slice(prepared.run.index);}grant.questions=Array.from({length:words?words.length:5},(_,i)=>{const q=BrawlCore.question(req.skill,p.grade,undefined,words?[words[i]]:undefined,req.numberMode,req.mathOptions);q.id=id+':'+i;return q;});}}
  cache.put('batch:'+id,JSON.stringify(grant),7200);return {ok:true,sessionId:id,questions:grant.questions,offset:grant.dictationOffset||0,total:grant.dictationWords?.length||grant.questions.length,missed:grant.missed||[],created:now,revision:p.revision};
 }
 if(typeof req.sessionId!=='string'||typeof req.requestId!=='string'||req.requestId.length>80)throw Error('Séance invalide.');
 if(p.seen.includes('batch:'+req.requestId))return {ok:true,profile:publicProfile(p),replay:true};
 const grant=JSON.parse(cache.get('batch:'+req.sessionId)||'null');if(!grant||grant.player!==p.id||now-grant.created>7200000)throw Error('Séance expirée. Tes résultats locaux sont conservés.');let next=p;
 if(req.action==='houseBatch'){
  if(grant.skill!=='house'||!Array.isArray(req.events)||req.events.length>220)throw Error('Session maison invalide.');if(!Number.isInteger(req.revision)||req.revision<grant.revision||req.revision>p.revision||req.revision!==p.revision&&grant.houseStamp!==houseFingerprint(p))throw Error('Le compte a changé sur un autre appareil. Ton brouillon local est conservé.');
  const allowed=['roomTerrain','houseTranslate','roomDimensions','room','houseControl','houseMove','houseOrder','houseCare','simOrder','simTick','simMeet','simMoveIn','simCancel','simLight','furnitureFinish','appearance'];let seconds=0;
  for(const e of req.events){if(!allowed.includes(e.type)||e.type==='furnitureFinish'&&e.finish?.mode==='palette')throw Error('Cette action exige une confirmation séparée.');if(e.type==='simTick'){if(!Number.isFinite(e.seconds)||e.seconds<0||e.seconds>60)throw Error('Durée invalide.');seconds+=e.seconds;}next=BrawlCore.apply(next,e,day,false);}
  if(seconds+(p._simTimeLedger?.[req.sessionId]||0)>(now-grant.created)/1000+3)throw Error('Le temps de simulation dépasse la séance réelle.');next._simTimeLedger={...p._simTimeLedger,[req.sessionId]:(p._simTimeLedger?.[req.sessionId]||0)+seconds};
 }else{
  if(p._learningCompleted?.includes(req.sessionId))return {ok:true,profile:publicProfile(p),replay:true};if(!BrawlCore.studyEnabled(p,grant.skill))throw Error('Ton parent a désactivé cette activité.');const entries=req.entries;if(!Array.isArray(entries)||entries.length>(grant.skill==='writing'?10:grant.questions.length))throw Error('Résultats invalides.');
  if(grant.skill==='writing')for(let i=0;i<entries.length;i++){const entry=entries[i];if(typeof entry.target!=='string'||entry.target.length>16)throw Error('Écriture invalide.');const result=HandwritingRecognizer.evaluateOCR(entry.segments,entry.target,entry.ocr);if(result.accepted)next=BrawlCore.apply(next,{type:'writing',id:req.sessionId+':'+i,symbol:entry.target},day,false);}
  else for(let i=0;i<entries.length;i++){const q=grant.questions[i],entry=entries[i];const dictation=grant.skill==='dictation'&&JSON.stringify(next.dictation?.[BrawlCore.weekOf(day)]||[])===JSON.stringify(grant.dictationWords),index=(grant.dictationOffset||0)+i;if(dictation){const prepared=BrawlCore.prepareDictation(next,day);next=prepared.profile;if(prepared.run.index>index)continue;}if(!Array.isArray(entry.answers)||entry.answers.length>10||entry.answers.some(a=>typeof a!=='string'||a.length>300))throw Error('Réponses invalides.');const success=entry.answers.findIndex(a=>BrawlCore.correct(q,a));if(success>=0)next=BrawlCore.apply(next,{type:'study',id:q.id,skill:q.skill,first:success===0&&!entry.copied},day,false);if(dictation){if(success>=0||entry.skipped)next=BrawlCore.advanceDictation(next,day,index,success<0);else break;}}
  const seconds=Number(req.seconds||0);if(!Number.isFinite(seconds)||seconds<0||seconds>3600||seconds>(now-grant.created)/1000+3)throw Error('Durée de pratique invalide.');let cursor=now-seconds*1000;next._studyClock={now:cursor,day:day,active:true};for(let left=seconds;left>0;){const step=Math.min(20,left);cursor+=step*1000;next=BrawlCore.studyPulse(next,day,cursor,true,grant.skill);left-=step;}next._learningCompleted=(p._learningCompleted||[]).concat(req.sessionId).slice(-100);
 }
 next.seen.push('batch:'+req.requestId);next.seen=next.seen.slice(-500);record.profile=next;saveRecord(record);if(req.action==='houseBatch'){grant.houseStamp=houseFingerprint(next);cache.put('batch:'+req.sessionId,JSON.stringify(grant),Math.max(1,Math.floor((7200000-(now-grant.created))/1000)));}return {ok:true,profile:publicProfile(next)};
}

