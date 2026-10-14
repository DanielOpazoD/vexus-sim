"""Reconstruct unresolved renal/psoas contact in the pinned derived atlas.

ESTIMATED 2 mm envelope clearance, not a measurement from BodyParts3D.
Changes only the psoas SDF; source renal contours, bones, labels and packing stay fixed.
Run before build-abdominal-surface.ts. Input is explicit and hash checked, never cumulative.
"""
import argparse, gzip, hashlib, json
from pathlib import Path
import numpy as np

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--input', type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
manifest_path = root/'docs/anatomy/abdominal-atlas-manifest.json'
m = json.loads(manifest_path.read_text())
raw = gzip.decompress(args.input.read_bytes())
source_hash = hashlib.sha256(raw).hexdigest()
if source_hash != '9a16b1f550949b120dfdbfe5c688c0479625f2afcab8a3f7d452382499477dda':
    raise ValueError('Expected the unmodified bc01922 acoustic atlas')
w,h,d = m['textureDimensions']
a = np.frombuffer(raw,dtype='<f2').reshape(d,h,w,2).copy()
def brick(f):
    x,y,z=f['offset']; nx,ny,nz=f['dimensions']
    return a[z:z+nz,y:y+ny,x:x+nx,0]
p = m['fields'][9]; pb=brick(p); before=int(np.count_nonzero(pb<0)); changed=0
for g in [m['fields'][5],m['fields'][6]]:
    pitch=p['pitchMm']; po=np.array(p['originMm']); go=np.array(g['originMm'])
    lo=np.maximum(po,go); hi=np.minimum(po+(np.array(p['dimensions'])-1)*pitch,go+(np.array(g['dimensions'])-1)*pitch)
    starts=[np.rint((lo-o)/pitch).astype(int) for o in [po,go]]; size=np.rint((hi-lo)/pitch).astype(int)+1
    slices=[tuple(slice(int(v),int(v+n)) for v,n in zip(start[::-1],size[::-1])) for start in starts]
    old=pb[slices[0]].copy(); target=np.maximum(old, np.minimum(16,2.0-brick(g)[slices[1]]))
    changed+=int(np.count_nonzero(target!=old)); pb[slices[0]]=target
new_raw=a.tobytes(); compressed=gzip.compress(new_raw,compresslevel=9,mtime=0)
after=int(np.count_nonzero(pb<0))
if after<.9*before or after>before: raise ValueError('Unexpected psoas volume loss')
p['representedVolumeMl']=after*p['pitchMm']**3/1000
m['renalBedReconstruction']={'inputRawSha256':source_hash,'clearanceMm':2,'status':'ESTIMATED / NEEDS_CALIBRATION','method':'max(psoas SDF, 2 - renal SDF), source lattice; kidney unchanged','modifiedField':'psoas','changedSamples':changed,'sourceOccupiedCenters':before,'derivedOccupiedCenters':after,'removedVolumeMl':(before-after)*p['pitchMm']**3/1000,'reference':'https://training.seer.cancer.gov/kidney/anatomy/','limitation':'Source has no segmented renal fascia or perirenal fat; 2 mm is a bounded reconstruction, not a normal-population thickness.'}
m.update(rawBytes=len(new_raw),gzipBytes=len(compressed),sha256Raw=hashlib.sha256(new_raw).hexdigest(),sha256Gzip=hashlib.sha256(compressed).hexdigest())
(root/'src/anatomy/abdominal-atlas.gzip.bin').write_bytes(compressed)
manifest_path.write_text(json.dumps(m,indent=2)+'\n')
path=root/'src/anatomy/abdominalAtlasData.ts';s=path.read_text();start=s.index('export const ABDOMINAL_ATLAS = ');end=s.index(' as const;',start)
s=s[:start]+'export const ABDOMINAL_ATLAS = '+json.dumps({k:m[k] for k in ['textureDimensions','rawBytes','gzipBytes','sha256Gzip','sha256Raw']})+s[end:];path.write_text(s)
print(json.dumps(m['renalBedReconstruction'],indent=2))
