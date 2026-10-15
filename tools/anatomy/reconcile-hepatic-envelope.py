"""Reconcile sub-grid cracks in the assembled hepatic envelope. Offline, explicit derivative.
Preserve the original source lattice and all other fields; record each added voxel.
"""
import argparse,gzip,hashlib,json
from pathlib import Path
import numpy as np
from scipy import ndimage

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--candidate-dir',type=Path,required=True)
args=parser.parse_args()
root=Path(__file__).resolve().parents[2]
m=json.loads((root/'docs/anatomy/abdominal-atlas-manifest.json').read_text())
compressed=(root/'src/anatomy/abdominal-atlas.gzip.bin').read_bytes()
raw=gzip.decompress(compressed)
if hashlib.sha256(raw).hexdigest()!=m['sha256Raw']:raise ValueError('Unexpected starting atlas')
a=np.frombuffer(raw,dtype='<f2').reshape(*m['textureDimensions'][::-1],2).copy()
f=m['fields'][4]
if f['name']!='liver' or f['pitchMm']!=1.5:raise ValueError('Unexpected hepatic descriptor')
x,y,z=f['offset'];nx,ny,nz=f['dimensions'];sl=(slice(z,z+nz),slice(y,y+ny),slice(x,x+nx))
o=a[sl][...,0]<0
candidate=ndimage.binary_closing(o,structure=ndimage.generate_binary_structure(3,1))
add=candidate&~o
coords=np.argwhere(add);world=np.array(f['originMm'])+coords[:,::-1]*1.5
# Every other source field may veto an addition; retain its original data unchanged.
veto=np.zeros(len(coords),dtype=bool)
for k,g in enumerate(m['fields']):
 if k==4:continue
 q=(world-np.array(g['originMm']))/1.5;idx=np.rint(q).astype(int)
 ok=np.all((idx>=0)&(idx<np.array(g['dimensions'])),axis=1)
 gx,gy,gz=g['offset'];v=idx[ok];veto[ok]|=a[gz+v[:,2],gy+v[:,1],gx+v[:,0],0]<0
add[tuple(coords[veto].T)]=False
union=o|add
before=ndimage.label(o)[1];after=ndimage.label(union)[1]
if after!=before or add.sum()>o.sum()*.01 or np.any(o&~union):raise ValueError('Hepatic reconciliation violates geometry bound')
d=ndimage.distance_transform_edt(~union,sampling=1.5)-.75
d[union]=-ndimage.distance_transform_edt(union,sampling=1.5)[union]+.75
a[sl][...,0]=np.clip(d,-64,16).astype('<f2')
# Exact bitwise guard outside the only modified brick (including every categorical label).
old=np.frombuffer(raw,dtype='<f2').reshape(a.shape)
mask=np.zeros(a.shape[:-1],dtype=bool);mask[sl]=True
if np.any(a[...,0][~mask]!=old[...,0][~mask]) or np.any(a[...,1]!=old[...,1]):raise ValueError('Another field/label changed')
newraw=a.tobytes();newgz=gzip.compress(newraw,compresslevel=9,mtime=0)
report={'method':'one-voxel six-neighbor closing; no original voxel removed; other viscera veto additions','pitchMm':1.5,'sourceAtlasSha256':m['sha256Raw'],'sourceVolumeMl':int(o.sum())*1.5**3/1000,'derivedVolumeMl':int(union.sum())*1.5**3/1000,'addedVolumeMl':int(add.sum())*1.5**3/1000,'componentsBefore':int(before),'componentsAfter':int(after),'vetoedOtherOrganPoints':int(veto.sum()),'addedVoxelIndicesZYX':np.argwhere(add).tolist()}
m['hepaticEnvelopeReconciliation']=report
f['representedVolumeMl']=report['derivedVolumeMl']
m.update({'gzipBytes':len(newgz),'sha256Raw':hashlib.sha256(newraw).hexdigest(),'sha256Gzip':hashlib.sha256(newgz).hexdigest()})
m['limitations']=[v.replace('No closing or artificial bridges.', 'No closing for digestive/posterior contact fields; hepatic envelope repair is separately recorded.') for v in m['limitations']]
m['limitations'].append('Hepatic segment envelope reconciled at 1.5 mm: all added voxels recorded; source meshes unchanged; not a clinical segmentation.')
args.candidate_dir.mkdir(exist_ok=True,parents=True)
(args.candidate_dir/'abdominal-atlas.bin.gz').write_bytes(newgz)
(args.candidate_dir/'abdominal-atlas-manifest.json').write_text(json.dumps(m,indent=2)+'\n')
for name,data in [('abdominal-body.bin',(root/'src/anatomy/abdominal-body.bin').read_bytes()),('abdominal-body-provenance.json',(root/'docs/anatomy/abdominal-body-provenance.json').read_bytes())]:
 (args.candidate_dir/name).write_bytes(data)
print(json.dumps({k:v for k,v in report.items() if k!='addedVoxelIndicesZYX'}),flush=True)
