"""Banco bilateral offline; no modifica el runtime ni descarga modelos.
Uso y alcance: docs/anatomy/COSTOCHONDRAL_BENCHMARK.md.
"""
import argparse
import hashlib
import json
import platform
from pathlib import Path
import numpy as np
import scipy
from scipy.ndimage import label, generate_binary_structure
from costochondral_geometry import (CENTRE_Y, HASHES, PAIRS, load_mesh, surface_samples,
    summary, TriangleQuery, YRays, profile_field, profile_mesh, topology)


def connectivity(mask):
    result = {}
    for neighbours, order in [(6, 1), (26, 3)]:
        labels, count = label(mask, generate_binary_structure(3, order))
        volumes = np.bincount(labels.ravel())[1:]
        spans = []
        for axis in range(3):
            low = np.unique(np.take(labels, 0, axis=axis))
            high = np.unique(np.take(labels, -1, axis=axis))
            common = np.intersect1d(low[low > 0], high[high > 0])
            spans.append(bool(len(common)))
        result[str(neighbours)] = {'components': int(count), 'occupiedVoxels': int(mask.sum()),
            'largestComponentVoxels': int(volumes.max()) if len(volumes) else 0,
            'spansRoiFacesXYZ': spans}
    return result


def skin_relation(points, rays):
    outer, inner, shell, beyond, unmatched = [], [], 0, 0, 0
    minima = []; intersections = []
    for p in points:
        hits = rays.hits(p[0], p[2]); anterior = hits[hits > CENTRE_Y]
        if len(anterior) != 2:
            unmatched += 1; intersections.append(None)
            continue
        hi, lo = anterior[-1], anterior[-2]
        intersections.append([float(lo), float(hi)])
        outer.append(hi-p[1]); inner.append(lo-p[1])
        shell += int(lo <= p[1] <= hi); beyond += int(p[1] > hi)
        minima.append((float(hi-p[1]), p.tolist(), hits.tolist()))
    return {'matchedSamples': len(outer), 'ambiguousOrMissingAnteriorRays': unmatched,
        'outerYClearanceMm': summary(outer), 'innerYClearanceMm': summary(inner),
        'withinOriginalSkinShellSamples': shell, 'beyondOuterSamples': beyond,
        'minimumOuterSamples': sorted(minima)[:3]}, intersections


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--atlas', type=Path, required=True)
    parser.add_argument('--candidate', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--baseline-points', type=Path, required=True)
    parser.add_argument('--angular', type=int, default=64)
    parser.add_argument('--circumference', type=int, default=64)
    parser.add_argument('--pitches', type=float, nargs='+', default=[.5, .25])
    args = parser.parse_args()
    if args.angular < 4 or args.circumference < 4 or not all(np.isfinite(p) and p > 0 for p in args.pitches):
        parser.error('Resoluciones numéricas inválidas')
    if args.output.exists() or args.baseline_points.exists():
        parser.error('Las salidas deben ser nuevas; no sobrescribir archivos')
    data = json.loads(args.candidate.read_text()); parts = data['parts']
    if len(parts) != 4:
        parser.error('Se requieren cuatro piezas bilaterales')
    for part in parts:
        r = np.asarray(part['rows'])
        if part['sha256'] != HASHES.get(part['id']) or PAIRS.get(part['side'], {}).get(part['tissue']) != part['id']:
            parser.error('Procedencia de candidata inválida')
        if r.shape != (16, 6) or not np.isfinite(r).all() or (np.diff(r[:, 0]) <= 0).any() or (r[:, 3:5] <= 0).any():
            parser.error('Perfil inválido')
    meshes = {element: load_mesh(args.atlas, element) for element in HASHES}
    rays = YRays(*meshes['FJ2810'])
    report = {'oracle': {'sourceSha256': HASHES, 'rigidRegistration': 'LPS origin[-.3152345,-205.92635,1164.5735] to LAS[0,85.25,0]; y reflection with reversed winding',
        'surfaceSamples': 'all used vertices + all triangle centroids; unweighted; coincident positions retained',
        'sourceToFieldDistance': 'exact point/triangle distance to a triangulated candidate zero-level shell, not exact continuous Hausdorff',
        'fieldToSourceDistance': 'candidate zero-shell vertices + triangle centroids to exact original triangles',
        'skin': 'original closed triangle y-ray intersections; anterior outer/inner only when exactly two anterior hits',
        'connectivity': 'whole original mesh topology + joint ROI voxel solid/void connectivity; void is free space, NOT vascular lumen',
        'clinicalTolerance': None, 'clinicalValidation': False},
        'candidateSha256': hashlib.sha256(args.candidate.read_bytes()).hexdigest(),
        'software': {'python': platform.python_version(), 'numpy': np.__version__, 'scipy': scipy.__version__},
        'sampling': {'angular': args.angular, 'circumference': args.circumference, 'voxelPitchesMm': args.pitches},
        'parts': [], 'joints': [], 'representation': {'rawFloat32ProfileBytes': sum(np.asarray(p['rows']).size*4 for p in parts),
            'rawFloat64ProfileBytes': sum(np.asarray(p['rows']).size*8 for p in parts), 'rowCount': 64,
            'runtimeDeltaBytes': 0, 'candidateIntegrated': False}}
    all_source_points, all_candidate_points, candidate_meshes = [], [], []
    baseline = {'format': 'vexus-costochondral-oracle-v1', 'sourceSha256': HASHES, 'parts': []}
    for part in parts:
        print('Auditar superficie', part['id'], flush=True)
        v, f = meshes[part['id']]; points = surface_samples(v, f)
        cv, cf = profile_mesh(part, args.angular, args.circumference)
        candidate_points = surface_samples(cv, cf)
        all_source_points.append(points); all_candidate_points.append(candidate_points); candidate_meshes.append((cv, cf))
        candidate_query = TriangleQuery(cv, cf)
        row = {'id': part['id'], 'side': part['side'], 'tissue': part['tissue'],
            'sourceTopology': topology(v, f), 'candidateTopology': topology(cv, cf),
            'sourceToTriangulatedZeroShellMm': summary(candidate_query.distance(points)),
            'triangulatedZeroShellToOriginalMm': summary(TriangleQuery(v, f).distance(candidate_points)),
            'sourceAbsApproximateFieldMm': summary(abs(profile_field(points, part))),
            'triangulatedZeroShellAbsFieldMm': summary(abs(profile_field(candidate_points, part)))}
        if part['tissue'] == 'cartilage':
            row['originalSkinRelation'], source_skin_y = skin_relation(points, rays)
            row['candidateSkinRelation'], _ = skin_relation(candidate_points, rays)
        report['parts'].append(row)
        baseline_part = {'id': part['id'], 'side': part['side'], 'tissue': part['tissue'], 'points': points.tolist()}
        if part['tissue'] == 'cartilage':
            baseline_part['skinAnteriorY'] = source_skin_y
        baseline['parts'].append(baseline_part)
    def combined(items):
        vertices, faces, offset = [], [], 0
        for v, f in items:
            vertices.append(v); faces.append(f+offset); offset += len(v)
        return np.concatenate(vertices), np.concatenate(faces)
    print('Auditar unión de las cuatro superficies', flush=True)
    report['bilateralUnion'] = {
        'sourceToTriangulatedZeroShellMm': summary(TriangleQuery(*combined(candidate_meshes)).distance(np.concatenate(all_source_points))),
        'triangulatedZeroShellToOriginalMm': summary(TriangleQuery(*combined([meshes[p['id']] for p in parts])).distance(np.concatenate(all_candidate_points)))}
    for side, pair in PAIRS.items():
        print('Auditar unión', side, flush=True)
        by_kind = {p['tissue']: p for p in parts if p['side'] == side}
        joint = {'side': side, 'patches': [], 'voxelConnectivity': []}; patch_points = []
        for tissue, other in [('bone', 'cartilage'), ('cartilage', 'bone')]:
            v, f = meshes[pair[tissue]]; points = v[np.unique(f)]
            distance = TriangleQuery(*meshes[pair[other]]).distance(points)
            own = profile_field(points, by_kind[tissue]); cross = profile_field(points, by_kind[other])
            patch_points.extend(points[distance <= .5])
            baseline_part = next(p for p in baseline['parts'] if p['id'] == pair[tissue])
            # Used vertices lead the sample array; remaining centroids are not patch-selected here.
            baseline_part['contactBands'] = [{ 'maxExactSourceDistanceMm': bin_mm,
                'sampleIndices': np.flatnonzero(distance <= bin_mm).tolist()} for bin_mm in [.03, .1, .5]]
            for bin_mm in [.03, .1, .5]:
                mask = distance <= bin_mm
                if mask.any():
                    joint['patches'].append({'sourceId': pair[tissue], 'maxExactSourceDistanceMm': bin_mm,
                        'sourceOwnAbsFieldMm': summary(abs(own[mask])), 'otherAbsFieldMm': summary(abs(cross[mask]))})
        patch_points = np.asarray(patch_points)
        if not len(patch_points):
            raise ValueError('Fuente sin región de unión observada: ' + side)
        padding = 2*max(args.pitches)
        lo, hi = patch_points.min(axis=0)-padding, patch_points.max(axis=0)+padding
        joint['roi'] = {'minLasMm': lo.tolist(), 'maxLasMm': hi.tolist(),
            'selection': 'AABB of original used vertices <=0.5mm from other mesh plus two coarsest voxels; computational ROI, NOT anatomical tolerance'}
        for pitch in args.pitches:
            axes = [np.arange(a+pitch/2, b, pitch) for a, b in zip(lo, hi)]
            grids = np.meshgrid(*axes, indexing='ij'); points = np.stack(grids, axis=-1).reshape(-1, 3)
            shape = tuple(len(a) for a in axes)
            source_masks, odd = [], []
            for tissue in ['bone', 'cartilage']:
                m, ambiguous = YRays(*meshes[pair[tissue]]).classify_grid(*axes)
                source_masks.append(m); odd.append(ambiguous)
            source = source_masks[0] | source_masks[1]
            fields = [profile_field(points, by_kind[tissue]).reshape(shape) <= 0 for tissue in ['bone', 'cartilage']]
            candidate = fields[0] | fields[1]
            joint['voxelConnectivity'].append({'pitchMm': pitch, 'shape': shape, 'oddSourceRayLines': odd,
                'sourceSolid': connectivity(source), 'candidateSolid': connectivity(candidate),
                'sourceVoid': connectivity(~source), 'candidateVoid': connectivity(~candidate),
                'sourceOverlapVoxels': int((source_masks[0] & source_masks[1]).sum()),
                'candidateOverlapVoxels': int((fields[0] & fields[1]).sum()),
                'classificationDisagreementVoxels': int((source != candidate).sum()),
                'subVoxelNativeGapsResolved': False})
        report['joints'].append(joint)
    for path, obj in [(args.output, report), (args.baseline_points, baseline)]:
        with path.open('x') as out:
            out.write(json.dumps(obj, indent=2, allow_nan=False)+'\n')
    print('Banco completado; parámetros y oráculos registrados. Sin cambios runtime.', flush=True)


if __name__ == '__main__':
    main()
