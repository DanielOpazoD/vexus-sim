from pathlib import Path
import json,hashlib,argparse
import numpy as np
import trimesh
from shapely.geometry import Polygon,LineString,Point
R=Path(__file__).parent
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source-dir',type=Path,required=True)
parser.add_argument('--output-dir',type=Path,required=True)
parser.add_argument('--reference-body',type=Path,required=True)
args=parser.parse_args()
D=args.source_dir;O=args.output_dir;O.mkdir(exist_ok=True,parents=True)
m=trimesh.load(D/'FJ2810.obj',force='mesh',process=True)
m.vertices=(m.vertices-np.array([-.3152345,-205.92635,1164.5735]))*np.array([1,-1,1])+np.array([0,85.25,0])
rows=[];report=[]
for z in range(-400,-160,40):
 section=m.section(plane_origin=[0,0,z],plane_normal=[0,0,1])
 polys=[Polygon(p[:,:2]) for p in section.discrete if np.linalg.norm(p[0]-p[-1])<.01]
 polys=[p for p in polys if p.is_valid and p.area>500]
 if not polys:raise ValueError(f'No closed skin section at {z}')
 poly=max(polys,key=lambda p:p.area)
 # The primary contour is trunk skin; reject a leg/arm selected instead of midline.
 cy=(poly.bounds[1]+poly.bounds[3])/2
 if not poly.covers(Point(0,cy)):raise ValueError(f'Skin section excludes midline at {z}')
 values=[cy]
 for i in range(64):
  phi=2*np.pi*i/64;ray=LineString([(0,cy),(400*np.cos(phi),cy+400*np.sin(phi))])
  hits=ray.intersection(poly.boundary)
  pts=[hits] if hits.geom_type=='Point' else list(hits.geoms)
  radius=max(np.hypot(p.x,p.y-cy) for p in pts if p.geom_type=='Point')
  if not 40<radius<300:raise ValueError(f'Skin radius {radius}')
  values.append(radius)
 rows+=values
 report.append({'zMm':z,'centerY':cy,'contours':len(polys),'bounds':list(poly.bounds),'radiusRangeMm':[min(values[1:]),max(values[1:])]})
original=args.reference_body.read_bytes()
raw=np.array(rows,dtype='<f4').tobytes()+original
(O/'abdominal-body.bin').write_bytes(raw)
(O/'abdominal-body-provenance.json').write_text(json.dumps({'sourceSkin':'FJ2810','sourceSha256':hashlib.sha256((D/'FJ2810.obj').read_bytes()).hexdigest(),'newRows':report,'preservedUpperRows':8,'totalRows':14,'minZMm':-400,'maxZMm':120,'stepMm':40,'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),'limitations':'Old upper eight rows preserved exactly; body clamps below -400 and above120. Inferior rectal tip extends 7 mm below final source section.'},indent=2))
print(report,flush=True)
