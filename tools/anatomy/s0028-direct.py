"""P0c offline: atlas RG16F directo, gas categórico recuperable y padding real."""
import argparse
import gzip
import hashlib
import itertools
import json
from pathlib import Path
import time

import numpy as np

def save(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False)+'\n')


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def pack_boxes(rows, width, height):
    # Extreme points; exact non-overlap and one empty guard texel between bricks.
    boxes = []
    for row in rows:
        size = [v+1 for v in row['dimensions']]
        axes = [{0} | {p[i]+d[i] for p, d, _ in boxes} for i in range(3)]
        best = None
        for z, y, x in itertools.product(sorted(axes[2]), sorted(axes[1]), sorted(axes[0])):
            p = (x, y, z)
            if x+size[0] > width+1 or y+size[1] > height+1:
                continue
            if any(all(p[i] < q[i]+d[i] and q[i] < p[i]+size[i] for i in range(3)) for q, d, _ in boxes):
                continue
            depth = max([z+size[2]]+[q[2]+d[2] for q, d, _ in boxes])-1
            score = (depth, z, y, x)
            if best is None or score < best[0]:
                best = (score, p)
        if best is None:
            return None
        boxes.append((best[1], size, row['name']))
    depth = max(p[2]+d[2] for p, d, _ in boxes)-1
    return {'textureDimensions': [width, height, depth], 'rawBytes': width*height*depth*4,
            'offsets': {n: list(p) for p, _, n in boxes}}


def search(rows):
    orders = [sorted(rows, key=lambda r: -np.prod(r['dimensions'])),
              sorted(rows, key=lambda r: -r['dimensions'][2]),
              sorted(rows, key=lambda r: -r['dimensions'][0]*r['dimensions'][1])]
    wx = max(r['dimensions'][0] for r in rows)
    hy = max(r['dimensions'][1] for r in rows)
    trials = []
    for w, h in itertools.product(sorted({wx, 192, 224, 256, 280, 320, 384, 448, 512}),
                                  sorted({hy, 144, 160, 192, 224, 256, 280, 320, 384})):
        if w < wx or h < hy:
            continue
        for order in orders:
            result = pack_boxes(order, w, h)
            if result:
                trials.append(result)
    return min(trials, key=lambda r: (r['rawBytes'], max(r['textureDimensions'])))


def load_fields(source):
    meta = json.loads((source/'fields.json').read_text())
    rows = [r for r in meta['fields'] if r['status'] == 'source' or r['name'] == 'digestiveGas']
    if len(rows) != 20 or len({r['name'] for r in rows}) != 20:
        raise ValueError('Se requieren los 20 campos')
    fields = {}
    for r in rows:
        packed = (source/(r['name']+'.gzip.bin')).read_bytes()
        raw = gzip.decompress(packed)
        if sha(raw) != r['sha256Raw'] or sha(packed) != r['sha256Gzip']:
            raise ValueError('Campo fuente alterado')
        fields[r['name']] = np.frombuffer(raw, '<f2').reshape(*r['dimensions'][::-1], 2).copy()
    return meta, rows, fields


def encode_gas(gut, gas):
    if gut.shape != gas.shape:
        raise ValueError('Gas y digestivo no comparten rejilla')
    result = gut.copy()
    occupied = gas[..., 0] < 0
    if np.any(occupied & (gut[..., 0] >= 0)):
        raise ValueError('Gas fuera de máscara digestiva')
    result[..., 1] += 128*occupied
    if not np.array_equal(result[..., 1] >= 128, occupied):
        raise ValueError('Gas no recuperado')
    if not np.array_equal(np.mod(result[..., 1], 128), gut[..., 1]):
        raise ValueError('Etiqueta digestiva perdida')
    return result


