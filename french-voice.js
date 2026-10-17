'use strict';
window.FrenchVoice=(()=>{
  let generation=0,active=null;
  const unavailable='Aucune voix française n’est disponible dans ce navigateur. Active une voix française dans les réglages de ton appareil, puis réessaie. Tu peux aussi afficher le mot.';
  function frenchVoices(){return speechSynthesis.getVoices().filter(v=>/^fr(?:[-_]|$)/i.test(v.lang)).sort((a,b)=>Number(/^fr[-_]CA$/i.test(b.lang))-Number(/^fr[-_]CA$/i.test(a.lang))||Number(b.localService)-Number(a.localService));}
  function stop(){generation++;if(active){active.cancelled=true;active.waitCancel?.();}active=null;if('speechSynthesis'in window)speechSynthesis.cancel();}
  function waitForFrench(job){const ready=frenchVoices()[0];if(ready)return Promise.resolve(ready);return new Promise(resolve=>{let timer;const finish=voice=>{clearTimeout(timer);speechSynthesis.removeEventListener?.('voiceschanged',changed);job.waitCancel=null;resolve(voice);},changed=()=>{const voice=frenchVoices()[0];if(voice)finish(voice);};job.waitCancel=()=>finish(null);speechSynthesis.addEventListener?.('voiceschanged',changed);timer=setTimeout(()=>finish(frenchVoices()[0]||null),1500);changed();});}
  async function speak(text){if(!('speechSynthesis'in window))throw Error('La voix française est indisponible sur cet appareil.');const id=++generation;if(active){active.cancelled=true;active.waitCancel?.();}speechSynthesis.cancel();speechSynthesis.resume();const job={id,text:String(text),cancelled:false,retries:0};active=job;
    const voice=await waitForFrench(job);if(job.cancelled||id!==generation)return;if(!voice){active=null;throw Error(unavailable);}
    const start=()=>{if(job.cancelled||id!==generation)return;const chosen=frenchVoices()[0];if(!chosen){active=null;window.App?.toast(unavailable);return;}const phrase=new SpeechSynthesisUtterance(job.text);job.phrase=phrase;phrase.voice=chosen;phrase.lang=chosen.lang.replace('_','-');if(phrase.lang.toLowerCase()==='fr')phrase.lang='fr-FR';phrase.rate=.8;phrase.onend=()=>{if(active===job)active=null;};phrase.onerror=e=>{if(job.cancelled||id!==generation)return;const interrupted=['interrupted','canceled','cancelled'].includes(e.error);if(interrupted&&job.retries++===0){setTimeout(()=>{if(id===generation&&!job.cancelled){speechSynthesis.resume();start();}},100);return;}if(active===job)active=null;window.App?.toast('La lecture française n’a pas abouti. Touche Écouter pour réessayer.');};speechSynthesis.speak(phrase);};start();
  }
  function prepare(){if(!('speechSynthesis'in window))return;speechSynthesis.getVoices();speechSynthesis.resume();}
  if('speechSynthesis'in window)speechSynthesis.getVoices();
  return {speak,prepare,stop};
})();
