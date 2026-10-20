/* Door models are inventory items applied to structural openings. */
(function(C){
 C.doorModels=[{id:'door-basic',name:'Porte classique',price:0,body:'#b88958',frame:'#e3c9a0',design:'panels'},
 {id:'door-oak',name:'Porte en chêne',price:3,body:'#a57443',frame:'#d1ab78',design:'panels'},
 {id:'door-white',name:'Porte blanche moderne',price:4,body:'#e9ece7',frame:'#c5ccc6',design:'modern'},
 {id:'door-glass',name:'Porte vitrée atelier',price:5,body:'#375a63',frame:'#6a888d',design:'glass'}];
 C.doorModels.push(...[
 {id:'door-walnut',name:'Noyer à lames verticales',price:4,body:'#73503d',frame:'#aa8567',design:'planks'},
 {id:'door-pine',name:'Pin naturel à chevrons',price:4,body:'#c49c6e',frame:'#e2c69f',design:'chevron'},
 {id:'door-sage',name:'Porte sauge à persiennes',price:4,body:'#849b86',frame:'#c4cfb7',design:'louver'},
 {id:'door-navy',name:'Porte marine à hublot',price:5,body:'#3c5977',frame:'#93a5ad',design:'porthole'},
 {id:'door-art-deco',name:'Porte Art déco',price:6,body:'#354e52',frame:'#c1a66f',design:'deco'},
 {id:'door-frosted',name:'Vitrage dépoli',price:5,body:'#606c73',frame:'#bec9c9',design:'frosted'},
 {id:'door-cottage',name:'Porte de cottage',price:4,body:'#b97660',frame:'#eed7b6',design:'cottage'},
 {id:'door-loft',name:'Porte verrière quadrillée',price:6,body:'#343f48',frame:'#78878c',design:'loft'},
 {id:'door-arch',name:'Panneau arrondi',price:5,body:'#c5b4a0',frame:'#f1e5d3',design:'arch'},
 {id:'door-slats',name:'Lattes horizontales',price:3,body:'#bd9671',frame:'#dfc3a1',design:'slats'}]);
 C.catalog.push(...C.doorModels.filter(d=>d.price).map(d=>({...d,category:'door',icon:'🚪',color:d.body})));
 const upgrade=C.upgrade;C.upgrade=function(p){const out=upgrade(p);out.room.doorStyles=Object.fromEntries(Object.entries(out.room.doorStyles||{}).filter(([edge,id])=>out.room.doors.includes(edge)&&C.doorModels.some(d=>d.id===id)&&(id==='door-basic'||out.inventory.includes(id))));return out;};
 const apply=C.apply;C.apply=function(p,e,day,parent){if(e.type==='room'){const styles=e.room?.doorStyles||{};if(!styles||typeof styles!=='object'||Array.isArray(styles)||Object.keys(styles).length>100)throw Error('Modèles de portes invalides.');for(const [edge,id] of Object.entries(styles))if(!e.room.doors?.includes(edge)||!C.doorModels.some(d=>d.id===id)||id!=='door-basic'&&!p.inventory.includes(id))throw Error('Cette porte doit être achetée et posée sur une ouverture valide.');}const out=apply(p,e,day,parent);return e.type==='expand'?C.upgrade(out):out;};
})(typeof BrawlCore!=='undefined'?BrawlCore:require('./domain.js'));
