"""Build and sign the embedded city game, then publish its update on the PC server."""
from pathlib import Path
import subprocess,os,zipfile,hashlib,json,secrets,shutil,re,sys
repo=Path(__file__).resolve().parents[1]
project=repo/'android'
tools=Path(os.environ.get('BRAWL_ANDROID_TOOLS',str(repo.parent.parent/'apk-test-20261025/tools')))
jdk=next((tools/'jdk').iterdir());bt=next((tools/'build-tools').iterdir());platform=next((tools/'platform').iterdir());jar=platform/'android.jar'
out=project/'build';out.mkdir(exist_ok=True)
version=json.loads((project/'version.json').read_text(encoding='utf-8'))
preview=version['applicationId']=='com.brawlacademy.preview'
baseName='Brawl-Academy-3D' if preview else 'Brawl-Ville'
if '--bump' in sys.argv:
 version['versionCode']+=1;version['versionName']=('3D-0.'+str(version['versionCode'])) if preview else ('0.1.'+str(version['versionCode']-1))
 (project/'version.json').write_text(json.dumps(version,indent=2)+'\n',encoding='utf-8')
env={**os.environ,'JAVA_HOME':str(jdk)}
def run(*args):
 print('Build: '+Path(str(args[0])).name,flush=True);subprocess.run([str(a) for a in args],check=True,env=env)
# Only public assets are embedded. Private data, keys and server sources stay on the PC.
asset_root=(out/'assets').resolve()
if asset_root.exists():
 assert asset_root.parent == out.resolve() and asset_root.name == 'assets'
 shutil.rmtree(asset_root)
assets=asset_root/'game';assets.mkdir(parents=True,exist_ok=True)
allowed={'.js','.css','.html','.svg','.png','.jpg','.jpeg','.webp','.mp3','.ogg','.wav','.wasm','.ttf','.woff','.woff2','.gz'}
excluded={'.git','.private','node_modules','backend','backend-engine','supabase','local-server','scripts','android','books','data','data-ville','sauvegardes-ville','sauvegardes','journaux','releases'}
for p in repo.rglob('*'):
 rel=p.relative_to(repo)
 if not p.is_file() or any(part in excluded or part.startswith('.') for part in rel.parts) or (p.suffix.lower() not in allowed and not(rel.parts[0]=='vendor' and p.name.startswith('LICENSE'))):continue
 target=assets/rel;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,target)
html=(assets/'index.html').read_text(encoding='utf-8')
for src in re.findall(r'(?:src|href)="([^"?#]+)',html):
 if src.startswith(('https:','http:','#')):continue
 if not (assets/src).exists():raise RuntimeError('Asset manquant : '+src)
manifest=(project/'AndroidManifest.xml').read_text(encoding='utf-8')
manifest=re.sub(r'android:versionCode="[^"]+"','android:versionCode="'+str(version['versionCode'])+'"',manifest)
manifest=re.sub(r'android:versionName="[^"]+"','android:versionName="'+version['versionName']+'"',manifest)
(out/'AndroidManifest.xml').write_text(manifest,encoding='utf-8')
classes=out/'classes';classes.mkdir(exist_ok=True);dex=out/'dex';dex.mkdir(exist_ok=True)
run(jdk/'bin/javac.exe','-encoding','UTF-8','--release','8','-classpath',jar,'-d',classes,*project.glob('src/**/*.java'))
run(jdk/'bin/java.exe','-cp',bt/'lib/d8.jar','com.android.tools.r8.D8','--lib',jar,'--min-api','26','--output',dex,*classes.glob('**/*.class'))
run(bt/'aapt2.exe','compile','--dir',project/'res','-o',out/'resources.zip')
unsigned=out/'unsigned.apk'
run(bt/'aapt2.exe','link','-I',jar,'--manifest',out/'AndroidManifest.xml','--min-sdk-version','26','--target-sdk-version','35','-A',out/'assets','-o',unsigned,out/'resources.zip')
with zipfile.ZipFile(unsigned) as source,zipfile.ZipFile(out/'with-dex.apk','w') as z:
 for info in source.infolist():z.writestr(info,source.read(info.filename))
 for p in dex.glob('*.dex'):z.write(p,p.name,compress_type=zipfile.ZIP_DEFLATED)
