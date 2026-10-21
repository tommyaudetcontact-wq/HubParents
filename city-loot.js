'use strict';
(function(root){
 let api=null,loot=null,nextAt=0,flight=false,generation=0,pendingCard=null;
 const floating=[];
 function mount(ctx){api=ctx;nextAt=0;loot=null;generation++;flight=false;pendingCard=null;floating.length=0;}
 function reveal(){
  if(!pendingCard||root.CityGames?.overlayActive()||root.document?.getElementById('modal')?.open)return;
  const card=pendingCard;pendingCard=null;api.stop?.();
  root.App.popup('<h2>Une carte trouvée !</h2>'+root.GameFX.reveal(card)+'<button class="btn purple" data-action="close">Continuer en ville</button>');
 }
 function tick(){
  if(!api)return;reveal();
  if(flight||root.CityGames?.overlayActive())return;
  const a=api.actor();if(!a)return;
  const now=Date.now(),claim=loot&&Math.hypot(a.x-loot.x,a.y-loot.y)<38;
  if(!claim&&now<nextAt)return;
  const before=new Set((root.App.profile().cards||[]).map(c=>c.id)),point={x:a.x,y:a.y},coinsBefore=root.App.profile().coins||0;
  flight=true;const epoch=generation;
  root.App.api(claim?'cityLootClaim':'cityLootStatus',claim?{lootId:loot.id,position:point}:{}).then(r=>{
   if(epoch!==generation)return;
   loot=r.loot;nextAt=Math.max(now+1500,Math.min(r.nextAt||now+60000,now+15000));
   if(r.profile&&r.profile.revision>=root.App.profile().revision)root.App.setProfile(r.profile);
   if(claim&&r.reward==='coin')floating.push({...point,text:'+1 $',at:Date.now()});
   if(claim&&r.reward==='card'){
    const gained=r.profile?.cards?.find(c=>!before.has(c.id));
    pendingCard=gained&&root.BrawlCore.cards.find(c=>c.id===gained.id);
    if(pendingCard)reveal();else if((r.profile?.coins||0)>coinsBefore)floating.push({...point,text:'+1 $',at:Date.now()});else root.App.toast('Récompense récupérée !');
   }
  }).catch(()=>{if(epoch===generation){loot=null;nextAt=now+5000;}}).finally(()=>{if(epoch===generation)flight=false;});
 }
 function draw(g){
  const now=Date.now();while(floating.length&&now-floating[0].at>1600)floating.shift();
  for(const f of floating){const age=(now-f.at)/1600,p=root.CityArt.project(f.x,f.y,70+age*35);g.save();g.globalAlpha=Math.min(1,(1-age)*3);g.font='900 25px "Segoe UI",Arial';g.textAlign='center';g.lineWidth=4;g.strokeStyle='#28453e';g.strokeText(f.text,p.x,p.y);g.fillStyle='#fff1a2';g.fillText(f.text,p.x,p.y);g.restore();}
  if(!loot||now>loot.expires)return;
  const p=root.CityArt.project(loot.x,loot.y,13+Math.sin(now/240)*3);g.save();g.translate(p.x,p.y);g.fillStyle='#f4d276';g.strokeStyle='#734e25';g.lineWidth=2;
  if(loot.kind==='card'){g.rotate(.15);g.fillRect(-10,-15,20,28);g.strokeRect(-10,-15,20,28);g.fillStyle='#6e5a9c';g.fillRect(-6,-10,12,18);}else{g.beginPath();g.ellipse(0,0,12,14,0,0,7);g.fill();g.stroke();g.fillStyle='#71512a';g.font='bold 16px "Segoe UI",Arial';g.textAlign='center';g.fillText('$',0,6);}g.restore();
 }
 root.CityLoot={mount,tick,draw,reset:()=>{generation++;api=null;loot=null;flight=false;nextAt=0;pendingCard=null;floating.length=0;}};
})(typeof window!=='undefined'?window:globalThis);
