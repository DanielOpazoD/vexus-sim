"""Measured costal collision: move only the explicitly estimated spleen 5 mm medially.
No source organ/torso/vascular transform changes; other atlas bytes must be identical.
"""
from pathlib import Path
import json,gzip,hashlib,re,numpy as np
p=Path('src/anatomy/abdominal-atlas.gzip.bin');original=gzip.decompress(p.read_bytes())
if hashlib.sha256(original).hexdigest()!='1a963ba64c23ffec44da2cdf1cf1ded62e35aca8602ba5d9a5c14070e0796958':raise ValueError('This migration requires the original pinned atlas')
before=np.frombuffer(original,dtype='<f2').reshape((280,217,338,2));atlas=before.copy()
lo=np.array([55.,-93.,-130.5]);dims=np.array([65,65,88]);grid=np.indices(tuple(dims)).transpose(1,2,3,0)*1.5+lo
center=np.array([95.,-40.,-75.]);u=np.array([-.24,-.20,.95]);u/=np.linalg.norm(u);v=np.array([1.,0.,0.]);v-=u*np.dot(u,v);v/=np.linalg.norm(v);w=np.cross(u,v)
local=np.stack([(grid-center)@u,(grid-center)@v,(grid-center)@w],axis=-1)
outer=(np.linalg.norm(local/np.array([52.,20.,24.]),axis=-1)-1)*27
notch=(np.linalg.norm((grid-np.array([74.,-34.,-88.]))/np.array([14.,15.,34.]),axis=-1)-1)*14
distance=np.maximum(outer,-notch);field=np.stack([np.clip(distance,-64,16),np.ones(tuple(dims))],axis=-1).astype('<f2')
slices=(slice(119,207),slice(97,162),slice(178,243))
old=atlas[slices].copy();atlas[slices]=field.transpose(2,1,0,3)
unchanged=atlas.copy();unchanged[slices]=old
if not np.array_equal(unchanged,before):raise ValueError('Other organ bytes changed')
raw=atlas.tobytes();compressed=gzip.compress(raw,compresslevel=9,mtime=0);p.write_bytes(compressed)
data=Path('src/anatomy/abdominalAtlasData.ts');s=data.read_text();s=re.sub(r'gzipBytes: \d+',f'gzipBytes: {len(compressed)}',s,count=1)
for k,b in [('sha256Gzip',compressed),('sha256Raw',raw)]:s=re.sub(k+r": '[a-f0-9]+'",k+": '"+hashlib.sha256(b).hexdigest()+"'",s,count=1)
data.write_text(s)
jpath=Path('docs/anatomy/abdominal-atlas-manifest.json');j=json.loads(jpath.read_text());j.update({'gzipBytes':len(compressed),'sha256Gzip':hashlib.sha256(compressed).hexdigest(),'sha256Raw':hashlib.sha256(raw).hexdigest()})
j['estimatedSpleenCostalCorrection']={'translationMm':[-5,0,0],'reason':'Registered ribs 9/10 intersected estimated spleen (207 deep bone nodes, 3.18 mm penetration). Source liver, kidneys, pancreas and all other field bytes retained exactly.','oldCenterMm':[100,-40,-75],'newCenterMm':center.tolist()}
for f in j['fields']:
 if f['name']=='spleen':f['estimatedCenterMm']=center.tolist();f['representedVolumeMl']=float(np.count_nonzero(distance<0)*1.5**3/1000)
jpath.write_text(json.dumps(j,indent=2)+'\n')
print(j['estimatedSpleenCostalCorrection'])
