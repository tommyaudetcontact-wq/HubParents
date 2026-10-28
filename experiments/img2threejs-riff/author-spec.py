from pathlib import Path
import json,copy
out=Path('../BrawlAcademy3D/experiments/img2threejs-riff');s=json.loads((out/'sculpt-spec.json').read_text());a=s['preSpecAssessment']
a['objectClass'].update(primaryType='stylized adult male wearing backwards cap and sunglasses',primaryDomain='character',formLanguage=['organic','fabric-like','hard-surface accessories'],structureKind=['articulated assembly','deformable surface','layered shell'],motionPotential=['articulated','bendable','whole-object transform'],materialFamilies=['skin-like','cloth','rubber','metal','plastic'])
a['complexity']['scores']={k:v for k,v in zip(a['complexity']['scores'],[2,3,2,1,2,2,2,3])};a['complexity']['reasoning']=['Full body, articulated fingers, cap, eyewear, necklace, short sleeves and trouser hems observed in reference. Back and depths inferred.']
a['anatomy']={'applies':True,'styleHeads':7.8,'proportions':{'headUnit':.128,'torso':3.45,'legs':4.35,'shoulderWidth':1.77,'hipWidth':1.21},'pose':{'type':'relaxed standing contrapposto','jointAngles':{'neck':[0,0,-8],'leftShoulder':[0,0,8],'rightShoulder':[0,0,-8],'leftKnee':[0,0,8],'rightKnee':[0,0,0]}},'faceLandmarks':{'eyeLine':.42,'eyeSpacing':.25,'noseBase':.62,'mouthLine':.76,'hairline':.13,'earTop':.38,'earBottom':.65},'features':['backward black cap','dark rectangular sunglasses','gold pendant','tattoo on forearm'],'confidence':.76,'evidenceRefs':['full-object'],'measurementNotes':'Approximate visual measurements of reference-isolated.png; hidden back inferred.'}
s['sourceImage']=str((out/'reference-isolated.png').resolve());s['silhouette']={'boundingShape':'athletic adult with tapered waist and full trousers','symmetry':'bilateral anatomy, asymmetric cap and stance','aspectRatios':[{'name':'height/head','value':7.8}],'dominantCurves':['shoulder to tapered waist','jawline','calf into sneaker'],'negativeSpaces':['between arms and torso','between legs'],'landmarks':[]}
# Remove accessories that were in the upstream example, but not this reference.
drop={'hp-band','hp-cup-l','hp-cup-r','shirt-decal'}
s['componentTree']=[c for c in s['componentTree'] if c['id'] not in drop]
colors={'hidden':'#000000','skin':'#d59a73','hair':'#34282b','shirt':'#22232c','pants':'#242c43','shoes':'#272932','eye':'#eee8de','lips':'#a16a59','glasses-frame':'#191e25','glasses-lens':'#141922','gold':'#d1af59'}
for c in s['componentTree']:
 c['evidenceRefs']=['full-object'];co=colors.get(c['material'],'#242c43');rgb=[int(co[i:i+2],16) for i in [1,3,5]];mat='skin' if c['material']=='skin' else 'fabric' if c['material'] in ['shirt','pants'] else 'rubber' if c['material']=='shoes' else 'plastic'
 c['colorMaterialRecipe']={'dominantAlbedo':f'rgba({rgb[0]}, {rgb[1]}, {rgb[2]}, 1)','secondaryAlbedo':f'rgba({rgb[0]}, {rgb[1]}, {rgb[2]}, 1)','materialClass':mat,'materialClassConfidence':.8,'evidenceRefs':['full-object']}
# Palette material fields deliberately flat: user requested simple stylized models, no skin pores or fabric photos.
s['materials']=[]
for id,co in colors.items():
 m={'id':id,'name':id,'type':'standard','shaderModel':'MeshStandardMaterial','baseColor':co,'color':co,'roughness':.25 if id=='glasses-lens' else .32 if id=='gold' else .78,'metalness':.8 if id=='gold' else 0,'textureless':{'declared':True,'evidence':['reference-isolated.png: broad smooth color regions, no observable pore/grain pattern at target game distance; simplified art requested by user']},'albedo':{'dominant':co,'secondary':[co]},'ambientOcclusion':{'cavityStrength':.16,'contactShadowBias':.25},'localOverrides':[]}
 if id=='hidden':m['qualityTier']='utility'
 s['materials'].append(m)
# Real visible small features, explicitly linked to their host. These are authored constraints, not invented textures.
details=[('cap-seam','seam','hair'),('cap-brim','contour','hair'),('swept-fringe','contour','hair'),('neckline','seam','chest'),('sleeve-hem','seam','upper-arm-l'),('trouser-hem','seam','shin-l'),('shoe-sole','contour','foot-l'),('lace-row','linework','foot-l'),('eyewear-bridge','contour','glasses-bridge'),('smoked-lens','gloss','lens-l'),('gold-chain','linework','chest'),('rectangular-pendant','bevel','chest'),('angular-tattoo','linework','forearm-l')]
a['detailInventory']['details']=[]
for id,kind,host in details:
 c=next(c for c in s['componentTree'] if c['id']==host);c['localFeatures'].append({'id':id,'kind':kind,'description':id.replace('-',' ')+' observed on reference','evidenceRefs':['full-object']});a['detailInventory']['details'].append({'id':id,'kind':kind,'mapsTo':[id],'evidenceRefs':['full-object']})
# Five micro groups are useful at game distance: frames, lens, bridge, mouth and visible ear rim.
for c in s['componentTree']:
 if c['id'] in ['glasses-bridge','lens-l','lens-r','mouth','brow-l','brow-r']:c['level']='micro'
s['repetitionSystems']=[{'id':'shoe-laces','componentRefs':['foot-l','foot-r'],'count':5,'distribution':'five alternating lace runs on each shoe tongue','variation':'bilaterally mirrored','evidenceRefs':['full-object']}]
ids=[c['id'] for c in s['componentTree']]
for p in s['buildPasses']:p['componentRefs']=[x for x in p['componentRefs'] if x not in drop]
s['buildPasses'].insert(2,{'id':'structural-pass','goal':'Verify joined anatomy and independent cap, hair, eyewear and apparel layers.','componentRefs':ids,'acceptance':['No visible joint gaps or invented headphones.']})
s['sculptPipeline']['passOrder']=[p['id'] for p in s['buildPasses']]
for f in s['featureReviewTargets']:f['componentRefs']=[x for x in f['componentRefs'] if x not in drop and x!='headphone']
s['performanceBudget'].update(targetTriangles=50000,maxDrawCalls=20,fpsTarget=60)
(out/'assessment.json').write_text(json.dumps({'preSpecAssessment':a,'qualityContract':s['qualityContract'],'localSpecSearch':json.loads((out/'local-search.json').read_text())},indent=2))
(out/'sculpt-spec.json').write_text(json.dumps(s,indent=2))
state=json.loads((out/'state.json').read_text());state['artifacts']['reference']=s['sourceImage'];state.pop('referenceImage',None);(out/'state.json').write_text(json.dumps(state,indent=2))
