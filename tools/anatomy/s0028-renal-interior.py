"""Exportador P3 r4 offline del interior renal s0028 (decisión 321, pendiente): no instala ni toca el runtime.

Rejilla P1 de `kidneyRight`/`kidneyLeft` (1,5 mm, mismo marco físico); caja = crop de la máscara O (el campo P1 sin
su relleno de 6 nodos). Etiquetas categóricas: 0 U, 1 corteza, 2 médula, 3 seno graso, 4 colector/pelvis.
Procedencia por vóxel con los códigos de la pared P2: U = 0, D = 2, E = 3 (O no aparece dentro: la máscara O sólo
da el borde). Ningún vóxel reclamado por otra máscara fuente recibe etiqueta.

Profundidad: EDT de la envolvente convexa con la caja acolchada (el borde del array es exterior, no interior).
Seno: la componente de cavidad (envolvente − máscara − otras máscaras) que contiene el vóxel de cavidad más profundo
(el hilio; en empate, el primero en orden C), si llega a `minDepthMm`; cualquier otra componente (concavidad somera)
no es seno. La banda a menos de `mouthBandMm` del exterior (boca hiliar) es U porque depende de la regla de cierre.
Dentro: grasa D por HU crudo; luz del colector D por HU líquido suavizado sólo con los vóxeles no grasos del seno, HU
crudo acotado, sin borde grasa/realce en su vecindad 26 y con tamaño mínimo; vasos, bordes y restos U.
Parénquima: corteza/médula sólo si el déficit del parénquima profundo supera el ruido (puerta medida); umbral de Otsu
del HU suavizado en el núcleo renal; E si el d′ por vóxel no alcanza `nativeDPrimeForD`; médula subcapsular o en
componentes pequeños, U. Nada de atlas ajenos ni formas analíticas. Python -I; numpy/scipy (nibabel sólo en E/S).

Exportación (TAC y máscaras fuera de Git, versiones de `paired-renal-review-requirements.txt`):
    python -I tools/anatomy/s0028-renal-interior.py --case-dir "$VEXUS_S0028_CASE_DIR" --out <directorio nuevo>
con `VEXUS_S0028_CASE_DIR` = carpeta del caso s0028 (`ct.nii.gz` y `segmentations/`, hashes de `s0028-case.json`).
"""
import argparse
import copy
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform

import numpy as np
import scipy
from scipy import ndimage as ndi
from scipy.spatial import ConvexHull, Delaunay

PITCH = 1.5
FIELD_PAD = 6
LABELS = ('U', 'cortex', 'medulla', 'sinusFat', 'collectingSystem')
U, D, E = 0, 2, 3
PAGE_HALVES = 2048
N6 = ndi.generate_binary_structure(3, 1)
N26 = np.ones((3, 3, 3), bool)
PARAMS = {
    'format': 's0028-p3-renal-interior-v1',
    'pitchMm': PITCH,
    'labels': list(LABELS),
    'provenanceCodes': {'U': U, 'D': D, 'E': E},
    'nibble': 'bits 0-2 label; bit 3 = E (label>0); label 0 only U; 5-7 and 8-15 except 9-12 invalid',
    'flatten': 'C xyz, z fastest; even voxel low nibble; one byte per exact half; 2048 halves per 32x32 RG16F page',
    'depth': 'EDT of the convex hull with the box padded by >= max depth + 1 voxel (array border is exterior)',
    'sinus': {'hullTolerance': 1e-9, 'connectivity': 26, 'rule': 'cavity component holding the deepest cavity voxel',
              'minDepthMm': 3.0, 'mouthBandMm': 3.0},
    'fatHU': [-190, -30],
    'collecting': {'sigmaMm': 1.5, 'smoothedHU': [-10, 40], 'rawHU': [-40, 80], 'interfaceLowHU': -60,
                   'interfaceHighHU': 100, 'minVoxels': 27},
    'parenchyma': {'sigmaMm': 1.5, 'coreErosion6': 1, 'otsuHU': [0, 300, 1], 'otsuOffsetHU': 0, 'capsuleGuardMm': 3.0,
                   'minMedullaVoxels': 27, 'superficialMm': [3.0, 6.0], 'deepOutMm': 9.0, 'deepSinusMm': 6.0,
                   'nativeDPrimeForD': 2.0, 'smoothedSigmasForE': 2.0, 'maxSubcapsularFraction': 0.05},
    'noiseReference': {'mask': 'liver', 'erosion6': 3},
}


