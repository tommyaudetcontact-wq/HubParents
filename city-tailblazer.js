'use strict';
(function(root){
 const colors=['#70e9ff','#ff8bbf'],radius=260,speed=145;
 const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
 function spawn(s){
  s.roundTime=0;s.pause=1.2;s.roundPause=0;
  s.accepted.forEach((id,n)=>Object.assign(s.players[id],{
   x:500+(n?-115:115),y:300,heading:n?Math.PI/2:-Math.PI/2,
   out:false,hp:100,tail:[],tailLength:240,straight:0,tailAt:0,queue:[],input:null
  }));
 }
 function init(s){s.round=1;for(const p of Object.values(s.players))p.score=0;spawn(s);}
 function move(s,p,input,dt,emit=true){
  if(p.out||s.pause>0||s.roundPause>0)return;
  const old=p.heading;
  if(Math.hypot(input.x,input.y)>.16){const delta=wrap(Math.atan2(input.y,input.x)-old);p.heading+=Math.max(-2.9*dt,Math.min(2.9*dt,delta));}
  p.straight=Math.abs(wrap(p.heading-old))<.006?(p.straight||0)+dt:0;
  p.x+=Math.cos(p.heading)*speed*dt;p.y+=Math.sin(p.heading)*speed*dt;
  p.tailLength=Math.min(1900,240+s.roundTime*16+Math.min(120,p.straight*18));
  p.tail=p.tail||[];p.tailAt=(p.tailAt||0)+speed*dt;
  if(emit&&p.tailAt>=8){p.tailAt%=8;p.tail.push([Math.round(p.x*10)/10,Math.round(p.y*10)/10]);}
  while(p.tail.length>Math.min(240,Math.ceil(p.tailLength/8)))p.tail.shift();
 }
 function distance(x,y,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(x-a[0]-dx*t,y-a[1]-dy*t);}
 function crash(s,p){
  if(Math.hypot(p.x-500,p.y-300)>radius-12)return true;
  for(const other of Object.values(s.players)){
   const tail=other.tail||[],end=tail.length-(other===p?9:0);
   for(let n=1;n<end;n++)if(distance(p.x,p.y,tail[n-1],tail[n])<12)return true;
  }
  return false;
 }
 function step(s,actors,dt,finish){
  if(s.accepted.length!==2)return finish(s,actors,s.accepted[0]);
  s.pause=Math.max(0,s.pause-dt);if(s.pause)return;
  s.roundTime+=dt;
  for(const p of Object.values(s.players)){
   if(p.queued){p.credit=Math.min(.3,(p.credit??.12)+dt);let advanced=0;
    while(p.queue?.length&&p.credit>=p.queue[0].dt&&advanced+p.queue[0].dt<=.07){const f=p.queue.shift();p.credit-=f.dt;advanced+=f.dt;move(s,p,f,f.dt);p.ack=f.seq;p.input={...f,at:s.elapsed};}
   }else move(s,p,p.input&&s.elapsed-p.input.at<.5?p.input:{x:0,y:0},dt);
  }
  // Evaluate everyone before deleting a tail, so simultaneous hits remain fair.
  const hit=Object.values(s.players).filter(p=>!p.out&&crash(s,p));
  for(const p of hit){p.out=true;p.hp=0;p.tail=[];}
  const alive=Object.entries(s.players).filter(([,p])=>!p.out);
  if(alive.length<=1||s.roundTime>=90){
   s.roundPause=(s.roundPause||0)+dt;
   if(s.roundPause<1.5)return;
   const ranked=Object.entries(s.players).sort((a,b)=>Number(a[1].out)-Number(b[1].out));
   if(alive.length===1){ranked[0][1].score+=5;ranked[1][1].score+=3;}else for(const [,p]of ranked)p.score+=3;
   if(s.round>=3){const winner=ranked.sort((a,b)=>b[1].score-a[1].score);return finish(s,actors,winner[0][1].score===winner[1][1].score?null:winner[0][0]);}
   s.round++;spawn(s);
  }
 }
 function predict(s,id,input,dt){const p=s.players[id];if(p)move(s,p,input,dt);}
 function draw(g,{state:s,members,localId,width,height}){
  g.fillStyle='#102b42';g.fillRect(0,0,width,height);
  const scale=Math.min(width/590,Math.max(1,height-115)/590);
  g.save();g.translate(width/2-500*scale,(height-115)/2-300*scale);g.scale(scale,scale);
  const rink=g.createRadialGradient(430,210,20,500,300,radius);rink.addColorStop(0,'#567a99');rink.addColorStop(1,'#254963');
  g.fillStyle=rink;g.beginPath();g.arc(500,300,radius,0,Math.PI*2);g.fill();
  g.strokeStyle='#c1e5ed';g.lineWidth=7;g.stroke();g.strokeStyle='#9dcbd033';g.lineWidth=1;
  for(let r=60;r<250;r+=60){g.beginPath();g.arc(500,300,r,0,7);g.stroke();}
  s.accepted.forEach((id,n)=>{const p=s.players[id];g.strokeStyle=colors[n];g.lineWidth=8;g.lineJoin='round';g.lineCap='round';g.beginPath();(p.tail||[]).forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.stroke();g.strokeStyle='#ffffffa0';g.lineWidth=2;g.stroke();
   if(p.out)return;g.save();g.translate(p.x,p.y);g.rotate(p.heading);g.fillStyle='#122f43';g.beginPath();g.ellipse(0,3,20,13,0,0,7);g.fill();g.fillStyle=colors[n];g.beginPath();g.roundRect(-18,-11,36,22,7);g.fill();g.fillStyle='#eaf6ff';g.beginPath();g.moveTo(19,0);g.lineTo(6,-7);g.lineTo(6,7);g.fill();g.fillStyle='#1b394b';g.fillRect(-8,-7,11,14);g.restore();g.fillStyle=id===localId?'#fff3ba':colors[n];g.textAlign='center';g.font='bold 14px "Segoe UI",Arial';g.fillText(members.find(m=>m.id===id)?.name||'',p.x,p.y-28);
  });
  if(s.pause>0||s.roundPause>0){g.fillStyle='#f5f5df';g.textAlign='center';g.font='bold 28px "Segoe UI",Arial';g.fillText(s.roundPause?'Manche terminée':'Manche '+s.round,500,300);}
  g.restore();
 }
 const api={init,spawn,move,crash,step,predict,draw,colors,radius};
 if(typeof module!=='undefined')module.exports=api;else root.CityTailblazer=api;
})(typeof window!=='undefined'?window:globalThis);
