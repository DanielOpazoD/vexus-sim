"""Contrato y exportador P2 offline. No se importa ni instala desde el producto.

Tres distancias por normal de apoyo: banda externa, banda interna e interfaz
interna E. No se llaman fascia/transversalis observadas. El cuarto componente
RG16F guarda región y procedencia independiente de los cuatro valores.
"""
import argparse
from collections import deque
import gzip
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import struct

import numpy as np

FRAME_KEYS = ['person', 'frameId', 'ctSha256', 'shape', 'affineRASmm', 'rasToLASmm', 'pitchMm', 'units']
PROVENANCE = ['U', 'O', 'D', 'E']
REGIONS = [None, 'alba', 'sheath', 'obliques', 'intercostals']
SHAPE = (181, 512, 4)
TILE_SHAPE = (16, 2, 91, 65, 2)
SURFACE_GEOMETRY = {
    'normal': 'unit common skin EDT gradient', 'prismResidualMaxMm': 1.5,
    'organEnvelopeVoxels26': 2, 'skeletonEnvelopeVoxels26': 1,
    'innerInterfaceOffsetMm': 0, 'runtimeProof': False,
}

LOGICAL_SURFACE_GEOMETRY = {
    'normal': 'unit common skin EDT gradient; 13 mm symmetric support',
    'inverse': 'continuous bilinear normal chart; residual <=0.1 mm',
    'organEnvelopeVoxels26': 1, 'sourceVoxelBackoffMm': .5,
    'sourceConstraint': 'all four bilinear nodes',
    'skeleton': 'source O material; never muscle; not a visceral stop',
    'neighborLimitMm': 3, 'costalTransitionLimitMm': 12.0625,
    'costalSourceDistanceMaxMm': 6, 'innerInterfaceOffsetMm': 0,
    'runtimeProof': False,
}


