'use strict';
window.DuelLobby=(()=>{
 let active=null,inboxTimer=null,inboxFlight=null,invites=[];
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const description=pc=>({type:pc.localDescription.type,sdp:pc.localDescription.sdp});
 function invitations(list=invites){return list.map(i=>'<div class="notice"><b>'+esc(i.name)+' te propose un duel.</b> <button class="btn purple" data-duel="accept" data-id="'+esc(i.id)+'">Accepter le duel</button></div>').join('');}
 function panel(){return App.connected()?'<section class="panel"><h2>Invitations de duel</h2><p>Ton ami peut t’inviter depuis l’arène ou le lobby. Les coups et les animations passent ensuite directement entre vos appareils.</p><div id="duel-inbox">'+invitations()+'</div><button class="btn secondary" data-duel="refresh">Actualiser les invitations</button></section>':'';}
 function status(text){const n=document.getElementById('duel-status');if(n)n.textContent=text;}
 function waiting(){App.popup('<h2>Connexion du duel</h2><p id="duel-status" role="status">Préparation de la connexion directe…</p><p class="small">Garde cet onglet ouvert. Les coups ne transitent pas par la feuille Google.</p><button class="btn secondary" data-duel="cancel">Annuler</button>');}
 function refresh(){if(active||!App.connected())return Promise.resolve();if(inboxFlight)return inboxFlight;const player=App.profile().id;inboxFlight=(async()=>{try{const response=await App.api('lobbyPulse');if(App.profile().id!==player)return;invites=response.duels||[];const n=document.getElementById('duel-inbox');if(n)n.innerHTML=invitations();return response;}catch(err){const n=document.getElementById('duel-inbox');if(n)n.textContent=err.message;}finally{inboxFlight=null;}})();return inboxFlight;}

 function enter(){if(inboxTimer||!App.connected())return;refresh();inboxTimer=setInterval(()=>{if(!App.battle()?.state)refresh();},3000);}
 function leave(){clearInterval(inboxTimer);inboxTimer=null;cancel();invites=[];}
 function cancel(){const s=active;active=null;if(!s)return;clearTimeout(s.timer);s.battle.close();App.api('duelCancel',{roomId:s.id}).catch(()=>{});}
 function failed(battle){if(active?.battle!==battle)return;cancel();status('Connexion directe impossible sur ce réseau. Réessaie sur le même Wi-Fi ou avec un relais TURN configuré.');}
 function connected(battle){if(active?.battle!==battle)return;clearTimeout(active.timer);active=null;App.closeModal();}
 async function choose(){if(!App.connected())return;App.popup('<h2>Inviter un ami au duel</h2><div id="duel-friends" role="status">Recherche des amis en ligne…</div><p class="small">Ton ami doit ouvrir le lobby ou l’arène avec son profil.</p><button class="btn secondary" data-action="manual-host">Utiliser un code à copier</button>');const response=await refresh(),n=document.getElementById('duel-friends');if(!n)return;const players=(response?.online||[]).filter(p=>p.id!==App.profile().id);n.innerHTML=players.length?players.map(p=>'<div class="task-line"><b>'+esc(p.name)+'</b><button class="btn purple" data-duel="invite" data-id="'+esc(p.id)+'">Inviter au duel</button></div>').join(''):'Personne en ligne pour le moment. Ouvre le lobby sur l’autre appareil.';}
 function session(id){cancel();const battle=App.peerBattle();const s={id,battle,queue:[],after:0,answer:null,answerSent:false,started:Date.now(),seen:new Set(),timer:null};active=s;return s;}
 function candidate(s,c){if(active===s&&s.queue.length<40)s.queue.push(c);}
 async function invite(to){const s=session(crypto.randomUUID());App.go('battle');waiting();try{await s.battle.setup(true,c=>candidate(s,c));if(active!==s)return;status('Envoi de l’invitation à ton ami…');await App.api('duelCreate',{roomId:s.id,to,offer:description(s.battle.pc),candidates:[]});if(active!==s)return;status('Invitation envoyée. Ton ami peut l’accepter dans l’arène ou le lobby.');sync(s);}catch(err){if(active===s){cancel();status(err.message+' Vérifie que le nouveau Code.gs est déployé.');}}}
 async function accept(id){const s=session(id);App.go('battle');waiting();try{await s.battle.setup(false,c=>candidate(s,c));if(active===s)sync(s);}catch(err){if(active===s){cancel();status(err.message);}}}
 async function sync(s){if(active!==s||s.battle.connected)return;if(Date.now()-s.started>180000){cancel();status('Invitation expirée. Crée un nouveau duel.');return;}
  const batch=s.queue.slice(0,20),pc=s.battle.pc;let delay=1500;
  try{
   const out=await App.api('duelSync',{roomId:s.id,after:s.after,candidates:batch,...(s.answer&&!s.answerSent?{answer:s.answer}:{})});if(active!==s)return;
   if(out.cancelled){cancel();status('Ton ami a annulé le duel.');return;}
   s.queue.splice(0,batch.length);if(s.answer)s.answerSent=true;
   if(out.description&&!pc.remoteDescription){await pc.setRemoteDescription(out.description);if(active!==s)return;if(s.battle.role===1){await pc.setLocalDescription(await pc.createAnswer());if(active!==s)return;s.answer=description(pc);delay=0;}status('Ton ami a répondu. Connexion directe en cours…');}
   if(pc.remoteDescription){for(const c of out.candidates||[]){const key=JSON.stringify(c);if(!s.seen.has(key)){await pc.addIceCandidate(c);s.seen.add(key);}}s.after=out.next;}
  }catch(err){if(active!==s)return;if(/expirée|destinée|invalide|Action inconnue|déjà enregistrée/.test(err.message)){cancel();status(err.message);return;}status(err.message+' Nouvelle tentative de connexion…');delay=3000;}
  if(active===s&&!s.battle.connected)s.timer=setTimeout(()=>sync(s),delay);
 }
 document.addEventListener('click',async e=>{const b=e.target.closest('[data-duel]');if(!b||b.disabled)return;b.disabled=true;try{const action=b.dataset.duel;if(action==='invite')await invite(b.dataset.id);if(action==='accept')await accept(b.dataset.id);if(action==='cancel'){cancel();App.closeModal();}if(action==='refresh')await refresh();}catch(err){App.toast(err.message);}finally{if(b.isConnected)b.disabled=false;}});
 return {panel,invitations,enter,leave,choose,invite,accept,cancel,connected,failed,refresh};
})();
