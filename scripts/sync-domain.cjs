const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const names=['cards-data','domain','parent-domain','appearance-domain','furniture-domain','household-domain','progression-domain','sim-domain','card-domain','door-domain','house-domain','city-domain'];
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
fs.writeFileSync(path.join(root,'backend/Domain.gs'),names.map(n=>read(n+'.js')).join('\n'));
fs.writeFileSync(path.join(root,'Code-complet.gs'),['Domain','Handwriting','Trades','Accounts','Lobby','Auth','Stats','City','WordLists','Code'].map(n=>read('backend/'+n+'.gs')).join('\n\n'));
console.log('Shared domain and backend fixtures synchronized.');
