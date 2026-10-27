"""Generate Brawl's own continuous, skinnable character surface (no downloaded models)."""
from pathlib import Path
import sys,json,base64
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'.private/mesh-tools'))
import numpy as np
from skimage.measure import marching_cubes
from scipy.ndimage import gaussian_filter
root=Path(__file__).resolve().parents[1]
step=1.0;origin=np.array([-33.,-21.,-3.]);axes=[np.arange(origin[i],end,step) for i,end in enumerate([34,25,126])];p=np.stack(np.meshgrid(*axes,indexing='ij'),axis=-1)
def ellipsoid(c,r):return (np.linalg.norm((p-np.array(c))/np.array(r),axis=-1)-1)*min(r)
def capsule(a,b,r):
 a=np.array(a);b=np.array(b);d=b-a;t=np.clip(np.sum((p-a)*d,axis=-1)/np.dot(d,d),0,1);return np.linalg.norm(p-a-t[...,None]*d,axis=-1)-r
def smooth(a,b,k=2.5):return np.minimum(a,b)-np.maximum(k-np.abs(a-b),0)**2/(4*k)
# A tailored torso uses anatomical sections instead of a barrel made from overlapping lobes.
z=p[...,2];levels=np.array([54,60,68,76,85,90,93]);width=np.interp(z,levels,[12,12.3,12.8,14.1,16,13,4]);depth=np.interp(z,levels,[7.2,6.8,7,7.8,7.8,6.7,3.2])
radial=(np.abs(p[...,0]/width)**2.6+np.abs(p[...,1]/depth)**2.6)**(1/2.6)-1
field=np.maximum(radial*np.minimum(width,depth),np.maximum(54-z,z-93))
for c,r in [([0,0,55],[12.2,7.2,10]),([0,-.1,107],[6.65,6.15,8.1]),([0,1.0,101.4],[5.4,5.1,4.3]),([0,6.5,106],[1.25,2.1,2.0]),([-6.6,0,105],[1.1,1.5,2.4]),([6.6,0,105],[1.1,1.5,2.4])]:field=smooth(field,ellipsoid(c,r),2.2)
field=smooth(field,capsule([0,0,89],[0,0,101],2.9),2)
rest={'hip':[0,0,48],'chest':[0,0,88],'head':[0,0,104],'ls':[-16,0,84],'rs':[16,0,84],'le':[-20,0,65],'re':[20,0,65],'lh':[-17,0,47],'rh':[17,0,47],'ll':[-7,0,46],'rl':[7,0,46],'lk':[-7,0,25],'rk':[7,0,25],'lf':[-7,0,4],'rf':[7,0,4]}
source_rest={k:v[:] for k,v in rest.items()}
rest.update(hip=[0,0,56],chest=[0,0,90],head=[0,0,106],ls=[-16,0,86],rs=[16,0,86],le=[-20,0,67],re=[20,0,67],ll=[-7,0,54],rl=[7,0,54],lk=[-7,0,28],rk=[7,0,28])
bones=[['hip','chest',13],['chest','head',6],['head',[0,0,121],12]]
for s,sign in [('l',-1),('r',1)]:
 for a,b,r in [(s+'s',s+'e',4.0),(s+'e',s+'h',2.9),(s+'l',s+'k',5.3),(s+'k',s+'f',3.8)]:
  field=smooth(field,capsule(rest[a],rest[b],r),1.8);bones.append([a,b,r])
 field=smooth(field,ellipsoid([sign*17,0,45],[2.7,1.9,3.6]),1.2)
 for x in [15.2,16.4,17.6,18.8]:field=smooth(field,capsule([sign*x,0,44],[sign*x,0,39+(x%2)*.5],.64),.6)
 field=smooth(field,capsule([sign*14,0,46],[sign*13,1.5,43],1),.8)
 field=smooth(field,ellipsoid([sign*7,4,4.4],[4.3,8.2,3.2]),1.6)
# Eye sockets and a lip crease are sculpted into the surface, not floating primitives.
for x in [-2.8,2.8]:field=np.maximum(field,-ellipsoid([x,5.7,109],[1.5,1.0,.7]))
field=np.maximum(field,-ellipsoid([0,5.9,102],[2.0,.65,.3]));field=np.maximum(field,1-p[...,2]);field=gaussian_filter(field,.35)
vertices,faces,normals,_=marching_cubes(field,0,spacing=(step,step,step),gradient_direction='ascent');vertices+=origin
# Every vertex blends at most four rigid bones. GPU skinning makes joints continuous.
dist=[];definition=[]
for a,b,r in bones:
 a=np.array(rest[a] if isinstance(a,str) else a);b=np.array(rest[b] if isinstance(b,str) else b);delta=b-a;t=np.clip(np.sum((vertices-a)*delta,axis=-1)/np.dot(delta,delta),0,1);d=np.linalg.norm(vertices-a-t[:,None]*delta,axis=-1);dist.append(np.maximum(0,d-r));definition.append({'a':a.tolist(),'b':b.tolist(),'start':next((k for k,v in rest.items() if np.array_equal(v,a)),None),'end':next((k for k,v in rest.items() if np.array_equal(v,b)),None)})
dist=np.stack(dist,axis=-1);indices=np.argsort(dist,axis=-1)[:,:4];weights=1/(np.take_along_axis(dist,indices,axis=-1)+1.4)**4;weights/=weights.sum(axis=-1,keepdims=True)
def packed(a,dtype):return base64.b64encode(np.array(a,dtype=dtype).tobytes()).decode()
# Change from game X/Y/Z to Three X/height/depth. Reverse triangles for the mirrored axis.
positions=vertices[:,[0,2,1]];positions[:,2]*=-1;normal=normals[:,[0,2,1]];normal[:,2]*=-1
result={'author':'Brawl Academy - original generated mesh','bones':definition,'rest':rest,'sourceRest':source_rest,'positions':packed(positions,'<f4'),'normals':packed(normal,'<f4'),'indices':packed(faces[:,[0,2,1]],'<u4'),'skinIndex':packed(indices,'<u2'),'skinWeight':packed(weights,'<f4'),'vertices':len(vertices),'triangles':len(faces)}
target=root/'assets3d/brawl-character.js';target.write_text('window.BrawlOriginalCharacter='+json.dumps(result,separators=(',',':'))+';\n',encoding='utf-8');print(f'Original continuous character: {len(vertices)} vertices, {len(faces)} triangles, {target.stat().st_size} bytes')
