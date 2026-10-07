"""Offline common-frame skeletal field; pinned BP3D meshes, no individual transforms."""
from pathlib import Path
import gzip, hashlib, json, zipfile, argparse
import numpy as np
import trimesh
from scipy import ndimage
from costochondral_geometry import TriangleQuery
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source-dir',type=Path,required=True)
parser.add_argument('--output-dir',type=Path,required=True)
args=parser.parse_args();SOURCE=args.source_dir;OUT=args.output_dir;OUT.mkdir(exist_ok=True)
manifest=json.loads(Path('docs/anatomy/thoracic-source-manifest.json').read_text())
if hashlib.sha256((SOURCE/'partof_BP3D_4.0_obj_99.zip').read_bytes()).hexdigest()!=manifest['archiveSha256']:raise ValueError('Unpinned archive')
PITCH=1.5
ORIGIN=np.array([-.3152345,-205.92635,1164.5735]);parts_report=[]
def interior_voxels(mesh):
 pitch=PITCH
 lo=np.floor(mesh.bounds[0]/pitch)*pitch;hi=np.ceil(mesh.bounds[1]/pitch)*pitch
 dims=np.rint((hi-lo)/pitch).astype(int)+1
 xy=np.indices(tuple(dims[:2])).transpose(1,2,0).reshape(-1,2)*pitch+lo[:2]
 # Sub-nanometre deterministic offset avoids a ray through a mesh vertex/edge.
 # It has no meaningful anatomical scale and is checked against contains below.
 origins=np.column_stack([xy+np.array([1.23e-7,2.34e-7]),np.full(len(xy),lo[2]-pitch)])
 all_points=[]
 z=np.arange(dims[2])*pitch+lo[2]
 for start in range(0,len(xy),256):
  o=origins[start:start+256];directions=np.zeros_like(o);directions[:,2]=1
  hits,rays,_=mesh.ray.intersects_location(o,directions,multiple_hits=True)
  for ray in np.unique(rays):
   intersections=np.unique(np.round(hits[rays==ray,2],9));points_z=z[np.searchsorted(intersections,z,side='right')%2==1]
   if len(points_z):all_points.append(np.column_stack([np.repeat(xy[start+ray,0],len(points_z)),np.repeat(xy[start+ray,1],len(points_z)),points_z]))
 return np.concatenate(all_points) if all_points else np.empty((0,3))


