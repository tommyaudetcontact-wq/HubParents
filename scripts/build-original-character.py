"""Generate Brawl's own continuous, skinnable character surface (no downloaded models)."""
from pathlib import Path
import sys,json,base64
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'.private/mesh-tools'))
import numpy as np
from skimage.measure import marching_cubes
from scipy.ndimage import gaussian_filter
root=Path(__file__).resolve().parents[1]
pilot='--riff-pilot' in sys.argv
step=.75 if pilot else 1.0;origin=np.array([-33.,-21.,-3.]);axes=[np.arange(origin[i],end,step) for i,end in enumerate([34,25,126])];p=np.stack(np.meshgrid(*axes,indexing='ij'),axis=-1)
def ellipsoid(c,r):return (np.linalg.norm((p-np.array(c))/np.array(r),axis=-1)-1)*min(r)
def capsule(a,b,r):
 a=np.array(a);b=np.array(b);d=b-a;t=np.clip(np.sum((p-a)*d,axis=-1)/np.dot(d,d),0,1);return np.linalg.norm(p-a-t[...,None]*d,axis=-1)-r
def smooth(a,b,k=2.5):return np.minimum(a,b)-np.maximum(k-np.abs(a-b),0)**2/(4*k)
# A tailored torso uses anatomical sections instead of a barrel made from overlapping lobes.
z=p[...,2];levels=np.array([54,60,68,76,85,90,93]);width=np.interp(z,levels,[11.6,10.9,11.5,13.7,15.8,13.6,3.4] if pilot else [12,11.4,11.8,15.1,17.6,14.5,4.5]);depth=np.interp(z,levels,[7.1,6.6,6.9,7.7,8.2,6.9,3.0] if pilot else [7.4,6.8,7.2,8.1,8.9,7.1,3.7])
radial=(np.abs(p[...,0]/width)**2.6+np.abs(p[...,1]/depth)**2.6)**(1/2.6)-1
field=np.maximum(radial*np.minimum(width,depth),np.maximum(54-z,z-93))
# Head cross-sections define a clear brow, cheek plane and tapered jaw instead of merged blobs.
if pilot:
 hlevels=np.array([95.5,97,99,102,105,108,110.5]);hw=np.interp(z,hlevels,[2.6,3.8,5.2,6.0,6.0,4.8,.4]);hd=np.interp(z,hlevels,[2.4,3.6,4.4,4.9,4.8,4.0,.4]);hc=np.interp(z,hlevels,[.4,.5,.5,.1,-.2,-.4,-.4])
else:
 hlevels=np.array([96,98,101,105,109,113,116]);hw=np.interp(z,hlevels,[2.8,4.1,5.9,6.9,6.8,5.6,.5]);hd=np.interp(z,hlevels,[2.9,4.1,5.6,6.0,5.8,4.8,.4]);hc=np.interp(z,hlevels,[.5,.5,.6,.2,-.2,-.5,-.5])
hradial=(np.abs(p[...,0]/hw)**2.35+np.abs((p[...,1]-hc)/hd)**2.35)**(1/2.35)-1
head=np.maximum(hradial*np.minimum(hw,hd),np.maximum((95.5 if pilot else 96)-z,z-(110.5 if pilot else 116)));field=smooth(field,head,1.0 if pilot else 1.2)
features=[([0,0,55],[11.1,6.8,9.5]),([0,4.4,103],[.9,1.4,2.2]),([0,5.45,101.6],[1.1,1.2,.95]),([-6,0,102],[.7,1.0,1.7]),([6,0,102],[.7,1.0,1.7])] if pilot else [([0,0,55],[12.2,7.4,10]),([0,5.5,106.5],[1.2,1.8,3.1]),([0,7.1,104.8],[1.45,1.55,1.3]),([-7,0,105],[1.0,1.3,2.3]),([7,0,105],[1.0,1.3,2.3])]
for c,r in features:field=smooth(field,ellipsoid(c,r),.9 if pilot else 1.25)
field=smooth(field,capsule([0,0,89],[0,0,99 if pilot else 101],2.7 if pilot else 3.5),1.1 if pilot else 1.5)
if pilot:
 for sign in [-1,1]:field=smooth(field,ellipsoid([sign*5.4,5.7,82.5],[6.8,2.8,5.6]),1.1)

rest={'hip':[0,0,48],'chest':[0,0,88],'head':[0,0,104],'ls':[-16,0,84],'rs':[16,0,84],'le':[-20,0,65],'re':[20,0,65],'lh':[-17,0,47],'rh':[17,0,47],'ll':[-7,0,46],'rl':[7,0,46],'lk':[-7,0,25],'rk':[7,0,25],'lf':[-7,0,4],'rf':[7,0,4]}
source_rest={k:v[:] for k,v in rest.items()}
rest.update(hip=[0,0,56],chest=[0,0,90],head=[0,0,106],ls=[-16,0,86],rs=[16,0,86],le=[-20,0,67],re=[20,0,67],ll=[-7,0,54],rl=[7,0,54],lk=[-7,0,28],rk=[7,0,28])
bones=[['hip','chest',13],['chest','head',6],['head',[0,0,121],12]]
for s,sign in [('l',-1),('r',1)]:
 for a,b,r in [(s+'s',s+'e',4.7),(s+'e',s+'h',3.7),(s+'l',s+'k',5.7),(s+'k',s+'f',4.1)]:
  r=r*(.86 if pilot else 1);field=smooth(field,capsule(rest[a],rest[b],r),1.25 if pilot else 1.8);bones.append([a,b,r])
 field=smooth(field,ellipsoid([sign*17,0,45],([2.7,1.9,3.6] if pilot else [3.1,2.2,4.1])),1.2)
 for x in [15.2,16.4,17.6,18.8]:field=smooth(field,capsule([sign*x,0,44],[sign*x,0,39+(x%2)*.5],.64),.6)
 field=smooth(field,capsule([sign*(15.8 if pilot else 14),0,46],[sign*(15.1 if pilot else 13),1.8 if pilot else 1.5,43],.8 if pilot else 1),.8)
 field=smooth(field,ellipsoid([sign*7,4,4.4],([4.2,8.0,3.4] if pilot else [4.7,8.7,3.7])),1.6)
