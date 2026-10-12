"""Audit pinned posterior muscle sources before promoting any anatomy.

Offline, explicit local sources/manifest/output. Exact coordinate welding only.
Zero-volume opposite sheets require explicit whole-component face lists.
No vertex moves, caps, threshold welding, smoothing or runtime writes.
BodyParts3D 4.0, ©DBCLS, CC BY 4.0. Source validity is not clinical validation.
"""
import argparse
import hashlib
import json
from pathlib import Path
from importlib.metadata import version
import numpy as np
from costochondral_geometry import load_mesh, topology
from diaphragm_source import components, nonmanifold_vertices
from diaphragm_source_repair import intersection_pairs, directed_boundary


def derive(vertices, faces, excluded):
    """Retain every source face except explicitly pinned opposite sheets."""
    if not isinstance(excluded, list) or any(type(i) is not int or i < 0 or i >= len(faces) for i in excluded):
        raise ValueError('Explicit valid source face indices required')
    if len(excluded) != len(set(excluded)):
        raise ValueError('Repeated exclusion index')
    unique, inverse = np.unique(vertices, axis=0, return_inverse=True)
    welded = inverse[faces]
    remove = np.zeros(len(faces), dtype=bool)
    remove[excluded] = True
    sheets = []
    for group in components(unique, welded):
        if not remove[group].any():
            continue
        if not remove[group].all() or len(group) != 2:
            raise ValueError('Only complete two-face sheet components may be excluded')
        a, b = welded[group]
        if len(set(a)) != 3 or sorted(a) != sorted(b) or directed_boundary(welded[group]):
            raise ValueError('Excluded component is not an exact opposite coincident sheet')
        sheets.append({'sourceFaceIndices': group.tolist(),
                       'sourceTrianglesLasMm': vertices[faces[group]].tolist(),
                       'reason': 'Exact opposite coincident triangles enclose zero geometric volume'})
    keep = np.flatnonzero(~remove)
    if not len(keep):
        raise ValueError('No retained source')
    used = np.unique(welded[keep])
    remap = np.full(len(unique), -1, dtype=int)
    remap[used] = np.arange(len(used))
    return unique[used], remap[welded[keep]], keep, sheets


def audit(directory, part):
    raw_vertices, raw_faces = load_mesh(directory, part['id'], expected_sha=part['sha256'])
    vertices, faces, keep, sheets = derive(raw_vertices, raw_faces, part['excludedZeroVolumeSheetFaceIndices'])
    shape = topology(vertices, faces)
    bad_links = nonmanifold_vertices(faces)
    failures = [key for key in ['boundaryEdges', 'nonManifoldEdges', 'inconsistentOrientedEdges', 'degenerateTriangles'] if shape[key]]
    if bad_links:
        failures.append('nonManifoldVertexLinks')
    if failures:
        pairs = None
        mapping_error = None
    else:
        try:
            pairs = intersection_pairs(vertices, faces)
            mapping_error = None
        except ValueError as exc:
            pairs = None
            mapping_error = str(exc)
    records = [] if pairs is None else [
        {'sourceFaceIndices': [int(keep[a]), int(keep[b])],
         'trianglesLasMm': vertices[faces[[a, b]]].tolist()}
        for a, b in pairs
    ]
    report = {**part, 'sourceBytesVerified': True,
              'registration': {'originLpsMm': [-.3152345, -205.92635, 1164.5735],
                               'axisSigns': [1, -1, 1], 'targetOriginMm': [0, 85.25, 0],
                               'reversedWinding': True, 'organSpecificTransform': False},
              'excludedSheets': sheets, 'retainedOriginalFaceIndices': keep.tolist(),
              'retainedSourceVerticesUnchanged': True, 'topology': shape,
              'nonManifoldVertexLinks': bad_links, 'topologyFailures': failures,
              'cgalMappingError': mapping_error,
              'globalSelfIntersectionPairs': records,
              'validForContactInvestigation': not failures and pairs == [] and mapping_error is None,
              'componentsRequireInterpretation': True,
              'anatomicalContactsVerified': False, 'runtimePromoted': False,
              'clinicalValidation': False}
    return vertices, faces, keep, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--source-dir', type=Path, required=True)
    parser.add_argument('--labels', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Choose a new output directory; preserve previous evidence')
    manifest_bytes = args.manifest.read_bytes()
    manifest = json.loads(manifest_bytes)
    labels = args.labels.read_bytes()
    if hashlib.sha256(labels).hexdigest() != manifest['officialLabelTableSha256']:
        raise ValueError('Official label table SHA differs')
    rows = {tuple(line.split('\t')) for line in labels.decode().splitlines()}
    for part in manifest['parts']:
        if not any(len(row) == 3 and row[1:] == (part['name'], part['id']) for row in rows):
            raise ValueError('Official name/element association absent: ' + part['id'])
    args.output.mkdir(parents=True, exist_ok=False)
    reports = []
    for part in manifest['parts']:
        vertices, faces, keep, report = audit(args.source_dir, part)
        file = args.output / (part['id'] + '-derived.npz')
        np.savez_compressed(file, verticesLasMm=vertices, triangles=faces,
                            sourceFaceIndices=keep)
        report['derivedSha256'] = hashlib.sha256(file.read_bytes()).hexdigest()
        reports.append(report)
        print(part['id'], 'pairs', None if report['globalSelfIntersectionPairs'] is None else len(report['globalSelfIntersectionPairs']),
              'contactCandidate', report['validForContactInvestigation'], flush=True)
    result = {'sourceManifestSha256': hashlib.sha256(manifest_bytes).hexdigest(),
              'cgalVersion': version('cgal'), 'parts': reports,
              'officialLabelsVerified': True,
              'runtimePromoted': False, 'clinicalValidation': False,
              'meaning': 'Explicit numerical surface derivation and independent intersection gate; source components, contacts and acquisition remain separate gates.'}
    (args.output/'report.json').write_text(json.dumps(result, indent=2, allow_nan=False)+'\n')


if __name__ == '__main__':
    main()
