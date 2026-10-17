'use strict';
window.HandwritingOCR=(()=>{
  let workerPromise;
  function worker(){
    if(location.protocol==='file:')throw Error('Pour lire ton écriture, ouvre l’application avec Lancer.cmd en mode web local (localhost).');
    if(!window.Tesseract)throw Error('Le moteur de lecture local est absent.');
    if(!workerPromise)workerPromise=Tesseract.createWorker('fra',1,{
      workerPath:new URL('vendor/ocr/worker.min.js',document.baseURI).href,
      corePath:new URL('vendor/ocr/',document.baseURI).href,
      langPath:new URL('vendor/ocr',document.baseURI).href,gzip:false,
      logger:m=>{const el=document.getElementById('hw-check');if(el&&m.status==='recognizing text')el.textContent='Lecture… '+Math.round(m.progress*100)+' %';}
    },{load_system_dawg:'0',load_freq_dawg:'0'}).catch(e=>{workerPromise=null;throw e;});
    return workerPromise;
  }
  function image(strokes){
    const canvas=document.createElement('canvas');canvas.width=canvas.height=384;const c=canvas.getContext('2d');c.fillStyle='white';c.fillRect(0,0,384,384);
    const pts=strokes.flat();if(!pts.length)return canvas;const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]),minX=Math.min(...xs),minY=Math.min(...ys),w=Math.max(...xs)-minX,h=Math.max(...ys)-minY,scale=260/Math.max(w,h,1),ox=(384-w*scale)/2,oy=(384-h*scale)/2;
    c.strokeStyle=c.fillStyle='black';c.lineCap=c.lineJoin='round';c.lineWidth=9;
    for(const s of strokes){if(!s.length)continue;c.beginPath();c.moveTo(ox+(s[0][0]-minX)*scale,oy+(s[0][1]-minY)*scale);for(const p of s)c.lineTo(ox+(p[0]-minX)*scale,oy+(p[1]-minY)*scale);c.stroke();if(s.length===1){c.beginPath();c.arc(ox+(s[0][0]-minX)*scale,oy+(s[0][1]-minY)*scale,4.5,0,Math.PI*2);c.fill();}}
    return canvas;
  }
  async function evaluateWord(segments,target){
    const geometric=HandwritingRecognizer.evaluateWord(segments,target),ocr=[];let w;
    for(let i=0;i<target.length;i++){
      if(geometric.results[i].accepted){ocr.push({text:'',confidence:0});continue;}
      if(geometric.results[i].reason==='empty'){ocr.push({text:'',confidence:0});continue;}
      w=w||await worker();
      // The whitelist contains the whole alphabet, never only the expected answer.
      await w.setParameters({tessedit_pageseg_mode:'10',tessedit_char_whitelist:/\d/.test(target[i])?'0123456789':HandwritingRecognizer.supported.filter(c=>!/[0-9]/.test(c)).join(''),user_defined_dpi:'300'});
      const ink=image(segments[i]),reads=[];for(const mode of ['10','8','13']){await w.setParameters({tessedit_pageseg_mode:mode});const {data}=await w.recognize(ink);reads.push({text:data.text.trim().normalize('NFC'),confidence:data.confidence});if(reads.at(-1).text===target[i])break;}const evidence=HandwritingRecognizer.accentEvidence?.(segments[i],target[i]);if(evidence?.valid&&evidence.body.length&&!reads.some(read=>read.text===target[i]&&read.confidence>=35)){const body=image(evidence.body);for(const mode of ['10','13']){await w.setParameters({tessedit_pageseg_mode:mode});const {data}=await w.recognize(body);reads.push({text:data.text.trim().normalize('NFC'),confidence:data.confidence});}}const matches=read=>read.text===target[i]||evidence?.valid&&read.text.normalize('NFD')[0]===target[i].normalize('NFD')[0]&&read.text.length===1;const exact=reads.filter(matches).sort((a,b)=>b.confidence-a.confidence)[0];ocr.push(exact||reads.sort((a,b)=>b.confidence-a.confidence)[0]);
    }
    return {result:HandwritingRecognizer.evaluateOCR(segments,target,ocr),ocr};
  }
  return {evaluateWord};
})();
