"""Registered BodyParts3D outer surfaces -> bounded acoustic fields, no per-organ resize.
Offline only: numpy/scipy/trimesh. Boundary caps are recorded explicitly.
"""
from pathlib import Path
import gzip, hashlib, json, zipfile, argparse
import numpy as np
import trimesh
from scipy import ndimage

ROOT = Path(__file__).parent
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source-dir',type=Path,default=ROOT/'abdominal-atlas-source')
parser.add_argument('--output-dir',type=Path,default=ROOT/'abdominal-field-candidate')
args=parser.parse_args()
SOURCE=args.source_dir
OUT=args.output_dir
for filename,expected in {'partof_BP3D_4.0_obj_99.zip':'9fbc713fffeee924a5a657d9813d84d7eb957bded63adb854931dd5e3eb61c97','partof_element_parts.txt':'3f5f6df1028eb122b30de77c711597b6bb8e5541658e5985859fd228adbf88ea'}.items():
 if hashlib.sha256((SOURCE/filename).read_bytes()).hexdigest()!=expected:raise ValueError('Unexpected source '+filename)
OUT.mkdir(exist_ok=True)
PITCH = 1.5
ORIGIN = np.array([-.3152345, -205.92635, 1164.5735])
groups = {
 'pancreas': ['FJ2629'],
 'digestiveTract': ['FJ2564','FJ2573']+[f'FJ{i}' for i in range(2606,2629)]+[f'FJ{i}' for i in range(2574,2606) if i!=2599]+['FJ2599','FJ2566','FJ2572','FJ2567','FJ2571'],
 'bladder': ['FJ3149'],
}
parts_report = []


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

fields=[]
for name,ids in groups.items():
 meshes=[source_mesh(id) for id in ids]
 bounds=np.array([np.min([m.bounds[0] for m in meshes],axis=0),np.max([m.bounds[1] for m in meshes],axis=0)])
 lo=np.floor((bounds[0]-9)/PITCH)*PITCH
 dims=np.ceil((bounds[1]+9-lo)/PITCH).astype(int)+1
 occupied=np.zeros(tuple(dims),dtype=bool)
 labels=np.zeros(tuple(dims),dtype=np.uint8)
 for id,m in zip(ids,meshes):
  points=interior_voxels(m)
  indices=np.rint((points-lo)/PITCH).astype(int)
  occupied[tuple(indices.T)]=True
  if name=='digestiveTract':
   label=1 if id=='FJ2564' else 2 if id=='FJ2573' else 3 if 2606<=int(id[2:])<=2628 else 4 if 2574<=int(id[2:])<=2605 and id!='FJ2599' else {'FJ2599':5,'FJ2566':6,'FJ2572':7,'FJ2567':8,'FJ2571':9}[id]
   labels[tuple(indices.T)]=label
  else:labels[tuple(indices.T)]=1
 components,count=ndimage.label(occupied)
 sizes=np.bincount(components.ravel())[1:]
 outside,nearest=ndimage.distance_transform_edt(~occupied,sampling=PITCH,return_indices=True)
 inside=ndimage.distance_transform_edt(occupied,sampling=PITCH)
 distance=np.where(occupied,-inside+PITCH/2,outside-PITCH/2)
 # Labels are metadata: nearest source-occupied voxel, never linearly interpolated.
 label_field=labels[tuple(nearest)]
 field=np.stack([np.clip(distance,-64,16),label_field],axis=-1).astype('<f2')
 fields.append({'name':name,'sourceIds':ids,'originMm':lo.tolist(),'dimensions':dims.tolist(),'pitchMm':PITCH,'sourceBoundsMm':bounds.tolist(),'components':int(count),'componentVoxelCounts':sorted(map(int,sizes),reverse=True),'representedVolumeMl':float(occupied.sum()*PITCH**3/1000),'data':field})
 print(name,dims.tolist(),'components',count,'ml',fields[-1]['representedVolumeMl'],flush=True)

# Estimated spleen: oblique ellipsoidal outer envelope with a medial hilar notch.
# This atlas element set has no spleen; do not present this as source segmentation.
lo=np.array([55.,-93.,-130.5]);dims=np.array([65,65,88]);grid=np.indices(tuple(dims)).transpose(1,2,3,0)*PITCH+lo
center=np.array([100.,-40.,-75.]);u=np.array([-.24,-.20,.95]);u/=np.linalg.norm(u)
v=np.array([1.,0.,0.]);v-=u*np.dot(u,v);v/=np.linalg.norm(v);w=np.cross(u,v)
local=np.stack([(grid-center)@u,(grid-center)@v,(grid-center)@w],axis=-1)
outer=(np.linalg.norm(local/np.array([52.,20.,24.]),axis=-1)-1)*27
notch=(np.linalg.norm((grid-np.array([79.,-34.,-88.]))/np.array([14.,15.,34.]),axis=-1)-1)*14
distance=np.maximum(outer,-notch)
fields.append({'name':'spleen','sourceIds':[],'originMm':lo.tolist(),'dimensions':dims.tolist(),'pitchMm':PITCH,'estimated':True,'estimatedCenterMm':center.tolist(),'estimatedRadiiMm':[52,20,24],'data':np.stack([np.clip(distance,-64,16),np.ones(tuple(dims))],axis=-1).astype('<f2')})