run(bt/'zipalign.exe','-f','4',out/'with-dex.apk',out/'aligned.apk')
private=repo/'.private/android';private.mkdir(parents=True,exist_ok=True);key=private/'signing.p12';meta=private/'signing.json'
if not key.exists():
 password=secrets.token_urlsafe(32);meta.write_text(json.dumps({'password':password,'alias':'brawl-ville'}),encoding='utf-8')
 env['BRAWL_APK_KEY_PASSWORD']=password
 run(jdk/'bin/keytool.exe','-genkeypair','-keystore',key,'-storepass:env','BRAWL_APK_KEY_PASSWORD','-keypass:env','BRAWL_APK_KEY_PASSWORD','-storetype','PKCS12','-alias','brawl-ville','-keyalg','RSA','-keysize','2048','-validity','10000','-dname','CN=Brawl Ville Local')
info=json.loads(meta.read_text(encoding='utf-8'));env['BRAWL_APK_KEY_PASSWORD']=info['password']
desktop=Path(os.environ.get('BRAWL_ANDROID_OUTPUT',str(Path.home()/('Desktop/Brawl-Academy-3D' if preview else 'Desktop/Brawl-Ville-Android'))));desktop.mkdir(parents=True,exist_ok=True)
apk=desktop/(baseName+'-'+version['versionName']+'-'+str(version['versionCode'])+'.apk')
run(jdk/'bin/java.exe','-jar',bt/'lib/apksigner.jar','sign','--ks',key,'--ks-key-alias',info['alias'],'--ks-pass','env:BRAWL_APK_KEY_PASSWORD','--out',apk,out/'aligned.apk')
run(jdk/'bin/java.exe','-jar',bt/'lib/apksigner.jar','verify','--verbose',apk)
run(bt/'aapt2.exe','dump','badging',apk)
sha=hashlib.sha256(apk.read_bytes()).hexdigest();release={**version,'apkPath':'/app/apk','file':'Brawl-Ville.apk','sha256':sha,'size':apk.stat().st_size}
shutil.copy2(apk,desktop/(baseName+'.apk'));(desktop/'SHA256.txt').write_text(sha+'  '+apk.name+'\n',encoding='utf-8')
if not preview:
 server=Path(os.environ.get('BRAWL_PC_SERVER',str(Path.home()/'Desktop/Brawl-Serveur')));releaseDir=server/'releases';releaseDir.mkdir(parents=True,exist_ok=True)
 keyBackup=server/'cles-android';keyBackup.mkdir(exist_ok=True)
 shutil.copy2(key,keyBackup/'signing.p12');shutil.copy2(meta,keyBackup/'signing.json')
 shutil.copy2(apk,releaseDir/'Brawl-Ville.next.apk');os.replace(releaseDir/'Brawl-Ville.next.apk',releaseDir/'Brawl-Ville.apk')
 (releaseDir/'latest.next.json').write_text(json.dumps(release,indent=2),encoding='utf-8');os.replace(releaseDir/'latest.next.json',releaseDir/'latest.json')
(desktop/'LIRE-MOI.txt').write_text('Installer Brawl-Ville.apk sur Android 8 ou plus récent.\nLe serveur Brawl-Serveur sur le Bureau doit être lancé pour se connecter.\nLes mises à jour sont détectées auprès du serveur; Android demande confirmation pour les installer.\nLa clé de signature privée est conservée dans le projet .private/android et doit être conservée pour les prochaines versions.\n',encoding='utf-8')
if preview:
 (desktop/'LIRE-MOI.txt').write_text('PROTOTYPE 3D EXPERIMENTAL\nInstaller Brawl-Academy-3D.apk. Application separee de Brawl Ville 2D.\nLe serveur habituel Brawl-Serveur sur le Bureau doit etre lance. Les comptes et le multijoueur utilisent ce serveur.\nCette experience ne remplace pas les mises a jour de la version 2D.\nRetour 2D : ouvrir Brawl Ville (icone originale). Sauvegarde complete : Bureau/Brawl-Backup-2D-2026-10-27.\n',encoding='utf-8')
cmd='@echo off\r\n"'+sys.executable+'" "'+str(repo/'scripts/build-android.py')+'"'+' --bump'+'\r\npause\r\n'
(desktop/'PRODUIRE-NOUVELLE-VERSION.cmd').write_bytes(cmd.encode('utf-8'))
print('APK READY '+str(apk)+' ('+str(apk.stat().st_size)+' bytes)',flush=True)
