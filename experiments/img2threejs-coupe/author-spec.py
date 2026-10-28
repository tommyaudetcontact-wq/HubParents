import json,copy,math
from pathlib import Path
out=Path('../BrawlAcademy3D/experiments/img2threejs-coupe');s=json.loads((out/'sculpt-spec.json').read_text());template=copy.deepcopy(s['componentTree'][0]);mt=copy.deepcopy(s['materials'][0]);parts=[];materials=[]
for id,color,rough,metal,opacity in [('hidden','#000000',1,0,0),('paint','#efbe2b',.32,.08,1),('rubber','#242729',.88,0,1),('metal','#b9bec2',.27,.8,1),('dark','#20272c',.7,0,1),('glass','#adc4cb',.13,.05,.22),('lamp','#e4e4d8',.23,.3,1),('red','#ae2525',.32,.1,1),('amber','#c98529',.4,.1,1),('seam','#756225',.65,0,1)]:
 m=copy.deepcopy(mt);m.update(id=id,name=id,color=color,baseColor=color,albedo={'dominant':color,'secondary':[color]},roughness={'base':rough,'variation':0,'map':'none','localResponse':'constant clean material'},metalness={'base':metal,'variation':0},opacity=opacity,transparent=opacity<1,clearcoat=.32 if id=='paint' else 0);m['colorVariation'].update(palette=[color],amplitude=0,pattern='none');m['normal'].update(pattern='none',strength=0);m['localOverrides']=[{'id':id+'-finish','region':'whole component','roughness':rough,'evidenceRefs':['full-object']}];m['notes']='Solid clean material inferred from generated concept, not measured physical BRDF; no painted pattern or projection.';materials.append(m)

def part(id,mat,primitive='box',pos=(0,0,0),size=(1,1,1),level='meso',desc=None,rotation=(0,0,0),parent='root',role='body'):
 c=copy.deepcopy(template);c.update(id=id,name=id,parent=None if id=='root' else parent,material=mat,materialLayers=[mat],level=level,role=role,importance=1 if level=='macro' else .7,confidence=.86,primitive=primitive,topologyClass='conforming-shell' if desc and 'carSurface' in desc else 'assembled-solid',topologyRationale='Image-measured continuous curved panel with authored cross-sections.' if desc and 'carSurface' in desc else 'Independent rigid mechanical component, not the body silhouette.');c['geometryDescriptor']={'normalStrategy':'smooth vertex normals','uvStrategy':'generated procedural coordinates','edgeTreatment':{'type':'bevel','bevelRadius':.012,'segments':3},'deformationStack':[],**(desc or {})};c['dimensions']={'width':size[0],'height':size[1],'depth':size[2],'units':'meters','confidence':.84};c['transform']={'position':list(pos),'rotation':list(rotation),'scale':list(size)};c['actionProfile']['animationRole']='root' if id=='root' else 'rigid';c['actionProfile']['destruction'].update(breakable=id!='root',fractureGroup=id,breakImpulse=12,detachableFragments=[id],debrisMaterial=mat);c['actionProfile']['sockets']=[{'id':id+'-mount','position':[0,0,0],'axis':[0,1,0]}];c['details']=[];c['localFeatures']=[];c['evidenceRefs']=['full-object'];rgb=[int(materials[[m['id'] for m in materials].index(mat)]['baseColor'][i:i+2],16) for i in [1,3,5]];rgba='rgba(%d, %d, %d, 1)'%tuple(rgb);c['colorMaterialRecipe']={'dominantAlbedo':rgba,'secondaryAlbedo':rgba,'materialClass':'metal' if mat=='metal' else 'rubber' if mat=='rubber' else 'glass' if mat=='glass' else 'plastic','materialClassConfidence':.85,'evidenceRefs':['full-object']};parts.append(c);return c

