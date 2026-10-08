"""Experimental upper-source roof, not adoption of the complete diaphragm mesh.

Uses the existing shared RG16F texture. Organs, labels, contact support and registration
remain bitwise unchanged. Only missing projection is extended harmonically. Source
crura/hiatal openings and clinical normality remain unvalidated. Never resizes organs.
"""
import argparse
import gzip
import hashlib
import json
import re
from pathlib import Path
import numpy as np
from scipy.sparse import lil_matrix
from scipy.sparse.linalg import spsolve
from scipy.ndimage import map_coordinates
from costochondral_geometry import YRays

ROOT = Path(__file__).resolve().parents[2]
SOURCE_SHA = '581c17df0c5b9469d4a0081550652b288f9bac03233ce810c81a85140e6dada3'
BASE_RAW_SHA = 'fb1a372f2d2f53bd69d2aea95733cb71ea2574ff6222b8471c5f498c9a1fb67d'
ORIGIN = np.array([-162., -127.5])
DIMENSIONS = [217, 143]
OFFSET = [178, 0, 259]  # XY transposed: 143 x 217 fits a free plane beside digestive tract.
GRADIENT_OFFSET = [178, 0, 260]
PITCH = 1.5


def build(source):
    if hashlib.sha256(source.read_bytes()).hexdigest() != SOURCE_SHA:
        raise ValueError('Unexpected repaired diaphragm source')
    with np.load(source, allow_pickle=False) as m:
        v, f = m['verticesLasMm'], m['triangles']
    rays = YRays(v[:, [0, 2, 1]], f[:, [0, 2, 1]])
    xx, yy = np.meshgrid(ORIGIN[0] + PITCH * np.arange(DIMENSIONS[0]), ORIGIN[1] + PITCH * np.arange(DIMENSIONS[1]))
    u, vv = xx / 160, (yy + 21.106195) / 105
    rho = np.hypot(u, vv)
    q = np.minimum(1, rho / .1)
    edge = -50 + 50 * q * q * (3 - 2 * q) * (np.maximum(0, vv) / np.maximum(rho, 1e-20)) ** 1.5
    upper = np.full(xx.shape, np.nan)
    for j, i in np.argwhere(rho <= 1.02):
        hits = rays.hits(xx[j, i] + 1.23e-7, yy[j, i] + 2.34e-7)
        if len(hits) % 2:
            raise ValueError('Odd source crossings')
        if len(hits):
            upper[j, i] = hits[-1]
    # Roof graph ends at the existing costal rim. It cannot represent descending
    # pillars or vertical multi-interval crossings; preserve these limitations.
    roof = np.where(np.isfinite(upper), np.maximum(edge, upper), edge)
    unknown = (rho < 1) & ~np.isfinite(upper)
    ids = np.full(xx.shape, -1, dtype=int)
    ids[unknown] = np.arange(unknown.sum())
    matrix = lil_matrix((int(unknown.sum()), int(unknown.sum())))
    rhs = np.zeros(int(unknown.sum()))
    for j, i in np.argwhere(unknown):
        k = ids[j, i]
        matrix[k, k] = 4
        for dj, di in [(0, 1), (0, -1), (1, 0), (-1, 0)]:
            if unknown[j + dj, i + di]:
                matrix[k, ids[j + dj, i + di]] = -1
            else:
                rhs[k] += roof[j + dj, i + di]
    roof[unknown] = spsolve(matrix.tocsr(), rhs)
    roof[rho >= 1] = edge[rho >= 1]
    return roof, upper, unknown, edge


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--baseline', type=Path, default=ROOT / 'src/anatomy/abdominal-atlas.gzip.bin', help='Pinned pre-roof atlas; keeps regeneration independent of the installed candidate')
    parser.add_argument('--apply', action='store_true', help='Install experimental derivative in this checkout')
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Evidence output must be new')
    manifest_path = ROOT / 'docs/anatomy/abdominal-atlas-manifest.json'
    manifest = json.loads(manifest_path.read_text())
    raw = gzip.decompress(args.baseline.read_bytes())
    if hashlib.sha256(raw).hexdigest() != BASE_RAW_SHA:
        raise ValueError('Roof must derive from the pinned pre-roof atlas')
    atlas = np.frombuffer(raw, dtype='<f2').reshape(*manifest['textureDimensions'][::-1], 2).copy()
    roof, upper, unknown, edge = build(args.source)
    xx, yy = np.meshgrid(ORIGIN[0] + PITCH * np.arange(DIMENSIONS[0]), ORIGIN[1] + PITCH * np.arange(DIMENSIONS[1]))
    contact = manifest['hepaticDiaphragmRegistration']
    cx, cy, cz = contact['offset']
    nx, ny = contact['dimensions']
    contact_map = atlas[cz, cy:cy + ny, cx:cx + nx].astype(float)
    q = np.array([(yy - contact['originMm'][1]) / PITCH, (xx - contact['originMm'][0]) / PITCH])
    height = map_coordinates(contact_map[:, :, 0], q, order=1, mode='constant', cval=0)
    support = map_coordinates(contact_map[:, :, 1], q, order=1, mode='constant', cval=0)
    final = roof + support * (height - roof)
    x, y, z = OFFSET
    packed_shape = np.array([DIMENSIONS[1], DIMENSIONS[0], 1])
    for offset in [OFFSET, GRADIENT_OFFSET]:
        for field in manifest['fields'] + [contact]:
            lo = np.array(field['offset'])
            hi = lo + np.array(list(field['dimensions']) + ([1] if len(field['dimensions']) == 2 else []))
            if np.all(np.array(offset) < hi) and np.all(np.array(offset) + packed_shape > lo):
                raise ValueError('Derived roof plane overlaps existing anatomy')
    atlas[z, y:y + DIMENSIONS[0], x:x + DIMENSIONS[1], 0] = final.T.astype('<f2')
    atlas[z, y:y + DIMENSIONS[0], x:x + DIMENSIONS[1], 1] = np.isfinite(upper).T.astype('<f2')
    # Smooth nodal slopes of the SAME decoded roof; bilinear interpolation is
    # continuous across cells. These guide projections, never define extra anatomy.
    packed_height = final.astype('<f2').astype(float)
    gy, gx = np.gradient(packed_height, PITCH, edge_order=1)
    dx, dy, dz = GRADIENT_OFFSET
    atlas[dz, dy:dy + DIMENSIONS[0], dx:dx + DIMENSIONS[1], 0] = gx.T.astype('<f2')
    atlas[dz, dy:dy + DIMENSIONS[0], dx:dx + DIMENSIONS[1], 1] = gy.T.astype('<f2')
    previous = np.frombuffer(raw, dtype='<f2').reshape(atlas.shape)
    for field in manifest['fields'] + [contact]:
        fx, fy, fz = field['offset']
        fnx, fny, fnz = list(field['dimensions']) + ([1] if len(field['dimensions']) == 2 else [])
        if not np.array_equal(previous[fz:fz + fnz, fy:fy + fny, fx:fx + fnx], atlas[fz:fz + fnz, fy:fy + fny, fx:fx + fnx]):
            raise ValueError('Anatomy/label/contact support changed')
    updated = atlas.tobytes()
    compressed = gzip.compress(updated, compresslevel=9, mtime=0)
    report = {'sourceRepairedSha256': SOURCE_SHA, 'sourceAtlasSha256': BASE_RAW_SHA,
              'originMm': ORIGIN.tolist(), 'dimensions': DIMENSIONS, 'pitchMm': PITCH, 'offset': OFFSET,
              'packedXYTransposed': True, 'gradientOffset': GRADIENT_OFFSET,
              'gradientMethod': 'Central nodal slopes of decoded half-float roof at 1.5 mm pitch (one-sided at table border), bilinearly interpolated; projection guide, not source normals or extra resolution',
              'sourceRays': int(np.isfinite(upper).sum()),
              'harmonicNodes': int(unknown.sum()), 'sourceBelowCostalRimNodes': int(((upper < edge) & ~unknown).sum()),
              'method': 'Upper source crossing constrained by existing costal rim; harmonic extension only at missing projection; existing hepatic apposition composed once before half-float packing',
              'costalRimEstimatedParameters': {'a': 160, 'b': 105, 'y0': -21.106195, 'edgeZ': -50, 'edgeRise': 50, 'axisCore': .1},
              'organFieldsBitwiseUnchanged': True, 'contactSupportBitwiseUnchanged': True,
              'sourceVerticesMoved': False, 'fullDiaphragmSourceIntegrated': False, 'clinicalValidation': False,
              'status': 'experimental-pending-contacts-images-and-external-validation',
              'limits': 'Roof graph and estimated 2.5 mm acoustic shell, not crura, source thickness, hiatal openings or validated clinical anatomy. Whole-source vascular/esophageal contacts remain blocked.',
              'rawSha256': hashlib.sha256(updated).hexdigest(), 'gzipSha256': hashlib.sha256(compressed).hexdigest(),
              'gzipBytes': len(compressed), 'rawBytesUnchanged': len(updated) == len(raw)}
    args.output.mkdir(parents=True)
    (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    (args.output / 'experimental-atlas.gzip.bin').write_bytes(compressed)
    np.savez_compressed(args.output / 'roof-field.npz', heightMm=final, sourceHeightMm=upper, roofBeforeContactMm=roof, unknown=unknown, originMm=ORIGIN, pitchMm=PITCH)
    if args.apply:
        (ROOT / 'src/anatomy/abdominal-atlas.gzip.bin').write_bytes(compressed)
        manifest['registeredDiaphragmRoof'] = report
        manifest.update({'gzipBytes': len(compressed), 'sha256Raw': report['rawSha256'], 'sha256Gzip': report['gzipSha256']})
        manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
        descriptor = ROOT / 'src/anatomy/abdominalAtlasData.ts'
        text = descriptor.read_text()
        for key in ['gzipBytes', 'sha256Raw', 'sha256Gzip']:
            text = re.sub(r'(' + key + r": )('[^']*'|\d+)", lambda m: m[1] + (repr(manifest[key]) if isinstance(manifest[key], str) else str(manifest[key])), text, count=1)
        text = re.sub(r'\n/\*\* Experimental upper-source graph[^\n]*\*/\nexport const REGISTERED_DOME[^\n]*\n?', '\n', text)
        text = re.sub(r'\nexport const REGISTERED_DOME_GRADIENT[^\n]*\n?', '\n', text)
        text += '\n/** Experimental upper-source graph; missing projection extended, hiatos/crura unvalidated. XY transposed in texture. */\nexport const REGISTERED_DOME = { originMm: [-162, -127.5], dimensions: [217, 143], offset: [178, 0, 259], pitchMm: 1.5 } as const;\nexport const REGISTERED_DOME_GRADIENT = { offset: [178, 0, 260] } as const;\n'
        descriptor.write_text(text)
    print(json.dumps(report))


if __name__ == '__main__':
    main()
