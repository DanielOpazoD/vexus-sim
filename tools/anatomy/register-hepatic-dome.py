"""Explicit normal-contact derivative; never moves source organs or fills their gaps.
Uses a free RG16F slice of the existing atlas. Requires numpy/scipy offline only.
"""
import gzip, hashlib, json
from pathlib import Path
import numpy as np
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
manifest_path = ROOT/'docs/anatomy/abdominal-atlas-manifest.json'
m = json.loads(manifest_path.read_text())
raw = gzip.decompress((ROOT/'src/anatomy/abdominal-atlas.gzip.bin').read_bytes())
if hashlib.sha256(raw).hexdigest() != m['sha256Raw']:
    raise ValueError('Unexpected source atlas')
a = np.frombuffer(raw, dtype='<f2').reshape(*m['textureDimensions'][::-1], 2).copy()
f = m['fields'][4]
x,y,z = f['offset']; nx,ny,nz = f['dimensions']
d = a[z:z+nz,y:y+ny,x:x+nx,0].astype(float)
inside = d < 0
valid = inside.any(axis=0)
k = nz-1-np.argmax(inside[::-1],axis=0)
yy,xx = np.indices(k.shape)
v = d[k,yy,xx]; w = d[np.minimum(k+1,nz-1),yy,xx]
roof = f['originMm'][2]+1.5*(k-np.divide(v,w-v,out=np.zeros_like(v),where=w!=v))
nearest = ndimage.distance_transform_edt(~valid,return_distances=False,return_indices=True)
roof[~valid] = roof[tuple(nearest[:,~valid])]
# The outer muscle boundary follows the hepatic +2.5 mm distance level, a parallel
# offset of the SAME field. A vertical roof + thickness*slope is only first order
# and failed the independent curved-surface witness; do not tune a local bias.
muscle_inside = d < 2.5
mk = nz-1-np.argmax(muscle_inside[::-1],axis=0)
mv=d[mk,yy,xx]-2.5; mw=d[np.minimum(mk+1,nz-1),yy,xx]-2.5
upper=f['originMm'][2]+1.5*(mk-np.divide(mv,mw-mv,out=np.zeros_like(mv),where=mw!=mv))
upper[~valid]=upper[tuple(nearest[:,~valid])]
smooth=ndimage.gaussian_filter(upper,.5,mode='nearest')
gy,gx = np.gradient(ndimage.gaussian_filter(roof,.5,mode='nearest'),1.5)
slope = np.sqrt(1+gx*gx+gy*gy)
def step(lo,hi,v):
    t = np.clip((v-lo)/(hi-lo),0,1)
    return t*t*(3-2*t)
border = ndimage.distance_transform_edt(valid,sampling=1.5)
weight = step(2,12,border)*step(-80,-50,roof)*step(.3,.7,1/slope)
contact = np.stack([smooth,weight],axis=-1).astype('<f2')
offset = [178,97,258]
cx,cy,cz = offset
if contact.shape != (120,154,2):
    raise ValueError('Unexpected hepatic map dimensions')
for g in m['fields']:
    lo=np.array(g['offset']); hi=lo+g['dimensions']
    if np.all(np.array(offset)<hi) and np.all(np.array(offset)+[nx,ny,1]>lo):
        raise ValueError('Contact map overlaps an organ field')
a[cz,cy:cy+ny,cx:cx+nx] = contact
newraw = a.tobytes()
old = np.frombuffer(raw,dtype='<f2').reshape(a.shape)
for g in m['fields']:
    gx,gy,gz=g['offset'];gnx,gny,gnz=g['dimensions']
    if not np.array_equal(old[gz:gz+gnz,gy:gy+gny,gx:gx+gnx],a[gz:gz+gnz,gy:gy+gny,gx:gx+gnx]):
        raise ValueError('Source organ or label changed')
compressed = gzip.compress(newraw,compresslevel=9,mtime=0)
m['hepaticDiaphragmRegistration']={'method':'superior crossing of the SAME hepatic +2.5 mm SDF level; muscle height smoothing sigma 0.75 mm; bounded superior/normal/border transition','sourceAtlasSha256':m.get('hepaticDiaphragmRegistration',{}).get('sourceAtlasSha256',m['sha256Raw']),'originMm':f['originMm'][:2],'dimensions':[nx,ny],'offset':offset,'pitchMm':1.5,'heightChannel':0,'supportChannel':1,'organFieldsBitwiseUnchanged':True,'clinicalValidation':False,'sourceDiaphragmIntegrated':False}
m.update({'gzipBytes':len(compressed),'sha256Raw':hashlib.sha256(newraw).hexdigest(),'sha256Gzip':hashlib.sha256(compressed).hexdigest()})
(ROOT/'src/anatomy/abdominal-atlas.gzip.bin').write_bytes(compressed)
manifest_path.write_text(json.dumps(m,indent=2)+'\n')
descriptor = ROOT/'src/anatomy/abdominalAtlasData.ts'
s=descriptor.read_text()
for key in ['gzipBytes','sha256Raw','sha256Gzip']:
    import re
    s=re.sub(r"("+key+r": )('[^']*'|\d+)",lambda q:q[1]+(repr(m[key]) if isinstance(m[key],str) else str(m[key])),s,count=1)
if 'export const HEPATIC_DOME' not in s:
    s+='\n/** Estimated normal contact, not a segmented diaphragm. RG = height mm / support. */\nexport const HEPATIC_DOME = { originMm: [-124.5, -87], dimensions: [154, 120], offset: [178, 97, 258], pitchMm: 1.5 } as const;\n'
descriptor.write_text(s)
print(json.dumps({'rawSha256':m['sha256Raw'],'gzipBytes':len(compressed),'organFieldsBitwiseUnchanged':True}))
