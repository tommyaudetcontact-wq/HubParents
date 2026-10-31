"""Independent reference runs for the five other traffic families; never resets progress."""
import copy,json,subprocess
from pathlib import Path
b=Path(__file__).parent;forge=Path('C:/Users/recto/.codex/skills/img2threejs/forge');base=json.loads((b/'sculpt-spec.json').read_text(encoding='utf8'))
observations={
 'compact':('three-door red hatchback','Two long side doors, fixed rear quarter panes, sloped glazed hatch, short overhangs, two circular headlights in an inset grille, dark multi-spoke rims, body-color bumpers and a small roof lip.'),
 'suv':('five-door blue SUV','Four side doors and glazed hatch, tall nearly horizontal roof, rear quarter glazing, black arch/sill cladding, attached roof rails, four round lamps in an inset grille, larger five-spoke wheels.'),
 'pickup':('orange four-door crew-cab pickup','Distinct cab and open lined cargo bed, four cab doors, upright rear cab window, inset tailgate, vertical corner tail lamps, large treaded tires and four round front lamps.'),
 'van':('ivory panel delivery van','Short forward hood, tall enclosed cargo body, only cab side glazing, long sliding cargo panel/track, two solid rear cargo doors, dark bumpers and simple perforated steel wheels.'),
 'bus':('yellow and ivory shuttle bus','Long two-axle body, broad upright windshield, five passenger windows per side, passenger seat rows, tall front entry door, narrow rear engine hatch, vertical tail lamps and a contrasting pale roof.')}
for family,(name,observed) in observations.items():
 out=b/'families'/family;out.mkdir(parents=True,exist_ok=True)
 if (out/'state.json').exists():continue
 ref=b/('reference-'+family+'.png')
 subprocess.run(['python','-X','utf8',str(forge/'stage2_spec/new_pre_spec_assessment.py'),name,'--image',str(ref),'--complexity','complex','--spec-query',name+' continuous automotive lofted shell glazing wheel arches articulated panels','--out',str(out/'assessment.json')],check=True,stdout=subprocess.DEVNULL)
 assessment=json.loads((out/'assessment.json').read_text(encoding='utf8'));s=copy.deepcopy(base);s.update(targetName=name,targetId='brawl-road-'+family,sourceImage=str(ref),reviewHistory=[],tier1Results=[],visualEvidence=[]);s['sculptPipeline'].update(currentPass='blockout',completedPasses=[],lastCompletedPass='',blockedReason='');s['localSpecSearch']=assessment['localSpecSearch'];s['preSpecAssessment']['sourceImage']=str(ref);s['preSpecAssessment']['objectClass']['primaryType']=name;s['preSpecAssessment']['complexity']['reasoning']=[observed];s['assumptions']=[observed,'Original generated multi-view concept, stylized procedural reconstruction. Hidden underbody/cavities are inferred conservatively, not photogrammetry.','Uses shared, tested wheel/cabin/damage library; family-specific geometry is still built and reviewed in stage order.'];s['qualityContract']['definitionOfDone']=[observed,'Match the reference family silhouette and glazing/door layout; no empty wheel wells or floating hardware.','Preserve independent wheels and complete detachable panel assemblies; review in the separate workshop before any game integration.'];s['runtimeMounts']={};s.pop('optimizationEvidence',None)
 colors={'compact':'#b52228','suv':'#285fa5','pickup':'#c76b21','van':'#ded5bd','bus':'#dba923'}
 for m in s['materials']:
  if m['id']=='paint':m.update(baseColor=colors[family],color=colors[family]);m['albedo']['dominant']=colors[family]
  m['textureless']={'declared':True,'evidence':[str(ref)+': clean uniform original concept; studio reflections are not albedo patterns.']}
 remove=set()
 if family=='compact':remove.update(['door-left-1','door-right-1','glass-left-1','glass-right-1','frame-left-1','frame-right-1','handle-left-1','handle-right-1'])
 if family=='van':remove.update(['glass-left-1','glass-right-1','frame-left-1','frame-right-1','quarter-left','quarter-right','rear-window'])
 if family=='bus':remove.update(['door-left-1','door-right-1','glass-left-1','glass-right-1','frame-left-1','frame-right-1','handle-left-1','handle-right-1','quarter-left','quarter-right'])
 s['componentTree']=[c for c in s['componentTree'] if c['id'] not in remove]
 for c in s['componentTree']:
  c['surfaceDetail']={};c['evidenceRefs']=['canonical','profile','rear']
  if c.get('parent') in remove:c['parent']='root'
  if family in ['compact','suv'] and c['id']=='rear-window':c['parent']='trunk'
  rgb=[int(next(m['baseColor'] for m in s['materials'] if m['id']==c['material'])[i:i+2],16) for i in [1,3,5]];c['colorMaterialRecipe'].update(componentId=c['id'],dominantAlbedo='rgba(%d, %d, %d, 1)'%tuple(rgb),secondaryAlbedo='rgba(%d, %d, %d, 1)'%tuple(rgb))
 if family=='van':
  extra=copy.deepcopy(next(c for c in s['componentTree'] if c['id']=='trunk'));extra.update(id='cargo-door-right',name='cargo-door-right');s['componentTree'].append(extra)
 if family=='bus':
  for side in ['left','right']:
   extra=copy.deepcopy(next(c for c in s['componentTree'] if c['id']=='windshield'));extra.update(id='passenger-windows-'+side,name='passenger-windows-'+side);s['componentTree'].append(extra)
 ids={c['id'] for c in s['componentTree']}
 for r in s['repetitionSystems']:r['componentRefs']=[id for id in r['componentRefs'] if id in ids]
 for p in s['buildPasses']:p['componentRefs']=list(ids)
 for f in s['featureReviewTargets']:
  f['componentRefs']=[id for id in f['componentRefs'] if id in ids];f['description']=name+': '+f['description'];f['name']=f['description']
 for c in s['componentTree']:
  for f in c['localFeatures']:
   if f['id']=='four-door-proportion' and family in ['compact','bus']:f['description']='Two front side-door assemblies; fixed body/window section aft.'
 # Keep inventory links real after deleting unused rear-door parts.
 live_features={f['id'] for c in s['componentTree'] for f in c['localFeatures']}
 s['preSpecAssessment']['detailInventory']['details']=[d for d in s['preSpecAssessment']['detailInventory']['details'] if d['mapsTo']['ref'] in live_features]
 (out/'sculpt-spec.json').write_text(json.dumps(s,indent=2),encoding='utf8')
 (out/'image-analysis.md').write_text('# '+name+'\n\nObserved: '+observed+'\n\nBilateral continuous shell with distinct roof/deck/door proportions. Paint is solid clean dielectric/clearcoat; windows transparent blue-gray; tires matte rubber; rims and trim metal. Lower cavities, suspension and hidden mounts are inferred. Reuse of a common mechanical library does not imply identical body shapes.\n',encoding='utf8')
 (out/'suitability.json').write_text(json.dumps({'verdict':'pass','confidence':.9,'target':name,'evidence':str(ref),'notes':'Original multi-view concept of the same vehicle; front/profile/rear visible. Hidden mechanisms approximate.'},indent=2),encoding='utf8')
 subprocess.run(['python','-X','utf8',str(forge/'state.py'),'init','--state',str(out/'state.json'),'--reference',str(ref),'--profile','generic','--spec',str(out/'sculpt-spec.json')],check=True,stdout=subprocess.DEVNULL)
 print('Prepared independent run:',family)
