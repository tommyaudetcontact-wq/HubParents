import json,copy,math
from pathlib import Path
out=Path('../BrawlAcademy3D/experiments/img2threejs-riff');s=json.loads((out/'sculpt-spec.json').read_text());(out/'spec-first-rejected.json').write_text(json.dumps(s,indent=2));template=copy.deepcopy(s['componentTree'][0]);parts=[]
materials={m['id']:m for m in s['materials']};materials['hidden']['opacity']=0
for id,color,rough,metal in [('cap','#24232c',.84,0),('sole','#171a22',.75,0),('ink','#45424a',.8,0),('gold','#cfac5c',.3,1)]:
 m=copy.deepcopy(materials['shirt']);m.update(id=id,name=id,color=color,baseColor=color,albedo={'dominant':color,'secondary':[color]},roughness=rough,metalness=metal);materials[id]=m

def part(id,mat,primitive='ellipsoid',pos=(0,0,0),size=(1,1,1),level='meso',role='body',desc=None,rotation=(0,0,0)):
 c=copy.deepcopy(template);c.update(id=id,name=id,parent=None if id=='root' else 'root',level=level,role=role,material=mat,materialLayers=[mat],localFeatures=[],details=[],attachment=None,primitive=primitive,confidence=.78,topologyClass='continuous-sculpt' if primitive in ['tapered-sweep','lathe'] else 'assembled-solid',topologyRationale='Contour follows the reference silhouette; depth is inferred and tested in orbit.');c['transform']={'position':list(pos),'rotation':list(rotation),'scale':list(size)};c['dimensions']={'width':size[0],'height':size[1],'depth':size[2],'units':'meters','confidence':.78};c['geometryDescriptor']=desc or {'normalStrategy':'smooth vertex normals','uvStrategy':'generated procedural coordinates','edgeTreatment':{'type':'none','bevelRadius':0,'segments':1},'deformationStack':[]};c['actionProfile']['animationRole']='root' if id=='root' else 'static';c['actionProfile']['destruction']['fractureGroup']=id;co=materials[mat]['baseColor'];rgb=[int(co[n:n+2],16) for n in [1,3,5]];rgba=f'rgba({rgb[0]}, {rgb[1]}, {rgb[2]}, 1)';c['colorMaterialRecipe']={'dominantAlbedo':rgba,'secondaryAlbedo':rgba,'materialClass':'skin' if mat=='skin' else 'fabric' if mat in ['shirt','pants','cap'] else 'metal' if mat=='gold' else 'plastic','materialClassConfidence':.8,'evidenceRefs':['full-object']};parts.append(c);return c

def sweep(id,mat,stations,level='meso',role='body',radial=24):
 # Upward spine: transported first axis is depth (+Z), second is width (+X).
 c=part(id,mat,'tapered-sweep',level=level,role=role,desc={'taperedSweep':{'stations':[{'position':p,'rx':d,'rz':w,'twist':0} for p,w,d in stations],'radialSegments':radial,'capEnds':True},'normalStrategy':'smooth vertex normals'});return c

def tube(id,mat,points,r):return part(id,mat,'tube',level='micro',desc={'tubePath':{'points':points,'radius':r,'closed':False}})

def sdf(id,mat,prims,level='macro',resolution=48,subtract=[]):
 lo=[min(p['center'][a]-p['radii'][a] for p in prims+subtract)-.025 for a in range(3)];hi=[max(p['center'][a]+p['radii'][a] for p in prims+subtract)+.025 for a in range(3)];ops=[];left=prims[0]['id']
 for i,p in enumerate(prims[1:]):name=f'blend{i}';ops.append({'id':name,'type':'smooth-union','left':left,'right':p['id'],'radius':.022});left=name
 for i,p in enumerate(subtract):name=f'cut{i}';ops.append({'id':name,'type':'subtract','left':left,'right':p['id']});left=name
 c=part(id,mat,'ellipsoid',level=level,desc={'sdf':{'primitives':prims+subtract,'operations':ops,'bounds':{'min':lo,'max':hi},'resolution':resolution},'normalStrategy':'smooth vertex normals'});c['topologyClass']='implicit';c['topologyRationale']='Continuous sculpt volume made from smoothly blended fields, not independently rendered spheres.';return c

