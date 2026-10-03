"""Audit source organ/diaphragm relationships without moving or clipping anatomy.
A negative sampled signed distance is a penetration witness. Its absence does NOT prove separation.
All inputs are explicit, source-pinned files; no network, runtime import, or clinical acceptance.
"""
import argparse
import hashlib
import json
from pathlib import Path
import tempfile
import numpy as np
from CGAL.CGAL_Kernel import Point_3, ON_BOUNDED_SIDE, ON_BOUNDARY
from CGAL.CGAL_Polyhedron_3 import Polyhedron_3
from CGAL.CGAL_Polygon_mesh_processing import Side_of_triangle_mesh, do_intersect
from CGAL.CGAL_AABB_tree import AABB_tree_Polyhedron_3_Facet_handle
from costochondral_geometry import load_mesh, topology
from diaphragm_source import nonmanifold_vertices
from diaphragm_source_repair import intersection_pairs

ROOT = Path(__file__).resolve().parents[2]
SOURCES = ROOT / 'docs/anatomy/diaphragm-relationship-sources.json'
CANDIDATE_SHA = '581c17df0c5b9469d4a0081550652b288f9bac03233ce810c81a85140e6dada3'


def validate_arrays(vertices, faces):
    v, f = np.asarray(vertices), np.asarray(faces)
    if v.ndim != 2 or v.shape[1] != 3 or not len(v) or not np.isfinite(v).all():
        raise ValueError('Invalid vertices')
    if f.ndim != 2 or f.shape[1] != 3 or not len(f) or f.dtype.kind not in 'iu' or f.min() < 0 or f.max() >= len(v):
        raise ValueError('Invalid triangles')
    area2 = np.linalg.norm(np.cross(v[f[:,1]] - v[f[:,0]], v[f[:,2]] - v[f[:,0]]), axis=1)
    if not np.isfinite(area2).all() or np.any(area2 == 0):
        raise ValueError('Degenerate triangles')
    return v.astype(float), f.astype(np.int64)


class ClosedSurfaceOracle:
    def __init__(self, vertices, faces):
        v, f = validate_arrays(vertices, faces)
        if len(np.unique(v, axis=0)) != len(v) or len(np.unique(f)) != len(v):
            raise ValueError('Oracle requires exact welding and no unused vertices')
        check = topology(v, f)
        if check['surfaceComponents'] != 1 or any(check[k] for k in ['boundaryEdges', 'nonManifoldEdges', 'inconsistentOrientedEdges', 'degenerateTriangles']) or nonmanifold_vertices(f) or intersection_pairs(v, f):
            raise ValueError('Oracle requires one closed embedded manifold')
        with tempfile.TemporaryDirectory(prefix='vexus-relations-') as directory:
            path = Path(directory) / 'surface.off'
            with path.open('w') as out:
                out.write(f'OFF\n{len(v)} {len(f)} 0\n')
                for p in v:
                    out.write(' '.join(format(float(x), '.17g') for x in p) + '\n')
                for triangle in f:
                    out.write('3 ' + ' '.join(str(int(x)) for x in triangle) + '\n')
            self.mesh = Polyhedron_3(str(path))
        self.tree = AABB_tree_Polyhedron_3_Facet_handle(self.mesh.facets())
        self.tree.accelerate_distance_queries()
        self.side = Side_of_triangle_mesh(self.mesh)

    def surface_intersects(self, vertices, faces):
        v, f = validate_arrays(vertices, faces)
        # Separate triangle components retain every source face, even when the source soup is
        # open or has unwelded seams. This is a surface predicate, not a volume union.
        tri = v[f].reshape(-1, 3)
        with tempfile.TemporaryDirectory(prefix='vexus-contact-') as directory:
            path = Path(directory) / 'triangles.off'
            with path.open('w') as out:
                out.write(f'OFF\n{len(tri)} {len(f)} 0\n')
                for p in tri:
                    out.write(' '.join(format(float(x), '.17g') for x in p) + '\n')
                for i in range(len(f)):
                    out.write(f'3 {3*i} {3*i+1} {3*i+2}\n')
            other = Polyhedron_3(str(path))
        if other.size_of_facets() != len(f):
            raise ValueError('Source face preservation failed')
        return bool(do_intersect(self.mesh, other))

    def distances(self, points):
        points = np.asarray(points, dtype=float)
        if points.ndim != 2 or points.shape[1] != 3 or not len(points) or not np.isfinite(points).all():
            raise ValueError('Invalid query points')
        values = []
        for p in points:
            q = Point_3(*p)
            side = self.side.bounded_side(q)
            d = float(np.sqrt(self.tree.squared_distance(q)))
            values.append(0. if side == ON_BOUNDARY else -d if side == ON_BOUNDED_SIDE else d)
        return np.asarray(values)


def audit_surface(oracle, vertices, faces):
    v, f = validate_arrays(vertices, faces)
    ids = np.unique(f)
    points = np.concatenate([v[ids], v[f].mean(axis=1)])
    values = oracle.distances(points)
    negative = np.flatnonzero(values < 0)
    worst = int(values.argmin())
    witness = {'kind': 'vertex' if worst < len(ids) else 'face-centroid',
               'sourceIndex': int(ids[worst]) if worst < len(ids) else worst - len(ids),
               'pointLasMm': points[worst].tolist(), 'signedDistanceMm': float(values[worst])}
    return {'vertexSamples': len(ids), 'faceCentroidSamples': len(f), 'sampleCount': len(points),
            'negativeSamples': len(negative), 'sampledMinSignedDistanceMm': float(values.min()),
            'sampledMinUnsignedDistanceMm': float(abs(values).min()), 'worstSample': witness,
            'interpretation': 'penetration-witness' if len(negative) else 'inconclusive-no-sampled-penetration',
            'surfaceIntersectionDetected': oracle.surface_intersects(v, f),
            'surfaceIntersectionMethod': 'CGAL do_intersect over every source triangle',
            'globalMinimumDistanceCertified': False, 'anatomicalAcceptance': False,
            'note': 'Vertex/centroid counts are not an overlap fraction or an area/volume measurement. Unsampled contacts may exist.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate', type=Path, required=True)
    parser.add_argument('--source-directory', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Output must be new')
    if hashlib.sha256(args.candidate.read_bytes()).hexdigest() != CANDIDATE_SHA:
        raise ValueError('Candidate hash mismatch')
    with np.load(args.candidate, allow_pickle=False) as data:
        oracle = ClosedSurfaceOracle(data['verticesLasMm'], data['triangles'])
    manifest = json.loads(SOURCES.read_text())
    results = []
    for source in manifest['parts']:
        v, f = load_mesh(args.source_directory, source['id'], source['sha256'])
        results.append({**source, **audit_surface(oracle, v, f)})
    report = {'candidateSha256': CANDIDATE_SHA, 'manifestSha256': hashlib.sha256(SOURCES.read_bytes()).hexdigest(),
              'runtimeIntegration': False, 'clinicalValidation': False, 'registrationChanged': False,
              'sourceVerticesMoved': False, 'sourceFacesClipped': False, 'method': 'CGAL complete triangle-surface intersection plus AABB distance and bounded side at source vertices and face centroids',
              'status': 'blocked-pending-anatomical-reconciliation', 'parts': results}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x') as out:
        json.dump(report, out, indent=2, allow_nan=False)
        out.write('\n')
    print(json.dumps({'parts': len(results), 'penetratingParts': sum(x['negativeSamples'] > 0 for x in results), 'status': report['status']}))


if __name__ == '__main__':
    main()
