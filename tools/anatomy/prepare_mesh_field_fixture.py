"""Create a source-pinned Float32 query fixture against independent CGAL oracles.
No simulator import or runtime promotion. All inputs and outputs are explicit local files.
"""
import argparse
import gzip
import hashlib
import json
from importlib.metadata import version
from pathlib import Path
import tempfile
import time
import numpy as np
from CGAL.CGAL_Kernel import Point_3, ON_BOUNDED_SIDE, ON_BOUNDARY
from CGAL.CGAL_Polyhedron_3 import Polyhedron_3
from CGAL.CGAL_Polygon_mesh_processing import Side_of_triangle_mesh
from CGAL.CGAL_AABB_tree import AABB_tree_Polyhedron_3_Facet_handle
from diaphragm_source_repair import intersection_pairs
from costochondral_geometry import topology
from diaphragm_source import nonmanifold_vertices


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate',type=Path,required=True)
    parser.add_argument('--report',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    if args.output.exists():parser.error('Output must be new')
    raw=args.candidate.read_bytes();report=json.loads(args.report.read_text())
    digest=hashlib.sha256(raw).hexdigest()
    if digest!=report['candidateSha256'] or not report['selfIntersectionsValidated'] or report['selfIntersectionPairsAfter']:
        raise ValueError('Candidate does not match a passed repair report')
    with np.load(args.candidate,allow_pickle=False) as data:
        original=data['verticesLasMm'];faces=data['triangles'].copy()
    vertices=original.astype('<f4').astype(float)
    quantization_error=float(abs(vertices-original).max())
    if quantization_error>1e-4:raise ValueError('Float32 conversion exceeds coordinate error gate')
    topo=topology(vertices,faces)
    if topo['surfaceComponents']!=1 or any(topo[k] for k in ['boundaryEdges','nonManifoldEdges','inconsistentOrientedEdges','degenerateTriangles']) or nonmanifold_vertices(faces) or intersection_pairs(vertices,faces):
        raise ValueError('Float32 conversion is not a valid embedded component')
    tri=vertices[faces];normal=np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]);area=np.linalg.norm(normal,axis=1)
    normal/=area[:,None];rng=np.random.default_rng(150)
    groups=[rng.uniform(vertices.min(axis=0)-10,vertices.max(axis=0)+10,size=(1024,3))]
    ids=rng.choice(len(faces),size=1024,p=area/area.sum());weights=rng.dirichlet([1,1,1],size=len(ids));surface=(tri[ids]*weights[:,:,None]).sum(axis=1)
    for offset in [-2,-.25,-.01,.01,.25,2]:groups.append(surface+offset*normal[ids])
    ids=rng.choice(len(vertices),size=256,replace=False)
    for axis in range(3):
        for sign in [-1,1]:
            points=vertices[ids].copy();points[:,axis]+=.05*sign;groups.append(points)
    groups.append(vertices[rng.choice(len(vertices),size=64,replace=False)])
    points=np.concatenate(groups).astype('<f4').astype(float)
    signed=[];normals=[];sides=[]
    start=time.perf_counter()
    with tempfile.TemporaryDirectory(prefix='vexus-mesh-oracle-') as folder:
        path=Path(folder)/'mesh.off'
        with path.open('w') as out:
            out.write(f'OFF\n{len(vertices)} {len(faces)} 0\n')
            for p in vertices:out.write(' '.join(format(float(x),'.17g') for x in p)+'\n')
            for f in faces:out.write('3 '+' '.join(str(int(x)) for x in f)+'\n')
        mesh=Polyhedron_3(str(path));tree=AABB_tree_Polyhedron_3_Facet_handle(mesh.facets());tree.accelerate_distance_queries();side=Side_of_triangle_mesh(mesh)
        for p in points:
            point=Point_3(*p);s=side.bounded_side(point);distance=float(np.sqrt(tree.squared_distance(point)));sign=-1 if s==ON_BOUNDED_SIDE else 1
            cp=tree.closest_point(point);delta=p-np.array([cp.x(),cp.y(),cp.z()]);n=sign*delta/distance if distance>.01 else np.zeros(3)
            signed.append(0. if s==ON_BOUNDARY else sign*distance);normals.append(n.tolist());sides.append(int(s))
    data={'format':'vexus-source-mesh-query-v1','sourceSha256':report['sourceSha256'],'repairedCandidateSha256':digest,
          'credit':report['credit'],'runtimeIntegration':False,'cgalPythonVersion':version('cgal'),'seed':150,
          'float32CoordinateMaxErrorMm':quantization_error,'float32SelfIntersectionPairs':0,
          'vertexCount':len(vertices),'faceCount':len(faces),'pointCount':len(points),
          'positions':vertices.reshape(-1).tolist(),'triangles':faces.reshape(-1).tolist(),
          'points':points.reshape(-1).tolist(),'signedDistanceMm':signed,'oracleNormals':normals,'boundedSide':sides}
    encoded=json.dumps(data,separators=(',',':'),allow_nan=False).encode()
    packed=gzip.compress(encoded,compresslevel=9,mtime=0)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    with args.output.open('xb') as out:out.write(packed)
    print(json.dumps({'vertices':len(vertices),'faces':len(faces),'points':len(points),'bytes':len(packed),'sha256':hashlib.sha256(packed).hexdigest(),'oracleSeconds':time.perf_counter()-start,'quantizationErrorMm':quantization_error}))


if __name__=='__main__':main()
