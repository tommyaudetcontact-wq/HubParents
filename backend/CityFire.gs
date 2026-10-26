/** Fire duty rewards are settled only by the authenticated server clock. */
function handleCityFire(req,record,day){
 if(!['cityFireStart','cityFireStatus','cityFireSpray','cityFireCancel'].includes(req.action))return null;
 if(!BrawlCore.cityStandalone)throw Error('Le service pompier est désactivé.');
 const p=BrawlCore.upgrade(record.profile),now=Date.now();let duty=p.cityFireDuty;
 const result=()=>({ok:true,profile:publicProfile(record.profile),duty:record.profile.cityFireDuty||null,serverNow:now});
 const save=()=>{p.revision++;record.profile=p;saveRecord(record);return result();};
 if(req.action==='cityFireCancel'){if(duty&&duty.state==='running')duty.state='abandoned';return save();}
 if(duty?.state==='running'&&now>=duty.deadline){duty.state='failed';save();}
 if(req.action==='cityFireStatus')return result();
 const point=req.position;if(!point||![point.x,point.y].every(Number.isFinite))throw Error('Position invalide.');
 if(req.action==='cityFireStart'){
  if(duty?.state==='running')return result();
  const base=p.cityFireReturn||{x:1750,y:-700};if(Math.hypot(point.x-base.x,point.y-base.y)>180)throw Error('Approche de la caserne pour prendre le camion.');
  const avoid=Array.isArray(req.avoid)?req.avoid.slice(0,20):[],targets=BrawlCore.cityFireTargets.filter(t=>!avoid.includes(t.id)&&t.id!==duty?.target.id);if(!targets.length)throw Error('Les bâtiments sont en reconstruction. Réessaie dans un moment.');
  const id=Utilities.getUuid(),n=id.split('').reduce((a,c)=>a+c.charCodeAt(0),0)%targets.length,seconds=BrawlCore.cityFireDuration(p.cityFireSaved||0);
  p.cityFireDuty={id,target:targets[n],started:now,deadline:now+seconds*1000,seconds,water:0,lastSpray:0,state:'running'};return save();
 }
 if(!duty||duty.id!==req.dutyId||duty.state!=='running')return result();
 const t=duty.target,dx=Math.max(t.x-point.x,0,point.x-t.x-t.w),dy=Math.max(t.y-point.y,0,point.y-t.y-t.d);if(Math.hypot(dx,dy)>170)throw Error('Approche du bâtiment pour utiliser la lance.');
 if(!duty.lastSpray){duty.lastSpray=now;return save();}const delta=Math.max(0,Math.min(1500,now-duty.lastSpray));if(delta<500)throw Error('La lance est déjà prise en compte.');duty.lastSpray=now;duty.water=Math.min(10,duty.water+delta/1000);
 if(duty.water>=10){duty.state='saved';p.coins++;p.cityFireSaved=(p.cityFireSaved||0)+1;p.cityFireReturn={x:point.x,y:point.y};p.history.unshift({day,label:'Pompier · bâtiment sauvé',coins:1,xp:0});p.history=p.history.slice(0,100);}
 return save();
}