# Existing upper-abdominal organs must share the same registration too.
for name,ids in {'liver':['FJ2816','FJ2818','FJ2819','FJ2820','FJ2821','FJ2822','FJ2823','FJ2824'],'kidneyRight':['FJ3147'],'kidneyLeft':['FJ3145'],'gallbladder':['FJ2817'],'lumbarSacralBone':['FJ3155','FJ3156','FJ3157','FJ3159','FJ3162','FJ3165','FJ3168','FJ3393'],'psoas':['FJ1431','FJ1431M'],'lumbarDiscs':['FJ3210','FJ3212','FJ3214','FJ3215','FJ3216','FJ3217']}.items():
 meshes=[source_mesh(id) for id in ids]
 bounds=np.array([np.min([m.bounds[0] for m in meshes],axis=0),np.max([m.bounds[1] for m in meshes],axis=0)])
 lo=np.floor((bounds[0]-9)/PITCH)*PITCH;dims=np.ceil((bounds[1]+9-lo)/PITCH).astype(int)+1
 occupied=np.zeros(tuple(dims),dtype=bool)
 for m in meshes:
  indices=np.rint((interior_voxels(m)-lo)/PITCH).astype(int);occupied[tuple(indices.T)]=True
 _,count=ndimage.label(occupied)
 outside=ndimage.distance_transform_edt(~occupied,sampling=PITCH);inside=ndimage.distance_transform_edt(occupied,sampling=PITCH)
 distance=np.where(occupied,-inside+PITCH/2,outside-PITCH/2)
 fields.append({'name':name,'sourceIds':ids,'originMm':lo.tolist(),'dimensions':dims.tolist(),'pitchMm':PITCH,'sourceBoundsMm':bounds.tolist(),'components':int(count),'representedVolumeMl':float(occupied.sum()*PITCH**3/1000),'data':np.stack([np.clip(distance,-64,16),np.ones(tuple(dims))],axis=-1).astype('<f2')})
 print(name,dims.tolist(),'components',count,'ml',fields[-1]['representedVolumeMl'],flush=True)

# Contact reconciliation modifies SUPPORT contours explicitly, before either renderer.
# All bricks share the same source-world 1.5 mm grid. No label priority hides overlaps.
contact_report=[]
# Reject/record isolated raster fragments smaller than one 3 mm sampling cell.
# Every removed component/coordinate is recorded; a >8-center fragment is never removed.
def remove_isolated_voxels(occupied):
 labels,count=ndimage.label(occupied);sizes=np.bincount(labels.ravel());ids=np.flatnonzero((sizes>0)&(sizes<=8));ids=ids[ids!=0]
 removed=np.isin(labels,ids);coords=np.argwhere(removed).tolist();return occupied&~removed,coords

def reconcile(name, obstacles):
 f=next(f for f in fields if f['name']==name);occ=f['data'][...,0]<0;before=int(occ.sum());_,components_before=ndimage.label(occ);removed=[]
 occ,islands_before=remove_isolated_voxels(occ);before=int(occ.sum());_,components_before=ndimage.label(occ)
 for obstacle in obstacles:
  g=next(g for g in fields if g['name']==obstacle)
  lo=np.maximum(f['originMm'],g['originMm']);hi=np.minimum(np.array(f['originMm'])+(np.array(f['dimensions'])-1)*PITCH,np.array(g['originMm'])+(np.array(g['dimensions'])-1)*PITCH)
  if np.any(lo>hi):continue
  fa=np.rint((lo-f['originMm'])/PITCH).astype(int);ga=np.rint((lo-g['originMm'])/PITCH).astype(int);n=np.rint((hi-lo)/PITCH).astype(int)+1
  fs=tuple(slice(int(a),int(a+c))for a,c in zip(fa,n));gs=tuple(slice(int(a),int(a+c))for a,c in zip(ga,n));mask=g['data'][gs][...,0]<0
  count=int(np.count_nonzero(occ[fs]&mask));occ[fs]&=~mask
  if count:removed.append({'obstacle':obstacle,'removedVolumeMl':count*PITCH**3/1000})
 occ,islands_after=remove_isolated_voxels(occ);labels_after,components_after=ndimage.label(occ);after=int(occ.sum())
 print('CONTACT',name,'components',components_before,components_after,'ml',before*PITCH**3/1000,after*PITCH**3/1000,'sizes',np.sort(np.bincount(labels_after.ravel())[1:])[:20].tolist(),'removed',removed,flush=True)
 if components_after!=components_before or after<.9*before:raise ValueError(f'{name}: contact repair changed components or >10% volume')
 outside,nearest=ndimage.distance_transform_edt(~occ,sampling=PITCH,return_indices=True);inside=ndimage.distance_transform_edt(occ,sampling=PITCH)
 labels=f['data'][...,1][tuple(nearest)];f['data']=np.stack([np.clip(np.where(occ,-inside+PITCH/2,outside-PITCH/2),-64,16),labels],axis=-1).astype('<f2')
 f['representedVolumeMl']=after*PITCH**3/1000
 contact_report.append({'field':name,'subcellSourceGridPointsRemoved':islands_before,'subcellContactGridPointsRemoved':islands_after,'componentsBefore':int(components_before),'componentsAfter':int(components_after),'sourceVolumeMl':before*PITCH**3/1000,'derivedVolumeMl':after*PITCH**3/1000,'removed':removed})
