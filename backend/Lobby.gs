/** Présence et signalisation uniquement : le jeu passe ensuite par RTCDataChannel. */
function lobbySheet(name,headers){let s=activeDB().getSheetByName(name);if(!s){s=activeDB().insertSheet(name);s.appendRow(headers);}return s;}
function lobbyProfiles(){const sheet=activeDB().getSheetByName('Profils');return sheet.getRange(1,1,sheet.getLastRow(),3).getValues();}
function handleLobbyAction(req){
  if(!['lobbyPulse','lobbyLeave','lobbyInvite','lobbyReply'].includes(req.action))return null;
  authenticate(req.player,req.token);const p={id:req.player},now=Date.now(),presence=lobbySheet('Lobby',['profil','derniere_presence','actif']),invites=lobbySheet('Invitations',['id','de','vers','offre','reponse','statut','cree_ms']);
  const rows=presence.getDataRange().getValues(),index=rows.findIndex((r,i)=>i&&r[0]===p.id),presenceRow=[p.id,now,req.action==='lobbyLeave'?'no':'yes'];if(index>=1)presence.getRange(index+1,1,1,3).setValues([presenceRow]);else presence.appendRow(presenceRow);
  if(req.action==='lobbyLeave')return {ok:true};
  const all=invites.getDataRange().getValues();
  if(req.action==='lobbyInvite'){
    if(req.to===p.id||typeof req.inviteId!=='string'||!/^[a-z0-9-]{5,80}$/i.test(req.inviteId)||typeof req.offer!=='string'||req.offer.length>40000)throw Error('Invitation invalide.');profileRecord(String(req.to));
    if(all.slice(1).filter(r=>r[1]===p.id&&r[5]==='pending'&&now-Number(r[6])<120000).length>=3)throw Error('Une invitation est déjà en attente.');
    if(!all.some(r=>r[0]===req.inviteId))invites.appendRow([req.inviteId,p.id,req.to,sheetText(req.offer),'','pending',now]);return {ok:true};
  }
  if(req.action==='lobbyReply'){
    const index=all.findIndex((r,i)=>i&&r[0]===req.inviteId),r=all[index];if(!r||r[2]!==p.id||r[5]!=='pending'||now-Number(r[6])>120000)throw Error('Invitation expirée.');
    if(!['accept','reject'].includes(req.decision)||req.decision==='accept'&&(typeof req.answer!=='string'||req.answer.length>40000))throw Error('Réponse invalide.');
    invites.getRange(index+1,5,1,2).setValues([[req.decision==='accept'?sheetText(req.answer):'',req.decision==='accept'?'accepted':'rejected']]);return {ok:true};
  }
  const directory=lobbyProfiles().slice(1),online=new Set(rows.slice(1).filter(r=>r[2]==='yes'&&now-Number(r[1])<45000).map(r=>r[0]));online.add(p.id);
  return {ok:true,online:directory.filter(r=>online.has(r[0])&&authProfileAllowed(r[0])).map(r=>({id:r[0],name:r[1]})),duels:duelInbox(req.player),invitations:all.slice(1).filter(r=>(r[1]===p.id||r[2]===p.id)&&now-Number(r[6])<120000).map(r=>({id:r[0],from:r[1],to:r[2],offer:r[2]===p.id?r[3]:'',answer:r[1]===p.id?r[4]:'',status:r[5]}))};
}

/** Sheets keeps invitations; CacheService holds short-lived SDP/ICE only.
 * No move, HP, animation or position message is accepted by these endpoints. */
