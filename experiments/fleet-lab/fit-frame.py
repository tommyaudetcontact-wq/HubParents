"""Bounded camera-frame alignment only; outputs a browser clip, never edits image/model."""
import argparse,json,sys
from pathlib import Path
sys.path.insert(0,'C:/Users/recto/.codex/skills/img2threejs/forge/stage4_review')
from diagnose_render import load_mask,bbox_of
from extract_pbr_evidence import load_image,build_foreground_mask
q=argparse.ArgumentParser();q.add_argument('family');q.add_argument('--prefix',default='blockout');a=q.parse_args();b=Path(__file__).parent/'families'/a.family
ref,_=load_mask(b/'reference-regions/canonical.png',32);w,h,pix,_=load_image(b/(a.prefix+'-full.png'));mask,_,_=build_foreground_mask(w,h,pix);rb=bbox_of(ref,32);ra=(rb[2]-rb[0]+1)/(rb[3]-rb[1]+1);rArea=sum(ref);best=(-1,None)
for x in range(265,386,10):
 for y in range(195,281,10):
  for cw in range(610,771,20):
   for ch in range(270,411,20):
    if y+ch>=h:continue
    inter=union=0;temp=[]
    for j in range(32):
     off=(y+int(j*ch/32))*w
     for i in range(32):
      v=mask[off+x+int(i*cw/32)];r=ref[j*32+i];temp.append(v);inter+=v and r;union+=v or r
    bb=bbox_of(temp,32);ar=(bb[2]-bb[0]+1)/(bb[3]-bb[1]+1);aspect=abs(ar-ra)/ra
    score=inter/max(1,union)-max(0,aspect-.035)*.5
    if score>best[0]:best=(score,{'x':x,'y':y,'width':cw,'height':ch,'estimatedIoU':inter/max(1,union),'aspectDelta':aspect})
out={'reference':str(b/'reference-regions/canonical.png'),'screenshot':str(b/(a.prefix+'-full.png')),'clip':best[1],'note':'Deterministic framing helper only; requires fresh browser capture and independent visual judgment.'};(b/(a.prefix+'-framing.json')).write_text(json.dumps(out,indent=2),encoding='utf8');print(a.family,best[1])
