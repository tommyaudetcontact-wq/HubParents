import { createHash, createHmac, randomUUID } from 'node:crypto';
import {Buffer} from 'node:buffer';

// Sequential callbacks preserve the original order of dependent account writes.
export async function asyncArray(method, array, fn) {
  const out=[];
  for(let i=0;i<array.length;i++) {
    if(!(i in array))continue;
    const result=await fn(array[i],i,array);
    if(method==='map')out.push(result);
    else if(method==='filter'&&result)out.push(array[i]);
    else if(method==='find'&&result)return array[i];
    else if(method==='findIndex'&&result)return i;
    else if(method==='some'&&result)return true;
    else if(method==='every'&&!result)return false;
  }
  if(method==='some')return false;
  if(method==='every')return true;
  if(method==='findIndex')return -1;
  if(method==='find'||method==='forEach')return undefined;
  return out;
}

export function runtime(sql, initialSettings={}) {
  const settings=new Map(Object.entries(initialSettings)), cache=new Map(), sheets=new Map();
  const properties={
    getProperty:key=>settings.get(key)??null,
    async setProperty(key,value){settings.set(key,String(value));await sql`insert into brawl_private.settings (key,value) values (${key},${String(value)}) on conflict(key) do update set value=excluded.value`;return properties;},
    async deleteProperty(key){settings.delete(key);await sql`delete from brawl_private.settings where key=${key}`;},
  };
  const cacheService={
    async get(key){if(cache.has(key))return cache.get(key);const rows=await sql`select value from brawl_private.cache where key=${key} and expires_at>now()`;const value=rows[0]?.value??null;cache.set(key,value);return value;},
    async put(key,value,ttl){cache.set(key,String(value));await sql`insert into brawl_private.cache(key,value,expires_at) values(${key},${String(value)},now()+${ttl}*interval '1 second') on conflict(key) do update set value=excluded.value,expires_at=excluded.expires_at`;},
    async remove(key){cache.delete(key);await sql`delete from brawl_private.cache where key=${key}`;},
  };
  class Sheet {
    constructor(name,headers){this.name=name;this.headers=headers;this.loaded=null;}
    async load(){if(!this.loaded){const rows=await sql`select row_no,cells from brawl_private.rows where sheet=${this.name} order by row_no`;this.loaded=[this.headers,...rows.map(r=>r.cells)];}return this.loaded;}
    async getLastRow(){if(this.loaded)return this.loaded.length;const [r]=await sql`select coalesce(max(row_no),1) as n from brawl_private.rows where sheet=${this.name}`;return Number(r.n);}
    getRange(row,col,rows=1,cols=1){return new Range(this,row,col,rows,cols);}
    getDataRange(){return new Range(this,1,1,null,null);}
    async appendRow(values){if(!this.headers.length){this.headers=values;this.loaded=null;await sql`insert into brawl_private.sheets(name,headers) values(${this.name},${sql.json(values)}) on conflict(name) do update set headers=excluded.headers`;return;}const row=(await this.getLastRow())+1;this.loaded=null;await sql`insert into brawl_private.rows(sheet,row_no,cells) values(${this.name},${row},${sql.json(values)})`;}
    async deleteRow(row){if(row<2)throw Error('En-tête protégé.');this.loaded=null;await sql`delete from brawl_private.rows where sheet=${this.name} and row_no=${row}`;await sql`update brawl_private.rows set row_no=row_no-1 where sheet=${this.name} and row_no>${row}`;}
    setFrozenRows(){return this;}
  }
  class Range {
    constructor(sheet,row,col,rows,cols){Object.assign(this,{sheet,row,col,rows,cols});}
    async getValues(){const count=this.rows??await this.sheet.getLastRow(),width=this.cols??this.sheet.headers.length;
      const rows=await sql`select row_no,coalesce((select jsonb_agg(value order by ord) from jsonb_array_elements(cells) with ordinality a(value,ord) where ord>=${this.col} and ord<${this.col+width}),'[]'::jsonb) as cells from brawl_private.rows where sheet=${this.sheet.name} and row_no>=${Math.max(2,this.row)} and row_no<${this.row+count} order by row_no`;
      const byRow=new Map(rows.map(r=>[r.row_no,r.cells]));return Array.from({length:count},(_,i)=>{const row=this.row+i;if(row===1)return Array.from({length:width},(_,j)=>this.sheet.headers[this.col+j-1]??'');const values=byRow.get(row)||[];return Array.from({length:width},(_,j)=>values[j]??'');});}
    async setValues(values){if(this.row<2)throw Error('En-tête protégé.');this.sheet.loaded=null;for(let i=0;i<values.length;i++){const row=this.row+i;const existing=await sql`select cells from brawl_private.rows where sheet=${this.sheet.name} and row_no=${row}`;const next=existing[0]?.cells.slice()||Array(this.sheet.headers.length).fill('');for(let j=0;j<values[i].length;j++)next[this.col+j-1]=values[i][j];const updated=await sql`update brawl_private.rows set cells=${sql.json(next)} where sheet=${this.sheet.name} and row_no=${row} returning row_no`;if(!updated.length)await sql`insert into brawl_private.rows(sheet,row_no,cells) values(${this.sheet.name},${row},${sql.json(next)})`;}}
    async setValue(value){return this.setValues([[value]]);}
  }
  const db={
    getSheetByName:name=>sheets.get(name)??null,
    async insertSheet(name){const sheet=new Sheet(name,[]);sheet.loaded=[];sheets.set(name,sheet);return sheet;},
  };
  const Utilities={
    getUuid:randomUUID,
    DigestAlgorithm:{SHA_256:'sha256'},
    computeDigest:(_algorithm,value)=>createHash('sha256').update(String(value)).digest(),
    computeHmacSha256Signature:(value,key)=>createHmac('sha256',key).update(String(value)).digest(),
    base64Encode:value=>Buffer.from(value).toString('base64'),
    formatDate(date,timeZone,format){if(format!=='yyyy-MM-dd')throw Error('Format de date non pris en charge.');const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);const get=k=>parts.find(p=>p.type===k).value;return `${get('year')}-${get('month')}-${get('day')}`;},
  };
  return {
    async initialize(){const rows=await sql`select name,headers from brawl_private.sheets`;for(const r of rows)sheets.set(r.name,new Sheet(r.name,r.headers));},
    PropertiesService:{getScriptProperties:()=>properties},CacheService:{getScriptCache:()=>cacheService},
    SpreadsheetApp:{openById:()=>db,flush:()=>{}},
    // The enclosing PostgreSQL transaction owns the advisory lock until commit/rollback.
    LockService:{getScriptLock:()=>({waitLock(){},hasLock:()=>false,releaseLock(){}})},
    ContentService:{MimeType:{JSON:'application/json'},createTextOutput:text=>({setMimeType:()=>JSON.parse(text)})},
    Utilities,
  };
}
