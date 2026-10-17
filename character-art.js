'use strict';
/* Layered, shaded paper-doll renderer. Appearance IDs and ownership stay unchanged. */
(()=>{
 const previous=Apartment.prototype.character;
 const shade=(hex,n)=>'#'+hex.replace('#','').match(/../g).map(v=>Math.max(0,Math.min(255,parseInt(v,16)+n)).toString(16).padStart(2,'0')).join('');
 Apartment.prototype.character=function(av,skinId,name='',phase=0,appearance=null){
  const C=BrawlCore,base=C.skins.find(s=>s.id===skinId)||C.skins[0],custom=appearance||(this.profile?.useCustomAppearance?this.profile.appearance:null),look={...C.appearanceDefaults(),hair:base.model==='long'?'hair-6':base.model==='pony'?'hair-8':'hair-0',skinColor:base.skin,hairColor:base.hair,topColor:base.shirt,...custom};
  const style=slot=>C.catalog.find(i=>i.id===look[slot])?.style||0,head=style('head');
  if(custom?head>=6:['cat','dog','fox','bunny','panda','robot','alien','helmet'].includes(base.model))return previous.call(this,av,skinId,name,phase,appearance);
  const c=this.ctx,p=this.iso(av.x+.5,av.y+.5),g=Math.sin(phase),top=style('top'),bottom=style('bottom'),shoes=style('shoes'),faceY=-106,faceWidth=head===1?12.3:head===2?9.8:head===4?11.8:head===5?10.6:11,skin=look.skinColor;
  c.save();c.translate(p.x,p.y);if(name.startsWith('💀')||!name&&this.profile?.household?.player.dead)c.globalAlpha=.35;
  const path=(points,fill,edge=true)=>{c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fillStyle=fill;c.fill();if(edge){c.strokeStyle='#192c392d';c.lineWidth=.7;c.stroke();}};
  const grad=(color,left=-15,right=15)=>{const v=c.createLinearGradient(left,0,right,0);if(!v?.addColorStop)return color;v.addColorStop(0,shade(color,22));v.addColorStop(.48,color);v.addColorStop(1,shade(color,-28));return v;};
  const oval=(x,y,w,h,color)=>{c.fillStyle=color;c.beginPath();c.ellipse(x,y,w,h,0,0,Math.PI*2);c.fill();};
  const rect=(x,y,w,h,r,color)=>{c.fillStyle=color;c.beginPath();c.roundRect(x,y,w,h,r);c.fill();};
  const line=(points,color,width=1)=>{c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke();};
  oval(0,3,19,7,'#152c3433');
  // Long hairstyles fall behind the shoulders; the same twenty owned cuts fit the new head.
  const hair=back=>{c.save();c.translate(0,faceY);c.scale(.54,.60);this.hairShape(0,0,style('hair'),look.hairColor,back);c.restore();};
  for(const side of [-1,1]){
   const swing=g*side*4,x=side*6.6;
   rect(x-4,-45+swing,8.5,40,3.2,grad(skin));
   const end=bottom===2?-25:bottom===3?-30:-7;
   if(bottom!==3)path([[x-5,-46+swing],[x+5,-46+swing],[x+4,end+swing],[x-3.8,end+swing]],grad(look.bottomColor));
   if(bottom===4){rect(x-4,end+swing-3,8,3,1,shade(look.bottomColor,-25));line([[x-3,-42+swing],[x-2,-12+swing]],'#f5f3e380',1.5);}
   if(bottom===1)line([[x+2,-43+swing],[x+1,-11+swing]],'#ffffff40',.8);
   const boot=shoes===1||shoes===5,sy=-7+swing;
   if(shoes===2){rect(x-4,sy,8,5,2,skin);line([[x-4,sy+1],[x+4,sy+1]],look.shoeColor,2);}
   else rect(x-4.5,sy-(boot?(shoes===5?15:9):0),9,boot?(shoes===5?20:14):5,shoes===4?4:2,grad(look.shoeColor));
   rect(x-4.7,sy+4,10,1.7,.5,shoes===3?shade(look.shoeColor,-35):'#eef0e7');
   if(shoes===1)rect(x-3,sy-6,3,2,.3,'#d9c894');
   if(shoes===0)for(let j=0;j<2;j++)line([[x-2,sy+j*2],[x+2,sy+j*2]],'#f7faf2',.7);
  }
  if(bottom===3)path([[-12,-48],[12,-48],[16,-28],[-16,-28]],grad(look.bottomColor));
  // Forearms swing opposite the legs; sleeves remain separate from skin.
  for(const side of [-1,1]){const swing=g*side*4;line([[side*16,-82],[side*19,-65+swing],[side*17,-47+swing]],grad(skin),6);oval(side*17,-46+swing,3.2,4,grad(skin));}
  rect(-4,-96,8,15,3,grad(skin));
  const shirt=grad(look.topColor),hem=top===7?-25:-47;
  path([[-5,-91],[-15,-87],[-20,-75],[-14,-72],[-12,-59],[-(top===7?20:12),hem],[top===7?20:12,hem],[12,-59],[14,-72],[20,-75],[15,-87],[5,-91],[4,-87],[-4,-87]],shirt);
  line([[-4,-89],[0,-85],[4,-89]],shade(look.topColor,-40),1);
  if(top===1)for(const y of [-78,-71,-64,-57])line([[-12,y],[12,y]],'#f5f3e2',2.3);
  if(top===2){path([[-6,-91],[-12,-86],[-7,-79],[0,-84],[7,-79],[12,-86],[6,-91]],grad(shade(look.topColor,-15)));line([[-5,-82],[-5,-72]],'#f8f3e4',1);line([[5,-82],[5,-72]],'#f8f3e4',1);rect(-8,-60,16,8,2,shade(look.topColor,-18));}
  if(top===3||top===4){line([[0,-85],[0,-48]],shade(look.topColor,-40),1.2);path([[-5,-90],[-10,-86],[-4,-79],[0,-85]],shade(look.topColor,28));path([[5,-90],[10,-86],[4,-79],[0,-85]],shade(look.topColor,15));for(const y of [-76,-67,-58])oval(1,y,.9,.9,'#f7f3dd');if(top===4){rect(-11,-63,7,2,0,shade(look.topColor,-28));rect(4,-63,7,2,0,shade(look.topColor,-28));}}
  if(top===5){c.fillStyle='#ffe37a';c.font='bold 17px sans-serif';c.textAlign='center';c.fillText('★',0,-65);}
  if(top===6){line([[-14,-83],[-10,-76]],'#fff4d8',2);line([[14,-83],[10,-76]],'#fff4d8',2);c.fillStyle='#fff4d8';c.font='bold 17px sans-serif';c.textAlign='center';c.fillText('7',0,-63);}
  if(top===7){line([[-12,-58],[12,-58]],shade(look.topColor,-35),2);for(const x of [-10,0,10])line([[x*.7,-54],[x,-28]],'#ffffff25',.7);}
  if(bottom===5){rect(-9,-71,18,25,2,grad(look.bottomColor));line([[-8,-87],[-7,-69]],look.bottomColor,3);line([[8,-87],[7,-69]],look.bottomColor,3);rect(-5,-65,10,7,1,shade(look.bottomColor,-15));for(const x of [-7,7])oval(x,-70,1.3,1.3,'#d5ba71');}
  hair(true);
  if(style('hair')===12)for(let j=0;j<7;j++)oval(12+(j%2)*.8,faceY+6+j*4,2.8,2.8,grad(look.hairColor));
  // Ears, jaw, nose and smaller eyes replace the oversized cartoon face.
  oval(-faceWidth,faceY+1,2,3.5,shade(skin,-12));oval(faceWidth,faceY+1,2,3.5,shade(skin,-16));
  c.fillStyle=grad(skin,-faceWidth,faceWidth);c.beginPath();c.moveTo(-faceWidth,faceY-5);c.bezierCurveTo(-faceWidth-2,faceY-21,faceWidth+2,faceY-21,faceWidth,faceY-5);c.bezierCurveTo(faceWidth,faceY+6,6,faceY+14,0,faceY+14);c.bezierCurveTo(-6,faceY+14,-faceWidth,faceY+6,-faceWidth,faceY-5);c.fill();
  for(const side of [-1,1]){oval(side*4.7,faceY,2.7,1.6,'#fff9ec');oval(side*4.7+.4,faceY,1.1,1.5,'#3a4547');oval(side*4.7+.7,faceY-.5,.4,.45,'#fff');line([[side*7,faceY-4],[side*3,faceY-(head===3?6.5:4.7)]],shade(look.hairColor,-15),1.1);}
  line([[1,faceY+1],[2.5,faceY+5],[.2,faceY+5.5]],shade(skin,-30),.7);
  line([[-3,faceY+8],[0,faceY+(head===3?10:9)],[3.5,faceY+7.7]],head===5?'#a35b68':shade(skin,-65),1);
  hair(false);
  if(!custom&&base.model==='cap'){rect(-12,faceY-16,24,5,2,look.topColor);path([[6,faceY-12],[18,faceY-10],[18,faceY-8],[6,faceY-9]],shade(look.topColor,-20));}
  if(name){c.font='bold 11px Nunito,Segoe UI';c.textAlign='center';c.fillStyle='#24495b';c.fillText(name,0,-166);}c.restore();
 };
})();
