"""Source-pinned local surface repair with an independent CGAL intersection gate.
Offline tools only. CGAL Python bindings are not linked into the simulator.
No source vertex moves, no hole filling, no global smoothing or runtime promotion.
"""
import argparse
from collections import Counter
import hashlib
from importlib.metadata import version
import json
from pathlib import Path
import tempfile
import numpy as np
from CGAL.CGAL_Polyhedron_3 import Polyhedron_3
from CGAL.CGAL_Polygon_mesh_processing import self_intersections
from costochondral_geometry import load_mesh, topology, TriangleQuery
from diaphragm_source import PLAN, apply_plan, genus, nonmanifold_vertices

REPAIR_PLAN = PLAN.parent / 'diaphragm-source-local-repair-plan.json'


def intersection_pairs(vertices, faces):
    """CGAL exact predicates; excludes only common incident vertices/edges.
    Map returned facets by their geometry, never assume parser iteration order.
    """
    keys = {tuple(sorted(tuple(float(x) for x in p) for p in vertices[f])): i for i, f in enumerate(faces)}
    if len(keys) != len(faces):
        raise ValueError('Repeated geometric triangle cannot be mapped unambiguously')
    with tempfile.TemporaryDirectory(prefix='vexus-cgal-') as folder:
        path = Path(folder)/'input.off'
        with path.open('w') as out:
            out.write(f'OFF\n{len(vertices)} {len(faces)} 0\n')
            for p in vertices:
                out.write(' '.join(format(float(x), '.17g') for x in p)+'\n')
            for f in faces:
                out.write('3 '+' '.join(str(int(i)) for i in f)+'\n')
        mesh = Polyhedron_3(str(path))
        if mesh.size_of_vertices() != len(vertices) or mesh.size_of_facets() != len(faces) or not mesh.is_valid() or not mesh.is_pure_triangle():
            raise ValueError('CGAL import changed or rejected the mesh')
        mapped = set()
        for face in mesh.facets():
            edge = face.halfedge()
            points = []
            for _ in range(3):
                p = edge.vertex().point()
                points.append((p.x(), p.y(), p.z()))
                edge = edge.next()
            key = tuple(sorted(points))
            if key not in keys or keys[key] in mapped:
                raise ValueError('CGAL facet mapping is not bijective')
            i = keys[key]
            mapped.add(i)
            face.set_id(i)
        pairs = []
        self_intersections(mesh, pairs)
        return sorted(set(tuple(sorted([p.first.id(), p.second.id()])) for p in pairs))


def directed_boundary(faces):
    edges = Counter((int(a), int(b)) for f in faces for a, b in zip(f, np.roll(f, -1)))
    return Counter({e: n-edges[e[::-1]] for e, n in edges.items() if n > edges[e[::-1]]})


def deviation_bound(vertices, source, target, threshold):
    """Conservative adaptive upper bound, not merely a point-sampling maximum.
    Unsigned distance is 1-Lipschitz. Each centroid distance + cell radius bounds
    its entire triangle. Uncertified cells subdivide; exhausted work rejects.
    """
    if not np.isfinite(threshold) or threshold <= 0:
        raise ValueError('Positive finite deviation threshold required')
    query = TriangleQuery(vertices, target)
    active = vertices[source].copy()
    accepted = 0.
    lower = 0.
    evaluated = 0
    for level in range(9):
        if len(active) > 65536:
            break
        centres = active.mean(axis=1)
        distance = query.distance(centres)
        radius = np.linalg.norm(active-centres[:, None, :], axis=2).max(axis=1)
        upper = distance+radius+1e-9
        evaluated += len(active)
        lower = max(lower, float(distance.max()))
        if lower > threshold:
            raise ValueError('Surface deviation exceeds explicit bound')
        certified = upper <= threshold
        if certified.any():
            accepted = max(accepted, float(upper[certified].max()))
        if certified.all():
            return {'lowerWitnessMm': lower, 'certifiedUpperMm': accepted, 'thresholdMm': threshold,
                    'evaluatedCells': evaluated, 'subdivisionLevels': level, 'roundoffAllowanceMm': 1e-9}
        a, b, c = np.moveaxis(active[~certified], 1, 0)
        ab, bc, ca = (a+b)/2, (b+c)/2, (c+a)/2
        active = np.concatenate([np.stack(t, axis=1) for t in [(a, ab, ca), (ab, b, bc), (ca, bc, c), (ab, bc, ca)]])
    raise ValueError('Surface deviation not certified within the finite work budget')


