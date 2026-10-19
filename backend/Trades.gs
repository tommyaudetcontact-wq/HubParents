/** Appelé sous le verrou global de Code.gs. L'échange écrit les deux profils ensemble. */
function tradeSheet(){const ss=activeDB();let s=ss.getSheetByName('Echanges_V2');if(!s){s=ss.insertSheet('Echanges_V2');s.appendRow(['id','de','vers','carte_offerte','carte_demandee','statut','cree_iso']);s.setFrozenRows(1);}return s;}
function readTrades(){return tradeSheet().getDataRange().getValues().slice(1).filter(r=>r[0]).map((r,i)=>({id:String(r[0]),from:String(r[1]),to:String(r[2]),offer:String(r[3]),request:String(r[4]),status:String(r[5]),created:String(r[6]),row:i+2}));}
function handleTradeAction(req,record){if(!['trades','offerTrade','decideTrade'].includes(req.action))return null;const p=record.profile,all=readTrades();
  if(req.action==='trades'){const rows=activeDB().getSheetByName('Profils').getDataRange().getValues().slice(1);return {ok:true,directory:rows.filter(r=>r[0]&&authProfileAllowed(r[0])).map(r=>{const x=BrawlCore.upgrade(decodeProfile(r[3]));return {id:x.id,name:x.name,cards:x.cards.map(c=>c.id)};}),trades:all.filter(t=>t.from===p.id||t.to===p.id).map(t=>{const x={...t};delete x.row;return x;})};}
  if(req.action==='offerTrade'){
    CacheService.getScriptCache().put('playing:'+p.id,JSON.stringify({at:Date.now(),route:'cards'}),45);
    if(typeof req.requestId!=='string'||!/^[a-z0-9-]{5,80}$/i.test(req.requestId))throw Error('Identifiant de proposition invalide.');
    const replay=all.find(t=>t.id===req.requestId);if(replay){if(replay.from!==p.id)throw Error('Proposition invalide.');return {ok:true};}
    if(all.filter(t=>t.status==='pending'&&(t.from===p.id||t.to===p.id)).length>=30)throw Error('Traite les échanges en attente avant d’en ajouter.');
    const other=profileRecord(String(req.to));const t={id:req.requestId,from:p.id,to:other.profile.id,offer:req.offer,request:req.request};BrawlCore.exchange(p,other.profile,t);
    tradeSheet().appendRow([t.id,t.from,t.to,t.offer,t.request,'pending',new Date().toISOString()]);return {ok:true};
  }
  const t=all.find(t=>t.id===req.tradeId);if(!t)throw Error('Échange introuvable.');const decision=req.decision;
  if(!['accept','reject','cancel'].includes(decision))throw Error('Décision invalide.');if(decision==='cancel'?t.from!==p.id:t.to!==p.id)throw Error('Cette décision appartient à l’autre joueur.');
  const a=profileRecord(t.from),b=profileRecord(t.to),transaction='trade:'+t.id;
  // Réparation d'une réponse interrompue après l'écriture groupée des profils.
  if(a.profile.seen.includes(transaction)&&b.profile.seen.includes(transaction)){tradeSheet().getRange(t.row,6).setValue('accepted');return {ok:true,profile:publicProfile(p.id===a.profile.id?a.profile:b.profile)};}
  if(t.status!=='pending')throw Error('Échange déjà traité.');
  if(decision==='accept'){
    if(!socialOnline(t.from))throw Error('Ton ami est hors ligne. Attends son retour ou refuse cet échange.');
    const [x,y]=BrawlCore.exchange(a.profile,b.profile,t);const start=Math.min(a.row,b.row),end=Math.max(a.row,b.row),range=a.sheet.getRange(start,1,end-start+1,5),rows=range.getValues();const date=new Date().toISOString();
    rows[a.row-start]=[x.id,sheetText(x.name),x.grade,encodeProfile(x),date];rows[b.row-start]=[y.id,sheetText(y.name),y.grade,encodeProfile(y),date];
    range.setValues(rows);SpreadsheetApp.flush();tradeSheet().getRange(t.row,6).setValue('accepted');return {ok:true,profile:publicProfile(p.id===x.id?x:y)};
  }
  tradeSheet().getRange(t.row,6).setValue(decision==='cancel'?'cancelled':'rejected');return {ok:true,profile:publicProfile(p)};
}
