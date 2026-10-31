"""Run deterministic evidence packaging; --record consumes human/agent-authored scores only."""
import argparse,json,subprocess
from pathlib import Path
q=argparse.ArgumentParser();q.add_argument('pass_id');q.add_argument('prefix');q.add_argument('--record',action='store_true');args=q.parse_args()
b=Path(__file__).parent;forge=Path('C:/Users/recto/.codex/skills/img2threejs/forge');spec=b/'sculpt-spec.json';ref=b/'reference-regions/canonical.png';render=b/(args.prefix+'-match.png');comparison=b/(args.prefix+'-comparison.png')
def run(name,extra,output=None):
 command=['python','-X','utf8',str(forge/name),*map(str,extra)]
 if output:
  with (b/output).open('w',encoding='utf8') as f:return subprocess.run(command,stdout=f).returncode
 return subprocess.run(command).returncode
if not args.record:
 code=run('stage4_review/diagnose_render.py',['--reference',ref,'--render',render,'--spec',spec,'--pass-id',args.pass_id,'--in-place','--json'],args.prefix+'-tier1.json')
 run('stage4_review/diagnose_render_multi_angle.py',['--reference',render,'--orbit',b/(args.prefix+'-side.png'),'--json'],args.prefix+'-orbit.json')
 run('stage4_review/interior_difference.py',[ref,render,'--json'],args.prefix+'-interior.json')
 if code:raise SystemExit(code)
 raise SystemExit(run('stage4_review/make_comparison_sheet.py',['--reference',ref,'--render',render,'--out',comparison,'--panel-width',720,'--panel-height',300,'--json'],args.prefix+'-sheet.json'))
review=json.loads((b/(args.prefix+'-vision.json')).read_text(encoding='utf8'))
extra=[spec,'--pass-id',args.pass_id,'--fidelity',review['score'],'--ai-vision-score',review['score'],'--action',review['action'],'--summary',review['summary'],'--reference-screenshot',ref,'--render-screenshot',render,'--comparison-image',comparison,'--feature-reviews-json',json.dumps(review['features']),'--layer-scores-json',json.dumps(review['layers']),'--ai-vision-notes',review['notes'],'--camera-view','three-quarter','--require-screenshot-files','--in-place']
raise SystemExit(run('stage4_review/append_review.py',extra))