def source_mesh(id):
 path=SOURCE/(id+'.obj')
 if not path.exists():
  with zipfile.ZipFile(SOURCE/'partof_BP3D_4.0_obj_99.zip') as z:
   path.write_bytes(z.read('partof_BP3D_4.0_obj_99/'+id+'.obj'))
 m=trimesh.load(path,force='mesh',process=False)
 source_vertices=len(m.vertices);source_faces=len(m.faces)
 # OBJ duplicates vertices at shading seams. Weld identical positions, then remove
 # duplicate/zero-area faces and fill only triangular/quadrilateral holes. No
 # vertex position is relocated. Audited before the explicit remaining-loop caps.
 m.merge_vertices(merge_tex=True,merge_norm=True)
 m.update_faces(m.nondegenerate_faces());m.update_faces(m.unique_faces());m.remove_unreferenced_vertices()
 pre_weld_boundary_edges=int(np.count_nonzero(np.unique(np.sort(m.edges,axis=1),axis=0,return_counts=True)[1]==1))
 trimesh.repair.fill_holes(m)
 m.vertices=(m.vertices-ORIGIN)*np.array([1,-1,1])+np.array([0,85.25,0])
 m.faces=m.faces[:,::-1] # LPS->LAS reflection: preserve outward winding.
 # Source surfaces have open cut boundaries. Cap only explicit boundary loops,
 # never change a source vertex or close two spatially unrelated segments.
 edges=np.sort(m.edges,axis=1)
 unique,counts=np.unique(edges,axis=0,return_counts=True)
 boundary=unique[counts==1]
 neighbors={}
 for a,b in boundary:
  neighbors.setdefault(int(a),[]).append(int(b));neighbors.setdefault(int(b),[]).append(int(a))
 if any(len(v)!=2 for v in neighbors.values()):
  raise ValueError(f'{id}: non-manifold source boundary')
 remaining=set(neighbors);loops=[];vertices=m.vertices.tolist();faces=m.faces.tolist()
 directed={(int(a),int(b)) for a,b in m.edges}
 while remaining:
  start=min(remaining);loop=[start];prev=None;current=start
  while True:
   nxt=next(v for v in neighbors[current] if v!=prev)
   if nxt==start:break
   if nxt in loop:raise ValueError('boundary revisits')
   loop.append(nxt);prev,current=current,nxt
  remaining.difference_update(loop)
  pts=m.vertices[loop];center=pts.mean(axis=0);ci=len(vertices);vertices.append(center.tolist())
  # Existing boundary winding must be reversed by each cap triangle.
  for a,b in zip(loop,loop[1:]+loop[:1]):
   faces.append([b,a,ci] if (a,b) in directed else [a,b,ci])
  loops.append({'vertices':len(loop),'center':center.tolist(),'diameterMm':float(np.max(np.linalg.norm(pts[:,None]-pts[None,:],axis=2)))})
 repaired=trimesh.Trimesh(vertices=np.array(vertices),faces=np.array(faces),process=False)
 if not repaired.is_watertight or not repaired.is_winding_consistent:
  raise ValueError(f'{id}: cap did not produce a closed consistently wound surface')
 parts_report.append({'id':id,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'sourceVertices':source_vertices,'sourceFaces':source_faces,'weldedVertices':len(m.vertices),'smallBoundaryEdgesBeforeRepair':pre_weld_boundary_edges,'boundaryCaps':loops,'registeredBoundsMm':m.bounds.tolist(),'closedVolumeMl':abs(float(repaired.volume))/1000})
 print('source',id,'closedMl',abs(float(repaired.volume))/1000,flush=True)
 return repaired

parts=[p for p in manifest['parts'] if (' rib' in p['name'] or 'thoracic vertebra' in p['name'] or 'costal cartilage' in p['name'] or p['name'] in ['body of sternum','manubrium','xiphoid process'])]
meshes=[]
for p in parts:
 m=source_mesh(p['id'])
 if parts_report[-1]['sha256']!=p['sha256']:raise ValueError('Unpinned part '+p['id'])
 meshes.append(m)
lo=np.floor((np.min([m.bounds[0]for m in meshes],axis=0)-6)/PITCH)*PITCH
hi=np.ceil((np.max([m.bounds[1]for m in meshes],axis=0)+6)/PITCH)*PITCH
dims=np.rint((hi-lo)/PITCH).astype(int)+1
occupied=np.zeros(tuple(dims),dtype=bool);labels=np.zeros(tuple(dims),dtype=np.uint8);part_interiors=[]
for i,(p,m) in enumerate(zip(parts,meshes)):
 points=interior_voxels(m);indices=np.rint((points-lo)/PITCH).astype(int)
 if not len(indices):raise ValueError('Lost source '+p['id'])
 mask=np.zeros(tuple(dims),dtype=bool);mask[tuple(indices.T)]=True
 components,count=ndimage.label(mask)
 sizes=np.bincount(components.ravel());small=np.flatnonzero((sizes>0)&(sizes<=8));small=small[small!=0]
 removed=np.argwhere(np.isin(components,small));mask[tuple(removed.T)]=False
 indices=np.argwhere(mask);p['subcellFragmentsRemoved']=removed.tolist()
 part_interiors.append(indices)
 _,count=ndimage.label(mask)
 p['label']=i+1;p['material']='cartilage' if 'cartilage' in p['name'] else 'vertebra' if 'vertebra' in p['name'] else 'bone'
 p['occupiedVoxels']=len(indices);p['components']=int(count)
 existing=labels[tuple(indices.T)]
 previous_bone=np.isin(existing,[q['label']for q in parts[:i]if q.get('material')!='cartilage'])
 p['overlapWithEarlierSourceVoxels']=int(np.count_nonzero(existing));p['bonePrecedenceVoxels']=int(previous_bone.sum()) if p['material']=='cartilage' else 0
 if p['material']=='cartilage':indices=indices[~previous_bone]
 labels[tuple(indices.T)]=i+1;occupied|=mask
 print('VOX',p['name'],len(indices),'components',count,flush=True)
