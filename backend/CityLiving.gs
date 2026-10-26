/** Timed, authenticated home interactions; no client supplied needs or rewards. */
function handleCityLiving(req,record,day){
 if(!['cityLivingStart','cityLivingFinish','cityLivingCancel','cityLivingPulse'].includes(req.action))return null;
 if(!BrawlCore.cityStandalone)throw Error('Le jeu autonome est désactivé.');
 const p=BrawlCore.upgrade(record.profile),now=Date.now();
 const save=()=>{p.revision++;record.profile=p;saveRecord(record);return {ok:true,profile:publicProfile(p),interaction:p.cityLiving.active||null};};
 if(req.action==='cityLivingPulse'){
  const elapsed=p.cityLiving.lastTick&&req.active===true?Math.max(0,Math.min(60,(now-p.cityLiving.lastTick)/1000)):0;p.cityLiving.lastTick=now;
  for(const [need,rate]of Object.entries({food:1.1,energy:.65,clean:.5,bladder:1,fun:.6})){p.needs[need]=Math.max(0,(p.needs[need]??70)-rate*elapsed/60);if(p.household?.player)p.household.player[need]=p.needs[need];}return save();
 }
 if(req.action==='cityLivingCancel'){delete p.cityLiving.active;return save();}
 if(!p.cityEstate.owned)throw Error('Tu ne possèdes pas encore de terrain.');
 const active=p.cityLiving.active,action=req.action==='cityLivingStart'?req.kind:active?.kind,item=req.action==='cityLivingStart'?req.item:active?.item,placed=p.room.items.find(i=>i.id===item),point=req.position;
 if(!placed||!BrawlCore.cityLivingAllowed(p,action,item))throw Error('Ce meuble ne permet pas cette action.');
 const bounds=BrawlCore.placedBounds(p.room,placed),dx=point&&Math.max(bounds.x-point.x,0,point.x-bounds.x-bounds.w),dy=point&&Math.max(bounds.y-point.y,0,point.y-bounds.y-bounds.d);
 if(!point||![point.x,point.y].every(Number.isFinite)||point.x<0||point.y<0||point.x>=p.room.size||point.y>=p.room.size||Math.hypot(dx,dy)>1.8)throw Error('Approche du meuble dans ta maison.');
 if(req.action==='cityLivingStart'){
  if(active&&now<active.ends+60000)throw Error('Termine ou annule ton action actuelle.');
  if(action==='fridge'&&p.coins<1)throw Error('Les ingrédients coûtent 1 $.');
  if(action==='stove'&&!p.cityLiving.prepared)throw Error('Prends les ingrédients au frigo.');
  if(action==='eat'&&!p.cityLiving.meal)throw Error('Prépare le repas à la cuisinière.');
  p.cityLiving.active={id:Utilities.getUuid(),kind:action,item,started:now,ends:now+BrawlCore.cityLivingActions[action].seconds*1000};return save();
 }
 if(!active||active.id!==req.interactionId)throw Error('Interaction introuvable.');
 if(now<active.ends)throw Error('L’action n’est pas encore terminée.');
 if(now>active.ends+60000)throw Error('Cette interaction a expiré.');
 const result=BrawlCore.cityLivingFinish(p,active.kind);delete result.cityLiving.active;result.revision++;record.profile=result;saveRecord(record);return {ok:true,profile:publicProfile(result),interaction:null};
}
