'use strict';
/* Layered, shaded paper-doll renderer. Appearance IDs and ownership stay unchanged. */
(()=>{
 const previous=Apartment.prototype.character;
 const shade=(hex,n)=>'#'+hex.replace('#','').match(/../g).map(v=>Math.max(0,Math.min(255,parseInt(v,16)+n)).toString(16).padStart(2,'0')).join('');
 Apartment.prototype.character=function(av,skinId,name='',phase=0,appearance=null){
  const C=BrawlCore,base=C.skins.find(s=>s.id===skinId)||C.skins[0],custom=appearance||(this.profile?.useCustomAppearance?this.profile.appearance:null),look={...C.appearanceDefaults(),hair:base.model==='long'?'hair-6':base.model==='pony'?'hair-8':'hair-0',skinColor:base.skin,hairColor:base.hair,topColor:base.shirt,...custom};
  const headItem=C.catalog.find(i=>i.id===look.head),face=headItem?.face,topDesign=C.catalog.find(i=>i.id===look.top)?.design,bottomDesign=C.catalog.find(i=>i.id===look.bottom)?.design,shoeDesign=C.catalog.find(i=>i.id===look.shoes)?.design,feminine=look.presentation==='feminine'||look.presentation==='mixte'&&headItem?.gender==='feminine';
  const style=slot=>C.catalog.find(i=>i.id===look[slot])?.style||0,head=style('head');
  if(custom?head>=6:['cat','dog','fox','bunny','panda','robot','alien','helmet'].includes(base.model))return previous.call(this,av,skinId,name,phase,appearance);
  const c=this.ctx,p=this.iso(av.x+.5,av.y+.5),g=Math.sin(phase),top=style('top'),bottom=style('bottom'),shoes=style('shoes'),faceY=-106,faceWidth=face?[11,12.5,11.8,9.4,11.1,10.2,11.4,10.8,10.1,9.6,11.9,10.9][face.index]-(face.gender==='feminine'?.5:0):head===1?12.3:head===2?9.8:head===4?11.8:head===5?10.6:11,skin=look.skinColor;
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
   const isSkirt=bottomDesign?.cut==='skirt'||bottom===3||bottomDesign?.gender==='feminine'&&[5,7].includes(bottomDesign.index),end=bottomDesign?.cut==='trousers'?bottomDesign.hem:bottom===2||bottomDesign?.index===4?-25:bottomDesign?.index===8?-17:isSkirt?-30:-7;
   if(!isSkirt){const bw=bottomDesign?.cut==='trousers'?bottomDesign.width:5,flare=bottomDesign?.pattern==='flare'?bw:bottomDesign?.pattern==='taper'?4:bw*.8;path([[x-bw,-46+swing],[x+bw,-46+swing],[x+flare,end+swing],[x-flare,end+swing]],grad(look.bottomColor));}
   if(bottom===4){rect(x-4,end+swing-3,8,3,1,shade(look.bottomColor,-25));line([[x-3,-42+swing],[x-2,-12+swing]],'#f5f3e380',1.5);}
   if(bottom===1)line([[x+2,-43+swing],[x+1,-11+swing]],'#ffffff40',.8);
   const boot=shoes===1||shoes===5,sy=-7+swing;
   if(shoes===2){rect(x-4,sy,8,5,2,skin);line([[x-4,sy+1],[x+4,sy+1]],look.shoeColor,2);}
   else rect(x-4.5,sy-(boot?(shoes===5?15:9):0),9,boot?(shoes===5?20:14):5,shoes===4?4:2,grad(look.shoeColor));
   rect(x-4.7,sy+4,10,1.7,.5,shoes===3?shade(look.shoeColor,-35):'#eef0e7');
   if(shoeDesign){const n=shoeDesign.index;if([1,4,7].includes(n))rect(x-4.5,sy-(n===4?17:8),9,n===4?20:11,2,grad(look.shoeColor));if([0,1,3,7].includes(n))for(let j=0;j<3;j++)line([[x-2,sy-1-j*2],[x+2,sy-1-j*2]],'#ffffffb0',.8);if([2,6].includes(n))oval(x,sy+1,n===6?3.3:2.5,n===6?2:1.5,skin);if(n===2)line([[x-4,sy+2],[x+4,sy+2]],shade(look.shoeColor,-25),1.5);if(n===3||n===7)rect(x-4.7,sy+4,10,1.7,.5,shade(look.shoeColor,-40));if(n===7)rect(x-3,sy-5,6,1,0,shade(look.shoeColor,-30));if(n===5){rect(x-4,sy,8,5,2,skin);line([[x-4,sy+2],[x+4,sy+2]],look.shoeColor,2);}}
   if(shoes===1)rect(x-3,sy-6,3,2,.3,'#d9c894');
   if(shoes===0)for(let j=0;j<2;j++)line([[x-2,sy+j*2],[x+2,sy+j*2]],'#f7faf2',.7);
  }
  if(bottomDesign){const n=bottomDesign.index;if([0,1,3,7,8].includes(n)){for(const side of [-1,1]){const x=side*6.6;line([[x+(n===3?0:2),-43],[x+(n===3?0:1),n===8?-19:-9]],n===0?'#b8d5e180':shade(look.bottomColor,-25),n===3?2:1);if(n===0)line([[x-3,-42],[x-2,-37],[x+2,-37]],'#b8d5e180',.8);if(n===1)rect(x-2,-43,4,2,0,shade(look.bottomColor,-30));if(n===7)line([[x,-42],[x,-9]],'#ffffff60',.7);if(n===8)rect(x-4,-19,8,2,0,shade(look.bottomColor,-30));}}if(bottomDesign.gender==='feminine'&&[5,7].includes(n)){path([[-12,-48],[12,-48],[n===5?18:15,n===5?-10:-26],[-(n===5?18:15),n===5?-10:-26]],grad(look.bottomColor));if(n===7)for(const x of [-10,-5,0,5,10])line([[x*.7,-45],[x,-27]],'#ffffff60',.8);}if(n===2)for(const x of [-9,4]){rect(x,-32,5,8,1,shade(look.bottomColor,-10));line([[x,-31],[x+5,-31]],'#ffffff50',1);}if(n===5&&bottomDesign.gender==='masculine')for(const x of [-11,2])path([[x,-43],[x+9,-43],[x+10,-7],[x-1,-7]],grad(look.bottomColor));if(n===6)for(const x of [-10,9])line([[x,-43],[x,-10]],'#f7f3e3',1.5);}
  if(bottom===3)path([[-12,-48],[12,-48],[16,-28],[-16,-28]],grad(look.bottomColor));
  if(bottomDesign?.cut){const d=bottomDesign;if(d.cut==='skirt')path([[-12,-48],[12,-48],[d.width,d.hem],[-d.width,d.hem]],grad(look.bottomColor));garmentPattern(d,look.bottomColor,-44,d.width,d.hem);line([[-11,-47],[11,-47]],shade(look.bottomColor,-35),2);}
  // Forearms swing opposite the legs; sleeves remain separate from skin.
  for(const side of [-1,1]){const swing=g*side*4;line([[side*16,-82],[side*19,-65+swing],[side*17,-47+swing]],grad(skin),6);oval(side*17,-46+swing,3.2,4,grad(skin));}
  rect(-4,-96,8,15,3,grad(skin));
  const dress=topDesign?.cut==='dress'||top===7||topDesign?.gender==='feminine'&&[7,8,14].includes(topDesign.index),tunic=topDesign?.gender==='feminine'&&topDesign.index===9,shirt=grad(look.topColor),hem=topDesign?.cut?topDesign.hem:dress?-24:tunic?-35:topDesign?.gender==='feminine'&&topDesign.index===10?-54:topDesign?.gender==='masculine'&&topDesign.index===12?-43:-47;
  if(topDesign?.cut&&['strap','sleeveless'].includes(topDesign.sleeve)){const w=topDesign.width;path([[-9,-84],[-11,-63],[-w,hem],[w,hem],[11,-63],[9,-84]],shirt);if(topDesign.sleeve==='strap')for(const side of [-1,1])line([[side*8,-91],[side*8,-81]],look.topColor,3);else path([[-5,-91],[-12,-87],[-11,-70],[11,-70],[12,-87],[5,-91]],shirt);}else path([[-5,-91],[-15,-87],[-20,-75],[-14,-72],[-12,-59],[-(topDesign?.width|| (dress?20:feminine?11:13)),hem],[topDesign?.width||(dress?20:feminine?11:13),hem],[12,-59],[14,-72],[20,-75],[15,-87],[5,-91],[4,-87],[-4,-87]],shirt);
  line([[-4,-89],[0,-85],[4,-89]],shade(look.topColor,-40),1);
  if(top===1)for(const y of [-78,-71,-64,-57])line([[-12,y],[12,y]],'#f5f3e2',2.3);
  if(top===2){path([[-6,-91],[-12,-86],[-7,-79],[0,-84],[7,-79],[12,-86],[6,-91]],grad(shade(look.topColor,-15)));line([[-5,-82],[-5,-72]],'#f8f3e4',1);line([[5,-82],[5,-72]],'#f8f3e4',1);rect(-8,-60,16,8,2,shade(look.topColor,-18));}
  if(top===3||top===4){line([[0,-85],[0,-48]],shade(look.topColor,-40),1.2);path([[-5,-90],[-10,-86],[-4,-79],[0,-85]],shade(look.topColor,28));path([[5,-90],[10,-86],[4,-79],[0,-85]],shade(look.topColor,15));for(const y of [-76,-67,-58])oval(1,y,.9,.9,'#f7f3dd');if(top===4){rect(-11,-63,7,2,0,shade(look.topColor,-28));rect(4,-63,7,2,0,shade(look.topColor,-28));}}
  if(top===5){c.fillStyle='#ffe37a';c.font='bold 17px sans-serif';c.textAlign='center';c.fillText('★',0,-65);}
  if(top===6){line([[-14,-83],[-10,-76]],'#fff4d8',2);line([[14,-83],[10,-76]],'#fff4d8',2);c.fillStyle='#fff4d8';c.font='bold 17px sans-serif';c.textAlign='center';c.fillText('7',0,-63);}
  if(top===7){line([[-12,-58],[12,-58]],shade(look.topColor,-35),2);for(const x of [-10,0,10])line([[x*.7,-54],[x,-28]],'#ffffff25',.7);}
  if(bottom===5){rect(-9,-71,18,25,2,grad(look.bottomColor));line([[-8,-87],[-7,-69]],look.bottomColor,3);line([[8,-87],[7,-69]],look.bottomColor,3);rect(-5,-65,10,7,1,shade(look.bottomColor,-15));for(const x of [-7,7])oval(x,-70,1.3,1.3,'#d5ba71');}
  if(topDesign){const n=topDesign.index,f=topDesign.gender==='feminine',longSleeve=topDesign.sleeve==='long'||[2,3,4,5,6,7,8,9,12,14,15].includes(n)&&!(f&&[8,14].includes(n));if(longSleeve)for(const side of [-1,1]){line([[side*15,-82],[side*19,-65+g*side*4],[side*17,-51+g*side*4]],shirt,7);line([[side*14,-51+g*side*4],[side*20,-51+g*side*4]],shade(look.topColor,-30),1);}
   if([1,2,5,7,9,12,13].includes(n)){path([[-5,-90],[-10,-85],[-4,-79],[0,-85]],shade(look.topColor,25));path([[5,-90],[10,-85],[4,-79],[0,-85]],shade(look.topColor,15));line([[0,-83],[0,hem]],shade(look.topColor,-35),1);for(const y of [-76,-67,-58])oval(1,y,.9,.9,'#f7f3dd');}
   if(n===3&&!f){path([[-6,-88],[0,-77],[6,-88],[3,-88],[0,-82],[-3,-88]],shade(look.topColor,-35));}
   if(n===8&&!f)rect(-5,-96,10,9,2,shirt);
   if(n===4||n===14&&!f){line([[-5,-87],[-10,-83],[0,-79],[10,-83],[5,-87]],shade(look.topColor,-30),3);line([[0,-79],[0,hem]],'#eeeecc',1);rect(-7,-60,14,7,2,shade(look.topColor,-15));}
   if([5,6,12].includes(n)){for(const x of [-10,4]){rect(x,-71,6,7,1,shade(look.topColor,-20));line([[x,-71],[x+6,-71]],'#ffffff70',.8);}}
   if(n===6&&!f||n===15&&!f){rect(-12,hem-4,24,4,1,shade(look.topColor,-28));if(n===15){c.fillStyle='#fff1c9';c.font='bold 13px sans-serif';c.textAlign='center';c.fillText('B',-5,-67);}}
   if(n===14&&!f){rect(-3,-78,6,30,1,'#e9e5d7');for(const x of [-10,5])rect(x,-62,5,7,1,shade(look.topColor,-25));}
   if(n===10&&!f){line([[-14,-82],[-10,-76]],'#fff4d8',3);line([[14,-82],[10,-76]],'#fff4d8',3);c.fillStyle='#fff4d8';c.font='bold 17px sans-serif';c.textAlign='center';c.fillText('9',0,-62);}
   if(n===9&&!f)path([[-10,-83],[-4,-80],[0,-69],[4,-80],[10,-83],[11,-49],[-11,-49]],grad(shade(look.topColor,-30)));
   if((n===7&&!f)||(n===12&&f)){path([[-5,-90],[-12,-84],[-4,-72],[0,-80]],shade(look.topColor,-25));path([[5,-90],[12,-84],[4,-72],[0,-80]],shade(look.topColor,-15));}
   if(n===13&&f){path([[-4,-52],[0,-49],[-6,-44]],shade(look.topColor,-25));path([[4,-52],[0,-49],[6,-44]],shade(look.topColor,-20));}
   if(n===11&&!f)rect(-12,-74,24,14,0,shade(look.topColor,35));
   if(n===13&&!f||n===15&&f)for(const y of [-77,-71,-65,-59])line([[-12,y],[12,y]],'#f1f1d9',2);
   if(n===11&&f)for(const side of [-1,1])oval(side*16,-80,5.5,7,shirt);
   if(n===14&&f){rect(-9,-82,18,16,1,shade(look.topColor,-12));line([[-8,-91],[-7,-80]],look.topColor,3);line([[8,-91],[7,-80]],look.topColor,3);}
   if(dress)for(const x of [-12,-6,0,6,12])line([[x*.5,-48],[x,-25]],'#ffffff38',.8);
  }
  if(bottomDesign?.index===9){rect(-9,-70,18,23,2,grad(look.bottomColor));line([[-8,-88],[-7,-68]],look.bottomColor,3);line([[8,-88],[7,-68]],look.bottomColor,3);rect(-5,-64,10,7,1,shade(look.bottomColor,-20));}
  // Extra garments change the cut, sleeve, hem and construction, independently of their colour.
  function garmentPattern(design,color,waist,width,hem){const accent=shade(color,-32),light=shade(color,35),p=design.pattern;
   if(['folds','pleats','rib','knit','denim','panel','wide','flare','taper'].includes(p))for(let j=-2;j<=2;j++){const xx=j*width/3;line([[xx*.6,waist],[xx,hem-1]],j%2?light:accent,p==='rib'?.7:1);if(p==='knit')for(let y=waist+4;y<hem-2;y+=6)line([[xx-2,y],[xx,y+3],[xx+2,y]],light,.8);}
   if(['belt','empire','sport','contrast','cuff'].includes(p)){const y=p==='empire'?-73:p==='belt'?-57:p==='cuff'?hem-2:waist+8;line([[-width*.6,y],[width*.6,y]],accent,p==='sport'?4:2);if(p==='belt')rect(-2,y-2,4,4,1,'#d9b75d');if(p==='contrast')for(const side of [-1,1])line([[side*14,-82],[side*18,-68],[side*17,-53]],light,3);}
   if(['buttons','cardigan','vest'].includes(p)){line([[0,waist-4],[0,hem]],accent,1);for(let y=waist;y<hem-3;y+=8)oval(1,y,1,1,'#e9d9ad');if(p==='vest')for(const side of [-1,1])path([[side*5,-88],[side*12,-82],[side*11,-54],[side*2,-54],[side*2,-72]],accent);if(p==='cardigan')for(const x of [-10,5])rect(x,hem-11,5,6,1,accent);}
   if(p==='ruffles'){for(let y=hem-13;y<=hem;y+=6){const points=[[-width,y-3]];for(let x=-width;x<=width;x+=3)points.push([x,y+(Math.round((x+width)/3)%2?2:0)]);points.push([width,y-3]);path(points,light,false);}}
   if(p==='dots'||p==='flowers')for(let y=waist+4;y<hem-4;y+=9)for(let x=-width*.6;x<=width*.6;x+=8){if(p==='dots')oval(x,y,1.3,1.3,light);else{for(let j=0;j<5;j++)oval(x+Math.cos(j*1.256)*1.7,y+Math.sin(j*1.256)*1.7,1.2,1.2,light);oval(x,y,.8,.8,'#e7c66c');}}
   if(p==='wrap'||p==='asymmetric'){path([[-width*.7,waist],[width*.8,waist+4],[-width*.6,hem]],shade(color,12));line([[width*.8,waist+4],[-width*.6,hem]],accent,1.3);}
   if(p==='sailor'){path([[-10,-87],[0,-76],[10,-87],[6,-86],[0,-81],[-6,-86]],'#ece7db');line([[0,-79],[0,-70]],accent,2);}
   if(p==='pockets'){for(const x of [-11,4]){rect(x,waist+12,7,7,1,accent);line([[x,waist+12],[x+7,waist+12]],light,1);}for(const side of [-1,1])line([[side*8,-91],[side*7,-70]],accent,3);}
   if(p==='stripe')line([[-width*.6,waist+12],[width*.6,waist+12]],light,4);
   if(p==='peplum')path([[-10,-58],[10,-58],[width,hem],[-width,hem]],shade(color,20));
   if(p==='split')line([[0,waist],[0,hem]],accent,1.5);
  };
  if(topDesign?.cut){const d=topDesign;if(d.sleeve==='puff')for(const side of [-1,1]){oval(side*16,-80,6,8,shirt);line([[side*12,-73],[side*20,-73]],shade(look.topColor,-25),1);}garmentPattern(d,look.topColor,d.cut==='dress'?-54:-80,d.width,d.hem);}
  hair(true);
  if(style('hair')===12)for(let j=0;j<7;j++)oval(12+(j%2)*.8,faceY+6+j*4,2.8,2.8,grad(look.hairColor));
  // Ears, jaw, nose and smaller eyes replace the oversized cartoon face.
  oval(-faceWidth,faceY+1,2,3.5,shade(skin,-12));oval(faceWidth,faceY+1,2,3.5,shade(skin,-16));
  c.fillStyle=grad(skin,-faceWidth,faceWidth);c.beginPath();c.moveTo(-faceWidth,faceY-5);c.bezierCurveTo(-faceWidth-2,faceY-(face?.index===9?25:21),faceWidth+2,faceY-(face?.index===9?25:21),faceWidth,faceY-5);c.bezierCurveTo(faceWidth,faceY+6,6,faceY+14,0,faceY+14);c.bezierCurveTo(-6,faceY+14,-faceWidth,faceY+6,-faceWidth,faceY-5);c.fill();
  for(const side of [-1,1]){oval(side*(face?.index===8?5.5:4.7),faceY,face?.index===8?3.2:2.7,face?.index===7?1.9:1.6,'#fff9ec');oval(side*4.7+.4,faceY,1.1,1.5,'#3a4547');oval(side*4.7+.7,faceY-.5,.4,.45,'#fff');line([[side*7,faceY-4],[side*3,faceY-(head===3||face?.index===4?6.5:face?.index===2?3.5:4.7)]],shade(look.hairColor,-15),1.1);}
  line([[1,faceY+1],[(face?.index===6?4:2.5),faceY+(face?.index===10?7:5)],[.2,faceY+5.5]],shade(skin,-30),.7);
  line([[-3,faceY+8],[0,faceY+(head===3?10:9)],[3.5,faceY+7.7]],head===5||face?.gender==='feminine'?'#a35b68':shade(skin,-65),1);
  if(face?.index===11)for(const side of [-1,1])for(let j=0;j<3;j++)oval(side*(5+j),faceY+4+j%2,.55,.5,shade(skin,-60));
  hair(false);
  if(!custom&&base.model==='cap'){rect(-12,faceY-16,24,5,2,look.topColor);path([[6,faceY-12],[18,faceY-10],[18,faceY-8],[6,faceY-9]],shade(look.topColor,-20));}
  if(name){c.font='bold 11px Nunito,Segoe UI';c.textAlign='center';c.fillStyle='#24495b';c.fillText(name,0,-166);}c.restore();
 };
})();
