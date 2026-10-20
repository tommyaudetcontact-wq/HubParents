'use strict';
window.RequestStatus=(()=>{
 const pending=new Map();let next=0,timer=null,box=null;
 function display(){timer=null;if(!pending.size)return;const host=document.getElementById?.('house-save-status');if(host){document.body.classList?.add('network-busy');host.setAttribute?.('aria-busy','true');if(box)box.hidden=true;return;}if(!box){box=document.createElement('div');box.id='network-progress';box.className='network-progress';box.setAttribute('role','status');box.setAttribute('aria-live','polite');box.innerHTML='<span class="network-spinner" aria-hidden="true"></span><span data-network-label></span>';document.body.append(box);}const label=box.querySelector('[data-network-label]');if(label)label.textContent=[...pending.values()].some(a=>/event|Batch|Save|Update|Create|buy/i.test(a))?'Enregistrement en cours…':'Chargement en cours…';box.hidden=false;}
 function begin(action){if(/Poll$|Heartbeat$|activityPosition|activityLeave|houseBatch|houseStart|cityPartyPulse|cityDriveSave/.test(action))return null;const id=++next;pending.set(id,action);if(box&&!box.hidden)display();else if(!timer)timer=setTimeout(display,180);return id;}
 function end(id){if(id===null||id===undefined)return;pending.delete(id);if(!pending.size){document.body.classList?.remove('network-busy');document.getElementById?.('house-save-status')?.removeAttribute?.('aria-busy');if(timer)clearTimeout(timer);timer=null;if(box)box.hidden=true;}else if(box&&!box.hidden)display();}
 return {begin,end,count:()=>pending.size};
})();
