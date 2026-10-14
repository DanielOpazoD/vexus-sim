"""Reconstruct unresolved renal/psoas contact in the pinned derived atlas.

ESTIMATED 2 mm envelope clearance, not a measurement from BodyParts3D.
Regularizes renal/psoas voxel stair steps before reconstructing their separation.
Bones, other organs, labels and packing stay fixed. Not new anatomical segmentation.
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
regularization=[]
for field in [5,6,9]:
    f=m['fields'][field]; b=brick(f); original=b.astype(np.float32)
    # One source voxel (1.5 mm) sigma: suppress lattice stair steps, retain the
    # bean-shaped hilum and longitudinal muscle contour. No new fine detail.
    smooth=original.copy(); radius=3
    kernel=np.exp(-np.arange(-radius,radius+1,dtype=np.float32)**2/2); kernel/=kernel.sum()
    for axis in range(3):
        pad=[(0,0)]*3; pad[axis]=(radius,radius)
        padded=np.pad(smooth,pad,mode='edge'); filtered=np.zeros_like(smooth)
        for j,weight in enumerate(kernel):
            sl=[slice(None)]*3; sl[axis]=slice(j,j+smooth.shape[axis])
            filtered+=weight*padded[tuple(sl)]
        smooth=filtered
    occupied=int(np.count_nonzero(original<0))
    # Preserve the number of occupied voxel centres before the clearance step.
    # Bound field displacement to one voxel, including the volume correction.
    threshold=float(np.partition(smooth.ravel(),occupied)[occupied])
    # Smooth only the near-surface band; retain the distant source field and its
    # compact encoding. 1/64 mm quantization is <1.1% of source voxel pitch.
    taper=np.clip((8-np.abs(original))/4,0,1)
    candidate=original+np.clip(smooth-threshold-original,-1.5,1.5)*taper
    b[:]=np.where(taper>0,np.round(candidate*64)/64,original)
    after=int(np.count_nonzero(b<0)); delta=np.abs(b.astype(np.float32)-original)
    band=np.abs(original)<3
    if abs(after-occupied)>occupied*.01: raise ValueError('Regularization changed volume >1%')
    f['representedVolumeMl']=after*f['pitchMm']**3/1000
    regularization.append({'field':f['name'],'sigmaMm':f['pitchMm'],'maxFieldChangeMm':float(delta.max()),'surfaceBandP95ChangeMm':float(np.percentile(delta[band],95)),'sourceOccupiedCenters':occupied,'smoothedOccupiedCenters':after,'volumeOffsetMm':threshold})
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
m['renalBedReconstruction']={'inputRawSha256':source_hash,'clearanceMm':2,'status':'ESTIMATED / NEEDS_CALIBRATION','method':'bounded Gaussian regularization, then max(psoas SDF, 2 - renal SDF); shared acoustic and 3D fields','modifiedFields':['kidneyRight','kidneyLeft','psoas'],'regularization':regularization,'changedSamples':changed,'sourceOccupiedCenters':before,'derivedOccupiedCenters':after,'removedVolumeMl':(before-after)*p['pitchMm']**3/1000,'reference':'https://training.seer.cancer.gov/kidney/anatomy/','limitation':'Source has no segmented renal fascia or perirenal fat; 2 mm is a bounded reconstruction, not a normal-population thickness. Regularization suppresses lattice artifacts, not a patient-specific shape correction.'}
m.update(rawBytes=len(new_raw),gzipBytes=len(compressed),sha256Raw=hashlib.sha256(new_raw).hexdigest(),sha256Gzip=hashlib.sha256(compressed).hexdigest())
(root/'src/anatomy/abdominal-atlas.gzip.bin').write_bytes(compressed)
manifest_path.write_text(json.dumps(m,indent=2)+'\n')
path=root/'src/anatomy/abdominalAtlasData.ts';s=path.read_text();start=s.index('export const ABDOMINAL_ATLAS = ');end=s.index(' as const;',start)
s=s[:start]+'export const ABDOMINAL_ATLAS = '+json.dumps({k:m[k] for k in ['textureDimensions','rawBytes','gzipBytes','sha256Gzip','sha256Raw']})+s[end:];path.write_text(s)
print(json.dumps(m['renalBedReconstruction'],indent=2))