def run(source, out):
    out.mkdir(parents=True, exist_ok=True)
    meta, rows, fields = load_fields(source)
    gas = fields['digestiveGas']
    fields['digestiveTract'] = encode_gas(fields['digestiveTract'], gas)
    gas_report = {'occupiedVoxels': int((gas[..., 0] < 0).sum()), 'occupiedExact': True,
                  'sourceRawBytes': gas.nbytes, 'packedAdditionalRawBytes': 0,
                  'digestiveLabelsExact': True, 'gasSdfStored': False,
                  'meaning': 'nearest occupied bit, same 1.5mm lattice; not trilinear gas SDF'}
    # Nearest gas does not preserve the continuous zero. Quantify it rather than imply equivalence.
    raw_labels = (gas[..., 0] < 0).astype(np.uint8)
    from scipy import ndimage as ndi
    labels, count = ndi.label(raw_labels)
    gas_report['components6'] = count
    recovered = (fields['digestiveTract'][..., 1] >= 128).astype(np.uint8)
    _, recovered_count = ndi.label(recovered)
    gas_report['recoveredComponents6'] = recovered_count
    # Band trim is exact only if every removed R node is clipped16. Source labels outside support
    # are not discarded here: preserve their bits too. Thus no unjustified crop is credited.
    assets = []
    for asset, limit in [('abdominal', 139921010), ('thoracic', 60413664)]:
        selected = [r for r in rows if r['asset'] == asset and r['name'] != 'digestiveGas']
        started = time.perf_counter()
        packing = search(selected)
        width, height, depth = packing['textureDimensions']
        atlas = np.zeros((depth, height, width, 2), '<f2')
        atlas[..., 0] = 16
        descriptors = []
        for r in selected:
            x, y, z = packing['offsets'][r['name']]
            dx, dy, dz = r['dimensions']
            atlas[z:z+dz, y:y+dy, x:x+dx] = fields[r['name']]
            descriptors.append({**r, 'offset': [x, y, z],
                                'storedSha256Raw': sha(fields[r['name']].tobytes()),
                                'sha256RawMeaning': 'source descriptor; storedSha256Raw includes nearest gas bit'})
        raw = atlas.tobytes()
        compressed = gzip.compress(raw, compresslevel=9, mtime=0)
        file = out/(asset+'-direct.gzip.bin')
        file.write_bytes(compressed)
        decoded = np.frombuffer(gzip.decompress(file.read_bytes()), '<f2').reshape(atlas.shape)
        for r in descriptors:
            x, y, z = r['offset']; dx, dy, dz = r['dimensions']
            if not np.array_equal(decoded[z:z+dz, y:y+dy, x:x+dx].view('<u2'), fields[r['name']].view('<u2')):
                raise ValueError('Atlas no recupera campo')
        field_bytes = sum(fields[r['name']].nbytes for r in selected)
        record = {'name': asset, **packing, 'fieldsRawBytes': field_bytes,
                  'paddingBytes': len(raw)-field_bytes, 'gzipBytes': len(compressed),
                  'file': file.name, 'sha256Raw': sha(raw), 'sha256Gzip': sha(compressed),
                  'rawLimitBytes': limit, 'textureMarginBytes': limit-len(raw),
                  'packingSeconds': time.perf_counter()-started, 'fields': descriptors,
                  'allBricksDecodedExact': True, 'max3d256Pass': max(packing['textureDimensions']) <= 256}
        assets.append(record)
        print(json.dumps({k: v for k, v in record.items() if k not in ['fields', 'offsets']}), flush=True)
    result = {'sourcePhysicalFrameSha256': meta['physicalFrameSha256'], 'pitchMm': 1.5,
              'fieldCount': len(rows), 'physicalBricks': 19, 'gas': gas_report,
              'assets': assets, 'supportCropCreditedBytes': 0,
              'gasAliasDescriptor': next(r for r in rows if r['name'] == 'digestiveGas'),
              'runtimeInstalled': False, 'clinicalValidation': False}
    save(out/'packing.json', result)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    a = p.parse_args()
    run(a.source, a.out)
