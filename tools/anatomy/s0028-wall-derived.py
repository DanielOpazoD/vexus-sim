"""Bloque derivado OFFLINE de la carta de pared s0028 para el runtime P2. No se importa desde el producto.

No es anatomía nueva ni anotación: sale sólo del payload r1c ya fijado (fronteras y procedencia) y de la piel
polar de la misma persona, y queda en la reserva de pared tras ese payload (atlas, RAW y tórax +0 B). Todo lo
que contiene es E (estimado) y va rotulado:

 - E por nodo (512×181 RG16F, fila mayor): R = cara interna (interfaz) del nodo conocido más cercano a ≤ 12 mm,
   por distancia euclídea entre las semillas de piel de los dos nodos; G = código del desplazamiento al nodo
   fuente, (Δfila + 8)·32 + (Δcolumna + 16); 272 es el propio nodo conocido. Sin nodo conocido a ≤ 12 mm: NaN/NaN
   (U, sin pared). Lo usa sólo el contacto de la sonda en CPU: un nodo U comprime contra esa cara rotulada E.
 - Rampa respiratoria por fila (181 RG16F): p10/p90 de la cara interna conocida de la fila (ventana simétrica de
   filas hasta reunir 32 nodos conocidos: las filas sin anotar toman las anotadas más cercanas). La usan CPU y GPU
   (columna [0, 0, 653] del atlas, hueco libre con relleno finito alrededor) para el peso respiratorio de las celdas U.

Se busca aquí, una vez: el runtime y la GPU no buscan.
"""
import argparse
import gzip
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import struct

import numpy as np

