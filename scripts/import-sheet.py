"""Read-only XLSX export; emit SQL for the authorized private Supabase schema.
No credential/profile data is written into the repository or printed in summaries.
"""
import argparse, datetime, hashlib, json, pathlib, secrets
import openpyxl

def extract(source):
    workbook=openpyxl.load_workbook(source,read_only=True,data_only=True)
    result=[]
    def clean(value):
        if value is None:return ''
        if isinstance(value,(datetime.datetime,datetime.date)):return value.isoformat()
        return value
    for sheet in workbook:
        rows=[[clean(v) for v in row] for row in sheet.iter_rows(values_only=True)]
        if not rows or not all(isinstance(h,str) and h for h in rows[0]):raise ValueError('En-têtes invalides: '+sheet.title)
        result.append(dict(name=sheet.title,headers=rows[0],rows=[r for r in rows[1:] if any(v!='' for v in r)]))
    if len(result)!=16:raise ValueError('Export incomplet: 16 onglets attendus')
    profiles=next(s for s in result if s['name']=='Profils')['rows']
    fragments=next(s for s in result if s['name']=='EtatsProfils')['rows']
    for row in profiles:
        p=json.loads(row[3])
        if '_chunks' in p:
            pieces=sorted((r for r in fragments if r[0]==p['_chunks']),key=lambda r:r[1])
            if len(pieces)!=p['count'] or any(int(r[1])!=i for i,r in enumerate(pieces)):raise ValueError('Fragments incomplets')
            p=json.loads(''.join(r[2] for r in pieces))
        if p.get('id')!=row[0]:raise ValueError('Identifiant du profil incohérent')
    return result

def quote(value):return "'"+str(value).replace("'","''")+"'"
def json_sql(value):return quote(json.dumps(value,ensure_ascii=False,separators=(',',':')))+'::jsonb'

def main():
    parser=argparse.ArgumentParser();parser.add_argument('source');parser.add_argument('--sql',action='store_true');args=parser.parse_args()
    sheets=extract(args.source)
    summary={s['name']:len(s['rows']) for s in sheets}
    if not args.sql:print(json.dumps(summary));return
    root=pathlib.Path(__file__).resolve().parents[1];private=root/'.private';private.mkdir(exist_ok=True)
    secret_file=private/'migration.json'
    if secret_file.exists():secret=json.loads(secret_file.read_text())
    else:
        secret={'token':secrets.token_urlsafe(48),'expires':int((datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=7)).timestamp()*1000)}
        secret_file.write_text(json.dumps(secret))
    statements=['begin;','select pg_advisory_xact_lock(7816017);']
    # The initial import is deliberately one-shot. Existing rows must not be overwritten.
    statements.append("do $$ begin if exists(select 1 from brawl_private.rows) then raise exception 'Import déjà présent'; end if; end $$;")
    for sheet in sheets:
        statements.append('insert into brawl_private.sheets(name,headers) values('+quote(sheet['name'])+','+json_sql(sheet['headers'])+');')
        if sheet['rows']:
            statements.append('insert into brawl_private.rows(sheet,row_no,cells) values '+','.join('('+quote(sheet['name'])+','+str(i+2)+','+json_sql(row)+')' for i,row in enumerate(sheet['rows']))+';')
    settings={'DB_ID':'supabase','DB_SCHEMA':'3','AUTH_SCHEMA_VERSION':'2','MIGRATION_TOKEN_HASH':hashlib.sha256(secret['token'].encode()).hexdigest(),'MIGRATION_EXPIRES':str(secret['expires'])}
    statements.append('insert into brawl_private.settings(key,value) values '+','.join('('+quote(k)+','+quote(v)+')' for k,v in settings.items())+';')
    statements.append('commit;')
    print(json.dumps({'query':'\n'.join(statements),'summary':summary},ensure_ascii=False))
if __name__=='__main__':main()