function duelTable(){return lobbySheet('Duels',['id','hote','invite','statut','cree_ms']);}
function duelInbox(player){const sheet=activeDB().getSheetByName('Duels');if(!sheet)return [];const now=Date.now(),names=lobbyProfiles();return sheet.getDataRange().getValues().slice(1).filter(r=>r[2]===player&&r[3]==='waiting'&&now-Number(r[4])<180000&&authProfileAllowed(r[1])).slice(-10).map(r=>({row:r,room:JSON.parse(CacheService.getScriptCache().get('duel:'+r[0])||'null')})).filter(x=>x.room&&x.room.status!=='cancelled'&&now-(x.room.hostSeen||x.room.created)<=35000).map(({row:r,room})=>({id:r[0],from:r[1],purpose:room.purpose||'duel',name:String(names.find(n=>n[0]===r[1])?.[1]||'Un ami')}));}
function duelDescription(value,type){if(!value||value.type!==type||typeof value.sdp!=='string'||value.sdp.length>16000||!value.sdp.startsWith('v=0'))throw Error('Description réseau invalide.');return {type:type,sdp:value.sdp};}
function duelCandidates(values){if(values===undefined)return [];if(!Array.isArray(values)||values.length>20)throw Error('Informations réseau invalides.');return values.map(v=>{if(!v||typeof v.candidate!=='string'||v.candidate.length>1500||typeof v.sdpMid!=='string'&&v.sdpMid!==null||v.sdpMLineIndex!==null&&(!Number.isInteger(v.sdpMLineIndex)||v.sdpMLineIndex<0||v.sdpMLineIndex>20))throw Error('Adresse réseau invalide.');return {candidate:v.candidate,sdpMid:v.sdpMid,sdpMLineIndex:v.sdpMLineIndex};});}
function handleDuelAction(req){
 if(!['duelCreate','duelSync','duelCancel','peerCodeCreate','peerCodeJoin','peerCodeApprove'].includes(req.action))return null;
 if(requestParent)throw Error('Connecte un profil enfant pour jouer.');
 let id=req.roomId;if(req.action==='peerCodeJoin'){authThrottle('peer-code:'+req.player,30);if(!/^[0-9]{1,4}$/.test(String(req.code||'')))throw Error('Entre un code de 4 chiffres.');id=CacheService.getScriptCache().get('peer-code:'+String(req.code).padStart(4,'0'));if(!id)throw Error('Code incorrect ou expiré.');}
 if(typeof id!=='string'||!/^[a-z0-9-]{10,80}$/i.test(id))throw Error('Invitation invalide.');
 const cache=CacheService.getScriptCache(),key='duel:'+id,now=Date.now();let room=JSON.parse(cache.get(key)||'null');
 if(req.action==='peerCodeCreate'){
  if(!['duel','house'].includes(req.purpose))throw Error('Type de rencontre invalide.');
  if(room){if(room.host!==req.player||!room.publicCode||room.status==='cancelled')throw Error('Invitation déjà utilisée.');return {ok:true,code:room.code,roomId:id};}
  const table=duelTable(),rows=table.getDataRange().getValues();if(rows.some(r=>r[0]===id))throw Error('Invitation expirée. Crée une nouvelle rencontre.');if(rows.slice(1).filter(r=>r[1]===req.player&&['waiting','code'].includes(r[3])&&now-Number(r[4])<180000).length>=2)throw Error('Annule ton invitation actuelle avant d’en créer une autre.');
  let code=null;for(let n=0;n<100;n++){const candidate=String(Math.floor(Math.random()*10000)).padStart(4,'0');if(!cache.get('peer-code:'+candidate)){code=candidate;break;}}if(!code)throw Error('Réessaie dans quelques secondes.');
  room={host:req.player,guest:null,created:now,offer:duelDescription(req.offer,'offer'),answer:null,ice:[[],[]],row:table.getLastRow()+1,hostSeen:now,status:'code',code:code,publicCode:true,approved:false,purpose:req.purpose};
  cache.put(key,JSON.stringify(room),180);cache.put('peer-code:'+code,id,180);table.appendRow([id,req.player,'','code',now]);return {ok:true,code:code,roomId:id};
 }
 if(req.action==='peerCodeJoin'){
  if(!room||!room.publicCode||now-room.created>=180000||room.status==='cancelled')throw Error('Code incorrect ou expiré.');
  if(now-(room.hostSeen||room.created)>35000)throw Error('Ton ami a quitté le jeu. Demande une nouvelle invitation.');
  if(room.host===req.player)throw Error('Ce code appartient à ton propre appareil.');if(room.guest&&room.guest!==req.player)throw Error('Ce code est déjà utilisé.');
  room.guest=req.player;room.approved=room.approved||authSameFamily(room.host,req.player);cache.put(key,JSON.stringify(room),180);duelTable().getRange(room.row,3).setValue(req.player);
  return {ok:true,roomId:id,purpose:room.purpose,approvalRequired:!room.approved};
 }
 if(req.action==='duelCreate'){
  if(req.to===req.player||typeof req.to!=='string'||!authProfileAllowed(req.to))throw Error('Choisis un élève de ta famille.');
  // Check the target exists without decoding either child's large collection.
  const profiles=lobbyProfiles();if(!profiles.some((r,i)=>i&&r[0]===req.to))throw Error('Profil introuvable.');
  const offer=duelDescription(req.offer,'offer'),table=duelTable(),rows=table.getDataRange().getValues();
  const existing=rows.find(r=>r[0]===id);if(existing){if(!room||room.host!==req.player||room.guest!==req.to||JSON.stringify(room.offer)!==JSON.stringify(offer))throw Error('Invitation déjà utilisée.');return {ok:true};}
  if(rows.slice(1).filter(r=>r[1]===req.player&&r[3]==='waiting'&&now-Number(r[4])<180000).length>=2)throw Error('Une invitation est déjà en attente.');
  room={host:req.player,guest:req.to,created:now,offer:offer,answer:null,ice:[duelCandidates(req.candidates),[]],row:table.getLastRow()+1,hostSeen:now,purpose:req.purpose==='house'?'house':'duel',status:'waiting'};
  cache.put(key,JSON.stringify(room),180);table.appendRow([id,room.host,room.guest,'waiting',now]);return {ok:true};
 }
 if(!room||now-room.created>=180000)throw Error('Invitation expirée. Crée un nouveau duel.');
 if(req.player!==room.host&&req.player!==room.guest||!room.publicCode&&(!authProfileAllowed(room.host)||!authProfileAllowed(room.guest)))throw Error('Cette invitation ne t’est pas destinée.');
 if(req.action!=='duelCancel'&&now-(room.hostSeen||room.created)>35000)throw Error('Invitation expirée : ton ami a quitté le jeu.');
 if(req.player===room.host){room.hostSeen=now;cache.put(key,JSON.stringify(room),180);}
 if(req.action==='peerCodeApprove'){if(req.player!==room.host||!room.publicCode||!room.guest||room.status==='cancelled')throw Error('Demande invalide.');room.approved=true;cache.put(key,JSON.stringify(room),180);return {ok:true};}
 if(req.action==='duelCancel'){room.status='cancelled';cache.put(key,JSON.stringify(room),180);duelTable().getRange(room.row,4).setValue('cancelled');return {ok:true};}
 if(room.status==='cancelled')return {ok:true,cancelled:true};
 if(room.publicCode&&!room.approved&&req.player===room.guest)return {ok:true,pending:true,description:null,candidates:[],next:0};
 const side=req.player===room.host?0:1,remote=1-side,candidates=duelCandidates(req.candidates);let changed=false;
 if(req.answer){if(side!==1)throw Error('Seul l’invité peut répondre.');const answer=duelDescription(req.answer,'answer');if(room.answer&&JSON.stringify(room.answer)!==JSON.stringify(answer))throw Error('Réponse déjà enregistrée.');if(!room.answer){room.answer=answer;room.status='accepted';changed=true;}}
 for(const candidate of candidates){if(!room.ice[side].some(c=>JSON.stringify(c)===JSON.stringify(candidate))){if(room.ice[side].length>=40)throw Error('Trop d’adresses réseau.');room.ice[side].push(candidate);changed=true;}}
 if(changed){const encoded=JSON.stringify(room);if(encoded.length>80000)throw Error('Trop d’informations réseau.');cache.put(key,encoded,180);if(room.status==='accepted')duelTable().getRange(room.row,4).setValue('accepted');}
 const after=req.after??0;if(!Number.isInteger(after)||after<0||after>40)throw Error('Curseur invalide.');
 const request=room.publicCode&&room.guest&&!room.approved&&side===0?{id:room.guest,name:String(lobbyProfiles().find(r=>r[0]===room.guest)?.[1]||'Un ami')}:null;
 return {ok:true,request:request,description:side===0?room.answer:room.offer,candidates:room.ice[remote].slice(after),next:room.ice[remote].length};
}
/** Présence de jeu et autorisations de visite. Les positions restent en P2P. */
function socialPresence(id){return JSON.parse(CacheService.getScriptCache().get('playing:'+id)||'null');}
function socialOnline(id){const p=socialPresence(id);return !!p&&Date.now()-p.at<35000;}
function livePeer(req){const cache=CacheService.getScriptCache(),key='live:'+req.roomId,room=JSON.parse(cache.get(key)||'null');if(!room||room.closed||![room.host,room.guest].includes(req.player))throw Error('La visite est terminée.');return {cache,key,room};}
function handleSocialAction(req){
 if(!['notifications','activityLeave','peerPulse','peerClose','visitUse'].includes(req.action))return null;
 if(requestParent)throw Error('Connecte un profil enfant pour jouer.');
 const cache=CacheService.getScriptCache(),now=Date.now();
 if(req.action==='notifications'){
  const route=String(req.route||'').slice(0,40);cache.put('playing:'+req.player,JSON.stringify({at:now,route}),45);
  const names=lobbyProfiles(),name=id=>String(names.find(r=>r[0]===id)?.[1]||'Un ami'),items=duelInbox(req.player).map(i=>({...i,type:'invite',label:i.purpose==='house'?'t’invite chez lui':'te propose un duel'}));
  const table=activeDB().getSheetByName('Duels');if(table)for(const r of table.getDataRange().getValues().slice(1)){
   if(r[1]!==req.player||now-Number(r[4])>=180000)continue;
   const room=JSON.parse(cache.get('duel:'+r[0])||'null');
   if(room&&room.status!=='cancelled'&&room.publicCode&&room.guest&&!room.approved)items.push({id:r[0],type:'request',name:name(room.guest),purpose:room.purpose,label:'demande à te rejoindre'});
  }
  for(const t of readTrades().filter(t=>t.to===req.player&&t.status==='pending'&&authProfileAllowed(t.from)).slice(-30))items.push({id:t.id,type:'trade',name:name(t.from),offer:t.offer,request:t.request,label:'te propose un échange',available:socialOnline(t.from)});
  return {ok:true,items};
 }
 if(req.action==='activityLeave'){
  cache.put('playing:'+req.player,'null',1);
  const table=activeDB().getSheetByName('Duels');if(table)for(const r of table.getDataRange().getValues().slice(1))if(r[1]===req.player&&now-Number(r[4])<180000){const key='duel:'+r[0],room=JSON.parse(cache.get(key)||'null');if(room){room.status='cancelled';cache.put(key,JSON.stringify(room),180);table.getRange(room.row,4).setValue('cancelled');}}
  if(req.roomId){try{const live=livePeer(req);live.room.closed=true;live.cache.put(live.key,JSON.stringify(live.room),300);}catch(ignore){}}
  return {ok:true};
 }
 if(req.action==='peerPulse'){
  if(typeof req.roomId!=='string'||!/^[a-z0-9-]{10,80}$/i.test(req.roomId))throw Error('Rencontre invalide.');
  const key='live:'+req.roomId;let room=JSON.parse(cache.get(key)||'null');
  if(!room){const pending=JSON.parse(cache.get('duel:'+req.roomId)||'null');if(!pending||pending.status==='cancelled'||!pending.guest||pending.publicCode&&!pending.approved||![pending.host,pending.guest].includes(req.player)||now-pending.created>180000||now-(pending.hostSeen||pending.created)>35000)throw Error('Rencontre expirée.');room={host:pending.host,guest:pending.guest,purpose:pending.purpose||'duel',seen:{},created:now};}
  if(room.closed||![room.host,room.guest].includes(req.player))throw Error('La rencontre est terminée.');
  const expected=room.purpose==='house'?'apartment':'battle';if(req.route!==expected){room.closed=true;cache.put(key,JSON.stringify(room),300);return {ok:true,closed:true};}
  room.seen[req.player]=now;const other=req.player===room.host?room.guest:room.host;
  if(now-(room.seen[other]||room.created)>45000)room.closed=true;
  cache.put(key,JSON.stringify(room),300);return {ok:true,closed:!!room.closed};
 }
 const live=livePeer(req),room=live.room;
 if(req.action==='peerClose'){const pending=JSON.parse(cache.get('duel:'+req.roomId)||'null');if(pending){pending.status='cancelled';cache.put('duel:'+req.roomId,JSON.stringify(pending),180);duelTable().getRange(pending.row,4).setValue('cancelled');}room.closed=true;cache.put(live.key,JSON.stringify(room),300);return {ok:true};}
 if(room.purpose!=='house'||req.player!==room.guest||now-(room.seen[room.host]||0)>35000||now-(room.seen[room.guest]||0)>35000)throw Error('Ton ami n’est plus dans la maison.');
 if(typeof req.requestId!=='string'||!/^[a-z0-9-]{10,80}$/i.test(req.requestId))throw Error('Interaction invalide.');
 const visitor=profileRecord(req.player),p=visitor.profile;
 if(p._visitUse?.id===req.requestId&&p._visitUse.done)return {ok:true,profile:publicProfile(p)};
 // Autorisation étroite : lire le plan de l’hôte, sans accéder à son compte ni l’écrire.
 const sheet=activeDB().getSheetByName('Profils'),ids=sheet.getRange(2,1,sheet.getLastRow()-1,1).getValues(),index=ids.findIndex(r=>r[0]===room.host);if(index<0)throw Error('Maison indisponible.');
 const host=BrawlCore.upgrade(decodeProfile(sheet.getRange(index+2,4).getValues()[0][0])),placed=host.room.items.find(i=>i.id===req.item),item=BrawlCore.catalog.find(i=>i.id===req.item),pos=req.position;
 if(!placed||!item||!['food','energy','clean','fun'].includes(item.need)||p.household.player.dead)throw Error('Ce meuble ne peut pas être utilisé.');
 if(!pos||!Number.isFinite(pos.x)||!Number.isFinite(pos.y)||pos.x<0||pos.y<0||pos.x>=host.room.size||pos.y>=host.room.size||Math.hypot(pos.x-placed.x,pos.y-placed.y)>(placed.scale||1)+1.7)throw Error('Approche-toi du meuble.');
 const probe=BrawlCore.clone(p);probe.room=host.room;probe.household.player.position={...pos};const destination=BrawlCore.houseDestination(probe,'player',{food:'feed',energy:'rest',clean:'wash',fun:'play'}[item.need],req.item);if(!destination||destination.path.length>1||BrawlCore.houseBlocked(host.room,pos,pos)||BrawlCore.wallCrossed(host.room,pos,{x:placed.x+((placed.scale||1)-1)/2,y:placed.y+((placed.scale||1)-1)/2}))throw Error('Place-toi devant le meuble, sans mur entre vous.');
 if(req.stage==='begin'){
  if(p._visitUse?.id===req.requestId)return {ok:true,readyAt:p._visitUse.at+10000};
  if(p._visitUse&&!p._visitUse.done&&now-p._visitUse.at<12000)throw Error('Une interaction est déjà en cours.');
  p._visitUse={id:req.requestId,item:req.item,roomId:req.roomId,at:now,done:false};saveRecord(visitor);return {ok:true,readyAt:now+10000};
 }
 const use=p._visitUse;if(!use||use.id!==req.requestId||use.item!==req.item||use.roomId!==req.roomId||now-use.at<10000||now-use.at>60000)throw Error('Recommence cette interaction.');
 p.needs[item.need]=Math.min(100,p.needs[item.need]+Math.min(55,item.amount||30));use.done=true;p.revision++;saveRecord(visitor);return {ok:true,profile:publicProfile(p)};
}
function handleVisitBatch(req){
 if(req.action!=='visitBatch')return null;if(requestParent)throw Error('Connecte ton profil enfant.');
 if(!Array.isArray(req.entries)||req.entries.length>20)throw Error('Résultats de visite invalides.');const cache=CacheService.getScriptCache(),room=JSON.parse(cache.get('live:'+req.roomId)||'null'),now=Date.now();
 if(!room||room.purpose!=='house'||room.guest!==req.player)throw Error('Visite introuvable.');
 const visitor=profileRecord(req.player),sheet=activeDB().getSheetByName('Profils'),ids=sheet.getRange(2,1,sheet.getLastRow()-1,1).getValues(),row=ids.findIndex(r=>r[0]===room.host);if(row<0)throw Error('Maison introuvable.');const host=BrawlCore.upgrade(decodeProfile(sheet.getRange(row+2,4).getValues()[0][0]));let p=visitor.profile;
 for(const e of req.entries){if(typeof e.id!=='string'||e.id.length>80)throw Error('Interaction invalide.');const id='visit:'+e.id;if(p.seen.includes(id))continue;
  if(!Number.isFinite(e.started)||!Number.isFinite(e.finished)||e.started<room.created-3000||e.finished-e.started<10000||e.finished>now+3000||now-e.finished>7200000||e.finished>(room.seen[room.host]||room.created)+35000)throw Error('Interaction hors de la visite active.');const item=BrawlCore.catalog.find(i=>i.id===e.item),placed=host.room.items.find(i=>i.id===e.item),q=e.position;if(!item||!placed||!['food','clean','energy','fun'].includes(item.need)||!q||!Number.isFinite(q.x)||!Number.isFinite(q.y)||q.x<0||q.y<0||q.x>=host.room.size||q.y>=host.room.size||Math.hypot(q.x-placed.x,q.y-placed.y)>(placed.scale||1)+1.7||BrawlCore.wallCrossed(host.room,q,{x:placed.x,y:placed.y},0))throw Error('Meuble ou position invalide.');if(p.household.player.dead)throw Error('Ton personnage doit être réanimé.');p.needs[item.need]=Math.min(100,p.needs[item.need]+Math.min(55,item.amount||30));p.seen.push(id);p.revision++;
 }p.seen=p.seen.slice(-500);visitor.profile=p;saveRecord(visitor);return {ok:true,profile:publicProfile(p)};
}
