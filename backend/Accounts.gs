/** Gestion parent authentifiée ; suppression confirmée et copie d'archive avant retrait. */
function handleFamilyAction(req){
  if(!['familyList','familyCreate','familyUpdate','familyDelete','familyKey'].includes(req.action))return null;
  if(!isParent(req.parentToken))throw Error('Clé parent nécessaire.');
  const sheet=activeDB().getSheetByName('Profils');
  const list=()=>lobbyProfiles().slice(1).filter(r=>r[0]&&authProfileAllowed(r[0])).map(r=>publicProfile(profileRecord(r[0]).profile));
  if(req.action==='familyList')return {ok:true,profiles:list()};
  if(req.action==='familyCreate'){
    const id=String(req.childId||(requestParent!=='legacy'?Utilities.getUuid():''));if(!/^[a-z0-9_-]{1,60}$/i.test(id))throw Error('Identifiant : lettres, chiffres, tirets, 60 caractères maximum.');
    if(sheet.getDataRange().getValues().slice(1).some(r=>String(r[0])===id))throw Error('Cet identifiant existe déjà.');
    const p=BrawlCore.parentEdit(BrawlCore.upgrade(BrawlCore.makeProfile(id,'Nouvel enfant',4,'🦊')),req.patch||{}),key=Utilities.getUuid()+Utilities.getUuid();
    sheet.appendRow([id,sheetText(p.name),p.grade,encodeProfile(p),new Date().toISOString()]);if(requestFamily&&requestFamily!=='legacy')authSheet('EnfantsFamilles').appendRow([id,requestFamily]);requestFamilyMap=null;properties().setProperty('PLAYER_'+id,digestKey(key));return {ok:true,profiles:list(),childKey:key};
  }
  const record=profileRecord(String(req.childId));
  if(req.action==='familyUpdate'){if(req.revision!==record.profile.revision)throw Error('Ce compte a changé. Actualise la liste avant de modifier.');record.profile=BrawlCore.parentEdit(record.profile,req.patch);saveRecord(record);return {ok:true,profiles:list()};}
  if(req.action==='familyKey'){const key=Utilities.getUuid()+Utilities.getUuid();properties().setProperty('PLAYER_'+record.profile.id,digestKey(key));return {ok:true,childKey:key};}
  if(req.confirmName!==record.profile.name)throw Error('Recopie le prénom pour confirmer la suppression.');
  let archive=activeDB().getSheetByName('ProfilsArchives');if(!archive){archive=activeDB().insertSheet('ProfilsArchives');archive.appendRow(['id','prenom','annee','etat_archive','suppression_iso']);}
  archive.appendRow([record.profile.id,sheetText(record.profile.name),record.profile.grade,encodeProfile(record.profile),new Date().toISOString()]);properties().deleteProperty('PLAYER_'+record.profile.id);authRevokeChild(record.profile.id);sheet.deleteRow(record.row);return {ok:true,profiles:list()};
}
function encodeProfile(p){
  const text=JSON.stringify(p);if(text.length<45000)return text;
  const ss=activeDB();let sheet=ss.getSheetByName('EtatsProfils');if(!sheet){sheet=ss.insertSheet('EtatsProfils');sheet.appendRow(['version_id','fragment','json']);}
  const key=p.id+':'+Utilities.getUuid(),chunks=[];for(let i=0;i<text.length;i+=40000)chunks.push([key,chunks.length,sheetText(text.slice(i,i+40000))]);
  const start=sheet.getLastRow()+1;sheet.getRange(start,1,chunks.length,3).setValues(chunks);return JSON.stringify({_chunks:key,count:chunks.length,start:start});
}
function decodeProfile(value){const p=JSON.parse(value);if(!p._chunks)return p;const sheet=activeDB().getSheetByName('EtatsProfils');if(!sheet)throw Error('Fragments du profil manquants.');const rows=Number.isInteger(p.start)&&p.start>=2&&Number.isInteger(p.count)&&p.count>0?sheet.getRange(p.start,1,p.count,3).getValues():sheet.getDataRange().getValues().slice(1).filter(r=>r[0]===p._chunks).sort((a,b)=>a[1]-b[1]);if(rows.some((r,i)=>r[0]!==p._chunks||Number(r[1])!==i))throw Error('Fragments du profil incohérents.');if(rows.length!==p.count)throw Error('Profil incomplet.');return JSON.parse(rows.map(r=>r[2]).join(''));}
