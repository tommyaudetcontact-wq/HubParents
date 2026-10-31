"""Persist reference observations and analytic surface decisions before building."""
import copy,json,shutil,sys
from pathlib import Path
base=Path(__file__).parent
images=Path('C:/Users/recto/.codex/generated_images/01a13fa7-7c93-7aa2-9a37-9795b79cfd27')
for family,file in [('compact','28569814-d0b4-49bb-a7f3-756d2f0193de'),('suv','f47d11d2-1d11-4729-8ab6-260935e5c443'),('pickup','cea3f2bd-2fe7-47de-aa00-7084495d5ba5'),('van','f030cfde-899a-4f61-943a-26cd754cbbd6'),('bus','f08c0f14-eae8-4ae1-ac71-67861f33be44')]:
 shutil.copy2(images/('exec-'+file+'.png'),base/('reference-'+family+'.png'))
read=lambda p:json.loads(p.read_text(encoding='utf8'))
write=lambda p,s:p.write_text(json.dumps(s,indent=2,ensure_ascii=False),encoding='utf8')
s=read(base/'sculpt-spec.json')
if s.get('reviewHistory') and '--reset-authoring' not in sys.argv:raise SystemExit('Refusing to overwrite reviewed spec. Edit current sculpt-spec.json; --reset-authoring explicitly rebuilds intake only.')
a=read(base/'assessment.json');old=read(base.parent/'img2threejs-coupe/sculpt-spec.json')
a['preSpecAssessment']['objectClass'].update(primaryType='four-door three-box sedan with related reference-built traffic families',primaryDomain='object',formLanguage=['bilateral lofted automotive shell','crowned decks','recessed wheel arches'],structureKind=['articulated mechanical assembly','thin conforming panels'],motionPotential=['steering','wheel rotation','hinged damage','detachable panels'],materialFamilies=['painted metal','rubber','glass','upholstery'])
a['preSpecAssessment']['complexity']['scores'].update(dict(zip(a['preSpecAssessment']['complexity']['scores'],[3,3,2,3,2,2,2,3])))
a['preSpecAssessment']['complexity']['estimatedCounts'].update(macroComponents=8,mesoComponents=30,microFeatureGroups=14,materialLayers=8,repetitionSystems=3)
a['preSpecAssessment']['complexity']['reasoning']=['Four independent door assemblies and panes, two articulated decks, four wheel pivots, closed cabin and engine/cargo cavities; distinct family roof and axle layouts.']
a['preSpecAssessment']['unknownsToResolveBeforeImplementation']=[]
a['qualityContract']['definitionOfDone']=['Reference-like continuous teal sedan silhouette, four doors, crowned hood and three-box roof, paired square lamps and recessed five-spoke rims.','Distinct compact, SUV, crew pickup, panel van and shuttle bus profiles, not stretched copies of the coupe.','Glass follows its frame; door glass travels with detachable door. Fixed quarter panes stay with shell. No floating trim or holes through wheel wells.','Existing authoritative damage, spin, steering, driver seating and physical debris remain functional.']
s['preSpecAssessment']=a['preSpecAssessment'];s['qualityContract']=a['qualityContract'];s['localSpecSearch']=a['localSpecSearch']
template=copy.deepcopy(old['componentTree'][0]);mt=old['materials'][0];parts=[];materials=[]
for id,color,rough,metal,opacity in [('hidden','#000000',1,0,0),('paint','#398c92',.32,.18,1),('rubber','#24292c',.85,0,1),('metal','#b3bfc5',.28,.75,1),('dark','#29343b',.7,0,1),('glass','#accbd4',.16,.02,.24),('lamp','#eceddf',.23,.1,1),('red','#b52d35',.32,.05,1),('amber','#d58b30',.4,.05,1)]:
 m=copy.deepcopy(mt);m.update(id=id,name=id,color=color,baseColor=color,roughness={'base':rough,'variation':0},metalness={'base':metal,'variation':0},opacity=opacity,transparent=opacity<1,clearcoat=.35 if id=='paint' else 0)
 m['albedo']={'dominant':color,'secondary':[color]};m['colorVariation'].update(palette=[color],amplitude=0,pattern='none');m.pop('normal',None);m['roughness'].pop('variation',None)
 m['localOverrides']=[{'id':id+'-finish','region':'whole component','roughness':rough,'evidenceRefs':['canonical']}]
 m['notes']='Generated concept has unpatterned solid materials; scalar PBR approximation, no baked studio highlight in albedo.';materials.append(m)