def load_capacity():
    spec = importlib.util.spec_from_file_location('capacity', Path(__file__).with_name('s0028-capacity.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def require_identity(source, case):
    for key in FRAME_KEYS:
        if source.get(key) != case.get(key):
            raise ValueError('fuente/unidades distintas: '+key)
    if source['person'] != 's0028' or source['units'] != 'mm':
        raise ValueError('fuente/unidades P2 inválidas')


def require_record(record):
    bounds = record['boundaries']
    if len(bounds) != 3:
        raise ValueError('tres fronteras obligatorias')
    for value in bounds:
        p, v = value['provenance'], value['value']
        if p not in PROVENANCE or (p == 'U') != (v is None):
            raise ValueError('ausencia no puede convertirse en cero ni promoverse')
        if v is not None and (not np.isfinite(v) or v <= 1.5 or v > 80 or not value.get('source')):
            raise ValueError('orden/ausencia o procedencia de frontera inválida')
    if bounds[2]['provenance'] not in ['E', 'U']:
        raise ValueError('interfaz fina E/U, nunca observada')
    known = [v['value'] for v in bounds if v['value'] is not None]
    if known and (len(known) != 3 or not known[0] < known[1] <= known[2]):
        raise ValueError('orden de fronteras cruzado o incompleto')
    region = record['region']
    p = region['provenance']
    if p not in PROVENANCE or region['value'] not in REGIONS or (p == 'U') != (region['value'] is None):
        raise ValueError('identidad regional desconocida/promovida')
    if p == 'O' and (record.get('regionEvidence') != 'O' or not region.get('source')):
        raise ValueError('identidad U presentada como O; HU no identifica músculos')
    if p == 'D' and (record.get('regionEvidence') not in ['O', 'D'] or not region.get('source')):
        raise ValueError('identidad derivada sin fuente regional')


def require_surface_record(record):
    """Procedencia geométrica r1c independiente de la identidad muscular U."""
    require_record(record)
    row, col = record['cell']
    phi = col*2*np.pi/512
    if not (phi <= 3.55 or phi >= 2*np.pi-.35):
        raise ValueError('posterior U/P3; no anillo renal')
    evidence = record['surfaceEvidence']
    if (evidence['profileCell'] != [row, col] or
            record['sourceProfile'] != f'surface-profile:{row}:{col}' or
            not 0 < evidence['profileStepMm'] <= .75):
        raise ValueError('perfil propio o paso inválido')
    provenance = [v['provenance'] for v in record['boundaries'][:2]]
    if provenance == ['D', 'D']:
        if evidence['method'] != 'own-profile':
            raise ValueError('D requiere perfil propio, no anclas ni anillo')
    elif provenance == ['E', 'E']:
        span = evidence.get('maxHoleSpanMm', np.inf)
        if (evidence['method'] != 'short-surface-gap' or not 0 < span <= 6 or
                len(evidence.get('supportCells', [])) < 3):
            raise ValueError('hueco superficial E sin soporte corto')
    else:
        raise ValueError('perfil de superficie requiere D/D o E/E')
    stop = evidence['organSkeletonStopMm']
    if not np.isfinite(stop) or record['boundaries'][2]['value'] > stop:
        raise ValueError('órgano/esqueleto invade el intervalo de pared')


def require_logical_surface_record(record):
    evidence = record['surfaceEvidence']
    if not 20 <= record['cell'][0] <= 140:
        raise ValueError('fuera de región anotada; conservar U')
    if record['boundaries'][2]['value'] != record['boundaries'][1]['value']:
        raise ValueError('interfaz fina E sin extensión visceral')
    require_surface_record({**record, 'surfaceEvidence': {
        **evidence, 'organSkeletonStopMm': evidence['visceralStopMm']}})
    if record['boundaries'][0]['provenance'] == 'D':
        support = np.asarray(evidence.get('boundarySupportMm', []), dtype=float)
        values = np.array([b['value'] for b in record['boundaries'][:2]])
        if (support.shape != (2, 2) or not np.isfinite(support).all() or
                np.any(support[:, 1] < support[:, 0]) or
                np.any(support[:, 1]-support[:, 0] > 3.00001) or
                np.any(values < support[:, 0]-.001) or
                np.any(values > support[:, 1]+.001)):
            raise ValueError('D sin frontera leída en su propio perfil')


def require_periodic_surface_gaps(surface, annotation):
    """E se mide sobre el hueco completo, también a través de phi=0."""
    code = surface[..., 3].astype(int)//8 % 4
    estimated = code == 3
    if not estimated.any():
        return
    phi = np.arange(512)*2*np.pi/512
    region = np.zeros((181, 512), bool)
    region[20:141, (phi <= 3.55) | (phi >= 2*np.pi-.35)] = True
    hole = region & (code != 2)
    records = {tuple(r['cell']): r for r in annotation.get('records', [])}
    visited = set()
    for start in map(tuple, np.argwhere(estimated)):
        if start in visited:
            continue
        pending, cells = deque([start]), {start}
        while pending:
            r, c = pending.popleft()
            for rr, cc in [(r+1, c), (r-1, c), (r, (c+1) % 512), (r, (c-1) % 512)]:
                if 0 <= rr < 181 and hole[rr, cc] and (rr, cc) not in cells:
                    cells.add((rr, cc))
                    pending.append((rr, cc))
        visited.update(cells)
        for cell in cells:
            if not estimated[cell]:
                continue
            evidence = records.get(cell, {}).get('surfaceEvidence', {})
            declared = {tuple(c) for c in evidence.get('holeCells', [])}
            corners = np.asarray(evidence.get('holeCornersLASmm', []), dtype=float)
            if (declared != cells or corners.shape != (4*len(cells), 3) or
                    not np.isfinite(corners).all()):
                raise ValueError('hueco E periódico incompleto o sin esquinas físicas')
            diameter = max(float(np.max(np.linalg.norm(corners[i:i+128, None]-corners[None], axis=-1)))
                           for i in range(0, len(corners), 128))
            if diameter > 6 or abs(diameter-evidence.get('maxHoleSpanMm', np.inf)) > 1e-5:
                raise ValueError('hueco E físico mayor de 6 mm o diámetro distinto')


def require_logical_surface(surface, annotation):
    """Límite 2D; cada excepción costal queda ligada a evidencia fuente externa."""
    require_periodic_surface_gaps(surface, annotation)
    exceptions = {}
    for edge in annotation.get('transitionEdges', []):
        cells = tuple(tuple(c) for c in edge['cells'])
        distance = np.asarray(edge['sourceCostalDistanceMm'], dtype=float)
        if (len(cells) != 2 or edge.get('anatomy') != 'source-costal-rim' or
                distance.shape != (2,) or not np.isfinite(distance).all() or
                np.any(distance < 0) or np.any(distance > 6) or
                not edge.get('sourceMasksSha256')):
            raise ValueError('transición sin evidencia costal fuente')
        if cells in exceptions:
            raise ValueError('transición costal duplicada')
        exceptions[cells] = edge
    known = np.isfinite(surface[..., :2]).all(-1)
    for r, c in np.argwhere(known):
        for rr, cc in [(r+1, c), (r, (c+1) % 512)]:
            if rr >= 181 or not known[rr, cc]:
                continue
            jump = float(np.max(abs(surface[r, c, :2].astype(float)-surface[rr, cc, :2].astype(float))))
            if jump > 3:
                edge = exceptions.get(((int(r), int(c)), (int(rr), int(cc))))
                if edge is None or jump > LOGICAL_SURFACE_GEOMETRY['costalTransitionLimitMm']:
                    raise ValueError('gradiente superficial sin transición anatómica documentada')


def encode_record(record):
    require_record(record)
    code = REGIONS.index(record['region']['value'])
    for value, factor in zip(record['boundaries'], [8, 32, 128]):
        code += PROVENANCE.index(value['provenance'])*factor
    code += PROVENANCE.index(record['region']['provenance'])*512
    return np.array([*[np.nan if v['value'] is None else v['value'] for v in record['boundaries']], code], '<f2')


def decode_code(value):
    if not np.isfinite(value) or value != int(value) or not 0 <= value <= 2047 or int(value) % 8 >= len(REGIONS):
        raise ValueError('identidad/procedencia no nearest o corrupta')
    code = int(value)
    return code % 8, [PROVENANCE[code//f % 4] for f in [8, 32, 128]], PROVENANCE[code//512]


def require_surface(surface):
    if surface.shape != SHAPE:
        raise ValueError('rejilla de pared distinta')
    for code in np.unique(surface[..., 3]):
        decode_code(float(code))
    code = surface[..., 3].astype(int)
    for i, factor in enumerate([8, 32, 128]):
        unknown = code//factor % 4 == 0
        if not np.array_equal(np.isnan(surface[..., i]), unknown):
            raise ValueError('ausencia no preservada en superficie')
    known = np.isfinite(surface[..., :3]).all(-1)
    if np.any(known & ((surface[..., 0] <= 1.5) | (surface[..., 0] >= surface[..., 1]) |
                      (surface[..., 1] > surface[..., 2]) | (surface[..., 2] > 80))):
        raise ValueError('orden de fronteras en superficie')
    if np.any((code % 8 == 0) != (code//512 == 0)):
        raise ValueError('identidad U presentada como conocida')


def tile_surface(surface):
    require_surface(surface)
    tiles = []
    for z in range(2):
        for phi in range(8):
            block = surface[z*90+np.arange(91)[:, None], (phi*64+np.arange(65)[None, :]) % 512]
            tiles.append(np.stack([block[..., :2], block[..., 2:]], axis=0))
    return np.asarray(tiles, dtype='<f2')


def require_halos(tiles):
    if tiles.shape != TILE_SHAPE:
        raise ValueError('halo: forma de tiles distinta')
    equal = lambda a, b: np.array_equal(a, b, equal_nan=True)
    for z in range(2):
        for phi in range(8):
            if not equal(tiles[z*8+phi, :, :, 64], tiles[z*8+(phi+1) % 8, :, :, 0]):
                raise ValueError('halo phi corrupto')
    for phi in range(8):
        if not equal(tiles[phi, :, 90], tiles[8+phi, :, 0]):
            raise ValueError('halo z corrupto')


def untile_surface(tiles):
    require_halos(tiles)
    result = np.empty(SHAPE, '<f2')
    for z in range(2):
        for phi in range(8):
            block = np.concatenate([tiles[z*8+phi, 0], tiles[z*8+phi, 1]], axis=-1)
            result[z*90:z*90+91, phi*64:phi*64+64] = block[:, :64]
    require_surface(result)
    return result


def require_placement(offset, size, layout):
    if (len(offset) != 3 or len(size) != 3 or
            any(not isinstance(v, int) or v < 0 for v in offset) or
            any(not isinstance(v, int) or v <= 0 for v in size) or
            any(q+s > d for q, s, d in zip(offset, size, layout['dimensions']))):
        raise ValueError('ocupación fuera del atlas')
    for field in layout['occupied']:
        if all(q < r+d and r < q+s for q, s, r, d in zip(offset, size, field['offset'], field['dimensions'])):
            raise ValueError('ocupación de campo ajeno: '+field.get('name', 'campo'))


def require_reviewable(summary):
    if summary['method'] == 'ten-anchor-interpolation':
        raise ValueError('diez anclas no prueban continuidad ni identidad')
    if any(summary[key] for key in ['missingBands', 'unknownRegions', 'collisions']):
        raise ValueError('revisión anatómica incompleta; conservar frontera U/conflicto')


def export(annotation_dir, baseline_dir, out, case):
    """Candidato externo. Verifica/reabre cada parte; nunca cambia el paquete P1."""
    annotation_dir, baseline_dir, out = map(Path, [annotation_dir, baseline_dir, out])
    annotation = json.loads((annotation_dir/'annotation.json').read_text())
    require_identity(annotation['source'], case)
    geometry = {'surface-own-profiles-v1': SURFACE_GEOMETRY,
                'surface-logical-complex-v2': LOGICAL_SURFACE_GEOMETRY}.get(annotation.get('method'))
    if geometry is not None and annotation.get('surfaceGeometry') != geometry:
        raise ValueError('geometría superficial sin margen de celda finita')
    for record in annotation['records']:
        require_record(record)
        if annotation.get('method') == 'surface-own-profiles-v1':
            require_surface_record(record)
        elif annotation.get('method') == 'surface-logical-complex-v2':
            require_logical_surface_record(record)
    tiles = np.frombuffer((annotation_dir/'tiles.f16').read_bytes(), '<f2').reshape(TILE_SHAPE)
    surface = untile_surface(tiles)
    if annotation.get('method') == 'surface-logical-complex-v2':
        require_logical_surface(surface, annotation)
    expected = np.empty(SHAPE, '<f2')
    expected[..., :3], expected[..., 3] = np.nan, 0
    seen = set()
    for record in annotation['records']:
        cell = tuple(record['cell'])
        if len(cell) != 2 or not all(isinstance(v, int) for v in cell) or not (0 <= cell[0] < 181 and 0 <= cell[1] < 512) or cell in seen:
            raise ValueError('muestra/celda ausente, duplicada o fuera de dominio')
        seen.add(cell)
        expected[cell] = encode_record(record)
    if not np.array_equal(surface, expected, equal_nan=True):
        raise ValueError('muestra ausente convertida en valor; payload distinto del trazado')
    baseline_bytes = (baseline_dir/'candidate-manifest.bin').read_bytes()
    manifest = json.loads(baseline_bytes)
    packing = manifest['packing']
    if packing['sourcePhysicalFrameSha256'] != annotation['physicalFrameSha256']:
        raise ValueError('fuente física P1 distinta')
    abdominal = next(a for a in packing['assets'] if a['name'] == 'abdominal')
    occupied = [{**f, 'name': f['name']} for f in abdominal['fields']]
    occupied.append({'name': 'body-depth', 'offset': abdominal['depthOffset'], 'dimensions': manifest['depth']['dimensions']})
    layout = {'dimensions': abdominal['textureDimensions'], 'occupied': occupied}
    placements = annotation['placements']
    if len(placements) != 16:
        raise ValueError('16 tiles obligatorios')
    for i, offset in enumerate(placements):
        require_placement(offset, [65, 91, 2], layout)
        occupied.append({'name': 'wall-'+str(i), 'offset': offset, 'dimensions': [65, 91, 2]})
    require_placement(annotation['centerOffset'], [1, 181, 1], layout)
    cap_file = baseline_dir/'annotation-capacity.gzip.bin'
    original = gzip.decompress(cap_file.read_bytes())
    raw = bytearray(original)
    magic, count = struct.unpack_from('<4sI', raw)
    header = json.loads(raw[8:8+count])
    if magic != b'S28C':
        raise ValueError('capacidad P1 inválida')
    part = next(p for p in header['parts'] if p['name'] == 'wall')
    centers = (annotation_dir/'centers.f16').read_bytes()
    if len(centers) != 724 or not np.isfinite(np.frombuffer(centers, '<f2')).all():
        raise ValueError('centro Y inválido')
    payload = tiles.tobytes()+centers
    load_capacity().require_wall_budget(len(payload), 0, 0, 0, 0)
    start = part['offsetBytes']
    raw[start:start+len(payload)] = payload
    part.update(format='s0028-wall-regional-v1; 16 RG16F tiles 65x91x2 + 181 RG16F centers; remainder unused',
                payloadBytes=len(payload), ownerReview='pending')
    encoded_header = json.dumps(header, separators=(',', ':')).encode()
    if len(encoded_header)+8 > 4096:
        raise ValueError('presupuesto cabecera capacidad')
    raw[:4096] = bytes(4096)
    raw[:8] = struct.pack('<4sI', b'S28C', len(encoded_header))
    raw[8:8+len(encoded_header)] = encoded_header
    descriptor = {
        'format': 's0028-wall-regional-v1', 'annotationId': annotation['id'],
        'sourceSha256': hashlib.sha256((annotation_dir/'annotation.json').read_bytes()).hexdigest(),
        'dimensions': [512, 181], 'zMm': [-210, 60], 'tileSize': [65, 91, 2],
        'placements': placements, 'centerOffset': annotation['centerOffset'],
        'payloadBytes': len(payload), 'payloadSha256': hashlib.sha256(payload).hexdigest(),
        'channels': ['grossBandOuter', 'grossBandInner', 'innerInterfaceE', 'regionProvenanceNearest'],
        'code': 'region[0:2]; provenance outer[3:4],inner[5:6],interface[7:8],region[9:10]; U=0 O=1 D=2 E=3',
        'unknown': 'NaN boundary, region=0; no zero fill or interpolation through U',
        'skinMm': {'value': 1.5, 'provenance': 'E'},
        'review': 'pending-owner', 'runtimeInstalled': False, 'posterior': 'U/P3',
    }
    if geometry is not None:
        descriptor['surfaceGeometry'] = annotation['surfaceGeometry']
    meta = json.dumps(descriptor, separators=(',', ':')).encode()
    header_delta = max(0, len(encoded_header)-count)
    load_capacity().require_wall_budget(len(payload), len(meta)+header_delta, 0, 0, 0)
    compressed = gzip.compress(raw, compresslevel=9, mtime=0)
    if raw[4096:start] != original[4096:start] or raw[start+len(payload):] != original[start+len(payload):]:
        raise ValueError('ocupación de reserva ajena')
    with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as stream:
        for offset in range(0, len(raw), 65536):
            if stream.read(65536) != raw[offset:offset+65536]:
                raise ValueError('capacidad reabierta corrupta')
        if stream.read(1):
            raise ValueError('capacidad reabierta con cola')
    out.mkdir(parents=True, exist_ok=True)
    (out/'annotation-capacity.gzip.bin').write_bytes(compressed)
    manifest['wallP2Offline'] = descriptor
    manifest['capacity'].update(downloadBytes=len(compressed), sha256=hashlib.sha256(raw).hexdigest(),
                                sha256Gzip=hashlib.sha256(compressed).hexdigest(), anatomyAnnotated=False,
                                compressionCredit=len(raw)-len(compressed))
    for record in manifest['files']:
        if record['file'] == cap_file.name:
            record.update(bytes=len(compressed), sha256=hashlib.sha256(compressed).hexdigest())
    candidate = (json.dumps(manifest, indent=2, ensure_ascii=False)+'\n').encode()
    (out/'candidate-manifest.bin').write_bytes(candidate)
    metadata_delta = len(candidate)-len(baseline_bytes)
    load_capacity().require_wall_budget(len(payload), max(len(meta), metadata_delta)+header_delta, 0, 0, 0)
    files = []
    for path in sorted(baseline_dir.iterdir()):
        if path.suffix != '.bin':
            continue
        chosen = out/path.name if (out/path.name).exists() else path
        content = chosen.read_bytes()
        if path.name.endswith('.gzip.bin'):
            with gzip.GzipFile(fileobj=io.BytesIO(content)) as stream:
                while stream.read(65536):
                    pass
        files.append({'file': path.name, 'path': str(chosen), 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()})
    # El perfil abdominal compartido viaja también al activar s0028 (decisión 319).
    profile = baseline_dir.parent/'abdominal-body.bin'
    content = profile.read_bytes()
    files.append({'file': profile.name, 'path': str(profile), 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()})
    before = sum(p.stat().st_size for p in baseline_dir.glob('*.bin'))+len(content)
    after = sum(f['bytes'] for f in files)
    increment = after-before
    if increment > 850000 or after > 25000000:
        raise ValueError('presupuesto descarga P2 excedido')
    report = {'files': files, 'baselineDownloadBytes': before, 'candidateDownloadBytes': after,
              'incrementBytes': increment, 'gzipCapacityBytes': len(compressed), 'payloadBytes': len(payload),
              'metadataBytes': max(len(meta), metadata_delta)+header_delta, 'metadataDeltaBytes': metadata_delta,
              'atlasIncrementBytes': 0, 'rawReservationIncrementBytes': 0, 'thoracicIncrementBytes': 0,
              'additionalTemporaryBudgetBytes': 16000000, 'peakMetalMeasured': False,
              'offlineOnly': True, 'ownerReview': 'pending', 'globalAnatomyAnnotated': False}
    (out/'budget.json').write_text(json.dumps(report, indent=2)+'\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--annotation', type=Path, required=True)
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    case = json.loads(Path(__file__).with_name('s0028-case.json').read_text())
    print(json.dumps(export(args.annotation, args.baseline, args.out, case), indent=2))