def surface(id,kind,mat='paint',level='macro',**params):return part(id,mat,'plane-card',level=level,desc={'carSurface':{'kind':kind,**params}})
def rod(id,mat,a,b,r,level='micro'):return part(id,mat,'tube',level=level,desc={'tubePath':{'points':[a,b],'radius':r,'closed':False}})
part('root','hidden',size=(.001,.001,.001),level='macro')
surface('chassis','floor','dark');surface('fender-left','side',side=-1);surface('fender-right','side',side=1);surface('hood','deck',z0=-2.2,z1=-.61);surface('trunk','deck',z0=1.33,z1=2.2);surface('roof','roof')
for side in [-1,1]:
 word='left' if side<0 else 'right';surface('door-'+word,'door',side=side,z0=-.59,z1=.91)
 surface('quarter-'+word,'quarter',side=side)
 surface('window-'+word,'windowSide','glass',side=side)
 surface('window-quarter-'+word,'windowQuarter','glass',side=side)
 rod('a-pillar-'+word,'paint',[side*.84,.84,-.61],[side*.68,1.28,-.10],.028,'meso')
 rod('roof-rail-'+word,'paint',[side*.68,1.28,-.10],[side*.68,1.28,.76],.025,'meso')
 rod('b-pillar-'+word,'dark',[side*.84,.85,.46],[side*.68,1.29,.46],.018,'meso')
 rod('sill-'+word,'paint',[side*.85,.22,-.59],[side*.85,.22,.91],.033,'meso')
 part('mirror-'+word,'paint',pos=(side*.966,.89,-.52),size=(.155,.09,.11));rod('mirror-stalk-'+word,'dark',[side*.83,.86,-.53],[side*.94,.88,-.52],.018)
 part('handle-'+word,'metal',pos=(side*.878,.72,.57),size=(.018,.026,.115),level='micro')
surface('windshield','windshield','glass');surface('rear-window','rearWindow','glass');surface('nose','end',z=-2.2);surface('tail','end',z=2.2)
for axle,z in [('front',-1.35),('rear',1.30)]:
 for side in [-1,1]:
  name=axle+('-left' if side<0 else '-right');part('tire-'+name,'rubber','lathe',pos=(side*.86,.32,z),rotation=(0,0,math.pi/2),level='macro',desc={'latheProfile':{'points':[[.21,-.112],[.28,-.112],[.315,-.09],[.323,-.04],[.323,.04],[.315,.09],[.28,.112],[.21,.112]],'segments':28}})
  part('rim-'+name,'metal','cylinder',pos=(side*.977,.32,z),size=(.43,.025,.43),rotation=(0,0,math.pi/2),desc={'wheelRim':True});part('hub-'+name,'metal','cylinder',pos=(side*.997,.32,z),size=(.1,.035,.1),rotation=(0,0,math.pi/2),level='micro')
  for n in range(5):part('spoke-'+name+'-'+str(n),'metal','box',level='micro',desc={'carSurface':{'kind':'spoke','side':side,'axle':z,'angle':n*math.tau/5}})
part('grille','dark',pos=(0,.59,-2.198),size=(1.55,.265,.035))
for y in [.495,.56,.625,.69]:rod('grille-slat-'+str(y),'dark',[-.74,y,-2.224],[.74,y,-2.224],.009)
for side in [-1,1]:
 for n,x in enumerate([.51,.7]):part('headlight-'+str(side)+'-'+str(n),'lamp','cylinder',pos=(side*x,.594,-2.23),size=(.175,.023,.175),rotation=(math.pi/2,0,0))
 part('tail-light-'+str(side),'red',pos=(side*.55,.63,2.206),size=(.40,.13,.026));part('indicator-'+str(side),'amber',pos=(side*.66,.345,-2.207),size=(.15,.05,.025),level='micro')
part('front-bumper','metal',pos=(0,.402,-2.215),size=(1.66,.105,.075));part('rear-bumper','metal',pos=(0,.37,2.22),size=(1.67,.12,.075));part('rear-plate','dark',pos=(0,.295,2.215),size=(.3,.14,.022),level='micro')
for x in [-.23,.23]:part('lower-intake-'+str(x),'dark',pos=(x,.29,-2.205),size=(.24,.055,.025),level='micro')
for side in [-1,1]:
 part('seat-base-'+str(side),'dark',pos=(side*.38,.47,.35),size=(.45,.12,.48));part('seat-back-'+str(side),'dark',pos=(side*.38,.72,.56),size=(.43,.48,.12),rotation=(-.12,0,0));part('headrest-'+str(side),'dark',pos=(side*.38,1.0,.57),size=(.26,.20,.1))