def part(id,kind,level='meso',mat='paint',parent='root',**params):
 c=copy.deepcopy(template);c.update(id=id,name=id,parent=None if id=='root' else parent,level=level,role='rigid mechanical part',material=mat,materialLayers=[mat],primitive='plane-card' if kind in ['side','deck','roof','glass','frame','well','floor','end','door'] else 'box',topologyClass='conforming-shell' if kind in ['side','deck','roof','glass','well','door'] else 'assembled-solid',topologyRationale='Conforming analytic automotive skin follows continuous section profile.' if kind in ['side','deck','roof','glass','well','door'] else 'Separate rigid hardware has its own mechanical boundary.')
 c['geometryDescriptor']={'normalStrategy':'smooth indexed normals','uvStrategy':'procedural solid color','edgeTreatment':{'type':'bevel','bevelRadius':.012,'segments':2},'deformationStack':[],'roadSurface':{'kind':kind,**params}}
 c['transform']={'position':[0,0,0],'rotation':[0,0,0],'scale':[1,1,1]};c['dimensions']={'width':1,'height':1,'depth':1,'units':'meters','confidence':.85};c['attachment']=None if id=='root' else {'parentSocket':parent+'-mount','localStart':[0,0,0],'localEnd':[0,0,0],'contactType':'overlap','embedDepth':.025,'overlap':.025,'gapTolerance':.012}
 c['localFeatures']=[];c['details']=[];c['evidenceRefs']=['canonical','profile','rear'];c['actionProfile']['animationRole']='root' if id=='root' else 'rigid';c['actionProfile']['destruction'].update(breakable=id!='root',fractureGroup=parent if parent!='root' else id,detachableFragments=[id],breakImpulse=12);c['actionProfile']['sockets']=[{'id':id+'-mount','position':[0,0,0],'axis':[0,1,0]}];rgb=[int(next(m['baseColor'] for m in materials if m['id']==mat)[i:i+2],16) for i in [1,3,5]];c['colorMaterialRecipe'].update(componentId=id,dominantAlbedo='rgba(%d, %d, %d, 1)'%tuple(rgb),secondaryAlbedo='rgba(%d, %d, %d, 1)'%tuple(rgb));parts.append(c);return c
part('root','root','macro','hidden');part('chassis','floor','macro','dark');part('hood','deck','macro',z0=-2.2,z1=-.72);part('trunk','deck','macro',z0=1.28,z1=2.2);part('roof','roof','macro');part('front-fascia','end',z=-2.2);part('rear-fascia','end',z=2.2)
for side in [-1,1]:
 word='left' if side<0 else 'right';part('fender-'+word,'side','macro',side=side);part('wheel-well-'+word,'well',mat='dark',side=side)
 for n in range(2):
  door='door-'+word+'-'+str(n);part(door,'door','macro',side=side,door=n);part('glass-'+word+'-'+str(n),'glass',mat='glass',parent=door,side=side,door=n);part('frame-'+word+'-'+str(n),'frame',parent=door,side=side,door=n);part('handle-'+word+'-'+str(n),'handle','micro','metal',parent=door,side=side,door=n)
 part('quarter-'+word,'glass',mat='glass',side=side,quarter=True);part('mirror-'+word,'mirror',side=side)
 for axle in ['front','rear']:
  wheel='wheel-'+word+'-'+axle;part(wheel,'wheel','macro','rubber',side=side,axle=axle);part('rim-'+word+'-'+axle,'rim',mat='metal',parent=wheel,side=side,axle=axle)
part('windshield','glass',mat='glass',front=True);part('rear-window','glass',mat='glass',rear=True)
for id in ['engine-bay','engine','cargo-liner','dashboard','seat-front-left','seat-front-right','seat-rear','steering-wheel']:part(id,'interior',mat='dark')
for id,mat in [('grille','dark'),('headlights','lamp'),('tail-lamps','red'),('indicators','amber'),('bumpers','metal'),('window-gaskets','rubber')]:part(id,'hardware','micro',mat)
details=[('crowned-hood','hood','contour'),('four-door-proportion','door-left-0','contour'),('door-seams','door-right-1','linework'),('continuous-arches','fender-left','cutout'),('closed-wells','wheel-well-right','cavity'),('recessed-rims','rim-left-front','relief'),('five-spokes','rim-right-front','repetition'),('roof-camber','roof','contour'),('fitted-panes','windshield','contour'),('paired-square-lamps','headlights','repetition'),('inset-grille','grille','cavity'),('rear-lenses','tail-lamps','color'),('integrated-trim','bumpers','bevel'),('padded-seats','seat-front-left','contour')]
inventory=[]
for id,host,kind in details:
 next(c for c in parts if c['id']==host)['localFeatures'].append({'id':id,'kind':kind,'description':id,'evidenceRefs':['canonical']});inventory.append({'id':id,'kind':kind,'mapsTo':{'ref':id},'evidenceRefs':['canonical']})
