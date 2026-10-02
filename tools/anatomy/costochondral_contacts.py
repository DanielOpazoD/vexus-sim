"""Distancias geométricas en toda la unión muestreada, ambos lados y resoluciones.
Complementa el banco global/voxel; sólo archivos locales, sin nuevas candidatas.
"""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from costochondral_geometry import HASHES, PAIRS, load_mesh, surface_samples, TriangleQuery, profile_mesh, summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--atlas', type=Path, required=True)
    parser.add_argument('--candidate', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Salida debe ser nueva')
    parts = json.loads(args.candidate.read_text())['parts']
    if {(p['side'], p['tissue'], p['id']) for p in parts} != {(side, kind, element) for side, pair in PAIRS.items() for kind, element in pair.items()}:
        parser.error('Piezas bilaterales incompletas')
    for p in parts:
        rows = np.asarray(p['rows'])
        if p['sha256'] != HASHES[p['id']] or rows.shape != (16, 6) or not np.isfinite(rows).all() or (np.diff(rows[:, 0]) <= 0).any() or (rows[:, 3:5] <= 0).any():
            parser.error('Perfil/procedencia inválidos')
    meshes = {p['id']: load_mesh(args.atlas, p['id']) for p in parts}
    source_queries = {name: TriangleQuery(*mesh) for name, mesh in meshes.items()}
    groups = []
    for side, pair in PAIRS.items():
        for kind, other in [('bone', 'cartilage'), ('cartilage', 'bone')]:
            points = surface_samples(*meshes[pair[kind]])
            distance = source_queries[pair[other]].distance(points)
            keep = distance <= .5
            groups.append((side, kind, other, points[keep], distance[keep]))
    results = []
    for resolution in [64, 128]:
        queries = {p['id']: TriangleQuery(*profile_mesh(p, resolution, resolution)) for p in parts}
        for side, kind, other, points, original_distance in groups:
            own = queries[PAIRS[side][kind]].distance(points)
            cross = queries[PAIRS[side][other]].distance(points)
            for bin_mm in [.03, .1, .5]:
                mask = original_distance <= bin_mm
                if mask.any():
                    results.append({'resolution': resolution, 'side': side, 'sourceId': PAIRS[side][kind],
                        'maxExactOriginalOtherDistanceMm': bin_mm,
                        'originalOtherDistanceMm': summary(original_distance[mask]),
                        'ownCandidateTriangleDistanceMm': summary(own[mask]),
                        'otherCandidateTriangleDistanceMm': summary(cross[mask])})
        print('Contacto bilateral completado', resolution, flush=True)
    report = {'method': 'All used source vertices + all triangle centroids in complete sampled proximity bands; exact point/triangle distances to each candidate zero-shell piece, both directions of bone/cartilage contact. Bands descriptive, not anatomical tolerances. Complements global bidirectional and voxel bank.',
        'candidateSha256': hashlib.sha256(args.candidate.read_bytes()).hexdigest(), 'sourceSha256': HASHES,
        'candidateIntegrated': False, 'clinicalValidation': False, 'results': results}
    with args.output.open('x') as out:
        out.write(json.dumps(report, indent=2, allow_nan=False)+'\n')


if __name__ == '__main__':
    main()
