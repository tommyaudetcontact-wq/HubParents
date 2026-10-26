// Le PC publie uniquement son adresse; les comptes restent sur sa base locale.
window.BRAWL_CONFIG=Object.freeze({standalone:true,backend:'local',endpoint:'',realtimeUrl:''});
window.BRAWL_SERVER_READY=(async()=>{
 const sources=['https://raw.githubusercontent.com/tommyaudetcontact-wq/HubParents/main/server-location.json?t=','https://api.github.com/repos/tommyaudetcontact-wq/HubParents/contents/server-location.json?ref=main&t='];
 for(const source of sources){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);try{const response=await fetch(source+Date.now(),{cache:'no-store',headers:{Accept:'application/vnd.github.raw+json'},signal:controller.signal});if(!response.ok)continue;const info=await response.json();if(info.online&&/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(info.origin)){const health=await fetch(info.origin+'/health',{cache:'no-store',signal:controller.signal});if(!health.ok||!(await health.json()).ok)continue;window.BRAWL_CONFIG=Object.freeze({standalone:true,backend:'local',endpoint:info.origin+'/api',realtimeUrl:info.origin.replace(/^http/,'ws')+'/realtime'});return;}}catch{}finally{clearTimeout(timer);}}
})();
