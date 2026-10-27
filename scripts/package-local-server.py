"""Prepare a standalone, private desktop installation. Never copy data into web/."""
from pathlib import Path
import shutil,subprocess,json,sys,secrets
repo=Path(__file__).resolve().parents[1]
dest=Path(sys.argv[1]).resolve()
for name in ['web','serveur/engine','serveur/node_modules','outils','data','sauvegardes','journaux']:(dest/name).mkdir(parents=True,exist_ok=True)
files=subprocess.check_output(['git','ls-files'],cwd=repo,text=True).splitlines() if (repo/'.git').exists() else [str(p.relative_to(repo)).replace('\\','/') for p in repo.rglob('*') if p.is_file()]
if (repo/'.git').exists():files+=subprocess.check_output(['git','ls-files','--others','--exclude-standard'],cwd=repo,text=True).splitlines()
files+=['bootstrap.js','server-location.json']
extensions={'.html','.js','.css','.svg','.png','.jpg','.jpeg','.webp','.mp3','.ogg','.wav','.wasm','.pdf','.traineddata','.gz'}
for name in sorted(set(files)):
 p=Path(name)
 if p.parts[0] in ['supabase','backend','backend-engine','scripts','local-server','android','.github'] or p.name.startswith('.') or p.suffix.lower() not in extensions or not (repo/p).is_file():continue
 target=dest/'web'/p;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(repo/p,target)
for name in ['server.mjs','runtime.js','parental.mjs','superuser.mjs','city-trades.mjs','patrol.mjs','publish.mjs','package.json']:
 shutil.copy2(repo/'local-server'/name,dest/'serveur'/name)
for name in ['engine.js','domain.js']:shutil.copy2(repo/'backend-engine'/name,dest/'serveur/engine'/name)
(dest/'serveur/engine/runtime.js').write_text("export {asyncArray} from '../runtime.js';\n",encoding='utf-8')
(repo/'local-server/engine').mkdir(parents=True,exist_ok=True)
for name in ['engine.js','domain.js']:shutil.copy2(repo/'backend-engine'/name,repo/'local-server/engine'/name)
(repo/'local-server/engine/runtime.js').write_text("export {asyncArray} from '../runtime.js';\n",encoding='utf-8')
if (repo/'local-server/node_modules/ws').exists():shutil.copytree(repo/'local-server/node_modules/ws',dest/'serveur/node_modules/ws',dirs_exist_ok=True)
elif not (dest/'serveur/node_modules/ws').exists():raise RuntimeError('Dépendance ws manquante')
node=shutil.which('node')
if node and Path(node).resolve()!=(dest/'outils/node.exe').resolve():shutil.copy2(node,dest/'outils/node.exe')
for p in (repo/'local-server/desktop').glob('*'):shutil.copy2(p,dest/p.name)
settings=json.loads((dest/'settings.json').read_text(encoding='utf-8')) if (dest/'settings.json').exists() else {}
settings.update({'git':settings.get('git') or shutil.which('git'),'gitContext':settings.get('gitContext') or str(repo),'gameUrl':'https://tommyaudetcontact-wq.github.io/HubParents/','port':4173,'python':sys.executable})
(dest/'settings.json').write_text(json.dumps(settings,indent=2),encoding='utf-8')
if (repo/'standalone.json').exists():shutil.copy2(repo/'standalone.json',dest/'standalone.json')
if (repo/'standalone.json').exists() and json.loads((repo/'standalone.json').read_text())['enabled']:
 game_data=dest/'data-ville';game_data.mkdir(exist_ok=True)
 initial=game_data/'export-initial.json'
 if not initial.exists():
  initial.write_text(json.dumps({'settings':{'DB_ID':'brawl-ville-local','AUTH_PEPPER':secrets.token_hex(32)},'sheets':json.loads((repo/'local-server/schema.json').read_text(encoding='utf-8')),'rows':[]},ensure_ascii=False),encoding='utf-8')
  print('Nouvelle base de jeu préparée, aucun ancien compte importé.')
print('Serveur autonome préparé :',dest)