part('dashboard','dark',pos=(0,.76,-.46),size=(1.42,.14,.20));part('steering-wheel','dark','torus',pos=(-.38,.87,-.25),size=(.31,.31,.31),rotation=(-.4,0,0));rod('steering-column','dark',[-.38,.75,-.48],[-.38,.87,-.25],.025)
s['componentTree']=parts;s['materials']=materials;s['coordinateFrame'].update(upAxis='+Y',forwardAxis='-Z',units='meters')
s['preSpecAssessment']['objectClass'].update(primaryType='two-door retro muscle coupe',primaryDomain='object',formLanguage=['hard-surface','continuous curved shell'],structureKind=['articulated assembly','layered shell'],motionPotential=['destructible','detachable','whole-object transform'],materialFamilies=['paint','metal','glass','rubber','plastic'])
s['preSpecAssessment']['complexity']['scores']={k:v for k,v in zip(s['preSpecAssessment']['complexity']['scores'],[2,3,2,2,2,1,1,3])};s['preSpecAssessment']['complexity']['reasoning']=['Separate curved panels, glazing and articulated wheel assemblies with destruction.']
s['qualityContract']['definitionOfDone']=['Match the yellow coupe five-view silhouette with a crowned hood, curved fenders and normal wheel proportions.','Every named part can be picked and exploded; wheels spin and steer; window shards and detachable body pieces have bounded gravity simulation; damage repairs to rest state.']
s['preSpecAssessment']['detailInventory']['details']=[]
for id,host,kind in [('hood-crown','hood','contour'),('hood-ridges','hood','relief'),('arch-front-l','fender-left','cutout'),('arch-front-r','fender-right','cutout'),('roof-camber','roof','contour'),('window-tint','windshield','gloss'),('five-spokes','rim-front-left','repetition'),('four-headlamps','grille','repetition'),('grille-slats','grille','repetition'),('door-seam-l','door-left','linework'),('door-seam-r','door-right','linework'),('silver-bumpers','front-bumper','gloss'),('tail-lenses','tail-light--1','color'),('c-pillar','quarter-left','contour')]:
 c=next(c for c in parts if c['id']==host);c['localFeatures'].append({'id':id,'kind':kind,'description':id,'evidenceRefs':['full-object']});s['preSpecAssessment']['detailInventory']['details'].append({'id':id,'kind':kind,'mapsTo':{'ref':id},'evidenceRefs':['full-object']})
s['repetitionSystems']=[{'id':'wheel-spokes','componentRefs':[c['id'] for c in parts if c['id'].startswith('spoke-')],'count':20,'distribution':'five radial spokes on each of four mirrored wheels','evidenceRefs':['full-object'],'buildsGeometry':True}]
s['performanceBudget'].update(targetTriangles=30000,maxTriangles=60000,targetDrawCalls=90)
s['featureReviewTargets']=[{'id':key,'passIds':[p['id'] for p in s['buildPasses']],'importance':'critical','description':desc,'acceptanceThreshold':.7,'componentRefs':ids,'evidenceRefs':['full-object']} for key,desc,ids in [('silhouette','Long hood, curved fenders and coupe roof',['hood','roof','fender-left','fender-right']),('wheel-proportion','Four wheels with normal diameter and wheelbase',['tire-front-left','tire-rear-left']),('front-identity','Four round recessed headlights and dark grille',['grille']),('transparent-cabin','Transparent glazing and two seats',['windshield','seat-back--1'])]]
for p in s['buildPasses']:p['componentRefs']=[c['id'] for c in parts]
s['assumptions']=['Approximate procedural reconstruction, not photogrammetry. Solid paint needs no photograph projection. Generated views have minor rear-trim inconsistencies; canonical design uses two horizontal red rear lamps.','Custom carSurface descriptors are analytic lofts; authoring adapter retains all parameters in this spec and only replaces corresponding emitted geometry expressions.']
s['viewEvidence']=[{'id':'full-object','sourceImage':str(out/'reference.png'),'notes':'Original simplified accepted concept'}]
(out/'sculpt-spec.json').write_text(json.dumps(s,indent=2),encoding='utf-8');(out/'assessment.json').write_text(json.dumps(s['preSpecAssessment'],indent=2),encoding='utf-8');(out/'detail-inventory.json').write_text(json.dumps(s['preSpecAssessment']['detailInventory'],indent=2),encoding='utf-8')
print('Authored',len(parts),'components')
