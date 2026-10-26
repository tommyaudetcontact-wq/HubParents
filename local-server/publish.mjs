import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),settings=JSON.parse(fs.readFileSync(path.join(root,'settings.json'),'utf8'));
const online=process.argv[2]==='online',origin=online?process.argv[3]:null;
if(online&&!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(origin))throw Error('Adresse de tunnel invalide.');
try{
 const output=execFileSync(settings.git||'git',['-C',settings.gitContext,'credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',stdio:['pipe','pipe','pipe'],windowsHide:true,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'Never'}});
 const credentials=Object.fromEntries(output.trim().split(/\r?\n/).map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));if(!credentials.password)throw Error('Identifiant GitHub absent.');
 const url='https://api.github.com/repos/tommyaudetcontact-wq/HubParents/contents/server-location.json',headers={'Authorization':'Bearer '+credentials.password,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'Brawl-local-launcher'},current=await fetch(url+'?ref=main',{headers});let sha;if(current.ok)sha=(await current.json()).sha;else if(current.status!==404)throw Error('Lecture GitHub refusée.');
 const manifest={online,origin,updatedAt:new Date().toISOString()},response=await fetch(url,{method:'PUT',headers,body:JSON.stringify({message:online?'Connect PC-hosted game server':'Mark PC-hosted game server offline',content:Buffer.from(JSON.stringify(manifest)+'\n').toString('base64'),branch:'main',...(sha?{sha}:{})})});
 if(!response.ok)throw Error('Mise à jour GitHub refusée ('+response.status+').');
 fs.writeFileSync(path.join(root,'data','publication.json'),JSON.stringify(manifest));console.log(online?'Le lien habituel du jeu est relié au PC.':'Le serveur est indiqué hors ligne.');
}catch{console.error('Impossible de mettre à jour le lien du jeu. Vérifie Internet et la connexion GitHub de ce PC. Aucun identifiant n’a été affiché.');process.exitCode=1;}
