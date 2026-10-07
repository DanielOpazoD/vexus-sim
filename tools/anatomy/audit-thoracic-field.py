"""Independent original triangle/surface witnesses; never fitted to the field."""
import argparse,json,gzip
from pathlib import Path
import numpy as np,trimesh
from scipy.ndimage import map_coordinates
from costochondral_geometry import load_mesh,surface_samples,summary,TriangleQuery
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source-dir',type=Path,required=True);p.add_argument('--output',type=Path,required=True);args=p.parse_args()
j=json.loads(Path('docs/anatomy/thoracic-atlas-manifest.json').read_text());m=j['meta'];data=np.frombuffer(gzip.decompress(Path('src/anatomy/thoracic-atlas.gzip.bin').read_bytes()),dtype='<f2').reshape((*m['textureDimensions'][::-1],2)).astype(float)
result=[];meshes={}
for part in j['parts']:
 v,f=load_mesh(args.source_dir,part['id'],part['sha256']);mesh=trimesh.Trimesh(v,f,process=True);trimesh.repair.fill_holes(mesh);meshes[part['id']]=mesh
for part in j['parts']:
 v,f=load_mesh(args.source_dir,part['id'],part['sha256']);samples=surface_samples(v,f);samples=samples[np.linspace(0,len(samples)-1,min(1200,len(samples))).astype(int)]
 q=((samples-m['originMm'])/m['pitchMm']).T[::-1];d=map_coordinates(data[...,0],q,order=1,mode='constant',cval=16)
 original=summary(np.abs(d));innerLabel=map_coordinates(data[...,1],q,order=0,mode='constant',cval=0)
 entry={'id':part['id'],'name':part['name'],'originalSurfaceErrorMm':original,'boundsMm':np.array([v.min(axis=0),v.max(axis=0)]).tolist(),'components':part['components'],'labelAgreement':float(np.mean(innerLabel==part['label']))}
 # Separately audit surfaces exposed in the source union. A source joint surface
 # contained inside a different original part is not the union's exterior.
 # Containment uses original meshes, never field distances or labels.
 covered=np.zeros(len(samples),dtype=bool)
 for id,mesh in meshes.items():
  if id==part['id']:continue
  eligible=np.flatnonzero(np.all(samples>=mesh.bounds[0],axis=1)&np.all(samples<=mesh.bounds[1],axis=1))
  if len(eligible):covered[eligible]|=mesh.contains(samples[eligible])
 entry['sourceCoveredSurfaceWitnesses']=int(covered.sum())
 entry['exposedSourceSurfaceErrorMm']=summary(np.abs(d[~covered])) if np.any(~covered) else None
 # Original position witness in the medial head neighborhood, not joint-gap certification.
 if ' rib' in part['name']:
  medial=np.argmin(np.abs(v[:,0]));head=v[medial];entry['medialSourceWitnessMm']=head.tolist()
 result.append(entry);print(part['name'],original['p95'],original['max'],flush=True)
report={'fieldSha256':m['sha256Raw'],'pitchMm':m['pitchMm'],'parts':result,'sourceSurfaceMaximumMm':max(e['originalSurfaceErrorMm']['max']for e in result),'ribSurfaceMaximumMm':max(e['originalSurfaceErrorMm']['max']for e in result if ' rib' in e['name']),'exposedSourceSurfaceMaximumMm':max(e['exposedSourceSurfaceErrorMm']['max']for e in result if e['exposedSourceSurfaceErrorMm']),'method':'Original source vertices and triangle centroids, deterministic held-out sample; trilinear field. Original-mesh containment separately identifies source surfaces internal to another part. Both raw and exposed metrics are retained; no acceptance thresholds fitted to these witnesses.'}
args.output.write_text(json.dumps(report,indent=2))
