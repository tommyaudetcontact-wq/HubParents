"""Generate the private, one-time GAS bridge outside the public repository."""
import pathlib,json,sys
root=pathlib.Path(__file__).resolve().parents[1]
output=pathlib.Path(sys.argv[1]).resolve();output.mkdir(parents=True,exist_ok=True)
token=json.loads((root/'.private/migration.json').read_text())['token']
helper=(root/'scripts/migrate-apps-script.gs.template').read_text(encoding='utf-8').replace('__MIGRATION_TOKEN__',token)
code=(root/'Code-complet.gs').read_text(encoding='utf-8')
pending="if(properties().getProperty('SUPABASE_EXPORT_ATTEMPT'))return jsonResponse({ok:false,error:'Transfert Supabase en cours. Réessaie dans quelques instants.'});"
code=code.replace('function doPost(e) {',"function doPost(e) {\n  const migrated=properties().getProperty('MIGRATED_ENDPOINT');if(migrated)return forwardMigrated(e,migrated);"+pending,1)
code=code.replace('lock.waitLock(15000);',"lock.waitLock(15000);\n    const redirected=properties().getProperty('MIGRATED_ENDPOINT');if(redirected)return forwardMigrated(e,redirected);"+pending,1)
target=output/'Code-complet.gs';target.write_text(code+'\n'+helper,encoding='utf-8')
print(str(target))
