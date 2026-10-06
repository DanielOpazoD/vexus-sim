from pathlib import Path
import numpy as np,trimesh,json,hashlib
import argparse
parser=argparse.ArgumentParser(description='Inspect closed sections of pinned hepatic vein source meshes without changing them.')
parser.add_argument('--source-dir', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args=parser.parse_args()
source=args.source_dir
pins={'FJ2416':'0e239c38accb79c114d9214e97cd2e8c96b29913c37725325e2942e1af2980ee','FJ2415':'f6f2d7c03cf24362c80741608d5e8bdcc1c259bd17aaf19fd2ab974be6220a3c'}
report=[]
for id,levels in [('FJ2416',[-100,-85,-70,-55,-40,-30,-23]),('FJ2415',[45,35,25,15,5,-3,-8])]:
 p=source/(id+'.obj');assert hashlib.sha256(p.read_bytes()).hexdigest()==pins[id], 'Source hash mismatch';mesh=trimesh.load_mesh(p,process=True);v=mesh.vertices-np.array([-.3152345,-205.92635,1164.5735]);v[:,1]=85.25-v[:,1];mesh.vertices=v
 part={'id':id,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'levels':[]}
 for x in levels:
  section=mesh.section(plane_origin=[x,0,0],plane_normal=[1,0,0]);loops=[]
  if section:
   for points in section.discrete:
    if np.linalg.norm(points[0]-points[-1])>1e-6:continue
    a=points[:-1,1:];b=points[1:,1:];cross=a[:,0]*b[:,1]-b[:,0]*a[:,1];area=cross.sum()/2
    if abs(area)<.01:continue
    centroid=((a+b)*cross[:,None]).sum(axis=0)/(6*area)
    loops.append({'areaMm2':abs(float(area)),'centroidMm':[x,*centroid.tolist()]})
  part['levels'].append({'x':x,'loops':sorted(loops,key=lambda l:-l['areaMm2'])})
 report.append(part)
args.output.write_text(json.dumps(report,indent=2)+'\n')