def repair(vertices, faces, source_indices, raw_vertices, plan):
    ids = plan['originalFaceIndices']
    if any(type(i) is not int or i < 0 for i in ids) or len(ids) != len(set(ids)) or not ids:
        raise ValueError('Invalid original face list')
    indices = {int(x): i for i, x in enumerate(source_indices)}
    if any(i not in indices for i in ids):
        raise ValueError('Patch face is absent from retained source')
    slots = np.array([indices[i] for i in ids])
    src = np.asarray(plan['replacementSourceVertexIndices'])
    if src.shape != (len(slots), 3) or not np.issubdtype(src.dtype, np.integer) or src.min() < 0 or src.max() >= len(raw_vertices):
        raise ValueError('Invalid replacement vertex references')
    lookup = {tuple(p): i for i, p in enumerate(vertices)}
    try:
        replacement = np.array([[lookup[tuple(raw_vertices[i])] for i in row] for row in src])
    except KeyError as exc:
        raise ValueError('Replacement vertex is not retained') from exc
    old = faces[slots]
    if set(old.flat) != set(replacement.flat) or directed_boundary(old) != directed_boundary(replacement):
        raise ValueError('Patch must preserve its exact vertex set and directed boundary')
    bound_keys = ['maxPatchExtentMm', 'maxBidirectionalSurfaceDeviationMm', 'maxAbsoluteVolumeChangeMm3']
    if any(not isinstance(plan[k], (int, float)) or not np.isfinite(plan[k]) or plan[k] <= 0 for k in bound_keys):
        raise ValueError('Invalid repair bound')
    if np.ptp(vertices[np.unique(old)], axis=0).max() > plan['maxPatchExtentMm']:
        raise ValueError('Patch exceeds explicit spatial extent')
    before_pairs = intersection_pairs(vertices, faces)
    if len(before_pairs) != plan['expectedInitialSelfIntersectionPairs'] or any(a not in slots or b not in slots for a, b in before_pairs):
        raise ValueError('Intersection witness differs from pinned local patch')
    bounds = [deviation_bound(vertices, a, b, plan['maxBidirectionalSurfaceDeviationMm']) for a, b in [(old, replacement), (replacement, old)]]
    result = faces.copy()
    result[slots] = replacement
    final = topology(vertices, result)
    if final['surfaceComponents'] != 1 or any(final[k] for k in ['boundaryEdges', 'nonManifoldEdges', 'inconsistentOrientedEdges', 'degenerateTriangles']) or nonmanifold_vertices(result):
        raise ValueError('Repair breaks manifold topology or orientation')
    invariant = genus(vertices, result)
    if invariant['genus'] != plan['expectedRetainedGenus'] or invariant != genus(vertices, faces):
        raise ValueError('Repair changes the source topology invariant')
    before_volume = topology(vertices, faces)['components'][0]['signedEnclosedVolumeMm3']
    after_volume = final['components'][0]['signedEnclosedVolumeMm3']
    if after_volume <= 0 or abs(after_volume-before_volume) > plan['maxAbsoluteVolumeChangeMm3']:
        raise ValueError('Repair exceeds volume bound or reverses orientation')
    after_pairs = intersection_pairs(vertices, result)
    if after_pairs or plan['expectedRemainingSelfIntersectionPairs'] != 0:
        raise ValueError('Self-intersections remain after repair')
    untouched = np.ones(len(faces), dtype=bool)
    untouched[slots] = False
    if not np.array_equal(result[untouched], faces[untouched]):
        raise ValueError('Unselected source triangles changed')
    report = {'modifiedOriginalFaceIndices': ids, 'modifiedTriangleCount': len(slots),
              'unmodifiedRetainedTriangles': int(untouched.sum()), 'allRetainedVertexPositionsPreserved': True,
              'directedBoundaryPreserved': True, 'deviationCertificates': bounds,
              'sourceIntersectionPairsBefore': [[int(source_indices[a]), int(source_indices[b])] for a, b in before_pairs],
              'selfIntersectionPairsAfter': after_pairs, 'selfIntersectionsValidated': True,
              'cgalPythonVersion': version('cgal'), 'cgalApi': 'Polygon_mesh_processing.self_intersections',
              'topologyAfter': final, 'topologyInvariant': invariant, 'nonManifoldVertexLinks': 0,
              'primaryVolumeBeforeMm3': before_volume, 'primaryVolumeAfterMm3': after_volume,
              'runtimeIntegration': False, 'clinicalValidation': False}
    return result, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--atlas', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Choose a new output directory')
    component_bytes, repair_bytes = PLAN.read_bytes(), REPAIR_PLAN.read_bytes()
    component_plan, repair_plan = json.loads(component_bytes), json.loads(repair_bytes)
    if any(component_plan[k] != repair_plan[k] for k in ['sourceElement', 'sourceSha256']):
        raise ValueError('Repair and component plans refer to different sources')
    raw_vertices, raw_faces = load_mesh(args.atlas, component_plan['sourceElement'], expected_sha=component_plan['sourceSha256'])
    vertices, faces, keep, component_report = apply_plan(raw_vertices, raw_faces, component_plan)
    faces, report = repair(vertices, faces, keep, raw_vertices, repair_plan)
    args.output.mkdir(parents=True, exist_ok=False)
    target = args.output/'diaphragm-repaired-candidate.npz'
    np.savez_compressed(target, verticesLasMm=vertices, triangles=faces.astype('<u4'), sourceFaceIndices=keep.astype('<u4'))
    report.update({'sourceElement': component_plan['sourceElement'], 'sourceSha256': component_plan['sourceSha256'],
                   'componentPlanSha256': hashlib.sha256(component_bytes).hexdigest(), 'repairPlanSha256': hashlib.sha256(repair_bytes).hexdigest(),
                   'candidateSha256': hashlib.sha256(target.read_bytes()).hexdigest(), 'candidateBytes': target.stat().st_size,
                   'componentSelection': component_report,
                   'credit': 'BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International'})
    (args.output/'report.json').write_text(json.dumps(report, indent=2, allow_nan=False)+'\n')
    print(json.dumps({'output': str(args.output), 'selfIntersectionPairsAfter': len(report['selfIntersectionPairsAfter']), 'modifiedTriangles': report['modifiedTriangleCount']}))


if __name__ == '__main__':
    main()
