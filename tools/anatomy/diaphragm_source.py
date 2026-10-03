"""Explicit, reversible cleanup of pinned diaphragm source components, offline only.
Never fills holes, moves vertices, welds by tolerance, or promotes runtime anatomy.
BodyParts3D / DBCLS, CC BY 4.0; plan and source hashes are retained in the report.
"""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from costochondral_geometry import load_mesh, topology

ROOT = Path(__file__).resolve().parents[2]
PLAN = ROOT / 'docs/anatomy/diaphragm-source-component-plan.json'


def components(vertices, faces):
    unique, ids = np.unique(vertices, axis=0, return_inverse=True)
    welded = ids[faces]
    edges = np.unique(np.sort(np.concatenate([welded[:, [0, 1]], welded[:, [1, 2]], welded[:, [2, 0]]]), axis=1), axis=0)
    graph = coo_matrix((np.ones(len(edges)), (edges[:, 0], edges[:, 1])), shape=(len(unique), len(unique)))
    _, labels = connected_components(graph.tocsr(), directed=False)
    owners = labels[welded[:, 0]]
    return [np.flatnonzero(owners == label) for label in np.unique(owners)]


def genus(vertices, faces):
    unique, ids = np.unique(vertices, axis=0, return_inverse=True)
    faces = ids[faces]
    edges = np.unique(np.sort(np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]]), axis=1), axis=0)
    euler = len(np.unique(faces))-len(edges)+len(faces)
    return {'vertices': len(np.unique(faces)), 'edges': len(edges), 'faces': len(faces),
            'eulerCharacteristic': euler, 'genus': (2-euler)/2}


def nonmanifold_vertices(faces):
    links = defaultdict(list)
    for a, b, c in faces:
        links[int(a)].append((int(b), int(c)))
        links[int(b)].append((int(c), int(a)))
        links[int(c)].append((int(a), int(b)))
    bad = []
    for vertex, edges in links.items():
        graph = defaultdict(set)
        for a, b in edges:
            graph[a].add(b)
            graph[b].add(a)
        stack = [next(iter(graph))]
        seen = set()
        while stack:
            node = stack.pop()
            if node in seen:
                continue
            seen.add(node)
            stack.extend(graph[node]-seen)
        if len(seen) != len(graph) or any(len(neighbours) != 2 for neighbours in graph.values()):
            bad.append(vertex)
    return bad