def _check_volume(name, value, shape=None, dtype=None):
    value = np.asarray(value)
    if value.ndim != 3 or (shape is not None and value.shape != shape) or (dtype is not None and value.dtype != dtype):
        raise ValueError('volumen inválido: '+name)
    return value


def convex_hull_mask(mask, tolerance):
    """Centros de vóxel dentro de la envolvente convexa de los centros de la máscara; la máscara debe quedar dentro."""
    mask = _check_volume('máscara', mask, dtype=bool)
    points = np.argwhere(mask)
    if len(points) < 4:
        raise ValueError('máscara renal vacía o degenerada')
    hull = ConvexHull(points)
    grid = np.indices(mask.shape).reshape(3, -1).T
    inside = (Delaunay(points[hull.vertices]).find_simplex(grid, tol=tolerance) >= 0).reshape(mask.shape)
    if np.any(mask & ~inside):
        raise ValueError('envolvente no contiene la máscara')
    return inside


def depth_inside(region):
    """Distancia (mm) de cada vóxel de `region` a su exterior, con la caja acolchada: fuera del array es exterior.

    Sin acolchar, la EDT toma el borde del array por interior y sobreestima la profundidad donde la región toca la cara
    de la caja (la envolvente renal la toca siempre: la caja es el crop de la máscara). El margen cubre la profundidad
    máxima posible (mitad del lado menor) más un vóxel."""
    region = _check_volume('región', region, dtype=bool)
    pad = -(-min(region.shape)//2)+1
    depth = ndi.distance_transform_edt(np.pad(region, pad), sampling=PITCH)[(slice(pad, -pad),)*3]
    if depth.max(initial=0)+PITCH > pad*PITCH+1e-9:
        raise ValueError('margen de la EDT insuficiente')
    return depth


def smooth_within(values, weights, sigma_mm):
    """Convolución gaussiana normalizada: sólo promedian los vóxeles de `weights`; NaN donde no llega ninguno."""
    weights = np.asarray(weights, bool)
    num = ndi.gaussian_filter(np.where(weights, values, 0).astype(np.float64), sigma_mm/PITCH, mode='constant')
    den = ndi.gaussian_filter(weights.astype(np.float64), sigma_mm/PITCH, mode='constant')
    return np.where(den > 1e-6, num/np.maximum(den, 1e-12), np.nan)


def otsu_threshold(values, lo, hi, step):
    values = np.asarray(values, np.float64)
    if not len(values) or not np.isfinite(values).all():
        raise ValueError('valores de Otsu inválidos')
    edges = np.arange(lo, hi+step, step, dtype=np.float64)
    h, _ = np.histogram(np.clip(values, lo, hi), bins=edges)
    centers = (edges[:-1]+edges[1:])/2
    w0 = np.cumsum(h)
    w1 = w0[-1]-w0
    s0 = np.cumsum(h*centers)
    m0 = s0/np.maximum(w0, 1)
    m1 = (s0[-1]-s0)/np.maximum(w1, 1)
    return float(edges[int(np.argmax(w0*w1*(m0-m1)**2))+1])


def sinus_region(mask, others, params):
    """Seno = componente de cavidad con el vóxel más profundo (el hilio), si alcanza la profundidad mínima; banda U."""
    p = params['sinus']
    hull = convex_hull_mask(mask, p['hullTolerance'])
    depth = depth_inside(hull)
    cavity = hull & ~mask & ~others
    labels, count = ndi.label(cavity, structure=N26 if p['connectivity'] == 26 else N6)
    sinus = np.zeros(mask.shape, bool)
    deepest = 0.0
    if count:
        flat = int(np.argmax(np.where(cavity, depth, -1.0)))  # primer máximo en orden C: determinista en empates
        deepest = float(depth.flat[flat])
        if deepest >= p['minDepthMm']:
            sinus = labels == labels.flat[flat]
    band = sinus & (depth < p['mouthBandMm'])
    return {'hull': hull, 'depth': depth, 'cavity': cavity, 'sinus': sinus, 'band': band,
            'cavityComponents': int(count), 'sinusMaxDepthMm': round(deepest, 3)}


def collecting_lumen(hu, inner, params):
    """Luz líquida (orina sin contraste): HU suavizado sólo con `inner` (seno sin grasa), crudo acotado, sin borde grasa/realce."""
    p = params['collecting']
    smoothed = smooth_within(hu, inner, p['sigmaMm'])
    low = ndi.minimum_filter(hu, footprint=N26, mode='nearest')
    high = ndi.maximum_filter(hu, footprint=N26, mode='nearest')
    interface = (low <= p['interfaceLowHU']) & (high >= p['interfaceHighHU'])
    candidate = (inner & np.isfinite(smoothed) & (smoothed >= p['smoothedHU'][0]) & (smoothed <= p['smoothedHU'][1]) &
                 (hu > p['rawHU'][0]) & (hu < p['rawHU'][1]) & ~interface)
    labels, count = ndi.label(candidate, structure=N26)
    sizes = np.bincount(labels.ravel(), minlength=count+1)
    sizes[0] = 0
    lumen = np.isin(labels, np.nonzero(sizes >= p['minVoxels'])[0])
    return lumen, {'candidateVoxels': int(candidate.sum()), 'components': int(count),
                   'keptComponents': int(np.count_nonzero(sizes >= p['minVoxels'])), 'smallVoxels': int((candidate & ~lumen).sum())}


def classify_parenchyma(hu, kidney, d_out, sinus, params):
    """Corteza/médula candidatas por Otsu del HU suavizado en el núcleo; la puerta decide U/E/D.

    `d_out` es la profundidad acolchada de la envolvente (la misma de `sinus_region`), no una EDT de la caja."""
    p = params['parenchyma']
    core = ndi.binary_erosion(kidney, structure=N6, iterations=p['coreErosion6'])
    if not core.any():
        raise ValueError('núcleo renal vacío')
    smoothed = smooth_within(hu, core, p['sigmaMm'])
    threshold = otsu_threshold(smoothed[core], *p['otsuHU'])+p['otsuOffsetHU']
    d_sinus = ndi.distance_transform_edt(~sinus, sampling=PITCH) if sinus.any() else np.full(hu.shape, np.inf)
    finite = kidney & np.isfinite(smoothed)
    low = finite & (smoothed < threshold)
    subcapsular = low & (d_out < p['capsuleGuardMm'])
    labels, count = ndi.label(low & ~subcapsular, structure=N26)
    sizes = np.bincount(labels.ravel(), minlength=count+1)
    sizes[0] = 0
    medulla = np.isin(labels, np.nonzero(sizes >= p['minMedullaVoxels'])[0])
    small = low & ~subcapsular & ~medulla
    cortex = finite & ~low
    # Puerta: déficit del parénquima profundo frente al superficial (HU crudo del núcleo) contra el ruido medido.
    a, b = p['superficialMm']
    superficial = core & (d_out > a) & (d_out <= b) & (d_sinus > p['deepSinusMm'])
    deep = core & (d_out > p['deepOutMm']) & (d_sinus > p['deepSinusMm'])
    pairs = core[1:] & core[:-1]
    native_sd = float(np.std(hu[1:][pairs]-hu[:-1][pairs])/np.sqrt(2)) if pairs.any() else float('nan')
    delta = float(np.median(hu[superficial])-np.median(hu[deep])) if superficial.any() and deep.any() else float('nan')
    return {'cortex': cortex, 'medulla': medulla, 'subcapsular': subcapsular, 'small': small, 'unsmoothed': kidney & ~finite,
            'threshold': threshold, 'deltaHU': delta, 'nativeNoiseSdHU': native_sd,
            'superficialVoxels': int(superficial.sum()), 'deepVoxels': int(deep.sum()),
            'subcapsularFraction': float(subcapsular.sum()/max(1, low.sum()))}


def gate(parenchyma, smoothed_noise_sd, params):
    p = params['parenchyma']
    delta, native = parenchyma['deltaHU'], parenchyma['nativeNoiseSdHU']
    if not (np.isfinite(delta) and np.isfinite(native) and native > 0 and smoothed_noise_sd > 0):
        return 'U', {'reason': 'sin medida'}
    dprime = delta/native
    smoothed = delta/smoothed_noise_sd
    if dprime >= p['nativeDPrimeForD']:
        decision = 'D'
    elif smoothed >= p['smoothedSigmasForE'] and parenchyma['subcapsularFraction'] <= p['maxSubcapsularFraction']:
        decision = 'E'
    else:
        decision = 'U'
    return decision, {'nativeDPrime': round(dprime, 3), 'smoothedSigmas': round(smoothed, 3)}


def annotate(hu, kidney, others, smoothed_noise_sd, params=PARAMS):
    """Etiquetas y procedencia de una caja renal; `others` es la unión de todas las demás máscaras fuente."""
    hu = _check_volume('HU', hu).astype(np.float64)
    kidney = _check_volume('riñón', kidney, hu.shape, bool)
    others = _check_volume('otras máscaras', others, hu.shape, bool)
    if not np.isfinite(hu).all():
        raise ValueError('HU no finito')
    own = kidney & ~others
    region = sinus_region(kidney, others, params)
    inner = region['sinus'] & ~region['band']
    fat_window = (hu >= params['fatHU'][0]) & (hu <= params['fatHU'][1])
    fat = inner & fat_window
    lumen, lumen_info = collecting_lumen(hu, inner & ~fat, params)
    par = classify_parenchyma(hu, own, region['depth'], region['sinus'], params)
    decision, gate_info = gate(par, smoothed_noise_sd, params)
    labels = np.zeros(hu.shape, np.uint8)
    provenance = np.zeros(hu.shape, np.uint8)
    if decision != 'U':
        code = D if decision == 'D' else E
        labels[par['cortex']] = 1
        labels[par['medulla']] = 2
        provenance[par['cortex'] | par['medulla']] = code
    labels[fat] = 3
    labels[lumen] = 4
    provenance[fat | lumen] = D
    require_annotation(labels, provenance, kidney, others, region['sinus'], region['band'])
    shallow = region['cavity'] & ~region['sinus']
    reasons = {'otherOwnerInMask': int((kidney & others).sum()), 'subcapsularLow': int(par['subcapsular'].sum()),
               'smallMedullaComponents': int(par['small'].sum()), 'unsmoothed': int(par['unsmoothed'].sum()),
               'mouthBand': int(region['band'].sum()), 'sinusVesselOrInterface': int((inner & ~fat & ~lumen).sum()),
               'parenchymaGateU': int(own.sum()) if decision == 'U' else 0}
    metrics = {'boxShape': list(hu.shape), 'maskVoxels': int(kidney.sum()), 'hullVoxels': int(region['hull'].sum()),
               'cavityVoxels': int(region['cavity'].sum()), 'cavityComponents': region['cavityComponents'],
               'sinusVoxels': int(region['sinus'].sum()), 'sinusMaxDepthMm': region['sinusMaxDepthMm'],
               'bandFatVoxels': int((region['band'] & fat_window).sum()),
               # Fuera del seno y de su dominio (U aquí); r5 decide si vuelven a grasa compatible D del paquete P3.
               'shallowConcavity': {'voxels': int(shallow.sum()), 'fatVoxels': int((shallow & fat_window).sum())},
               'parenchyma': {'decision': decision, **gate_info, 'otsuThresholdHU': par['threshold'],
                              'deltaDeepHU': round(par['deltaHU'], 2), 'nativeNoiseSdHU': round(par['nativeNoiseSdHU'], 2),
                              'smoothedNoiseSdHU': round(float(smoothed_noise_sd), 2), 'superficialVoxels': par['superficialVoxels'],
                              'deepVoxels': par['deepVoxels'], 'subcapsularFraction': round(par['subcapsularFraction'], 4)},
               'collecting': lumen_info, 'uReasons': reasons}
    return labels, provenance, metrics, region


def require_annotation(labels, provenance, kidney, others, sinus, band):
    """Invariantes de formato y procedencia: nada fuera de máscara ∪ seno, nada sobre otro dueño, U sólo con 0."""
    labels = _check_volume('etiquetas', labels, dtype=np.uint8)
    provenance = _check_volume('procedencia', provenance, labels.shape, np.uint8)
    if labels.max(initial=0) > 4 or not np.isin(provenance, (U, D, E)).all():
        raise ValueError('código fuera del contrato')
    if np.any((labels == 0) != (provenance == U)):
        raise ValueError('U sólo con etiqueta 0')
    if np.any((labels > 0) & others) or np.any((labels > 0) & ~(kidney | sinus)) or np.any((labels > 0) & band):
        raise ValueError('etiqueta fuera de la máscara y del seno, en la banda de cierre o sobre otro dueño')
    if np.any(np.isin(labels, (1, 2)) & ~kidney) or np.any(np.isin(labels, (3, 4)) & kidney):
        raise ValueError('parénquima fuera de la máscara o seno dentro de ella')
    if np.any(np.isin(labels, (3, 4)) & (provenance != D)):
        raise ValueError('seno graso y colector son D')
    cortex_medulla = provenance[np.isin(labels, (1, 2))]
    if cortex_medulla.size and len(np.unique(cortex_medulla)) != 1:
        raise ValueError('corteza y médula comparten una sola procedencia (puerta)')


def encode(labels, provenance):
    labels = _check_volume('etiquetas', labels, dtype=np.uint8)
    provenance = _check_volume('procedencia', provenance, labels.shape, np.uint8)
    if np.any((labels == 0) != (provenance == U)) or not np.isin(provenance, (U, D, E)).all() or labels.max(initial=0) > 4:
        raise ValueError('par etiqueta/procedencia inválido')
    return (labels | np.where(provenance == E, 8, 0)).astype(np.uint8)


def decode(codes):
    codes = np.asarray(codes)
    if codes.dtype != np.uint8 or not np.isin(codes, (0, 1, 2, 3, 4, 9, 10, 11, 12)).all():
        raise ValueError('nibble inválido')
    labels = (codes & 7).astype(np.uint8)
    provenance = np.where(labels == 0, U, np.where(codes & 8, E, D)).astype(np.uint8)
    return labels, provenance


def pack(boxes):
    """Cajas de códigos (xyz) → payload de halves exactos (un byte cada uno), página nueva por caja, relleno nulo."""
    stream, info = bytearray(), []
    for codes in boxes:
        codes = _check_volume('códigos', codes, dtype=np.uint8)
        decode(codes)
        flat = codes.ravel(order='C')
        if len(flat) % 2:
            flat = np.append(flat, np.uint8(0))
        data = (flat[0::2] | (flat[1::2] << 4)).astype(np.uint8)
        pages = -(-len(data)//PAGE_HALVES)
        info.append({'dimensions': list(codes.shape), 'pageBase': len(stream)//(2*PAGE_HALVES), 'pageCount': pages,
                     'byteCount': len(data)})
        halves = np.zeros(pages*PAGE_HALVES, '<f2')
        halves[:len(data)] = data
        stream.extend(halves.tobytes())
    payload = bytes(stream)
    return payload, {'boxes': info, 'pageCount': len(payload)//(2*PAGE_HALVES), 'encodedBytes': len(payload),
                     'sha256': hashlib.sha256(payload).hexdigest()}


def unpack(payload, info, index):
    if len(payload) != info['encodedBytes'] or hashlib.sha256(payload).hexdigest() != info['sha256']:
        raise ValueError('payload corrupto o de otro tamaño')
    box = info['boxes'][index]
    values = np.frombuffer(payload, '<f2', count=box['pageCount']*PAGE_HALVES, offset=box['pageBase']*PAGE_HALVES*2)
    if not np.isfinite(values).all() or np.any(values < 0) or np.any(values > 255) or np.any(values != np.floor(values)):
        raise ValueError('half no entero o fuera de byte')
    if np.any(values[box['byteCount']:] != 0):
        raise ValueError('relleno de página no nulo')
    data = values[:box['byteCount']].astype(np.uint8)
    codes = np.empty(2*len(data), np.uint8)
    codes[0::2] = data & 15
    codes[1::2] = data >> 4
    n = int(np.prod(box['dimensions']))
    if n % 2 and codes[n] != 0:
        raise ValueError('nibble de relleno no nulo')
    codes = codes[:n].reshape(box['dimensions'])
    decode(codes)
    return codes


def lookup(payload, info, index, node):
    """Lectura única por punto, como en la GPU: nodo nearest → página (columna fija), téxel, canal y nibble; fuera, None."""
    box = info['boxes'][index]
    nx, ny, nz = box['dimensions']
    x, y, z = (int(v) for v in node)
    if not (0 <= x < nx and 0 <= y < ny and 0 <= z < nz):
        return None
    linear = (x*ny+y)*nz+z
    byte = linear >> 1
    page = box['pageBase']+(byte >> 11)
    texel, channel = (byte & 2047) >> 1, byte & 1
    half = (page*1024+texel)*2+channel
    value = int(np.frombuffer(payload, '<f2', count=1, offset=2*half)[0])
    return (value >> ((linear & 1) << 2)) & 15


def box_frame(field, origin_las, crop_lo, crop_shape):
    """La caja anotada son los nodos del campo P1 sin su relleno: mismo origen físico y rejilla."""
    expected = np.asarray(origin_las, float)+(np.asarray(crop_lo)-FIELD_PAD)*PITCH
    if (field['pitchMm'] != PITCH or not np.allclose(field['originMm'], expected, atol=1e-9, rtol=0) or
            list(field['dimensions']) != [int(v)+2*FIELD_PAD for v in crop_shape]):
        raise ValueError('caja fuera del marco P1: '+field['name'])
    return {'field': field['name'], 'nodeOffset': [FIELD_PAD]*3, 'dimensions': [int(v) for v in crop_shape],
            'originMm': (expected+FIELD_PAD*PITCH).tolist()}


def place(masks, names, lo, shape):
    """Unión de crops nativos `masks[name] = (origen, máscara)` reproyectada en la caja `lo`, `shape` del mismo marco."""
    union = np.zeros(tuple(shape), bool)
    for name in names:
        p, data = masks[name]
        a = np.maximum(lo, p)
        b = np.minimum(np.asarray(lo)+shape, np.asarray(p)+data.shape)
        if np.all(b > a):
            union[tuple(slice(x-y, z-y) for x, y, z in zip(a, lo, b))] |= data[tuple(slice(x-y, z-y) for x, y, z in zip(a, p, b))]
    return union


def side_inputs(ct, masks, name):
    """Caja de un riñón: su crop O, la unión de todas las demás máscaras fuente en esa caja y el HU de la misma caja."""
    lo, kidney = masks[name]
    others = place(masks, [n for n in masks if n != name], lo, kidney.shape)
    hu = ct[tuple(slice(a, a+d) for a, d in zip(lo, kidney.shape))]
    return np.asarray(lo), kidney, others, hu


def parameters_digest(params):
    return hashlib.sha256(json.dumps(params, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def environment():
    import nibabel
    return {'python': platform.python_version(), 'numpy': np.__version__, 'scipy': scipy.__version__,
            'nibabel': nibabel.__version__}


def _source():
    spec = importlib.util.spec_from_file_location('s0028source', Path(__file__).with_name('s0028-source.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def export(case_dir, manifest, candidate, out, params=PARAMS):
    """Lee TAC y 117 máscaras con hash, verifica marco P1 y escribe payload, descriptor y volúmenes de revisión."""
    source = _source()
    out = Path(out)
    out.mkdir(parents=True, exist_ok=False)
    if candidate['packing']['sourcePhysicalFrameSha256'] != source.physical_id(manifest):
        raise ValueError('marco P1 y fuente distintos')
    image, ct, masks, stats = source.load_case(case_dir, manifest)
    nib = source.nib
    origin = nib.affines.apply_affine(np.asarray(manifest['rasToLASmm'], float),
                                      nib.affines.apply_affine(image.affine, [image.shape[0]-1, 0, 0]))
    fields = {f['name']: f for a in candidate['packing']['assets'] for f in a['fields']}
    p_noise = params['noiseReference']
    lo, liver = masks[p_noise['mask']]
    core = ndi.binary_erosion(liver, structure=N6, iterations=p_noise['erosion6'])
    hu_liver = ct[tuple(slice(a, a+d) for a, d in zip(lo, liver.shape))]
    smoothed_noise = float(np.nanstd(smooth_within(hu_liver, core, params['parenchyma']['sigmaMm'])[core]))
    boxes, codes, review = [], [], {}
    for side, field in (('right', 'kidneyRight'), ('left', 'kidneyLeft')):
        crop_lo, kidney, others, hu = side_inputs(ct, masks, 'kidney_'+side)
        frame = box_frame(fields[field], origin, crop_lo, kidney.shape)
        labels, provenance, metrics, region = annotate(hu, kidney, others, smoothed_noise, params)
        codes.append(encode(labels, provenance))
        boxes.append({'side': side, **frame, 'metrics': metrics})
        review[side] = {'labels': labels, 'provenance': provenance, 'sinus': region['sinus'], 'band': region['band'],
                        'hull': region['hull'], 'depth': region['depth'].astype(np.float32), 'cavity': region['cavity'],
                        'kidney': kidney, 'others': others, 'hu': hu.astype(np.int16), 'cropLo': crop_lo}
    payload, info = pack(codes)
    for box, row in zip(boxes, info['boxes']):
        box.update({k: row[k] for k in ('pageBase', 'pageCount', 'byteCount')})
    (out/'renal-interior.bin').write_bytes(payload)
    descriptor = {'format': params['format'], 'person': manifest['person'], 'physicalFrameSha256': source.physical_id(manifest),
                  'parametersSha256': parameters_digest(params), 'parameters': params, 'environment': environment(),
                  'boxes': boxes, 'pageCount': info['pageCount'], 'encodedBytes': info['encodedBytes'], 'sha256': info['sha256'],
                  'gzipBytes': len(gzip.compress(payload, compresslevel=9, mtime=0)),
                  'runtimeInstalled': False, 'ownerReview': 'pending', 'clinicalValidation': False}
    (out/'renal-interior.json').write_text(json.dumps(descriptor, ensure_ascii=False, indent=1)+'\n')
    for side, arrays in review.items():
        np.savez_compressed(out/f'review-{side}.npz', **arrays)
    return descriptor


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--case-dir', type=Path, default=os.environ.get('VEXUS_S0028_CASE_DIR'),
                        help='carpeta del caso s0028; por defecto $VEXUS_S0028_CASE_DIR')
    parser.add_argument('--manifest', type=Path, default=Path(__file__).with_name('s0028-case.json'))
    parser.add_argument('--candidate', type=Path, default=Path(__file__).resolve().parents[2]/'src/anatomy/s0028/candidate-manifest.bin')
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    if args.case_dir is None:
        parser.error('falta --case-dir o VEXUS_S0028_CASE_DIR')
    descriptor = export(args.case_dir, json.loads(args.manifest.read_text()), json.loads(args.candidate.read_bytes()), args.out,
                        copy.deepcopy(PARAMS))
    print(json.dumps({k: descriptor[k] for k in ('sha256', 'encodedBytes', 'pageCount', 'gzipBytes', 'parametersSha256', 'environment')}))


if __name__ == '__main__':
    main()
