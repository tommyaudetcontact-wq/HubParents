/** Timed work grants; client requests never directly award money. */
function handleCityActivities(req){
 if(!['cityJobStart','cityJobStatus','cityJobCheckpoint','cityJobCancel'].includes(req.action))return null;
 const record=profileRecord(req.player),p=record.profile,now=Date.now(),day=Utilities.formatDate(new Date(),TZ,'yyyy-MM-dd');p.cityWork=p.cityWork||{halves:0,completed:0};let active=p.cityWork.active;
 const result=()=>({ok:true,profile:publicProfile(record.profile),job:record.profile.cityWork?.active||null});
 if(req.action==='cityJobStatus')return result();
 if(req.action==='cityJobCancel'){if(active&&active.id===req.jobId){delete p.cityWork.active;p.revision++;saveRecord(record);}return result();}
 const point=req.position;if(!point||![point.x,point.y].every(Number.isFinite)||point.x<0||point.y<0||point.x>BrawlCore.cityMap.width||point.y>BrawlCore.cityMap.height)throw Error('Position de mission invalide.');
 if(req.action==='cityJobStart'){
 if(active&&now<active.expires)return result();if(!['taxi','delivery'].includes(req.kind)||typeof req.requestId!=='string'||req.requestId.length<8||req.requestId.length>100)throw Error('Mission invalide.');
 authThrottle('city-work:'+req.player,120);const place=BrawlCore.cityPlaces.find(s=>s.job===req.kind),rental=p.cityWork.rental,nearPlace=Math.hypot(point.x-place.x,point.y-place.y)<150||Math.hypot(point.x-BrawlCore.cityRoadSnap(place).x,point.y-BrawlCore.cityRoadSnap(place).y)<100,continuing=req.kind==='taxi'&&rental?.kind==='taxi'&&now<rental.expires&&Math.hypot(point.x-rental.position.x,point.y-rental.position.y)<100;
 if(!nearPlace&&!continuing)throw Error('Approche du restaurant ou de la station de taxis.');const id=Utilities.getUuid(),origin=BrawlCore.cityRoadSnap(point),job=BrawlCore.cityMakeJob(req.kind,origin,id);if(req.kind==='delivery')for(let n=1;n<32&&p.cityWork.lastDelivery&&Math.hypot(job.destination.x-p.cityWork.lastDelivery.x,job.destination.y-p.cityWork.lastDelivery.y)<1;n++)Object.assign(job,BrawlCore.cityMakeJob(req.kind,origin,id+':'+n));
 p.cityWork.active={...job,id,requestId:req.requestId,index:0,started:now,lastAt:now,lastPoint:origin,expires:now+1800000};p.revision++;saveRecord(record);return result();}
 if(!active||active.id!==req.jobId){if((p.cityWork.recent||[]).includes(req.jobId))return result();throw Error('Mission introuvable.');}
 if(now>active.expires)throw Error('Mission expirée. Reprends une commande.');if(!Number.isInteger(req.index)||req.index<0||req.index>=active.points.length)throw Error('Étape invalide.');if(req.index<active.index)return result();if(req.index!==active.index)throw Error('Suis les points dans l’ordre.');
 const target=active.points[active.index],distance=BrawlCore.cityRoute(active.lastPoint,target).reduce((n,p,i,list)=>n+(i?Math.hypot(p.x-list[i-1].x,p.y-list[i-1].y):0),0);if(Math.hypot(point.x-target.x,point.y-target.y)>60)throw Error('Approche du point de mission.');if(!Number.isFinite(active.travelDistance)){let previous=active.origin;active.travelDistance=active.points.slice(0,active.index).reduce((total,p)=>{const d=Math.hypot(p.x-previous.x,p.y-previous.y);previous=p;return total+d;},0);}if(now-active.started<Math.max((active.index+1)*180,(active.travelDistance+distance)/330*1000*.8))throw Error('Trajet trop rapide.');active.travelDistance+=distance;
 if(active.kind==='taxi'&&Math.hypot(target.x-active.pickup.x,target.y-active.pickup.y)<1)active.hasPassenger=true;active.index++;active.lastAt=now;active.lastPoint=target;
 const final=active.index===active.points.length,drop=active.kind==='delivery'&&active.drops?.find(d=>d.index===req.index),reward=active.kind==='taxi'&&final||!!drop||active.kind==='delivery'&&!active.drops&&final,id=active.id,kind=active.kind;
 if(final){p.cityWork.rental={kind,position:target,vehicle:active.vehicle,expires:now+1800000};if(kind==='delivery')p.cityWork.lastDelivery=active.destination;delete p.cityWork.active;p.cityWork.recent=[...(p.cityWork.recent||[]),id].slice(-30);}
 if(reward)record.profile=BrawlCore.apply(p,{type:'cityWorkReward',id:'work:'+id+(drop?':'+req.index:''),kind},day,false);else p.revision++;

 saveRecord(record);return result();
}
/** One shared, server-issued street pickup per minute and family. Claims use the request transaction lock. */
function handleCityLoot(req){
 if(!['cityLootStatus','cityLootClaim'].includes(req.action))return null;
 const family=authFamilyOf(req.player),scope=family==='legacy'?'player:'+req.player:family,cache=CacheService.getScriptCache(),now=Date.now(),minute=Math.floor(now/60000),key='city-loot:'+scope;
 let loot=JSON.parse(cache.get(key)||'null');
 if(!loot||loot.minute!==minute){const seed=parseInt(Utilities.getUuid().replace(/-/g,'').slice(0,8),16),map=BrawlCore.cityMap,vertical=seed%2===0,road=(vertical?map.roadsX:map.roadsY)[(seed>>>2)%4],along=170+(seed>>>5)%(vertical?1200:1450),record=profileRecord(req.player),unowned=BrawlCore.cards.filter(c=>!record.profile.cards.some(v=>v.id===c.id)),card=seed%8===0&&unowned.length?unowned[(seed>>>12)%unowned.length]:null;loot={id:'loot:'+scope+':'+minute,minute,x:vertical?road:along,y:vertical?along:road,kind:card?'card':'coin',card:card?.id||null,created:now,expires:(minute+1)*60000,claimedBy:null};cache.put(key,JSON.stringify(loot),180);}
 if(req.action==='cityLootStatus')return {ok:true,loot:loot.claimedBy?null:loot,nextAt:loot.expires};
 if(req.lootId!==loot.id||loot.claimedBy&&loot.claimedBy!==req.player)throw Error('Cette récompense a déjà été ramassée ou a expiré.');
 const record=profileRecord(req.player),p=BrawlCore.upgrade(record.profile);if(p.seen.includes(loot.id))return {ok:true,profile:publicProfile(p),loot:null,nextAt:loot.expires};
 const q=req.position;if(!q||![q.x,q.y].every(Number.isFinite)||Math.hypot(q.x-loot.x,q.y-loot.y)>45)throw Error('Approche de la récompense.');
 if(now-loot.created<500)throw Error('Réessaie dans un instant.');
 if(loot.kind==='card'&&!p.cards.some(c=>c.id===loot.card)){p.cards.push(BrawlCore.cardState({id:loot.card,condition:100}));}else p.coins+=1;
 p.seen.push(loot.id);p.seen=p.seen.slice(-500);p.revision++;p.history.unshift({day:Utilities.formatDate(new Date(),TZ,'yyyy-MM-dd'),label:loot.kind==='card'?'Carte trouvée en ville':'Récompense trouvée en ville',coins:loot.kind==='coin'?1:0,xp:0});p.history=p.history.slice(0,100);record.profile=p;saveRecord(record);loot.claimedBy=req.player;cache.put(key,JSON.stringify(loot),180);return {ok:true,profile:publicProfile(p),loot:null,nextAt:loot.expires,reward:loot.kind};
}
/** Server-issued, replay-safe activity payouts. Only the elected host can report results. */
function handleCityGameRewards(req){
 if(!['cityActivityStart','cityActivityFinish','cityActivityClaim'].includes(req.action))return null;
 const now=Date.now(),id=req.activityId;if(typeof id!=='string'||id.length<4||id.length>200||!/^[\w:.-]+$/.test(id))throw Error('Activité invalide.');
 const props=PropertiesService.getScriptProperties(),key='CITY_GAME_'+id;let run=JSON.parse(props.getProperty(key)||'null');
 const room=req.roomId?JSON.parse(CacheService.getScriptCache().get('city:'+req.roomId)||'null'):null;
 const host=room?room.host===req.player&&room.members.some(m=>m.id===req.player):!req.roomId;
 if(req.action==='cityActivityStart'){
  const kinds=['bracelet','hockey','race','chase','soccer','bowling','laser','derby','zombie','fight','tennis','sumo','tailblazer','drift','jumps','spot-battle','trials','trampoline','street-rage','carnage','carnage-drift','carnage-course','carnage-derby','carnage-ville','carnage-ville-ultime','carnage-drift-ultime','carnage-course-ultime','carnage-derby-ultime','carnage-moto-ultime','carnage-ville-moto-ultime','carnage-derby-moto-ultime'];
  if(!host||!kinds.includes(req.kind)||typeof req.gameId!=='string'||req.gameId.length>100||!Array.isArray(req.participants)||!req.participants.length||req.participants.length>6||new Set(req.participants).size!==req.participants.length||req.participants.some(p=>room?!room.members.some(m=>m.id===p):p!==req.player))throw Error('Départ d’activité refusé.');
  if(!run){run={id,kind:req.kind,gameId:req.gameId,host:req.player,room:req.roomId||null,participants:req.participants,started:now,expires:now+86400000,claimed:{},sold:{},checkpoint:0};props.setProperty(key,JSON.stringify(run));}
  if(!room&&run.host!==req.player||run.kind!==req.kind||run.gameId!==req.gameId||run.room!==(req.roomId||null))throw Error('Activité déjà enregistrée.');return {ok:true,activityId:id};
 }
 if(!run||run.expires<now)throw Error('Activité expirée.');
 if(req.action==='cityActivityFinish'){
  if(!host||run.room!==(req.roomId||null)||!room&&run.host!==req.player)throw Error('Seul l’hôte confirme les résultats.');
  if(req.checkpoint!==undefined){const n=req.checkpoint;if(run.kind!=='zombie'||!Number.isInteger(n)||n<1||n>30||now-run.started<n*25000)throw Error('Palier zombie invalide.');run.checkpoint=Math.max(run.checkpoint,n);}
  else if(!run.done){if(now-run.started<(run.kind==='bracelet'?2000:10000)||!Array.isArray(req.completed)||req.completed.some(p=>!run.participants.includes(p)))throw Error('Fin d’activité invalide.');const winner=req.winner||null;if(winner&&!req.completed.includes(winner))throw Error('Gagnant invalide.');if(run.kind==='bracelet'&&winner&&JSON.stringify(req.bracelet)!==JSON.stringify(BrawlCore.braceletPattern(run.gameId)))throw Error('Bracelet incorrect.');run.done=true;run.completed=[...new Set(req.completed)];run.winner=winner;}
  props.setProperty(key,JSON.stringify(run));return {ok:true};
 }
 if(!run.participants.includes(req.player))throw Error('Tu ne participes pas à cette activité.');const record=profileRecord(req.player),p=record.profile,who=req.player;let amount=0,label='';
 if(req.reward==='bracelet'){if(run.kind!=='bracelet'||!run.done||run.winner!==who)throw Error('Ce bracelet ne t’appartient pas.');if(!run.sold[who]){amount=1;run.sold[who]=true;p.bracelets=(p.bracelets||[]).filter(b=>b.id!==id);label='Bracelet revendu';}}
 else if(req.reward==='zombie'){if(run.kind!=='zombie')throw Error('Palier invalide.');const last=run.claimed[who]?.wave||0;for(let n=last+1;n<=run.checkpoint;n++)amount+=BrawlCore.cityZombieReward(n);run.claimed[who]={...run.claimed[who],wave:run.checkpoint};label='Survie zombies · paliers de 5 vagues';}
 else{if(!run.done||!run.completed.includes(who))throw Error('Activité en cours.');if(!run.claimed[who]?.finish){amount=1;run.claimed[who]={...run.claimed[who],finish:true};label='Activité terminée · '+run.kind;if(run.kind==='bracelet'&&run.winner===who&&!run.sold[who]){p.bracelets=p.bracelets||[];if(!p.bracelets.some(b=>b.id===id))p.bracelets.push({id,pattern:BrawlCore.braceletPattern(run.gameId),value:1});}}}
 if(amount){p.coins+=amount;p.revision++;p.history.unshift({day:Utilities.formatDate(new Date(),TZ,'yyyy-MM-dd'),label,coins:amount,xp:0});p.history=p.history.slice(0,100);saveRecord(record);}props.setProperty(key,JSON.stringify(run));return {ok:true,profile:publicProfile(p),amount,checkpoint:run.claimed[who]?.wave||0};
}
