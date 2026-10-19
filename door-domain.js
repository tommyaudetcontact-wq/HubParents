/* Door models are inventory items applied to structural openings. */
(function(C){
 C.doorModels=[{id:'door-basic',name:'Porte classique',price:0,body:'#b88958',frame:'#e3c9a0',design:'panels'},
 {id:'door-oak',name:'Porte en chêne',price:3,body:'#a57443',frame:'#d1ab78',design:'panels'},
 {id:'door-white',name:'Porte blanche moderne',price:4,body:'#e9ece7',frame:'#c5ccc6',design:'modern'},
 {id:'door-glass',name:'Porte vitrée atelier',price:5,body:'#375a63',frame:'#6a888d',design:'glass'}];
 C.catalog.push(...C.doorModels.filter(d=>d.price).map(d=>({...d,category:'door',icon:'🚪',color:d.body})));
 const upgrade=C.upgrade;C.upgrade=function(p){const out=upgrade(p);out.room.doorStyles=Object.fromEntries(Object.entries(out.room.doorStyles||{}).filter(([edge,id])=>out.room.doors.includes(edge)&&C.doorModels.some(d=>d.id===id)&&(id==='door-basic'||out.inventory.includes(id))));return out;};
 const apply=C.apply;C.apply=function(p,e,day,parent){if(e.type==='room'){const styles=e.room?.doorStyles||{};if(!styles||typeof styles!=='object'||Array.isArray(styles)||Object.keys(styles).length>100)throw Error('Modèles de portes invalides.');for(const [edge,id] of Object.entries(styles))if(!e.room.doors?.includes(edge)||!C.doorModels.some(d=>d.id===id)||id!=='door-basic'&&!p.inventory.includes(id))throw Error('Cette porte doit être achetée et posée sur une ouverture valide.');}const out=apply(p,e,day,parent);return e.type==='expand'?C.upgrade(out):out;};
})(typeof BrawlCore!=='undefined'?BrawlCore:require('./domain.js'));
