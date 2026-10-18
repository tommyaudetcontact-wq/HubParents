'use strict';
window.StudySession=(()=>{
  let lastInput=0,busy=false,lastPaint=0;const now=()=>Date.now(),active=()=>!document.hidden&&now()-lastInput<90000&&App.route().startsWith('study/')&&App.studyActive();
  function format(seconds){return Math.floor(seconds/60)+':'+String(Math.floor(seconds%60)).padStart(2,'0');}
  function banner(p){const plan=BrawlCore.studyPlan(p),seconds=BrawlCore.dayInfo(p,new Intl.DateTimeFormat('fr-CA',{timeZone:'America/Toronto'}).format(new Date())).studySeconds||0;return '<section class="study-clock"><div><b>⏱ Ma pratique du jour</b><span id="study-live">'+format(seconds)+'</span> / '+plan.minutes+' minutes</div><small id="study-clock-status">Le temps avance pendant la pratique active, et s’arrête quand tu quittes ou fais une pause.</small></section>';}
  function skill(){return App.route().split('/')[1]||'';}
  function pulse(){if(window.App&&active())Learning.addSecond();paint();}
  function paint(){if(!window.App)return;const live=document.getElementById('study-live'),status=document.getElementById('study-clock-status');if(live)live.textContent=format((BrawlCore.dayInfo(App.profile(),App.today()).studySeconds||0)+Learning.seconds());if(status)status.textContent=active()?'🟢 Pratique en cours · 20 minutes minimum pour terminer le jour.':'⏸ En pause · touche le cahier ou réponds pour reprendre.';lastPaint=now();}
  for(const name of ['pointerdown','pointermove','keydown'])document.addEventListener(name,()=>{lastInput=now();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)lastInput=0;paint();});
  setInterval(()=>{if(window.App)pulse();},1000);
  return {banner,paint,format};
})();