RADIUS_MM = 12.0
ROW_REACH = 8
COL_REACH = 15
SELF_CODE = 8*32+16
MIN_RAMP_NODES = 32
MIN_RAMP_SPAN_MM = 1.0
E_MAP_BYTES = 512*181*4
RAMP_BYTES = 181*4
RAMP_OFFSET = [0, 0, 653]
# La GPU lee la rampa con el filtro lineal del atlas a lo largo de x (filas lo/hi en una lectura): sus vecinos en y y z
# deben ser relleno finito del atlas, nunca una tesela con huecos U NaN (NaN·0 = NaN).
RAMP_HALO = ([0, 0, 652], [182, 2, 3])
FORMAT = 's0028-wall-derived-v1'


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name('s0028-'+name+'.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def code_of(dj, di):
    return (dj+8)*32+(di+16)


def offset_of(code):
    code = int(code)
    return code//32-8, code % 32-16


def skin_seeds(skin, meta):
    """Semilla de piel de cada nodo (fila j, columna i): la misma interpolación que `skinSeed` en s0028Wall.ts."""
    if skin.shape != (meta['dimensions'][1], meta['dimensions'][0], 2):
        raise ValueError('piel polar con forma distinta')
    z = -210+1.5*np.arange(181)
    row = np.clip((z-meta['originZMm'])/meta['pitchZMm'], 0, skin.shape[0]-1)
    y = np.minimum(skin.shape[0]-2, np.floor(row)).astype(int)
    fy = row-y
    cols = (np.arange(512)*skin.shape[1]//512) % skin.shape[1]
    a = skin[y][:, cols].astype(np.float64)
    b = skin[y+1][:, cols].astype(np.float64)
    xy = a+fy[:, None, None]*(b-a)
    return np.concatenate([xy, np.broadcast_to(z[:, None, None], (181, 512, 1))], -1)


def known_nodes(surface):
    return np.isfinite(surface[..., :3]).all(-1)


def nearest_known(surface, seeds):
    """Código del nodo conocido más cercano a ≤ 12 mm (desempate: |Δfila|, |Δcolumna|, Δfila, Δcolumna)."""
    known = known_nodes(surface)
    best = np.full((181, 512), np.inf)
    code = np.full((181, 512), -1, int)
    code[known] = SELF_CODE
    best[known] = 0
    offsets = sorted(((dj, di) for dj in range(-ROW_REACH, ROW_REACH+1) for di in range(-COL_REACH, COL_REACH+1)
                      if (dj, di) != (0, 0)), key=lambda o: (abs(o[0]), abs(o[1]), o[0], o[1]))
    rows, cols = np.meshgrid(np.arange(181), np.arange(512), indexing='ij')
    for dj, di in offsets:
        sj, si = rows+dj, (cols+di) % 512
        inside = (sj >= 0) & (sj <= 180)
        sj = np.clip(sj, 0, 180)
        d = np.linalg.norm(seeds[sj, si]-seeds, axis=-1)
        take = inside & ~known & known[sj, si] & (d <= RADIUS_MM) & (d < best)
        best[take] = d[take]
        code[take] = code_of(dj, di)
    return code, best


def e_map(surface, seeds):
    code, distance = nearest_known(surface, seeds)
    out = np.full((181, 512, 2), np.nan, '<f2')
    j, i = np.nonzero(code >= 0)
    dj, di = code[j, i]//32-8, code[j, i] % 32-16
    out[j, i, 0] = surface[j+dj, (i+di) % 512, 2]
    out[j, i, 1] = code[j, i]
    return out, distance


def ramps(surface):
    known = known_nodes(surface)
    iface = surface[..., 2].astype(np.float64)
    out = np.empty((181, 2))
    reach = np.empty(181, int)
    for j in range(181):
        for k in range(181):
            lo, hi = max(0, j-k), min(180, j+k)
            values = iface[lo:hi+1][known[lo:hi+1]]
            if values.size >= MIN_RAMP_NODES:
                break
        else:
            raise ValueError('rampa sin cara interna conocida')
        p10, p90 = np.percentile(values, [10, 90])
        out[j] = p10, max(p90, p10+MIN_RAMP_SPAN_MM)
        reach[j] = k
    half = out.astype('<f2')
    if not (np.isfinite(half).all() and (half[:, 1] > half[:, 0]).all() and (half[:, 0] > 1.5).all()):
        raise ValueError('rampa por fila inválida')
    return half, reach


def require_e_map(e, surface):
    """El mapa sólo copia caras internas conocidas y su código apunta a un nodo conocido; U sigue NaN/NaN."""
    known = known_nodes(surface)
    if e.shape != (181, 512, 2):
        raise ValueError('mapa E con forma distinta')
    if not np.array_equal(np.isnan(e[..., 0]), np.isnan(e[..., 1])):
        raise ValueError('mapa E con valor sin fuente')
    if not (np.array_equal(e[known, 0].view('<u2'), surface[known, 2].astype('<f2').view('<u2')) and (e[known, 1] == SELF_CODE).all()):
        raise ValueError('nodo conocido sin su propia cara interna')
    j, i = np.nonzero(~known & np.isfinite(e[..., 1]))
    for jj, ii in zip(j, i):
        dj, di = offset_of(e[jj, ii, 1])
        sj, si = jj+dj, (ii+di) % 512
        if (dj, di) == (0, 0) or not 0 <= sj <= 180 or not known[sj, si]:
            raise ValueError('mapa E apunta a un nodo U')
        if e[jj, ii, 0].view('<u2') != surface[sj, si, 2].astype('<f2').view('<u2'):
            raise ValueError('mapa E con otra cara')


def derive_block(surface, seeds):
    e, distance = e_map(surface, seeds)
    require_e_map(e, surface)
    ramp, reach = ramps(surface)
    block = e.tobytes()+ramp.tobytes()
    if len(block) != E_MAP_BYTES+RAMP_BYTES:
        raise ValueError('bloque derivado con tamaño distinto')
    known = known_nodes(surface)
    stats = {
        'knownNodes': int(known.sum()), 'uNodes': int((~known).sum()),
        'uNodesWithE': int((~known & np.isfinite(distance)).sum()),
        'uNodesWithoutE': int((~known & ~np.isfinite(distance)).sum()),
        'eDistanceMm': {k: float(np.percentile(distance[~known & np.isfinite(distance)], q))
                        for k, q in [('p50', 50), ('p90', 90), ('max', 100)]} if (~known & np.isfinite(distance)).any() else None,
        'rampRowsBorrowed': int((reach > 0).sum()), 'rampMaxReachRows': int(reach.max()),
        'rampMm': {'p10Min': float(ramp[:, 0].min()), 'p10Max': float(ramp[:, 0].max()),
                   'p90Min': float(ramp[:, 1].min()), 'p90Max': float(ramp[:, 1].max())},
    }
    return block, stats


def require_placement_free(manifest, offset, size):
    wall = load('wall')
    abdominal = next(a for a in manifest['packing']['assets'] if a['name'] == 'abdominal')
    occupied = [{**f} for f in abdominal['fields']]
    occupied.append({'name': 'body-depth', 'offset': abdominal['depthOffset'], 'dimensions': manifest['depth']['dimensions']})
    descriptor = manifest['wallP2Offline']
    for i, o in enumerate(descriptor['placements']):
        occupied.append({'name': 'wall-'+str(i), 'offset': o, 'dimensions': descriptor['tileSize']})
    occupied.append({'name': 'centers', 'offset': descriptor['centerOffset'], 'dimensions': [1, 181, 1]})
    wall.require_placement(offset, size, {'dimensions': abdominal['textureDimensions'], 'occupied': occupied})


def derive(package_dir, out):
    """Lee el paquete exportado (manifiesto, reserva y piel), escribe el bloque derivado tras el payload y un paquete nuevo."""
    package_dir, out = Path(package_dir), Path(out)
    wall = load('wall')
    manifest_bytes = (package_dir/'candidate-manifest.bin').read_bytes()
    manifest = json.loads(manifest_bytes)
    descriptor = manifest['wallP2Offline']
    compressed = (package_dir/'annotation-capacity.gzip.bin').read_bytes()
    if hashlib.sha256(compressed).hexdigest() != manifest['capacity']['sha256Gzip']:
        raise ValueError('reserva distinta del manifiesto')
    original = gzip.decompress(compressed)
    raw = bytearray(original)
    magic, count = struct.unpack_from('<4sI', raw)
    if magic != b'S28C':
        raise ValueError('capacidad P1 inválida')
    header = json.loads(raw[8:8+count])
    part = next(p for p in header['parts'] if p['name'] == 'wall')
    start = part['offsetBytes']
    payload = bytes(raw[start:start+descriptor['payloadBytes']])
    if hashlib.sha256(payload).hexdigest() != descriptor['payloadSha256']:
        raise ValueError('payload de pared distinto del manifiesto')
    tiles = np.frombuffer(payload[:wall.TILE_SHAPE[0]*np.prod(wall.TILE_SHAPE[1:])*2], '<f2').reshape(wall.TILE_SHAPE)
    surface = wall.untile_surface(tiles)
    skin_meta = manifest['skin']
    skin_compressed = (package_dir/skin_meta['file']).read_bytes()
    if hashlib.sha256(skin_compressed).hexdigest() != skin_meta['sha256Gzip']:
        raise ValueError('piel polar distinta del manifiesto')
    skin = np.frombuffer(gzip.decompress(skin_compressed), '<f2').reshape(skin_meta['dimensions'][1], skin_meta['dimensions'][0], 2)
    block, stats = derive_block(surface, skin_seeds(skin, skin_meta))
    offset = start+descriptor['payloadBytes']
    if offset % 4 or descriptor['payloadBytes']+len(block) > part['bytes']:
        raise ValueError('presupuesto P2: el bloque derivado no cabe en la reserva de pared')
    require_placement_free(manifest, *RAMP_HALO)
    raw[offset:offset+len(block)] = block
    if raw[:start] != original[:start] or raw[start:offset] != payload or raw[offset+len(block):] != original[offset+len(block):]:
        raise ValueError('ocupación de reserva ajena')
    part['derivedBytes'] = len(block)
    part['derivedFormat'] = FORMAT+'; E map 512x181 RG16F + 181 RG16F respiratory ramps after the payload'
    encoded = json.dumps(header, separators=(',', ':')).encode()
    if len(encoded)+8 > 4096:
        raise ValueError('presupuesto cabecera capacidad')
    raw[:4096] = bytes(4096)
    raw[:8] = struct.pack('<4sI', b'S28C', len(encoded))
    raw[8:8+len(encoded)] = encoded
    if len(raw) != len(original):
        raise ValueError('RAW de reserva distinto')
    capacity = gzip.compress(bytes(raw), compresslevel=9, mtime=0)
    with gzip.GzipFile(fileobj=io.BytesIO(capacity)) as stream:
        if stream.read() != bytes(raw):
            raise ValueError('capacidad reabierta corrupta')
    # Descriptor mínimo (el manifiesto tiene techo de bytes): el significado de cada canal está en la cabecera de este
    # archivo y las cifras en budget-derived.json.
    derived = {
        'format': FORMAT, 'provenance': 'E', 'payloadSha256': descriptor['payloadSha256'],
        'offsetBytes': descriptor['payloadBytes'], 'bytes': len(block), 'sha256': hashlib.sha256(block).hexdigest(),
        'eMap': {'bytes': E_MAP_BYTES, 'radiusMm': RADIUS_MM, 'nodesWithE': stats['uNodesWithE']},
        'ramps': {'offsetBytes': descriptor['payloadBytes']+E_MAP_BYTES, 'minKnownNodes': MIN_RAMP_NODES,
                  'placement': RAMP_OFFSET, 'size': [181, 1, 1]},
    }
    manifest['wallP2Derived'] = derived
    manifest['capacity'].update(downloadBytes=len(capacity), sha256=hashlib.sha256(bytes(raw)).hexdigest(),
                                sha256Gzip=hashlib.sha256(capacity).hexdigest(),
                                compressionCredit=len(raw)-len(capacity))
    for record in manifest['files']:
        if record['file'] == 'annotation-capacity.gzip.bin':
            record.update(bytes=len(capacity), sha256=hashlib.sha256(capacity).hexdigest())
    candidate = (json.dumps(manifest, indent=2, ensure_ascii=False)+'\n').encode()
    out.mkdir(parents=True, exist_ok=True)
    (out/'annotation-capacity.gzip.bin').write_bytes(capacity)
    (out/'candidate-manifest.bin').write_bytes(candidate)
    report = {'capacityGzipBefore': len(compressed), 'capacityGzipAfter': len(capacity),
              'downloadIncrementBytes': len(capacity)-len(compressed)+len(candidate)-len(manifest_bytes),
              'manifestBytes': len(candidate), 'derivedBytes': len(block),
              'wallReserveUsedBytes': descriptor['payloadBytes']+len(block), 'wallReserveBytes': part['bytes'],
              'atlasIncrementBytes': 0, 'rawReservationIncrementBytes': 0, 'thoracicIncrementBytes': 0, **stats}
    (out/'budget-derived.json').write_text(json.dumps(report, indent=2)+'\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(derive(args.package, args.out), indent=2))