def apply_plan(vertices, faces, plan):
    vertices = np.asarray(vertices, dtype=float)
    faces = np.asarray(faces)
    if vertices.ndim != 2 or vertices.shape[1] != 3 or not np.isfinite(vertices).all():
        raise ValueError('Invalid source vertices')
    if faces.ndim != 2 or faces.shape[1] != 3 or not np.issubdtype(faces.dtype, np.integer) or not len(faces) or faces.min() < 0 or faces.max() >= len(vertices):
        raise ValueError('Invalid source triangles')
    for key in ['maxRemovedComponentExtentMm', 'maxRemovedSurfaceAreaMm2', 'maxRemovedAbsoluteVolumeMm3']:
        if not isinstance(plan[key], (int, float)) or not np.isfinite(plan[key]) or plan[key] < 0:
            raise ValueError('Invalid explicit removal bound')
    if type(plan['expectedRetainedGenus']) is not int or plan['expectedRetainedGenus'] < 0:
        raise ValueError('Invalid genus contract')
    excluded = plan['excludedFaceIndices']
    if not isinstance(excluded, list):
        raise ValueError('Explicit face index list required')
    if any(type(i) is not int or i < 0 or i >= len(faces) for i in excluded) or len(excluded) != len(set(excluded)):
        raise ValueError('Invalid or repeated excluded face index')
    removed = np.zeros(len(faces), dtype=bool)
    removed[excluded] = True
    reports = []
    for group in components(vertices, faces):
        if removed[group].any() and not removed[group].all():
            raise ValueError('A plan must select whole disconnected components, never cut a surface')
        if not removed[group].all():
            continue
        part = topology(vertices, faces[group])
        extent = np.ptp(vertices[np.unique(faces[group])], axis=0)
        if float(extent.max()) > plan['maxRemovedComponentExtentMm']:
            raise ValueError('Removed component exceeds explicit extent bound')
        reports.append({'originalFaceIndices': group.tolist(), 'topology': part})
    removed_area = sum(c['surfaceAreaMm2'] for r in reports for c in r['topology']['components'])
    removed_volume = sum(abs(c['signedEnclosedVolumeMm3']) for r in reports for c in r['topology']['components'])
    if removed_area > plan['maxRemovedSurfaceAreaMm2'] or removed_volume > plan['maxRemovedAbsoluteVolumeMm3']:
        raise ValueError('Removed geometry exceeds explicit area or volume bound')
    keep = np.flatnonzero(~removed)
    if not len(keep):
        raise ValueError('No retained surface')
    # Exact coordinate weld only. Preserve the source triangle order and orientation.
    used = np.unique(faces[keep])
    mapping = np.full(len(vertices), -1, dtype=int)
    cleaned_vertices, inverse = np.unique(vertices[used], axis=0, return_inverse=True)
    mapping[used] = inverse
    cleaned_faces = mapping[faces[keep]]
    retained = topology(cleaned_vertices, cleaned_faces)
    if retained['surfaceComponents'] != 1 or any(retained[k] for k in ['boundaryEdges', 'nonManifoldEdges', 'inconsistentOrientedEdges', 'degenerateTriangles']):
        raise ValueError('Retained component is not closed, consistently oriented and nondegenerate')
    if retained['components'][0]['signedEnclosedVolumeMm3'] <= 0:
        raise ValueError('Retained signed volume must be positive')
    invalid_links = nonmanifold_vertices(cleaned_faces)
    if invalid_links:
        raise ValueError('Retained vertex links are not single cycles')
    invariant = genus(cleaned_vertices, cleaned_faces)
    if invariant['genus'] != plan['expectedRetainedGenus']:
        raise ValueError('Retained topology differs from the explicit genus contract')
    if not np.array_equal(cleaned_vertices[cleaned_faces], vertices[faces[keep]]):
        raise ValueError('Retained source triangles moved')
    report = {'originalTriangles': len(faces), 'retainedOriginalFaceIndicesSha256': hashlib.sha256(keep.astype('<u4').tobytes()).hexdigest(),
              'removedTriangleCount': int(removed.sum()), 'removedSurfaceAreaMm2': removed_area,
              'removedAbsoluteVolumeMm3': removed_volume, 'removedComponents': reports,
              'retained': retained, 'nonManifoldVertexLinks': len(invalid_links), 'retainedTopologyInvariant': invariant,
              'retainedTrianglesExactlyPreserved': True, 'runtimeIntegration': False,
              'selfIntersectionsValidated': False, 'clinicalValidation': False}
    return cleaned_vertices, cleaned_faces, keep, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--atlas', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True, help='New directory for candidate and report')
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Choose a new output directory; source/evidence is never overwritten')
    plan_bytes = PLAN.read_bytes()
    plan = json.loads(plan_bytes)
    vertices, faces = load_mesh(args.atlas, plan['sourceElement'], expected_sha=plan['sourceSha256'])
    vertices, faces, keep, report = apply_plan(vertices, faces, plan)
    args.output.mkdir(parents=True, exist_ok=False)
    path = args.output / 'diaphragm-candidate.npz'
    np.savez_compressed(path, verticesLasMm=vertices, triangles=faces.astype('<u4'), sourceFaceIndices=keep.astype('<u4'))
    report.update({'sourceElement': plan['sourceElement'], 'sourceSha256': plan['sourceSha256'],
                   'planSha256': hashlib.sha256(plan_bytes).hexdigest(), 'candidateSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                   'license': 'CC BY 4.0', 'credit': 'BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International'})
    (args.output / 'report.json').write_text(json.dumps(report, indent=2, allow_nan=False)+'\n')
    print(json.dumps({'output': str(args.output), 'retainedTriangles': len(faces), 'genus': report['retainedTopologyInvariant']['genus']}))


if __name__ == '__main__':
    main()