# Eye sockets and a lip crease are sculpted into the surface, not floating primitives.
for x in [-2.8,2.8]:field=np.maximum(field,-ellipsoid([x,4.8 if pilot else 5.6,105.2 if pilot else 108.2],[1.55 if pilot else 1.9,1.0 if pilot else 1.2,.8 if pilot else 1.0]))
field=np.maximum(field,-ellipsoid([0,4.9 if pilot else 5.9,99.35 if pilot else 101.5],[1.7 if pilot else 2.1,.35 if pilot else .55,.13 if pilot else .25]));field=np.maximum(field,1-p[...,2]);field=gaussian_filter(field,.35)
vertices,faces,normals,_=marching_cubes(field,0,spacing=(step,step,step),gradient_direction='ascent');vertices+=origin
# Every vertex blends at most four rigid bones. GPU skinning makes joints continuous.
dist=[];definition=[]
for a,b,r in bones:
 a=np.array(rest[a] if isinstance(a,str) else a);b=np.array(rest[b] if isinstance(b,str) else b);delta=b-a;t=np.clip(np.sum((vertices-a)*delta,axis=-1)/np.dot(delta,delta),0,1);d=np.linalg.norm(vertices-a-t[:,None]*delta,axis=-1);dist.append(np.maximum(0,d-r));definition.append({'a':a.tolist(),'b':b.tolist(),'start':next((k for k,v in rest.items() if np.array_equal(v,a)),None),'end':next((k for k,v in rest.items() if np.array_equal(v,b)),None)})
dist=np.stack(dist,axis=-1);indices=np.argsort(dist,axis=-1)[:,:4];weights=1/(np.take_along_axis(dist,indices,axis=-1)+1.4)**4;weights/=weights.sum(axis=-1,keepdims=True)
if pilot:
 # Anatomical masks prevent fingers being influenced by nearby thighs during a walk.
 for sign,upper,lower,thigh,calf in [(-1,3,4,5,6),(1,7,8,9,10)]:
  arm=(vertices[:,0]*sign>12.5)&(vertices[:,2]>38)&(vertices[:,2]<91)
  upper_weight=np.clip((vertices[arm,2]-63)/8,0,1);shoulder=1-(1-np.clip((np.abs(vertices[arm,0])-12)/6,0,1))*np.clip((vertices[arm,2]-73)/9,0,1)
  indices[arm]=np.array([upper,lower,0,0]);weights[arm]=np.stack([upper_weight*shoulder,(1-upper_weight)*shoulder,1-shoulder,np.zeros_like(shoulder)],axis=-1)
  hand=(vertices[:,0]*sign>12.5)&(vertices[:,2]<54)&(vertices[:,2]>36);indices[hand]=np.array([lower,0,0,0]);weights[hand]=np.array([1.,0.,0.,0.])
  leg=(vertices[:,0]*sign>0)&(np.abs(vertices[:,0])<12.5)&(vertices[:,2]<55)
  upper_weight=np.clip((vertices[leg,2]-24)/8,0,1);hip=np.clip((55-vertices[leg,2])/6,0,1)*np.where(vertices[leg,2]>43,np.clip((np.abs(vertices[leg,0])-2)/4,0,1),1)
  indices[leg]=np.array([thigh,calf,0,0]);weights[leg]=np.stack([upper_weight*hip,(1-upper_weight)*hip,1-hip,np.zeros_like(hip)],axis=-1)
 center=(np.abs(vertices[:,0])<1.5)&(vertices[:,2]>43)&(vertices[:,2]<57);indices[center]=np.array([0,0,0,0]);weights[center]=np.array([1.,0.,0.,0.])
 head_mask=(vertices[:,2]>=96)&(np.abs(vertices[:,0])<8.5);indices[head_mask]=np.array([2,0,0,0]);weights[head_mask]=np.array([1.,0.,0.,0.])

def packed(a,dtype):return base64.b64encode(np.array(a,dtype=dtype).tobytes()).decode()
# Change from game X/Y/Z to Three X/height/depth. Reverse triangles for the mirrored axis.
positions=vertices[:,[0,2,1]];positions[:,2]*=-1;normal=normals[:,[0,2,1]];normal[:,2]*=-1
result={'author':'Brawl Academy - original generated mesh','bones':definition,'rest':rest,'sourceRest':source_rest,'positions':packed(positions,'<f4'),'normals':packed(normal,'<f4'),'indices':packed(faces[:,[0,2,1]],'<u4'),'skinIndex':packed(indices,'<u2'),'skinWeight':packed(weights,'<f4'),'vertices':len(vertices),'triangles':len(faces)}
target=root/('assets3d/brawl-riff-pilot.js' if pilot else 'assets3d/brawl-character.js');target.write_text(('window.BrawlRiffPilot=' if pilot else 'window.BrawlOriginalCharacter=')+json.dumps(result,separators=(',',':'))+';\n',encoding='utf-8');print(f'Original continuous character: {len(vertices)} vertices, {len(faces)} triangles, {target.stat().st_size} bytes')
