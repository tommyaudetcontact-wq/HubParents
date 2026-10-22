'use strict';
// Side-scrolling cooperative street combat. The host owns hits and enemies;
// guests predict only their movement and attack poses, then replay unacknowledged input.
(function(root){
 const clamp=(n,a,b)=>Math.max(a,Math.min(b,n)),palette=['#df584c','#6c83cc','#cc9b38','#55a88a','#a76cb4','#dd8752'];
 const blocks=3,blockWidth=1180,lane={top:350,bottom:550};
 function init(s){
  s.streetStage=1;s.streetKills=0;s.streetNext=0;s.enemies=[];s.effects=[];s.streetWon=false;
  Object.values(s.players).forEach((p,n)=>Object.assign(p,{x:180+n*38,y:425+n%3*30,hp:100,face:1,combo:0,comboAt:-10,attackTime:0,attackSerial:0,cooldown:0,invincible:1,down:0,phase:0}));
  spawn(s);
 }
 function spawn(s){
  const start=(s.streetStage-1)*blockWidth,count=Math.min(8,2+Math.ceil(s.accepted.length/2)+s.streetStage);
  s.enemies=Array.from({length:count},(_,n)=>({id:'street-'+s.streetStage+'-'+n,x:start+670+(n%4)*105,y:lane.top+30+(n*47)%155,hp:n%4===3?150:110,maxHp:n%4===3?150:110,seed:n+s.streetStage*17,face:-1,cooldown:.7+n*.16,windup:0,stun:0,ragdoll:0,ragdollDuration:2.7,z:0,vz:0,vx:0,vy:0,phase:n*.7,flash:0}));
 }
 function move(p,input,dt,s){
  p.cooldown=Math.max(0,(p.cooldown||0)-dt);p.attackTime=Math.max(0,(p.attackTime||0)-dt);p.invincible=Math.max(0,(p.invincible||0)-dt);p.down=Math.max(0,(p.down||0)-dt);
  if(p.hp<=0||p.down>0)return;
  const len=Math.max(1,Math.hypot(input.x,input.y)),dx=input.x/len,dy=input.y/len,start=(s.streetStage-1)*blockWidth;
  p.x=clamp(p.x+dx*215*dt,start+45,start+blockWidth-40);p.y=clamp(p.y+dy*140*dt,lane.top,lane.bottom);
  if(Math.abs(dx)>.1)p.face=Math.sign(dx);p.moving=Math.hypot(dx,dy)>.1;p.phase=(p.phase||0)+Math.hypot(dx,dy)*dt*10;
  if(input.fire&&p.cooldown<=0){
   p.combo=s.elapsed-p.comboAt<.85?p.combo%4+1:1;p.comboAt=s.elapsed;p.attackTime=.22;p.cooldown=p.combo===4?.48:.23;p.attackSerial=(p.attackSerial||0)+1;
  }
 }
 function strike(s,id,p){
  const finisher=p.combo===4,reach=finisher?108:90;
  const targets=s.enemies.filter(e=>e.hp>0&&e.ragdoll<=0&&Math.abs(e.y-p.y)<45&&(e.x-p.x)*p.face> -16&&(e.x-p.x)*p.face<reach).sort((a,b)=>Math.abs(a.x-p.x)-Math.abs(b.x-p.x));
  for(const e of targets.slice(0,finisher?3:1)){
   const damage=finisher?36:10;e.hp=Math.max(0,e.hp-damage);e.flash=.16;e.stun=finisher?.7:.32;e.x+=p.face*(finisher?15:7);p.score+=damage;
   s.effects.push({x:e.x,y:e.y-65,life:.23,kind:finisher?'finish':'hit',face:p.face});
   if(finisher||e.hp<=0){e.ragdoll=2.7;e.ragdollStamp=(e.ragdollStamp||0)+1;e.vx=p.face*(finisher?320:160);e.vy=(e.y-p.y)*1.5;e.vz=finisher?250:150;e.z=1;}
   if(e.hp<=0){e.deadAt=s.elapsed;s.streetKills++;p.score+=50;}
  }
  s.effects=s.effects.slice(-24);
 }
 function advanceEnemy(e,dt){
  if(!(e.ragdoll>0))return;e.ragdoll=Math.max(0,e.ragdoll-dt);e.x+=e.vx*dt;e.y=clamp(e.y+e.vy*dt,lane.top-12,lane.bottom+12);e.vz-=550*dt;e.z=Math.max(0,e.z+e.vz*dt);
  if(!e.z){if(e.vz< -80)e.vz*=-.18;else e.vz=0;}
  const drag=Math.exp(-dt*(e.z>0?.7:7));e.vx*=drag;e.vy*=drag;
 }
 function step(s,actors,dt,finish){
  s.effects=(s.effects||[]).filter(e=>(e.life-=dt)>0);
  for(const [id,p] of Object.entries(s.players)){
   const before=p.attackSerial;
   if(p.queued){
    p.credit=Math.min(.3,(p.credit??.12)+dt);let advanced=0;
    while(p.queue?.length&&p.credit>=p.queue[0].dt&&advanced+p.queue[0].dt<=.07){const f=p.queue.shift();p.credit-=f.dt;advanced+=f.dt;const serial=p.attackSerial;move(p,f,f.dt,s);if(p.attackSerial!==serial)strike(s,id,p);p.ack=f.seq;p.input={...f,at:s.elapsed};}
   }else{move(p,p.input&&s.elapsed-p.input.at<.45?p.input:{x:0,y:0,fire:false},dt,s);if(p.attackSerial!==before)strike(s,id,p);}
  }
  const living=Object.values(s.players).filter(p=>p.hp>0);
  if(!living.length){s.streetWon=false;finish(s,actors);return;}
  for(const e of s.enemies){
   e.flash=Math.max(0,e.flash-dt);e.stun=Math.max(0,e.stun-dt);e.cooldown=Math.max(0,e.cooldown-dt);
   if(e.ragdoll>0){advanceEnemy(e,dt);continue;}if(e.hp<=0||e.stun>0)continue;
   const target=living.reduce((best,p)=>!best||Math.hypot(p.x-e.x,(p.y-e.y)*2)<Math.hypot(best.x-e.x,(best.y-e.y)*2)?p:best,null),dx=target.x-e.x,dy=target.y-e.y;
   e.face=dx>=0?1:-1;
   if(e.windup>0){e.windup-=dt;if(e.windup<=0){if(Math.abs(dx)<68&&Math.abs(dy)<38&&!target.invincible){target.hp=Math.max(0,target.hp-9);target.invincible=.7;target.down=target.hp<=0?2.7:0;target.x+=e.face*12;s.effects.push({x:target.x,y:target.y-65,life:.18,kind:'hit'});}e.cooldown=1.1;}}
   else if(Math.abs(dx)<55&&Math.abs(dy)<30){if(!e.cooldown)e.windup=.48;}
   else{const len=Math.max(1,Math.hypot(dx,dy*2));e.x+=dx/len*(e.maxHp>110?66:90)*dt;e.y=clamp(e.y+dy/len*105*dt,lane.top,lane.bottom);e.phase+=dt*8;}
  }
  // Keep approaching opponents distinct rather than stacking every sprite.
  for(let i=0;i<s.enemies.length;i++)for(let j=i+1;j<s.enemies.length;j++){
   const a=s.enemies[i],b=s.enemies[j];if(a.hp<=0||b.hp<=0||a.ragdoll||b.ragdoll)continue;
   const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);if(d<30){const force=Math.min(30,(30-d)*5)*dt,nx=d?dx/d:1,ny=d?dy/d:0;a.x-=nx*force;b.x+=nx*force;a.y=clamp(a.y-ny*force,lane.top,lane.bottom);b.y=clamp(b.y+ny*force,lane.top,lane.bottom);}
  }
  // Dead bodies retain their articulated fall briefly, then leave the simulation.
  s.enemies=s.enemies.filter(e=>e.hp>0||s.elapsed-e.deadAt<3);
  if(s.enemies.every(e=>e.hp<=0)){
   if(!s.streetNext)s.streetNext=s.elapsed+1.8;
   if(s.elapsed>=s.streetNext){
    if(s.streetStage>=blocks){s.streetWon=true;finish(s,actors,s.accepted.slice().sort((a,b)=>s.players[b].score-s.players[a].score)[0]);return;}
    s.streetStage++;s.streetNext=0;
    Object.values(s.players).forEach((p,n)=>{p.x=(s.streetStage-1)*blockWidth+180+n*38;p.hp=Math.min(100,Math.max(45,p.hp+25));p.invincible=1.5;p.down=0;});spawn(s);
   }
  }
 }
 function predict(s,id,input,dt){const p=s.players[id];if(p)move(p,input,dt,s);}
 function present(s,id,dt){
  for(const e of s.enemies||[]){e.flash=Math.max(0,e.flash-dt);if(e.ragdoll>0)advanceEnemy(e,dt);}
  for(const [who,p]of Object.entries(s.players))if(who!==id)p.attackTime=Math.max(0,(p.attackTime||0)-dt);
 }
 function valid(s){return Number.isInteger(s.streetStage)&&s.streetStage>=1&&s.streetStage<=3&&Array.isArray(s.enemies)&&s.enemies.length<=14&&s.enemies.every(e=>typeof e.id==='string'&&[e.x,e.y,e.hp,e.maxHp,e.seed,e.face,e.cooldown,e.windup,e.stun,e.ragdoll,e.z,e.vz,e.vx,e.vy,e.phase,e.flash].every(Number.isFinite)&&e.hp>=0&&e.hp<=160&&Math.abs(e.x)<6000&&Math.abs(e.y)<1000);}
 function draw(c,{state:s,members,localId,width:w,height:h}){
  const viewWidth=clamp(600*w/h,360,1000),scale=Math.min(w/viewWidth,h/600),ox=(w-viewWidth*scale)/2,oy=(h-600*scale)/2,me=s.players[localId],start=(s.streetStage-1)*blockWidth,camera=clamp((me?.x||start+180)-viewWidth*.35,start,start+blockWidth-viewWidth);
  c.fillStyle='#101b30';c.fillRect(0,0,w,h);c.save();c.translate(ox,oy);c.scale(scale,scale);
  const sky=c.createLinearGradient(0,0,0,340);sky.addColorStop(0,'#202a49');sky.addColorStop(1,'#b16b79');c.fillStyle=sky;c.fillRect(0,0,1000,600);
  // All scenery is simple geometry: no per-frame image allocation or costly filters.
  for(let n=-1;n<9;n++){const x=n*150-(camera*.3%150);c.fillStyle=n%2?'#303c57':'#374861';c.fillRect(x,75+n%3*20,140,260);c.fillStyle='#e8b777';for(let row=0;row<4;row++)for(let col=0;col<4;col++)if((row+col+n)%3)c.fillRect(x+15+col*30,100+row*43,12,21);}
  c.save();c.translate(-camera,0);
  const storeNames=['ARCADE','LE QUARTIER','CAFÉ NÉON','ATELIER','VINYLES','BRAWL CLUB'];
  for(let n=0;n<8;n++){const x=start+n*170-100;c.fillStyle=n%2?'#675363':'#535e77';c.fillRect(x,185,166,165);c.fillStyle='#273347';c.fillRect(x+12,250,140,95);c.strokeStyle=n%2?'#60d9d2':'#f4bd75';c.lineWidth=4;c.strokeRect(x+12,250,140,95);c.fillStyle='#243049';c.fillRect(x+8,210,150,30);c.fillStyle=n%2?'#76f3d9':'#ffcc8b';c.font='bold 16px sans-serif';c.textAlign='center';c.fillText(storeNames[n%6],x+83,231);}
  c.fillStyle='#8c8391';c.fillRect(start-10,347,blockWidth+20,22);c.fillStyle='#42495b';c.fillRect(start-10,369,blockWidth+20,231);
  c.strokeStyle='#565e72';c.lineWidth=1;for(let y=380;y<600;y+=42){c.beginPath();c.moveTo(start,y);c.lineTo(start+blockWidth,y);c.stroke();}
  c.fillStyle='#dbb67b';for(let x=start+30;x<start+blockWidth;x+=145)c.fillRect(x,575,65,5);
  const entities=Object.entries(s.players).map(([id,p])=>({id,p,m:members.find(m=>m.id===id)||{skin:'skin-neutral',useCustomAppearance:false},player:true})).concat((s.enemies||[]).map(e=>({id:e.id,p:e,m:{skin:'skin-neutral',useCustomAppearance:true,appearance:{...root.BrawlCore.appearanceDefaults(),topColor:palette[e.seed%palette.length],hairColor:'#39313e',bottomColor:'#26364c'}},player:false}))).sort((a,b)=>a.p.y-b.p.y);
  for(const {id,p,m,player}of entities){
   if(p.x<camera-120||p.x>camera+viewWidth+120)continue;const dead=p.hp<=0,fall=player?dead?Math.max(.65,p.down):0:dead?Math.max(.65,p.ragdoll):p.ragdoll;
   c.fillStyle='#10182765';c.beginPath();c.ellipse(p.x,p.y+3,24,7,0,0,7);c.fill();
   c.save();if(p.invincible>0&&Math.floor(s.elapsed*18)%2)c.globalAlpha=.65;
   root.CharacterRig?.draw(c,m,{x:p.x,y:p.y-(p.z||0),scale:.76,yaw:(p.face||1)*Math.PI*.36,phase:p.phase,moving:player?p.moving:!p.windup&&!fall,attack:p.attackTime>0?1-p.attackTime/.22:0,finisher:p.combo===4,ragdoll:fall,ragdollDuration:2.7,ragdollStamp:p.ragdollStamp||0,id,knockX:p.vx||p.face*200,knockY:p.vy||0,shadow:false});
   if(p.flash>0){c.fillStyle='#ff665580';c.beginPath();c.ellipse(p.x,p.y-70-(p.z||0),24,38,0,0,7);c.fill();}c.restore();
   if(!dead){const y=p.y-145-(p.z||0);c.fillStyle='#132439';c.fillRect(p.x-31,y,62,6);c.fillStyle=player?'#7ce0c0':'#f18f81';c.fillRect(p.x-30,y+1,60*p.hp/(p.maxHp||100),4);c.font='bold 12px sans-serif';c.textAlign='center';c.fillStyle=player?'#eaf4ff':'#ffd4a0';c.fillText(player?String(m.name||'Joueur').slice(0,18):p.windup>0?'!':'',p.x,y-6);if(player&&p.attackTime>0){c.fillStyle=p.combo===4?'#ffc370':'#b9edf6';c.fillText(p.combo===4?'FINALE !':p.combo+' / 3',p.x,y-23);}}
  }
  for(const e of s.effects||[]){c.save();c.translate(e.x,e.y);c.globalAlpha=clamp(e.life/.23,0,1);c.strokeStyle=e.kind==='finish'?'#ffd274':'#fff0cd';c.lineWidth=e.kind==='finish'?6:3;const r=(.25-e.life)*100+9;for(let n=0;n<7;n++){const a=n*Math.PI*2/7;c.beginPath();c.moveTo(Math.cos(a)*r*.6,Math.sin(a)*r*.6);c.lineTo(Math.cos(a)*r*1.5,Math.sin(a)*r*1.5);c.stroke();}c.restore();}
  c.restore();c.fillStyle='#17273de8';c.fillRect(16,14,260,53);c.fillStyle='#f7d58d';c.font='bold 18px sans-serif';c.textAlign='left';c.fillText('STREET OF RAGE',30,37);c.fillStyle='#e1ebf5';c.font='14px sans-serif';c.fillText('Quartier '+s.streetStage+' / 3 · '+s.streetKills+' ennemis éliminés',30,57);
  if(s.streetNext){c.fillStyle='#fff0bc';c.font='bold 23px sans-serif';c.textAlign='center';c.fillText(s.streetStage===3?'QUARTIER NETTOYÉ !':'QUARTIER SUIVANT →',viewWidth/2,140);}c.restore();
 }
 const api={init,move,step,predict,present,valid,draw,strike,advanceEnemy};if(typeof module!=='undefined')module.exports=api;else root.CityStreetRage=api;
})(typeof window==='undefined'?globalThis:window);