def ell(id,p,r):return {'id':id,'type':'ellipsoid','center':p,'radii':r}
part('root','hidden','box',size=(.001,.001,.001),level='macro')
# The torso and sleeve roots are fused as a continuous short-sleeve shell, not capsule joints.
shirt=[ell('waist',[0,1.04,0],[.176,.105,.108]),ell('abdomen',[0,1.15,0],[.165,.14,.105]),ell('chest',[0,1.34,.005],[.218,.15,.115]),ell('shoulder',[0,1.415,0],[.24,.065,.101])]
for side in [-1,1]:shirt.append(ell(f'sleeve{side}',[side*.243,1.345,0],[.09,.115,.09]))
sdf('shirt','shirt',shirt,resolution=64)
# Pelvis and crotch shell. Legs have deliberately shaped thigh, knee and calf widths.
sdf('pants-pelvis','pants',[ell('hip',[0,.965,-.008],[.178,.113,.112]),ell('crotch',[0,.885,0],[.12,.095,.09])],resolution=40)
for sign,side in [(1,'l'),(-1,'r')]:
 sweep('pants-'+side,'pants',[([sign*.115,.12,.003],.049,.048),([sign*.115,.18,.004],.06,.06),([sign*.115,.28,.007],.065,.063),([sign*.115,.40,.007],.075,.074),([sign*.108,.49,.012],.064,.067),([sign*.102,.58,.006],.075,.082),([sign*.098,.73,-.006],.092,.096),([sign*.091,.86,-.008],.099,.103),([sign*.086,.98,-.008],.098,.098)],level='macro')
 # Arm skin starts inside the short sleeve, continuous biceps/elbow/forearm profile.
 sweep('arm-'+side,'skin',[([sign*.321,.88,.003],.032,.029),([sign*.321,.95,0],.038,.035),([sign*.317,1.045,0],.055,.048),([sign*.31,1.105,0],.048,.043),([sign*.295,1.17,0],.055,.05),([sign*.276,1.245,0],.064,.06),([sign*.258,1.31,0],.062,.062)],level='macro')
 hand=[ell('palm',[sign*.325,.842,.005],[.038,.057,.024])]
 for n in range(4):hand.append(ell('finger'+str(n),[sign*(.301+n*.016),.792+abs(n-1)*.006,.01],[.009,.038-abs(n-1)*.004,.011]))
 hand.append(ell('thumb',[sign*.29,.84,.027],[.017,.029,.014]));sdf('hand-'+side,'skin',hand,level='meso',resolution=40)
 # Dark high-top sneaker with a broad toe and a separate replaceable outsole.
 sdf('shoe-'+side,'shoes',[ell('ankle',[sign*.115,.105,-.003],[.065,.08,.075]),ell('toe',[sign*.115,.053,.065],[.068,.05,.115])],level='meso',resolution=40)
 part('sole-'+side,'sole','extrude',pos=(sign*.115,.019,.025),size=(.145,.014,.25),level='micro',rotation=(math.pi/2,0,0),desc={'profile2D':{'points':[[-.42,-.45],[.42,-.45],[.5,-.1],[.47,.45],[.28,.5],[-.28,.5],[-.47,.45],[-.5,-.1]],'depth':1,'bevelEnabled':True,'bevelSize':.035,'bevelThickness':.035,'bevelSegments':2}})
 # Lace runs and tongue are local, distinct shoe details.
 for n in range(4):tube(f'lace-{side}-{n}','sole',[[sign*.115-.04,.093+n*.009,.11-n*.024],[sign*.115+.04,.093+n*.009,.09-n*.024]],.003)
# Neck enters the shirt and the jaw. Crown/head proportion approximates 7.8 head units.
sdf('neck','skin',[ell('neck-shaft',[0,1.505,-.012],[.049,.098,.045])],level='meso',resolution=36)
head=[ell('skull',[0,1.715,-.014],[.098,.118,.086]),ell('jaw',[0,1.632,.009],[.074,.06,.066]),ell('chin',[0,1.604,.027],[.051,.023,.042]),ell('cheek-l',[.052,1.668,.029],[.043,.042,.055]),ell('cheek-r',[-.052,1.668,.029],[.043,.042,.055]),ell('bridge',[0,1.685,.068],[.016,.04,.024]),ell('nose-tip',[0,1.664,.088],[.022,.017,.023])]
sdf('head','skin',head,resolution=64,subtract=[ell('socket-l',[.039,1.709,.07],[.028,.015,.018]),ell('socket-r',[-.039,1.709,.07],[.028,.015,.018])])
for side in [-1,1]:
 part('ear-'+str(side),'skin',pos=(side*.098,1.684,-.005),size=(.035,.061,.033))
 part('eye-'+str(side),'eye',pos=(side*.039,1.709,.07),size=(.035,.018,.014),level='micro')
 # Broad rectangular sunglass lenses obscure eyes as in the concept.
 part('glasses-'+str(side),'glasses-frame','extrude',pos=(side*.047,1.703,.088),size=(.082,.048,.012),level='micro',desc={'profile2D':{'points':[[-.5,.35],[-.4,.5],[.42,.5],[.5,.3],[.4,-.42],[-.35,-.5]],'depth':1,'bevelEnabled':True,'bevelSize':.05,'bevelThickness':.03,'bevelSegments':2}})
 tube('temple-'+str(side),'glasses-frame',[[side*.088,1.715,.088],[side*.105,1.711,.03],[side*.099,1.69,-.012]],.004)
