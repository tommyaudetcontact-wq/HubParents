import {randomUUID,randomInt} from 'node:crypto';
/** Only the authenticated officer may progress a server-issued intervention. */
export function createPatrol({db,enabled,core:C,can}){
 if(enabled)db.exec('CREATE TABLE IF NOT EXISTS city_patrol_jobs(id TEXT PRIMARY KEY,owner TEXT NOT NULL,state TEXT NOT NULL,created INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS city_patrol_owner ON city_patrol_jobs(owner,created)');
 const load=id=>{const row=db.prepare("SELECT row_no,cells FROM sheet_rows WHERE sheet='Profils' AND json_extract(cells,'$[0]')=?").get(id);if(!row)throw Error('Profil introuvable.');const cells=JSON.parse(row.cells);return {row:row.row_no,cells,p:C.upgrade(JSON.parse(cells[3]))};};
 const save=r=>{r.p.revision++;r.cells[3]=JSON.stringify(r.p);r.cells[4]=new Date().toISOString();db.prepare("UPDATE sheet_rows SET cells=? WHERE sheet='Profils' AND row_no=?").run(JSON.stringify(r.cells),r.row);};
 const publicProfile=p=>{const q={...p};delete q._cityPlayClock;return q;},read=r=>r?JSON.parse(r.state):null,write=m=>db.prepare('UPDATE city_patrol_jobs SET state=? WHERE id=?').run(JSON.stringify(m),m.id),point=p=>p&&[p.x,p.y].every(Number.isFinite)&&p.x>=C.cityMap.minX&&p.x<=C.cityMap.width&&p.y>=C.cityMap.minY&&p.y<=C.cityMap.height,dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
 async function handle(body,engine){if(!String(body.action).startsWith('cityPatrol'))return null;try{
 if(!enabled)throw Error('Métier réservé à la ville autonome.');const auth=await engine.doPost({postData:{contents:JSON.stringify({...body,action:'state'})}});if(!auth.ok)return auth;const id=auth.profile.id;
 if(!can(id,'play')||!can(id,'weapons'))throw Error('Le contrôle parental bloque ce métier de combat.');const r=load(id),now=Date.now();let m=read(db.prepare('SELECT state FROM city_patrol_jobs WHERE owner=? ORDER BY created DESC LIMIT 1').get(id));
 if(m?.phase==='running'&&m.rulesVersion!==2){m.phase='abandoned';write(m);}
 if(m?.phase==='running'&&now>m.expires){m.phase='expired';write(m);}
 const result=()=>({ok:true,profile:publicProfile(r.p),mission:m});
 if(body.action==='cityPatrolStatus')return result();
 if(body.action==='cityPatrolStart'){
 if(m?.phase==='running')return result();if(r.p.cityFireDuty?.state==='running'&&now<r.p.cityFireDuty.deadline)throw Error('Termine ton intervention de pompier.');
 if(body.count!==undefined&&body.count!==0)throw Error('Une seule patrouille est disponible : 1 à 3 criminels aléatoires.');
 if(!point(body.position)||typeof body.requestId!=='string'||!/^[a-zA-Z0-9-]{16,90}$/.test(body.requestId))throw Error('Intervention invalide.');
 const previous=read(db.prepare('SELECT state FROM city_patrol_jobs WHERE id=?').get(body.requestId));if(previous){if(previous.owner!==id)throw Error('Demande déjà utilisée.');m=previous;return result();}
 const roads=[];for(const x of C.cityMap.roadsX)for(const y of C.cityMap.roadsY)if(dist({x,y},body.position)>650&&dist({x,y},body.position)<2300)roads.push({x,y});if(!roads.length)throw Error('Rejoins le réseau routier de la ville.');
 const count=randomInt(1,4),offset=randomInt(roads.length),models=['car-retro','car-aurore','car-horizon'];m={id:body.requestId,owner:id,phase:'running',rulesVersion:2,requiredHits:4,created:now,expires:now+1200000,count,reward:count*(count+3)/4,seq:0,targets:[]};
 for(let n=0;n<count;n++){const p=roads[(offset+n*Math.max(1,Math.floor(roads.length/count)))%roads.length];m.targets.push({id:randomUUID(),x:p.x,y:p.y,model:models[n%models.length],armed:randomInt(2)===1,hits:0,combat:0,hp:100,lastImpact:0,lastCombat:0,cuffAt:0,arrested:false,killed:false,runOverHits:0,lastRunOver:0,updated:now});}
 db.prepare('INSERT INTO city_patrol_jobs VALUES(?,?,?,?)').run(m.id,id,JSON.stringify(m),now);return result();}
 if(!m||m.id!==body.missionId)throw Error('Intervention introuvable.');if(body.action==='cityPatrolCancel'){if(m.phase==='running'){m.phase='abandoned';write(m);}return result();}
 if(body.action!=='cityPatrolProgress')throw Error('Action policière inconnue.');
 if(!Number.isSafeInteger(body.seq)||body.seq<1)throw Error('Séquence invalide.');if(body.seq<=m.seq)return {...result(),replay:true};if(m.phase!=='running')return result();if(body.seq!==m.seq+1)throw Error('Reprends l’action précédente avant de continuer.');
 const e=body.event,t=m.targets.find(t=>t.id===e?.target);if(!t||t.arrested||t.killed||!point(e.position)||!point(e.targetPosition))throw Error('Cible ou position invalide.');
 if(!Number.isFinite(e.elapsed)||e.elapsed<0||e.elapsed<(m.lastElapsed||0)||e.elapsed>(now-m.created)/1000+1)throw Error('Chronologie de l’intervention invalide.');const at=Math.min(now,m.created+Math.round(e.elapsed*1000)),d=dist(e.position,e.targetPosition);if(dist(t,e.targetPosition)>340*(at-t.updated)/1000+180)throw Error('Déplacement de cible impossible.');
 if(e.type==='ram'){if(t.hits>=4||d>95||!Number.isFinite(e.speed)||e.speed<25||e.speed>750||t.lastImpact&&at-t.lastImpact<750)throw Error('Impact trop faible, trop éloigné ou répété trop vite.');t.hits++;t.lastImpact=at;}
 else if(e.type==='combat'){if(t.hits<4||t.hp<=0||at-t.lastCombat<(e.weapon==='pistol'?480:300)||d>(e.weapon==='pistol'?550:70)||!['pistol','melee'].includes(e.weapon))throw Error('Il faut immobiliser la voiture puis maîtriser le suspect à portée.');t.hp=Math.max(0,t.hp-(e.weapon==='pistol'?34:25));t.combat++;t.lastCombat=at;}
 else if(e.type==='run-over'){if(t.hits<4||d>95||!Number.isFinite(e.speed)||e.speed<25||e.speed>750||t.lastRunOver&&at-t.lastRunOver<750)throw Error('Renversement trop faible ou répété trop vite.');t.runOverHits=(t.runOverHits||0)+1;t.lastRunOver=at;t.hp=Math.max(0,t.hp-50);if(t.runOverHits>=2){t.killed=true;t.hp=0;}}
 else if(e.type==='cuff-start'){if(t.hp>0||d>55)throw Error('Maîtrise le suspect et approche-toi pour le menotter.');t.cuffAt=at;}
 else if(e.type==='arrest'){if(t.hp>0||!t.cuffAt||at-t.cuffAt<2200||d>55)throw Error('Termine le menottage près du suspect.');t.arrested=true;}
 else throw Error('Action policière invalide.');
 if(e.type==='ram')t.carPosition={...e.targetPosition};else t.personPosition={...e.targetPosition};t.x=e.targetPosition.x;t.y=e.targetPosition.y;t.updated=at;m.lastElapsed=e.elapsed;m.seq=body.seq;
 if(m.targets.every(t=>t.arrested||t.killed)){m.phase='finished';m.finished=now;const arrests=m.targets.filter(t=>t.arrested).length;m.reward=arrests*(arrests+3)/4;r.p.coins=Math.round((r.p.coins+m.reward)*100)/100;r.p.cityPatrolCompleted=(r.p.cityPatrolCompleted||0)+1;r.p.history??=[];r.p.history.unshift({day:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto'}).format(new Date()),label:'Police · '+arrests+' arrêté(s), '+m.targets.filter(t=>t.killed).length+' neutralisé(s)',coins:m.reward,xp:0});r.p.history=r.p.history.slice(0,300);save(r);}
 write(m);return result();
 }catch(e){return {ok:false,error:e.message};}}
 return {handle};
}