reconcile('lumbarSacralBone',[])
reconcile('lumbarDiscs',['lumbarSacralBone'])
reconcile('digestiveTract',['pancreas','liver','kidneyRight','kidneyLeft','gallbladder','bladder','lumbarSacralBone','lumbarDiscs','psoas'])
reconcile('psoas',['pancreas','liver','kidneyRight','kidneyLeft','gallbladder','bladder','lumbarSacralBone','lumbarDiscs','digestiveTract'])

# Explicit spatial packing of fixed source bricks: no runtime allocator or organ rescaling.
# Preserve one guard voxel and reject any overlap or exceeded budget.
OFFSETS={'pancreas':[244,97,119],'digestiveTract':[0,0,0],'bladder':[178,97,208],
 'spleen':[178,97,119],'liver':[178,97,0],'kidneyRight':[178,163,119],
 'kidneyLeft':[231,163,119],'gallbladder':[237,97,208],
 'lumbarSacralBone':[178,0,0],'psoas':[0,138,0],'lumbarDiscs':[272,0,0]}
for f in fields:f['offset']=OFFSETS[f['name']]
for i,f in enumerate(fields):
 for g in fields[i+1:]:
  a=np.array(f['offset']);b=np.array(g['offset']);
  if np.all(a+f['dimensions']>=b) and np.all(b+g['dimensions']>=a):
   raise ValueError('Source brick packing overlaps '+f['name']+' '+g['name'])
W,H,D=map(int,np.max([np.array(f['offset'])+f['dimensions']for f in fields],axis=0))
atlas=np.zeros((D,H,W,2),dtype='<f2');atlas[...,0]=16
for field in fields:
 x,y,z=field['offset'];nx,ny,nz=field['dimensions']
 atlas[z:z+nz,y:y+ny,x:x+nx]=field.pop('data').transpose(2,1,0,3)
raw=atlas.tobytes()
if len(raw)>96*1024*1024:raise ValueError('Unbounded atlas allocation')
compressed=gzip.compress(raw,compresslevel=9,mtime=0)
(OUT/'abdominal-atlas.bin.gz').write_bytes(compressed)
manifest={'version':1,'source':'BodyParts3D release 4.0, DBCLS, CC BY 4.0','archiveSha256':hashlib.sha256((SOURCE/'partof_BP3D_4.0_obj_99.zip').read_bytes()).hexdigest(),'coordinateFrame':'LAS mm; xiph register shared with reference torso','sourceOriginLpsMm':ORIGIN.tolist(),'anteriorOffsetMm':85.25,'pitchMm':PITCH,'textureDimensions':[W,H,D],'rawBytes':len(raw),'gzipBytes':len(compressed),'sha256Gzip':hashlib.sha256(compressed).hexdigest(),'sha256Raw':hashlib.sha256(raw).hexdigest(),'fields':fields,'sourceParts':parts_report,'contactReconciliation':contact_report,'limitations':['Source cut boundaries capped at existing loops; source vertices are unchanged. Caps and source IDs are recorded.','Spleen outer shape and gastric/intestinal layer properties are estimated, not atlas segmentation or clinical validation.','1.5 mm voxelization limits outer surface fidelity; subvoxel wall offsets do not recover missing source detail.','Contact reconciliation is reported with original/derived volumes; component count cannot change. No closing or artificial bridges.']}
(OUT/'abdominal-atlas-manifest.json').write_text(json.dumps(manifest,indent=2))
print('ATLAS',W,H,D,'raw',len(raw),'gzip',len(compressed),flush=True)