tube('glasses-bridge','glasses-frame',[[-.012,1.716,.097],[0,1.722,.103],[.012,1.716,.097]],.004)
tube('mouth','lips',[[-.03,1.627,.069],[0,1.623,.078],[.029,1.63,.069]],.0018)
# Cap follows the crown. Its backward brim, hair fringe and pendant are reference-specific.
cap=sweep('cap','cap',[([0,1.745,-.017],.101,.091),([0,1.775,-.019],.098,.089),([0,1.81,-.019],.083,.078),([0,1.837,-.019],.052,.05),([0,1.846,-.019],.003,.003)],level='meso')
part('cap-brim','cap','extrude',pos=(0,1.751,-.067),size=(.18,.18,.008),rotation=(math.pi/2,0,-.45),level='meso',desc={'profile2D':{'points':[[-.45,0],[-.55,-.4],[-.48,-.75],[-.2,-.95],[.2,-.95],[.48,-.75],[.55,-.4],[.45,0]],'depth':1,'bevelEnabled':True,'bevelSize':.035,'bevelThickness':.03,'bevelSegments':2}})
# Five swept locks, not cones; roots sit inside the scalp and only the tapered tips emerge.
for n in range(5):
 x=-.065+n*.027
 sweep('fringe-'+str(n),'hair',[([x,1.775,.035],.025,.032),([x+.025,1.788,.072],.021,.028),([x+.048,1.774,.098],.012,.018),([x+.065,1.753,.105],0,0)],level='micro',radial=12)
# No old appearance: all colours and accessories come from this reference.
tube('necklace','gold',[[-.057,1.485,.044],[-.044,1.417,.099],[0,1.355,.123],[.044,1.417,.099],[.057,1.485,.044]],.0021)
part('pendant','gold','box',pos=(0,1.346,.124),size=(.018,.031,.005),level='micro')
# These marks follow the arm side; replaceable markings module for future skins.
tube('tattoo-chevron','ink',[[.274,1.252,.06],[.292,1.278,.063],[.309,1.248,.06]],.005)
tube('tattoo-band','ink',[[.288,1.19,.045],[.317,1.16,.047],[.325,1.12,.045]],.009)
# Preserve measured requirements but update their concrete host links to the new anatomy.
s['componentTree']=parts;s['materials']=list(materials.values());s.pop('rig',None)
ids=[c['id'] for c in parts]
for p in s['buildPasses']:p['componentRefs']=ids
s['featureReviewTargets'][0]['componentRefs']=['head','shirt','pants-l','pants-r'];s['featureReviewTargets'][1]['componentRefs']=['head','mouth','glasses-bridge'];s['featureReviewTargets'][2]['componentRefs']=['shirt','arm-l','pants-l'];s['featureReviewTargets'][3]['componentRefs']=['shirt','cap','necklace','pendant']
details=[('cap-seam','seam','cap'),('cap-brim','contour','cap-brim'),('swept-fringe','contour','fringe-0'),('neckline','seam','shirt'),('sleeve-hem','seam','shirt'),('trouser-hem','seam','pants-l'),('shoe-sole','contour','sole-l'),('lace-row','linework','lace-l-0'),('eyewear-bridge','contour','glasses-bridge'),('smoked-lens','gloss','glasses-1'),('gold-chain','linework','necklace'),('rectangular-pendant','bevel','pendant'),('angular-tattoo','linework','tattoo-band')]
s['preSpecAssessment']['detailInventory']['details']=[]
for id,kind,host in details:
 next(c for c in parts if c['id']==host)['localFeatures'].append({'id':id,'kind':kind,'description':id,'evidenceRefs':['full-object']});s['preSpecAssessment']['detailInventory']['details'].append({'id':id,'kind':kind,'mapsTo':{'ref':id},'evidenceRefs':['full-object']})
s['repetitionSystems']=[{'id':'lace-series','componentRefs':[id for id in ids if id.startswith('lace-')],'count':8,'distribution':'four runs per shoe, mirrored','evidenceRefs':['full-object'],'buildsGeometry':True}]
s['assumptions'].append('Independent image-driven prototype, no old Brawl mesh. Rig deferred until static silhouette accepted and frozen; future semantic modules explicit.')
(out/'sculpt-spec.json').write_text(json.dumps(s,indent=2))
