/** City exchanges are committed with both profiles in the API's SQLite transaction. */
export function createCityTrades({db,enabled,core,can,room}){
 if(enabled)db.exec("CREATE TABLE IF NOT EXISTS city_trades(id TEXT PRIMARY KEY,sender TEXT NOT NULL,recipient TEXT NOT NULL,room TEXT NOT NULL,offer TEXT NOT NULL,wanted TEXT NOT NULL,status TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL)");
 const load=id=>{const r=db.prepare("SELECT row_no,cells FROM sheet_rows WHERE sheet='Profils' AND json_extract(cells,'$[0]')=?").get(id);if(!r)throw Error('Joueur introuvable.');const cells=JSON.parse(r.cells);return {row:r.row_no,cells,p:core.upgrade(JSON.parse(cells[3]))};};
 const save=r=>{r.p.revision++;r.cells[3]=JSON.stringify(r.p);r.cells[4]=new Date().toISOString();db.prepare("UPDATE sheet_rows SET cells=? WHERE sheet='Profils' AND row_no=?").run(JSON.stringify(r.cells),r.row);};
 const catalog=new Map(core.catalog.map(i=>[i.id,i]));
 // Placed/equipped items must be put away before transfer; no house or active vehicle is dismantled.
 const available=p=>p.inventory.filter(id=>{const i=catalog.get(id);return i&&['meuble','voiture','skin','look','bd'].includes(i.category)&&id!=='skin-neutral'&&id!==p.skin&&id!==p.garage?.selected&&!p.room?.items?.some(o=>o.id===id)&&!Object.values(p.appearance||{}).includes(id)&&!Object.values(p.equipment||{}).includes(id);});
 const money=v=>Number.isFinite(v)&&v>=0&&v<=1000000000&&Math.abs(v*100-Math.round(v*100))<.00001;
 const clean=v=>{if(!v||!money(v.money)||!Array.isArray(v.items)||v.items.length>12||new Set(v.items).size!==v.items.length||v.items.some(id=>typeof id!=='string'||id.length>120))throw Error('Montant ou objets invalides (12 objets maximum par côté).');return {money:v.money,items:[...v.items].sort()};};
 const validate=(a,b,v)=>{if(a.coins<v.money)throw Error(a.name+' n’a plus assez d’argent.');const owned=new Set(available(a));if(v.items.some(id=>!owned.has(id)))throw Error('Un objet est équipé, placé ou n’est plus disponible. Range-le avant l’échange.');if(v.items.some(id=>b.inventory.includes(id)))throw Error('Le destinataire possède déjà un de ces objets.');};
 const publicProfile=p=>{const out={...p};delete out._cityPlayClock;return out;};
 const name=id=>{try{return load(id).p.name;}catch{return 'Joueur supprimé';}};
 const receipt=t=>({...t,offer:JSON.parse(t.offer),wanted:JSON.parse(t.wanted),senderName:name(t.sender),recipientName:name(t.recipient)});
 async function handle(body,engine){if(!String(body.action).startsWith('cityTrade'))return null;try{
 if(!enabled)throw Error('Échanges disponibles dans la ville autonome.');
 const auth=await engine.doPost({postData:{contents:JSON.stringify({...body,action:'state'})}});if(!auth.ok)return auth;const id=auth.profile.id;
 if(!can(id,'multiplayer'))throw Error('Le multijoueur est bloqué par le contrôle parental.');
 const current=load(id),now=Date.now();db.prepare("UPDATE city_trades SET status='expired' WHERE status='pending' AND expires<=?").run(now);
 const activeRoom=()=>{const r=room(body.roomId);if(!r||!r.members.some(m=>m.id===id&&now-m.seen<(r.automatic?24000:45000)))throw Error('Rejoins une ville pour échanger.');return r;};
 const nearby=(r,other)=>{if(!r.members.some(m=>m.id===other&&now-m.seen<(r.automatic?24000:45000)))throw Error('Les deux joueurs doivent être dans la même ville.');if(!can(other,'multiplayer')||!can(other,'invites'))throw Error('Ce joueur ne peut pas recevoir d’échange.');};
 if(body.action==='cityTradeList'){const r=activeRoom();return {ok:true,profile:publicProfile(current.p),items:available(current.p),players:r.members.filter(m=>m.id!==id&&now-m.seen<(r.automatic?24000:45000)&&can(m.id,'multiplayer')&&can(m.id,'invites')).map(m=>{const p=load(m.id).p;return {id:p.id,name:p.name,items:available(p)};}),trades:db.prepare('SELECT * FROM city_trades WHERE sender=? OR recipient=? ORDER BY created DESC LIMIT 40').all(id,id).map(receipt)};}
 if(body.action==='cityTradeOffer'){
 const r=activeRoom(),to=body.to;if(typeof to!=='string'||to===id)throw Error('Choisis un autre joueur.');nearby(r,to);if(!can(id,'invites'))throw Error('Les invitations sont bloquées par le contrôle parental.');
 if(typeof body.requestId!=='string'||!/^[a-zA-Z0-9-]{16,90}$/.test(body.requestId))throw Error('Identifiant d’échange invalide.');
 const offer=clean(body.offer),wanted=clean(body.wanted),existing=db.prepare('SELECT * FROM city_trades WHERE id=?').get(body.requestId);
 if(existing){if(existing.sender!==id||existing.recipient!==to||existing.offer!==JSON.stringify(offer)||existing.wanted!==JSON.stringify(wanted))throw Error('Identifiant déjà utilisé.');return {ok:true,trade:receipt(existing),profile:publicProfile(current.p),replay:true};}
 if(!offer.money&&!wanted.money&&!offer.items.length&&!wanted.items.length)throw Error('Ajoute de l’argent ou un objet.');
 if(db.prepare("SELECT count(*) n FROM city_trades WHERE status='pending' AND (sender=? OR recipient=?)").get(id,id).n>=20)throw Error('Termine tes échanges en attente.');
 const other=load(to);validate(current.p,other.p,offer);validate(other.p,current.p,wanted);
 db.prepare('INSERT INTO city_trades VALUES(?,?,?,?,?,?,?,?,?)').run(body.requestId,id,to,r.id,JSON.stringify(offer),JSON.stringify(wanted),'pending',now,now+900000);
 return {ok:true,profile:publicProfile(current.p),trade:receipt(db.prepare('SELECT * FROM city_trades WHERE id=?').get(body.requestId))};}
 if(body.action!=='cityTradeDecide')throw Error('Action d’échange inconnue.');
 const t=db.prepare('SELECT * FROM city_trades WHERE id=?').get(body.tradeId);if(!t||![t.sender,t.recipient].includes(id))throw Error('Échange introuvable.');
 if(!['accept','reject','cancel'].includes(body.decision)||body.decision==='cancel'&&t.sender!==id||body.decision!=='cancel'&&t.recipient!==id)throw Error('Tu ne peux pas décider cet échange.');
 if(t.status!=='pending')return {ok:true,profile:publicProfile(current.p),trade:receipt(t),replay:true};
 const status={accept:'accepted',reject:'rejected',cancel:'cancelled'}[body.decision];
 if(status==='accepted'){
 const r=activeRoom();if(r.id!==t.room)throw Error('Rejoins la ville où cet échange a été proposé.');nearby(r,t.sender);nearby(r,t.recipient);
 const a=load(t.sender),b=load(t.recipient),o=JSON.parse(t.offer),w=JSON.parse(t.wanted);validate(a.p,b.p,o);validate(b.p,a.p,w);
 const net=Math.round(w.money*100)-Math.round(o.money*100),ac=Math.round(a.p.coins*100)+net,bc=Math.round(b.p.coins*100)-net;if(![ac,bc].every(v=>Number.isSafeInteger(v)&&v>=0&&v<=100000000000))throw Error('Le solde maximal serait dépassé.');
 a.p.coins=ac/100;b.p.coins=bc/100;
 for(const [from,to,items]of [[a.p,b.p,o.items],[b.p,a.p,w.items]])for(const item of items){from.inventory=from.inventory.filter(i=>i!==item);to.inventory.push(item);if(from.garage?.cars?.[item]){to.garage.cars[item]=from.garage.cars[item];delete from.garage.cars[item];}for(const key of ['furnitureColors','furnitureMaterials'])if(from.room?.[key]?.[item]){to.room[key]??={};to.room[key][item]=from.room[key][item];delete from.room[key][item];}}
 for(const [r,other,delta]of [[a,b,net/100],[b,a,-net/100]]){r.p.history??=[];r.p.history.unshift({day:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto'}).format(new Date()),label:'Échange avec '+other.p.name,coins:delta,xp:0});r.p.history=r.p.history.slice(0,300);save(r);}
 }
 db.prepare('UPDATE city_trades SET status=? WHERE id=?').run(status,t.id);return {ok:true,profile:publicProfile(load(id).p),trade:receipt({...t,status})};
 }catch(e){return {ok:false,error:e.message};}}
 return {handle};
}