# Refine EACH original part before taking the signed minimum. Refining only
# the rasterized union misses thin articular slits surrounded by occupied nodes.
# A minimum of part SDFs preserves the union zero, but is not an exact Euclidean
# distance to the union exterior deep inside overlapping parts.
distance=np.full(tuple(dims),16.);label_field=np.zeros(tuple(dims),dtype=np.uint8)
for p,m,interior in zip(parts,meshes,part_interiors):
 start=np.maximum(0,interior.min(axis=0)-12);end=np.minimum(dims,interior.max(axis=0)+13)
 region=tuple(slice(a,b)for a,b in zip(start,end));own=np.zeros(tuple(end-start),dtype=bool)
 own[tuple((interior-start).T)]=True
 outside=ndimage.distance_transform_edt(~own,sampling=PITCH);inside=ndimage.distance_transform_edt(own,sampling=PITCH)
 signed=np.where(own,-inside+PITCH/2,outside-PITCH/2)
 band=np.argwhere(np.abs(signed)<2*PITCH);candidates=lo+(band+start)*PITCH
 exact=np.concatenate([trimesh.proximity.closest_point(m,candidates[a:a+256])[1]for a in range(0,len(candidates),256)])
 probe=np.linspace(0,len(candidates)-1,min(12,len(candidates))).astype(int)
 check=TriangleQuery(np.asarray(m.vertices),np.asarray(m.faces)).distance(candidates[probe])
 if not np.allclose(exact[probe],check,rtol=0,atol=1e-6):raise ValueError('Triangle-query disagreement '+p['id'])
 signed[tuple(band.T)]=np.where(own[tuple(band.T)],-exact,exact)
 improves=signed<distance[region];distance[region][improves]=signed[improves];label_field[region][improves]=p['label']
 print('EXACT',p['name'],len(candidates),flush=True)
label_field[occupied]=labels[occupied]
field=np.stack([np.clip(distance,-64,16),label_field],axis=-1).astype('<f2')
raw=field.transpose(2,1,0,3).tobytes();compressed=gzip.compress(raw,compresslevel=9,mtime=0)
if len(raw)>48*1024*1024 or len(compressed)>6*1024*1024:raise ValueError('Skeletal field exceeds budget')
(OUT/'thoracic-atlas.gzip.bin').write_bytes(compressed)
meta={'textureDimensions':dims.tolist(),'originMm':lo.tolist(),'pitchMm':PITCH,'rawBytes':len(raw),'gzipBytes':len(compressed),'sha256Gzip':hashlib.sha256(compressed).hexdigest(),'sha256Raw':hashlib.sha256(raw).hexdigest(),'parts':[{'id':p['id'],'name':p['name'],'label':p['label'],'material':p['material']}for p in parts]}
(OUT/'thoracicAtlasData.ts').write_text('/** Generated common-frame source skeleton; provenance in docs/anatomy. */\nexport const THORACIC_ATLAS = '+json.dumps({**{k:v for k,v in meta.items()if k!='parts'},'materials':[0]+[{'bone':0,'cartilage':1,'vertebra':2}[p['material']]for p in meta['parts']]})+' as const;\n')
report={'sourceArchiveSha256':manifest['archiveSha256'],'sourceOriginLpsMm':ORIGIN.tolist(),'anteriorOffsetMm':85.25,'meta':meta,'sourceParts':parts_report,'parts':parts,'limitations':['1.5 mm voxelization; original vertices unmodified; explicit source boundary caps recorded.','One adult reference; no population or clinical validation.','Costal cartilages 1–7 source only; 8–10 distal source rib ends are preserved without invented anterior extensions.','Skeletal respiratory motion not yet represented.']}
(OUT/'thoracic-atlas-manifest.json').write_text(json.dumps(report,indent=2));print('FIELD',meta,flush=True)
