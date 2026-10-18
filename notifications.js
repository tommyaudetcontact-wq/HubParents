'use strict';
window.Notifications=(()=>{
 let items=[],player='',flight=null,tracked=null,opened=false,seen=new Set(),leaving=false;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function badge(){document.querySelectorAll('[data-notification-count]').forEach(n=>{n.textContent=items.length?' ('+items.length+')':'';});const n=document.getElementById('notification-count');if(n){n.hidden=!items.length;n.textContent=String(items.length);}document.getElementById('profile-button')?.setAttribute('aria-label','Compte et notifications'+(items.length?' : '+items.length+' en attente':''));}
 function cards(t){return [t.offer,t.request].map(id=>{const c=BrawlCore.cards.find(c=>c.id===id);return c?'<div class="notification-card">'+(c.image?'<img src="'+esc(c.image)+'" alt="'+esc(c.name)+'">':esc(c.emoji))+'<b>'+esc(c.name)+'</b></div>':'';}).join('<span>⇄</span>');}
 function body(){const p=App.profile();return '<section class="account-summary"><b>'+esc(p.avatar)+' '+esc(p.name)+'</b><p>Connecté comme enfant · '+p.grade+'e année · Niveau '+BrawlCore.levelInfo(p.xp).level+'</p><p>'+p.coins+' $ · '+p.xp+' XP</p><button class="btn compact secondary" data-action="go" data-arg="wardrobe">Mon personnage et ma garde-robe</button></section><h2>Mes notifications</h2><p class="small">Invitations de maison, duels et échanges. Une rencontre exige que ton ami soit encore en jeu.</p><div id="notifications-list">'+(items.length?items.map(t=>'<article class="notification-item"><b>'+esc(t.name)+'</b> '+esc(t.label)+(t.type==='trade'?'<div class="notification-cards">'+cards(t)+'</div>':'')+(t.available===false?'<p class="small">Ami hors ligne · attends son retour pour accepter.</p>':'')+'<div class="row"><button class="btn purple compact" data-notification="accept" data-id="'+esc(t.id)+'" '+(t.available===false?'disabled':'')+'>Accepter</button><button class="btn secondary compact" data-notification="reject" data-id="'+esc(t.id)+'">Refuser</button></div></article>').join(''):'<p>Aucune demande en attente.</p>')+'</div><button class="btn secondary" data-notification="refresh">Actualiser</button> <button class="btn ghost" data-notification="account">Mon compte / changer de profil</button>';}
 function open(){if(!App.playing?.()){App.profiles();return;}opened=true;App.popup(body());pulse();}
 function refreshView(){badge();if(opened&&document.getElementById('notifications-list'))App.popup(body());}
 function track(manager){tracked=manager;manager.peerLastSeen=Date.now();App.api('peerPulse',{roomId:manager.peerRoomId,route:App.route()}).then(r=>{if(r.closed)throw Error('La rencontre est terminée.');manager.peerLastSeen=Date.now();}).catch(err=>{if(tracked!==manager)return;manager.close();if(App.route()==='apartment')Family.leave();App.render();App.toast(err.message);});pulse();}
 function untrack(manager){if(!manager?.peerRoomId)return;if(tracked===manager)tracked=null;App.api('peerClose',{roomId:manager.peerRoomId}).catch(()=>{});manager.peerRoomId=null;}
 async function pulse(){
  if(flight||leaving)return flight;if(!App.playing?.()){items=[];player='';badge();if(tracked){tracked.close();tracked=null;}return;}
  const id=App.profile().id;if(player!==id){items=[];seen=new Set();player=id;badge();}const manager=tracked,route=App.route();
  flight=(async()=>{try{
   if(manager){if(!manager.connected||route!==(manager.peerPurpose==='house'?'apartment':'battle')){untrack(manager);manager.close();}else{const live=await App.api('peerPulse',{roomId:manager.peerRoomId,route});manager.peerLastSeen=Date.now();if(live.closed&&tracked===manager){manager.close();if(App.route()==='apartment')Family.leave();App.render();App.toast('Ton ami a quitté la rencontre.');return;}}}
   const r=await App.api('notifications',{route});if(!App.playing?.()||App.profile().id!==id)return;items=r.items||[];const fresh=items.some(i=>!seen.has(i.type+':'+i.id));items.forEach(i=>seen.add(i.type+':'+i.id));refreshView();if(fresh&&!opened)App.toast('Nouvelle demande : ouvre ton compte en haut à droite.');
  }catch(err){if(manager&&tracked===manager&&Date.now()-(manager.peerLastSeen||0)>45000){manager.close();if(App.route()==='apartment')Family.leave();App.render();App.toast('Connexion interrompue. La visite a été fermée.');}const n=document.getElementById('notifications-list');if(opened&&n)n.textContent=err.message;}finally{flight=null;}})();return flight;
 }
 document.addEventListener('click',async e=>{const b=e.target.closest('[data-notification]');if(!b||b.disabled)return;b.disabled=true;try{
  const action=b.dataset.notification;if(action==='open'){open();return;}if(action==='account'){opened=false;App.profiles();return;}if(action==='refresh'){await pulse();return;}
  const t=items.find(i=>i.id===b.dataset.id);if(!t)throw Error('Cette demande a expiré.');
  if(t.type==='trade'){await HouseDraft.beforeCritical();const r=await App.api('decideTrade',{tradeId:t.id,decision:action}).finally(()=>HouseDraft.afterCritical());App.setProfile(r.profile);App.toast(action==='accept'?'Échange terminé !':'Échange refusé.');}
  else if(action==='reject')await App.api('duelCancel',{roomId:t.id});
  else if(t.type==='request'){await App.api('peerCodeApprove',{roomId:t.id});App.toast('Ami accepté. Connexion en cours…');}
  else {opened=false;await DuelLobby.accept(t.id,t.purpose||'duel');}
  items=items.filter(i=>i.id!==t.id);refreshView();await pulse();
 }catch(err){App.toast(err.message);await pulse();}finally{if(b.isConnected)b.disabled=false;}});
 document.getElementById('modal')?.addEventListener('close',()=>{opened=false;});
 window.addEventListener('pagehide',()=>{leaving=true;App.socialLeave?.(tracked?.peerRoomId);tracked?.close();});
 window.addEventListener('pageshow',()=>{leaving=false;pulse();});
 setInterval(pulse,8000);pulse();
 return {badge,open,pulse,track,untrack};
})();