for d in inventory:d['kind']={'cutout':'hole','cavity':'groove','relief':'ridge','repetition':'contour','color':'gloss'}.get(d['kind'],d['kind'])
s['componentTree']=parts;s['materials']=materials;s['preSpecAssessment']['detailInventory']['details']=inventory
s['coordinateFrame'].update(upAxis='+Y',forwardAxis='-Z',units='meters')
s['repetitionSystems']=[{'id':key,'componentRefs':[c['id'] for c in parts if c['id'].startswith(prefix)],'count':count,'distribution':desc,'evidenceRefs':['canonical'],'buildsGeometry':True} for key,prefix,count,desc in [('wheels','wheel-',4,'bilateral two axles'),('doors','door-',4,'two lateral doors each side'),('rims','rim-',4,'five spokes each inset wheel face')]]
s['performanceBudget'].update(targetTriangles=28000,maxTriangles=40000,targetDrawCalls=45)
s['featureReviewTargets']=[{'id':key,'passIds':[p['id'] for p in s['buildPasses']],'importance':'critical','description':desc,'acceptanceThreshold':.7,'componentRefs':ids,'evidenceRefs':['canonical']} for key,desc,ids in [('silhouette','Four-door three-box sedan with curved continuous decks',['hood','roof','trunk']),('wheel-arch','Normal wheelbase with true cutouts and enclosed wells',['fender-left','wheel-left-front']),('cabin','Fitted glazing with four door frames and visible seated interior',['windshield','door-left-0','seat-front-left']),('front-rear-identity','Paired square lamps and thin integrated bumpers',['headlights','tail-lamps','bumpers'])]]
for f in s['featureReviewTargets']:f.update(name=f['description'],tier='critical')
s['lightingFromPhoto']=copy.deepcopy(old['lightingFromPhoto'])
s['roadFleetProfiles']={
 'sedan':dict(halfLength=2.2,halfWidth=.91,belt=.81,roof=1.36,roofFront=-.20,roofBack=.77,front=-.73,back=1.35,axles=[-1.38,1.37],radius=.33,doors=4),
 'compact':dict(halfLength=1.9,halfWidth=.87,belt=.80,roof=1.40,roofFront=-.30,roofBack=1.1,front=-.82,back=1.65,axles=[-1.14,1.17],radius=.33,doors=2),
 'suv':dict(halfLength=2.2,halfWidth=.95,belt=1.0,roof=1.79,roofFront=-.30,roofBack=1.45,front=-.85,back=1.95,axles=[-1.35,1.40],radius=.40,doors=4),
 'pickup':dict(halfLength=2.55,halfWidth=.96,belt=.97,roof=1.72,roofFront=-.72,roofBack=.44,front=-1.14,back=.58,axles=[-1.66,1.65],radius=.40,doors=4),
 'van':dict(halfLength=2.5,halfWidth=.98,belt=1.07,roof=2.03,roofFront=-1.1,roofBack=2.13,front=-1.7,back=2.4,axles=[-1.55,1.65],radius=.36,doors=4),
 'bus':dict(halfLength=3.35,halfWidth=1.08,belt=1.08,roof=2.35,roofFront=-2.78,roofBack=2.98,front=-3.08,back=3.2,axles=[-2.12,2.25],radius=.45,doors=2)}
s['assumptions']=['Stylized procedural reconstruction of original concept sheets; no exact production car brand.','Solid uniform paint and rubber: no photographic projection needed. Reflections are lighting, never baked into albedo. PBR scalars are inferred, not measured inverse rendering.','Custom roadSurface adapter uses the numeric roadFleetProfiles; every build pass gates which assembly stages may render. Runtime LOD may simplify hardware only at distance.','Damage deforms the whole affected front/rear shell and chassis; attached hood/trunk/door frames follow parent pivots, then exact meshes become existing physical debris.']
s['viewEvidence']=[{'id':id,'sourceImage':str(base/'reference-regions'/file),'notes':'Original multi-view generated sedan concept'} for id,file in [('canonical','canonical.png'),('profile','profile.png'),('rear','rear.png')]]
for p in s['buildPasses']:p['componentRefs']=[c['id'] for c in parts]
write(base/'sculpt-spec.json',s);write(base/'assessment.json',a);write(base/'detail-inventory.json',s['preSpecAssessment']['detailInventory'])
print('Authored',len(parts),'components and',len(inventory),'mapped details')
