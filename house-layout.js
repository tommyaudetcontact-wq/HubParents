'use strict';
window.HouseLayout=(()=>{
 const navHeight=64,gap=12;
 function regions(width,height,safeBottom=0,safeTop=0){const bottom=8+safeBottom,nav={left:8,right:width-8,top:height-bottom-navHeight,bottom:height-bottom},content={left:8,right:width-8,top:108+safeTop,bottom:nav.top-gap};return {nav,content,reserved:bottom+navHeight+gap};}
 function orbit(a,p){const stage=a.c.parentElement,r=stage.getBoundingClientRect(),viewport=window.visualViewport,top=viewport?.offsetTop||0,height=viewport?.height||window.innerHeight||r.height,nav=stage.querySelector?.('.house-bottom-nav')?.getBoundingClientRect?.(),limit=nav&&Number.isFinite(nav.top)?nav.top-gap:top+height-84;const minY=top-r.top+184,maxY=limit-r.top-111;return {visible:maxY>=minY,x:Math.max(76,Math.min((stage.clientWidth||r.width)-76,p.x)),y:Math.max(minY,Math.min(maxY,p.y-30))};}
 return {regions,orbit,navHeight,gap};
})();
