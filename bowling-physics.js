 'use strict';
(function(root){
 const Y=1.5,R=.031,BR=.054,clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
 // Equilateral rack in physical lane coordinates; rendering may project it in perspective.
 function rack(){return Array.from({length:10},(_,i)=>{const row=Math.floor((Math.sqrt(8*i+1)-1)/2),column=i-row*(row+1)/2;return {id:i+1,x:.5+(column-row/2)*.16,y:.34-row*.16*Math.sqrt(3)/2/Y,down:false,removed:false,vx:0,vy:0,yaw:-Math.PI/2,spin:0,tilt:0,tiltVelocity:0};});}
 function segment(p){const length=.055*Math.sin(p.tilt||0),dx=Math.cos(p.yaw||0)*length,dy=Math.sin(p.yaw||0)*length;return [{x:p.x-dx,y:p.y*Y-dy},{x:p.x+dx,y:p.y*Y+dy}];}
 const dot=(a,b)=>a.x*b.x+a.y*b.y,sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
 function closest(a,b){const [a0,a1]=a,[b0,b1]=b,u=sub(a1,a0),v=sub(b1,b0),w=sub(a0,b0),aa=dot(u,u),bb=dot(u,v),cc=dot(v,v),dd=dot(u,w),ee=dot(v,w);let s=0,t=0;if(aa<1e-10)t=cc<1e-10?0:clamp(ee/cc,0,1);else if(cc<1e-10)s=clamp(-dd/aa,0,1);else{const det=aa*cc-bb*bb;s=det>1e-10?clamp((bb*ee-cc*dd)/det,0,1):0;t=(bb*s+ee)/cc;if(t<0){t=0;s=clamp(-dd/aa,0,1);}else if(t>1){t=1;s=clamp((bb-dd)/aa,0,1);}}return [{x:a0.x+u.x*s,y:a0.y+u.y*s},{x:b0.x+v.x*t,y:b0.y+v.y*t}];}
 function fall(p,ix,iy,force,ball){if(p.ball||p.removed||p.down||force<.075)return;p.down=true;p.yaw=Math.atan2(iy,ix);p.tiltVelocity=clamp(force*4,1.8,7);p.spin+=((p.id||1)%2?1:-1)*Math.min(.6,force*.2);ball.knocked++;}
 function collide(a,b,ball){const reach=(a.ball?BR:R)+(b.ball?BR:R)+.055*Math.sin(a.tilt||0)+.055*Math.sin(b.tilt||0);if(Math.abs(a.x-b.x)>reach||Math.abs((a.y-b.y)*Y)>reach)return;const sa=a.ball?[{x:a.x,y:a.y*Y},{x:a.x,y:a.y*Y}]:segment(a),sb=b.ball?[{x:b.x,y:b.y*Y},{x:b.x,y:b.y*Y}]:segment(b),[pa,pb]=closest(sa,sb),dx=pb.x-pa.x,dy=pb.y-pa.y,d=Math.hypot(dx,dy),ra=a.ball?BR:R,rb=b.ball?BR:R;if(d>=ra+rb)return;const nx=d>1e-8?dx/d:1,ny=d>1e-8?dy/d:0,ia=a.ball?1/4.5:1,ib=b.ball?1/4.5:1,overlap=ra+rb-d+.00001;
  a.x-=nx*overlap*ia/(ia+ib);a.y-=ny*overlap*ia/(ia+ib)/Y;b.x+=nx*overlap*ib/(ia+ib);b.y+=ny*overlap*ib/(ia+ib)/Y;
  const cx=(pa.x+nx*ra+pb.x-nx*rb)/2,cy=(pa.y+ny*ra+pb.y-ny*rb)/2,ax=cx-a.x,ay=cy-a.y*Y,bx=cx-b.x,by=cy-b.y*Y,va={x:a.vx-(a.spin||0)*ay,y:a.vy*Y+(a.spin||0)*ax},vb={x:b.vx-(b.spin||0)*by,y:b.vy*Y+(b.spin||0)*bx},closing=(vb.x-va.x)*nx+(vb.y-va.y)*ny;if(closing>=-.008)return;
  const ta=ax*ny-ay*nx,tb=bx*ny-by*nx,invI=p=>p.ball?0:Math.sin(p.tilt||0)>.2?420:120,ja=invI(a),jb=invI(b),impulse=-(1+(a.ball||b.ball ? .35 : .25))*closing/(ia+ib+ta*ta*ja+tb*tb*jb),ix=impulse*nx,iy=impulse*ny;
  a.vx-=ix*ia;a.vy-=iy*ia/Y;b.vx+=ix*ib;b.vy+=iy*ib/Y;if(!a.ball)a.spin=clamp((a.spin||0)-ta*impulse*ja,-9,9);if(!b.ball)b.spin=clamp((b.spin||0)+tb*impulse*jb,-9,9);fall(a,-ix,-iy,impulse,ball);fall(b,ix,iy,impulse,ball);
 }
 function step(s,dt){const b=s.ball;if(!b)return false;const substeps=Math.max(1,Math.ceil(dt*120)),h=dt/substeps;
  for(let n=0;n<substeps;n++){b.age+=h;if(!b.finished){b.x+=b.vx*h;b.y+=b.vy*h;if(b.x<.08||b.x>.92){b.gutter=true;b.x=clamp(b.x,.035,.965);b.vx=0;}if(b.y<-.16||b.age>2.7)b.finished=true;}
   for(const p of s.pins){if(p.removed)continue;p.vx=p.vx||0;p.vy=p.vy||0;p.spin=p.spin||0;p.tilt=p.tilt||0;p.tiltVelocity=p.tiltVelocity||0;p.x+=p.vx*h;p.y+=p.vy*h;p.yaw=(p.yaw??-Math.PI/2)+p.spin*h;if(p.down){p.tiltVelocity+=(10*Math.sin(p.tilt)+2)*h;p.tilt+=p.tiltVelocity*h;if(p.tilt>=Math.PI/2){p.tilt=Math.PI/2;p.tiltVelocity=p.tiltVelocity>.4?-p.tiltVelocity*.12:0;}p.vx*=Math.exp(-3*h);p.vy*=Math.exp(-3*h);p.spin*=Math.exp(-4*h);}else{p.vx*=Math.exp(-9*h);p.vy*=Math.exp(-9*h);p.spin*=Math.exp(-8*h);}if(p.x<R||p.x>1-R){p.x=clamp(p.x,R,1-R);p.vx*=-.3;p.spin*=.6;}if(p.y<-.1){p.inPit=true;p.vx=p.vy=p.spin=0;}if(Math.hypot(p.vx,p.vy*Y)<.008)p.vx=p.vy=0;}
   // Resolve the ball itself rather than a copy, while keeping its public state compact.
   if(!b.finished&&!b.gutter){b.ball=true;for(const p of s.pins)if(!p.removed&&!p.inPit)collide(b,p,b);delete b.ball;}
   for(let i=0;i<s.pins.length;i++){const a=s.pins[i];if(a.removed||a.inPit)continue;for(let j=i+1;j<s.pins.length;j++){const q=s.pins[j];if(!q.removed&&!q.inPit)collide(a,q,b);}}
  }
  const moving=s.pins.some(p=>!p.removed&&!p.inPit&&(Math.hypot(p.vx||0,(p.vy||0)*Y)>.035||p.down&&(p.tilt||0)<1.5));b.settle=moving?0:(b.settle||0)+dt;return !!b.finished&&(!moving&&((b.settle||0)>.2||!b.knocked)||b.age>4);
 }
 const api={rack,step,segment,closest,spacing:.16,metricY:Y};if(typeof module!=='undefined')module.exports=api;else root.BowlingPhysics=api;
})(typeof window!=='undefined'?window:globalThis);
