"""Package real, transparent browser captures without stretching or crop fitting."""
import argparse, json, subprocess, shutil
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('family');p.add_argument('pass_id',default='blockout',nargs='?');p.add_argument('--record',action='store_true');a=p.parse_args()
b=Path(__file__).resolve().parent; d=b/'families'/a.family
forge=Path('C:/Users/recto/.codex/skills/img2threejs/forge')
ref=b/f'reference-{a.family}-isolated.png'; render=d/f'{a.pass_id}-match.png'; spec=d/'sculpt-spec.json'; clay=d/(a.pass_id+'-map-stripped.png')
def run(script,argv,out):
    with (d/out).open('w',encoding='utf8') as f:
        result=subprocess.run(['python','-X','utf8',str(forge/script),*map(str,argv)],stdout=f)
    return result.returncode
if a.record:
    review=json.loads((d/(a.pass_id+'-vision.json')).read_text(encoding='utf8'))
    extra=[spec,'--pass-id',a.pass_id,'--fidelity',review['score'],'--ai-vision-score',review['score'],'--action',review['action'],'--summary',review['summary'],'--reference-screenshot',ref,'--render-screenshot',render,'--comparison-image',d/(a.pass_id+'-comparison.png'),'--feature-reviews-json',json.dumps(review['features']),'--layer-scores-json',json.dumps(review['layers']),'--ai-vision-notes',review['notes'],'--map-stripped-render',clay,'--camera-view','three-quarter','--require-screenshot-files','--in-place']
    raise SystemExit(run('stage4_review/append_review.py',extra,a.pass_id+'-record.txt'))
shutil.copyfile(d/'capture.png',render)
shutil.copyfile(d/'capture-clay.png',clay)
# The analytic factory uses no texture maps. This same actual render is also
# map-stripped evidence; its geometry is not replaced by the reference image.
rc=run('stage4_review/diagnose_render.py',['--reference',ref,'--render',render,'--map-stripped-render',clay,'--spec',spec,'--pass-id',a.pass_id,'--in-place','--json'],a.pass_id+'-tier1.json')
print(a.family,'Tier1 exit',rc,flush=True)
if rc: raise SystemExit(rc)
run('stage4_review/diagnose_render_multi_angle.py',['--reference',render,'--orbit',(d/(a.pass_id+'-side.png') if (d/(a.pass_id+'-side.png')).exists() else d/'blockout-side.png'),'--json'],a.pass_id+'-orbit.json')
run('stage4_review/interior_difference.py',[ref,render,'--json'],a.pass_id+'-interior.json')
raise SystemExit(run('stage4_review/make_comparison_sheet.py',['--reference',ref,'--render',render,'--out',d/(a.pass_id+'-comparison.png'),'--panel-width',720,'--panel-height',480,'--json'],a.pass_id+'-sheet.json'))
