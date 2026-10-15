"""Generate independent original-mesh interior and intercostal-space witnesses."""
from pathlib import Path
import argparse,json,numpy as np,trimesh
from costochondral_geometry import load_mesh,TriangleQuery
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--source-dir',type=Path,required=True);args=parser.parse_args()
j=json.loads(Path('docs/anatomy/thoracic-source-manifest.json').read_text());source=args.source_dir
parts=[p for p in j['parts']if ' rib' in p['name'] or 'thoracic vertebra' in p['name'] or 'costal cartilage' in p['name'] or p['name']in['body of sternum','manubrium','xiphoid process']]
meshes={};oracles={};witnesses=[]
for p in parts:
 v,f=load_mesh(source,p['id'],p['sha256']);m=trimesh.Trimesh(v,f,process=True);trimesh.repair.fill_holes(m);meshes[p['id']]=m;oracles[p['id']]=TriangleQuery(v,f)
 if ' rib' not in p['name']:continue
 centers=m.triangles_center;ids=np.linspace(0,len(centers)-1,120).astype(int);points=centers[ids]-1.5*m.face_normals[ids];inside=m.contains(points)
 ds=oracles[p['id']].distance(points);indices=np.flatnonzero(inside&(ds>1.4))
 if len(indices)<4:raise ValueError('Insufficient independent interiors '+p['id'])
 chosen=indices[np.linspace(0,len(indices)-1,4).astype(int)]
 witnesses.extend({'id':p['id'],'name':p['name'],'p':points[i].tolist(),'sourceSurfaceDistanceMm':float(ds[i])}for i in chosen)
spaces=[]
for side in ['right','left']:
 order=['first','second','third','fourth','fifth','sixth','seventh','eighth','ninth','tenth','eleventh','twelfth'];ribs=[next(p for p in parts if p['name']==side+' '+number+' rib')for number in order]
 for a,b in zip(ribs,ribs[1:]):
  # Corresponding physical anterior/lateral/posterior bearings, not voxel nodes.
  for y in [-75.,-21.,35.]:
   target=np.array([-110. if side=='right' else 110.,y]);vs=[]
   for p in [a,b]:
    v=meshes[p['id']].vertices;i=np.argmin(np.linalg.norm(v[:,:2]-target,axis=1));vs.append(v[i])
   point=(vs[0]+vs[1])/2
   inside=any(bool(m.contains([point])[0])for m in meshes.values()if np.all(point>=m.bounds[0])and np.all(point<=m.bounds[1]))
   if inside:continue
   distance=min(o.distance([point])[0]for o in oracles.values())
   if distance>3:spaces.append({'ribs':[a['name'],b['name']],'p':point.tolist(),'sourceSurfaceDistanceMm':float(distance)})
report={'sourceArchiveSha256':j['archiveSha256'],'boneInterior':witnesses,'intercostalSpaces':spaces,'method':'Independent original triangle geometry and closed-mesh containment, without acoustic field access; 1.5 mm inward witnesses and spaces >3 mm from all source surfaces.'}
Path('docs/anatomy/costal-heldout-witnesses.json').write_text(json.dumps(report,indent=2)+'\n');print('witnesses',len(witnesses),'spaces',len(spaces))
