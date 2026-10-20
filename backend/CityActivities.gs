/** Timed work grants; client requests never directly award money. */
function handleCityActivities(req){
 if(!['cityJobStart','cityJobStatus','cityJobCheckpoint','cityJobCancel'].includes(req.action))return null;
 const record=profileRecord(req.player),p=record.profile,now=Date.now(),day=Utilities.formatDate(new Date(),TZ,'yyyy-MM-dd');p.cityWork=p.cityWork||{halves:0,completed:0};let active=p.cityWork.active;
 const result=()=>({ok:true,profile:publicProfile(record.profile),job:record.profile.cityWork?.active||null});
 if(req.action==='cityJobStatus')return result();
 if(req.action==='cityJobCancel'){if(active&&active.id===req.jobId){delete p.cityWork.active;p.revision++;saveRecord(record);}return result();}
 const point=req.position;if(!point||![point.x,point.y].every(Number.isFinite)||point.x<0||point.y<0||point.x>1300||point.y>1100)throw Error('Position de mission invalide.');
 if(req.action==='cityJobStart'){
 if(active&&now<active.expires)return result();if(!['taxi','delivery'].includes(req.kind)||typeof req.requestId!=='string'||req.requestId.length<8||req.requestId.length>100)throw Error('Mission invalide.');
 authThrottle('city-work:'+req.player,120);const place=BrawlCore.cityPlaces.find(s=>s.job===req.kind),rental=p.cityWork.rental,nearPlace=Math.hypot(point.x-place.x,point.y-place.y)<150||Math.hypot(point.x-BrawlCore.cityRoadSnap(place).x,point.y-BrawlCore.cityRoadSnap(place).y)<100,continuing=req.kind==='taxi'&&rental?.kind==='taxi'&&now<rental.expires&&Math.hypot(point.x-rental.position.x,point.y-rental.position.y)<100;
 if(!nearPlace&&!continuing)throw Error('Approche du restaurant ou de la station de taxis.');const id=Utilities.getUuid(),origin=BrawlCore.cityRoadSnap(point),job=BrawlCore.cityMakeJob(req.kind,origin,id);if(req.kind==='delivery')for(let n=1;n<32&&p.cityWork.lastDelivery&&Math.hypot(job.destination.x-p.cityWork.lastDelivery.x,job.destination.y-p.cityWork.lastDelivery.y)<1;n++)Object.assign(job,BrawlCore.cityMakeJob(req.kind,origin,id+':'+n));
 p.cityWork.active={...job,id,requestId:req.requestId,index:0,started:now,lastAt:now,lastPoint:origin,expires:now+1800000};p.revision++;saveRecord(record);return result();}
 if(!active||active.id!==req.jobId){if((p.cityWork.recent||[]).includes(req.jobId))return result();throw Error('Mission introuvable.');}
 if(now>active.expires)throw Error('Mission expirée. Reprends une commande.');if(!Number.isInteger(req.index)||req.index<0||req.index>=active.points.length)throw Error('Étape invalide.');if(req.index<active.index)return result();if(req.index!==active.index)throw Error('Suis les points dans l’ordre.');
 const target=active.points[active.index],distance=Math.hypot(target.x-active.lastPoint.x,target.y-active.lastPoint.y);if(Math.hypot(point.x-target.x,point.y-target.y)>60)throw Error('Approche du point de mission.');if(now-active.lastAt<Math.max(250,distance/330*1000*.8))throw Error('Trajet trop rapide.');
 if(active.kind==='taxi'&&Math.hypot(target.x-active.pickup.x,target.y-active.pickup.y)<1)active.hasPassenger=true;active.index++;active.lastAt=now;active.lastPoint=target;
 const final=active.index===active.points.length,drop=active.kind==='delivery'&&active.drops?.find(d=>d.index===req.index),reward=active.kind==='taxi'&&final||!!drop||active.kind==='delivery'&&!active.drops&&final,id=active.id,kind=active.kind;
 if(final){p.cityWork.rental={kind,position:target,vehicle:active.vehicle,expires:now+1800000};if(kind==='delivery')p.cityWork.lastDelivery=active.destination;delete p.cityWork.active;p.cityWork.recent=[...(p.cityWork.recent||[]),id].slice(-30);}
 if(reward)record.profile=BrawlCore.apply(p,{type:'cityWorkReward',id:'work:'+id+(drop?':'+req.index:''),kind},day,false);else p.revision++;

 saveRecord(record);return result();
}
