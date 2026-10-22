'use strict';
// Side-scrolling cooperative street combat. The host owns hits and enemies;
// guests predict only their movement and attack poses, then replay unacknowledged input.
(function(root){
 const clamp=(n,a,b)=>Math.max(a,Math.min(b,n)),palette=['#df584c','#6c83cc','#cc9b38','#55a88a','#a76cb4','#dd8752'];
 const D=root.CityDriving||(typeof require==='function'?require('./city-driving'):null),sprites=new Map(),looks=new Map();let backdrop=null,builds=0,poseBuilds=0;
 const blocks=3,blockWidth=1180,lane={top:350,bottom:550};
 function init(s){clear();
  s.streetStage=1;s.streetKills=0;s.streetNext=0;s.enemies=[];s.effects=[];s.streetWon=false;
  Object.entries(s.players).forEach(([id,p],n)=>Object.assign(p,{id,x:180+n*38,y:425+n%3*30,hp:100,face:1,combo:0,comboAt:-10,attackTime:0,attackSerial:0,cooldown:0,invincible:1,down:0,phase:0}));
  spawn(s);
 }
 function spawn(s){
  const start=(s.streetStage-1)*blockWidth,count=Math.min(8,2+Math.ceil(s.accepted.length/2)+s.streetStage);
  s.enemies=Array.from({length:count},(_,n)=>({id:'street-'+s.streetStage+'-'+n,x:start+670+(n%4)*105,y:lane.top+30+(n*47)%155,hp:n%3===2?150:110,maxHp:n%3===2?150:110,seed:n+s.streetStage*17,face:-1,brute:n%3===2,cooldown:.12+n*.04,enemyCombo:0,attackTime:0,combo:0,windup:0,stun:0,ragdoll:0,ragdollDuration:2.7,z:0,vz:0,vx:0,vy:0,phase:n*.7,flash:0}));
 }
 function move(p,input,dt,s){
  p.cooldown=Math.max(0,(p.cooldown||0)-dt);p.attackTime=Math.max(0,(p.attackTime||0)-dt);p.invincible=Math.max(0,(p.invincible||0)-dt);p.down=Math.max(0,(p.down||0)-dt);if(p.ragdoll>0){advanceEnemy(p,dt);if(!p.ragdoll){p.down=0;p.invincible=.45;}return;}
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
   const damage=finisher?36:10;e.hp=Math.max(0,e.hp-damage);e.flash=.16;e.stun=finisher?.7:e.brute?.07:.16;e.x+=p.face*(finisher?15:7);p.score+=damage;
   s.effects.push({x:e.x,y:e.y-65,life:.23,kind:finisher?'finish':'hit',face:p.face});
   if(finisher||e.hp<=0)toss(s,e,p,finisher?320:175);
   if(e.hp<=0){e.deadAt=s.elapsed;s.streetKills++;p.score+=50;}
  }
  s.effects=s.effects.slice(-24);
 }
 function hash(text){let h=2166136261;for(const c of String(text))h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;}
 function toss(s,p,source,power=280){p.ragdollStamp=(p.ragdollStamp||0)+1;p.ragdollSeed=hash(s.id+':'+p.id+':'+p.ragdollStamp+':'+Math.round(s.elapsed*1000));const seed=p.ragdollSeed,spread=(seed%101-50)/50;p.ragdoll=p.down=2.7;p.ragdollDuration=2.7;p.vx=(source.face||1)*power*(.85+(seed%31)/100);p.vy=(p.y-source.y)*1.2+spread*65;p.vz=195+(seed%91);p.z=1;p.angle=Math.atan2(p.vx,-p.vy);p.knockX=p.vx;p.knockY=p.vy;}
 function enemyHit(s,e,p){const dx=p.x-e.x,dy=p.y-e.y;if(Math.abs(dx)>78||Math.abs(dy)>42||p.invincible>0||p.hp<=0||p.ragdoll>0)return;e.enemyCombo=(e.enemyCombo||0)%3+1;e.combo=e.enemyCombo;e.attackTime=.22;p.hp=Math.max(0,p.hp-(e.brute?e.enemyCombo===3?18:10:8));p.invincible=.18;p.x+=e.face*(e.brute?8:5);s.effects.push({x:p.x,y:p.y-65,life:.23,kind:e.enemyCombo===3?'finish':'hit'});if(e.brute&&e.enemyCombo===3||!p.hp)toss(s,p,e,e.brute?300:195);}
 function advanceEnemy(e,dt){
  if(!(e.ragdoll>0))return;e.ragdoll=Math.max(0,e.ragdoll-dt);e.x+=e.vx*dt;e.y=clamp(e.y+e.vy*dt,lane.top-12,lane.bottom+12);e.vz-=550*dt;e.z=Math.max(0,e.z+e.vz*dt);
  if(!e.z){if(e.vz< -80)e.vz*=-.18;else e.vz=0;}
  const drag=Math.exp(-dt*(e.z>0?.7:7));e.vx*=drag;e.vy*=drag;e.knockX=e.vx;e.knockY=e.vy;
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
   e.flash=Math.max(0,e.flash-dt);e.attackTime=Math.max(0,(e.attackTime||0)-dt);e.stun=Math.max(0,e.stun-dt);e.cooldown=Math.max(0,e.cooldown-dt);
   if(e.ragdoll>0){advanceEnemy(e,dt);continue;}if(e.hp<=0||e.stun>0)continue;
   const targets=living.filter(p=>!(p.ragdoll>0));if(!targets.length)continue;const target=targets.reduce((best,p)=>!best||Math.hypot(p.x-e.x,(p.y-e.y)*2)<Math.hypot(best.x-e.x,(best.y-e.y)*2)?p:best,null),dx=target.x-e.x,dy=target.y-e.y;
   e.face=dx>=0?1:-1;
   if(e.windup>0){e.windup-=dt;if(e.windup<=0){enemyHit(s,e,target);e.cooldown=e.brute?.25:.42;}}
   else if(Math.abs(dx)<66&&Math.abs(dy)<34){if(!e.cooldown)e.windup=e.brute?.14:.2;}
   else{if(Math.abs(dx)>130||Math.abs(dy)>70)e.enemyCombo=0;const len=Math.max(1,Math.hypot(dx,dy*2));e.x+=dx/len*(e.brute?100:115)*dt;e.y=clamp(e.y+dy/len*125*dt,lane.top,lane.bottom);e.phase+=dt*8;}

  }
  const bodies=Object.values(s.players).concat(s.enemies);if(bodies.some(p=>p.ragdoll>0)){D?.contacts(bodies);const start=(s.streetStage-1)*blockWidth;for(const p of bodies)if(p.ragdoll>0){const x=p.x,y=p.y;p.x=clamp(p.x,start+20,start+blockWidth-20);p.y=clamp(p.y,lane.top-12,lane.bottom+12);if(x!==p.x||y!==p.y){const vx=p.vx||0,vy=p.vy||0;p.vx=x!==p.x?-vx*.3:vx;p.vy=y!==p.y?-vy*.3:vy;D?.limbImpact(p,p.vx-vx,p.vy-vy,x!==p.x?Math.sign(p.x-x):0,y!==p.y?Math.sign(p.y-y):0,Math.hypot(vx,vy));}p.knockX=p.vx;p.knockY=p.vy;}}
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
    Object.values(s.players).forEach((p,n)=>{p.x=(s.streetStage-1)*blockWidth+180+n*38;p.hp=Math.min(100,Math.max(45,p.hp+25));p.invincible=1.5;p.down=p.ragdoll=p.z=p.vz=p.vx=p.vy=0;});spawn(s);
   }
  }
 }
 function predict(s,id,input,dt){const p=s.players[id];if(p)move(p,input,dt,s);}
 function present(s,id,dt){
  for(const e of s.enemies||[]){e.flash=Math.max(0,e.flash-dt);e.attackTime=Math.max(0,(e.attackTime||0)-dt);if(e.ragdoll>0)advanceEnemy(e,dt);}
  for(const [who,p]of Object.entries(s.players))if(who!==id){p.attackTime=Math.max(0,(p.attackTime||0)-dt);if(p.ragdoll>0)advanceEnemy(p,dt);}
 }
 function valid(s){return Number.isInteger(s.streetStage)&&s.streetStage>=1&&s.streetStage<=3&&Array.isArray(s.enemies)&&s.enemies.length<=14&&s.enemies.every(e=>typeof e.id==='string'&&[e.x,e.y,e.hp,e.maxHp,e.seed,e.face,e.cooldown,e.windup,e.stun,e.ragdoll,e.z,e.vz,e.vx,e.vy,e.phase,e.flash].every(Number.isFinite)&&e.hp>=0&&e.hp<=160&&Math.abs(e.x)<6000&&Math.abs(e.y)<1000);}
 function clear(){sprites.clear();looks.clear();backdrop=null;builds=poseBuilds=0;}
 function enemyLook(e){const key=e.seed%palette.length;if(!looks.has(key))looks.set(key,{skin:'skin-neutral',useCustomAppearance:true,appearance:{...root.BrawlCore.appearanceDefaults(),topColor:palette[key],hairColor:'#39313e',bottomColor:'#26364c'}});return looks.get(key);}
 function paintCharacter(c,m,o){if(o.ragdoll>0||!root.document?.createElement)return root.CharacterRig?.draw(c,m,o);const phase=o.moving?Math.round((o.phase||0)/(Math.PI/2))%4:0,attack=o.attack?Math.max(1,Math.round(o.attack*3)):0,key=JSON.stringify([m.skin,m.appearance,m.useCustomAppearance,o.yaw,o.bulk,phase,!!o.moving,attack,o.finisher]);let sprite=sprites.get(key);if(!sprite){if(sprites.size>=112){const first=sprites.keys().next().value;sprite=sprites.get(first);sprites.delete(first);}else sprite=root.document.createElement('canvas');sprite.width=180;sprite.height=225;const g=sprite.getContext('2d');g.scale(1.5,1.5);root.CharacterRig?.draw(g,m,{...o,x:60,y:140,phase:phase*Math.PI/2,attack:attack/3});sprites.set(key,sprite);poseBuilds++;}else{sprites.delete(key);sprites.set(key,sprite);}c.drawImage(sprite,o.x-60,o.y-140,120,150);}
 function scenery(s){if(backdrop?.stage===s.streetStage)return backdrop.canvas;builds++;const canvas=root.document.createElement('canvas');canvas.width=blockWidth;canvas.height=600;const g=canvas.getContext('2d'),A=root.CityArt,neons=['#75d9df','#d482b9','#dcb772'],sky=g.createLinearGradient(0,0,0,360);sky.addColorStop(0,'#0c172b');sky.addColorStop(1,'#39445c');g.fillStyle=sky;g.fillRect(0,0,blockWidth,600);
  for(let n=0;n<12;n++){const x=n*110-40,h=80+(n*39)%110;g.fillStyle=n%2?'#18283b':'#203247';g.fillRect(x,215-h,104,h+145);g.fillStyle='#bcb486';for(let row=0;row<4;row++)for(let col=0;col<3;col++)if((n+row+col)%3)g.fillRect(x+14+col*27,235-h+row*29,10,14);}
  const stores=(A?.buildings||[]).filter(b=>b.commerce&&!b.fuel);for(let n=0;n<6;n++){const source=stores[(n+(s.streetStage-1)*3)%Math.max(1,stores.length)]||{color:'#758b8b',roof:'#4a606d',name:['LE QUARTIER','ATELIER','CAFÉ DES PINS'][n%3]},x=n*207-30,w=200,h=155+(n%3)*22,b={...source,x,y:0,w,d:58,h,name:null,commerce:true,fuel:false};
   if(A?.buildingModel)A.withProjection((xx,yy,z=0)=>({x:xx+yy*.24,y:350+(yy-58)*.2-z*.94}),()=>A.buildingModel(g,b));else{g.fillStyle=source.color;g.fillRect(x,350-h,w,h);g.fillStyle='#243c4c';g.fillRect(x+12,289,w-24,61);}
   g.fillStyle='#10213c73';g.fillRect(x,350-h,w+15,h);const color=neons[n%3];g.shadowColor=color;g.shadowBlur=8;g.strokeStyle=color;g.lineWidth=2;g.strokeRect(x+10,294,w-20,49);g.fillStyle='#142b3e';g.fillRect(x+10,277,w-20,18);g.fillStyle=color;g.font='bold 12px sans-serif';g.textAlign='center';g.fillText(String(source.name||'LE QUARTIER').slice(0,25),x+w/2,290);g.shadowBlur=0;g.fillStyle='#e8d4a033';g.fillRect(x+25,304,38,38);g.fillRect(x+w-63,304,38,38);}
  g.fillStyle='#6b7982';g.fillRect(0,350,blockWidth,16);g.fillStyle='#98a3a2';g.fillRect(0,366,blockWidth,3);const road=g.createLinearGradient(0,370,0,600);road.addColorStop(0,'#263546');road.addColorStop(1,'#142335');g.fillStyle=road;g.fillRect(0,369,blockWidth,231);
  for(let n=0;n<6;n++){const x=80+n*207,color=neons[n%3];const reflection=g.createLinearGradient(x,370,x,560);reflection.addColorStop(0,color+'3d');reflection.addColorStop(1,color+'00');g.fillStyle=reflection;g.beginPath();g.moveTo(x-28,370);g.lineTo(x+28,370);g.lineTo(x+75,555);g.lineTo(x-75,555);g.closePath();g.fill();g.fillStyle='#263e4b';g.fillRect(x+82,292,5,68);g.fillRect(x+72,289,25,6);const light=g.createRadialGradient(x+85,310,3,x+85,310,55);light.addColorStop(0,'#f4db9c42');light.addColorStop(1,'#f4db9c00');g.fillStyle=light;g.fillRect(x+30,255,110,110);g.fillStyle='#324d58';g.fillRect(x+50,339,18,23);g.fillStyle='#5b747a';g.fillRect(x+48,337,22,4);}
  g.strokeStyle='#d5e4dc12';g.lineWidth=1;for(let y=396;y<600;y+=37){g.beginPath();g.moveTo(0,y);g.lineTo(blockWidth,y);g.stroke();}g.fillStyle='#c9bd85';for(let x=25;x<blockWidth;x+=145)g.fillRect(x,576,62,3);backdrop={stage:s.streetStage,canvas};return canvas;
 }
 function draw(c,{state:s,members,localId,width:w,height:h}){
  const viewWidth=clamp(600*w/h,360,1000),scale=Math.min(w/viewWidth,h/600),ox=(w-viewWidth*scale)/2,oy=(h-600*scale)/2,me=s.players[localId],start=(s.streetStage-1)*blockWidth,camera=clamp((me?.x||start+180)-viewWidth*.35,start,start+blockWidth-viewWidth);
  c.fillStyle='#101b30';c.fillRect(0,0,w,h);c.save();c.translate(ox,oy);c.scale(scale,scale);
  c.drawImage(scenery(s),camera-start,0,viewWidth,600,0,0,viewWidth,600);c.save();c.translate(-camera,0);
  const entities=Object.entries(s.players).map(([id,p])=>({id,p,m:members.find(m=>m.id===id)||{skin:'skin-neutral',useCustomAppearance:false},player:true})).concat((s.enemies||[]).map(e=>({id:e.id,p:e,m:enemyLook(e),player:false}))).sort((a,b)=>a.p.y-b.p.y);
  for(const {id,p,m,player}of entities){
   if(p.x<camera-120||p.x>camera+viewWidth+120)continue;const dead=p.hp<=0,fall=player?dead?Math.max(.65,p.ragdoll||p.down):p.ragdoll||0:dead?Math.max(.65,p.ragdoll):p.ragdoll;
   c.fillStyle='#10182765';c.beginPath();c.ellipse(p.x,p.y+3,24,7,0,0,7);c.fill();
   c.save();if(p.invincible>0&&Math.floor(s.elapsed*18)%2)c.globalAlpha=.65;
   paintCharacter(c,m,{...p,x:p.x,y:p.y-(p.z||0),scale:p.brute?.86:.76,bulk:p.brute?1.3:1,yaw:(p.face||1)*Math.PI/2,phase:p.phase,moving:player?p.moving:!p.windup&&!fall,attack:p.attackTime>0?1-p.attackTime/.22:0,finisher:player?p.combo===4:p.combo===3,ragdoll:fall,ragdollDuration:2.7,ragdollStamp:p.ragdollStamp||0,id,knockX:p.vx||p.face*200,knockY:p.vy||0,shadow:false});
   if(p.flash>0){c.fillStyle='#ff665580';c.beginPath();c.ellipse(p.x,p.y-70-(p.z||0),24,38,0,0,7);c.fill();}c.restore();
   if(!dead){const y=p.y-(p.brute?138:122)-(p.z||0);c.fillStyle='#132439';c.fillRect(p.x-31,y,62,6);c.fillStyle=player?'#7ce0c0':'#f18f81';c.fillRect(p.x-30,y+1,60*p.hp/(p.maxHp||100),4);c.font='bold 12px sans-serif';c.textAlign='center';c.fillStyle=player?'#eaf4ff':'#ffd4a0';c.fillText(player?String(m.name||'Joueur').slice(0,18):p.windup>0?'!':'',p.x,y-6);if(player&&p.attackTime>0){c.fillStyle=p.combo===4?'#ffc370':'#b9edf6';c.fillText(p.combo===4?'FINALE !':p.combo+' / 3',p.x,y-23);}}
  }
  for(const e of s.effects||[]){c.save();c.translate(e.x,e.y);c.globalAlpha=clamp(e.life/.23,0,1);c.strokeStyle=e.kind==='finish'?'#ffd274':'#fff0cd';c.lineWidth=e.kind==='finish'?6:3;const r=(.25-e.life)*100+9;for(let n=0;n<7;n++){const a=n*Math.PI*2/7;c.beginPath();c.moveTo(Math.cos(a)*r*.6,Math.sin(a)*r*.6);c.lineTo(Math.cos(a)*r*1.5,Math.sin(a)*r*1.5);c.stroke();}c.restore();}
  c.restore();c.fillStyle='#17273de8';c.fillRect(16,14,260,53);c.fillStyle='#f7d58d';c.font='bold 18px sans-serif';c.textAlign='left';c.fillText('STREET OF RAGE',30,37);c.fillStyle='#e1ebf5';c.font='14px sans-serif';c.fillText('Quartier '+s.streetStage+' / 3 · '+s.streetKills+' ennemis éliminés',30,57);
  if(s.streetNext){c.fillStyle='#fff0bc';c.font='bold 23px sans-serif';c.textAlign='center';c.fillText(s.streetStage===3?'QUARTIER NETTOYÉ !':'QUARTIER SUIVANT →',viewWidth/2,140);}c.restore();
 }
 const api={clear,scenery,paintCharacter,enemyHit,toss,stats:()=>({backgroundBuilds:builds,poseBuilds,poses:sprites.size}),init,move,step,predict,present,valid,draw,strike,advanceEnemy};if(typeof module!=='undefined')module.exports=api;else root.CityStreetRage=api;
})(typeof window==='undefined'?globalThis:window);
