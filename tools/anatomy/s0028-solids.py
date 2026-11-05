"""Primitivas del contrato P3 offline; no instala anatomía ni clasifica el runtime.

O es una máscara automática; D una derivación, E una hipótesis y U desconocido.
Los candidatos se conservan independientemente, sin precedencia entre órganos.
Toda futura tabla P3 debe admitir acceso directo en GPU, sin bucles en código P3
ni helpers; inversas y correcciones se precalculan offline. La cobertura y el
presupuesto de esas tablas aún no se han demostrado.
"""
import hashlib
import math

import numpy as np

FRAME_KEYS = ('person', 'frameId', 'ctSha256', 'shape', 'affineRASmm',
              'rasToLASmm', 'pitchMm', 'units')
UNKNOWN_ONLY = frozenset(('Gerota', 'quadratus_lumborum', 'posterior_diaphragm',
                          'kidney_right_interior', 'kidney_left_interior'))
KNOWN_OWNERS = frozenset(('liver', 'spleen', 'pancreas', 'stomach', 'kidney_right', 'kidney_left',
                          'kidney_cyst_right', 'kidney_cyst_left', 'iliopsoas_right', 'iliopsoas_left',
                          'autochthon_right', 'autochthon_left', 'bone', 'lung', 'compatible_fat', 'sacrum'))
KNOWN_OWNERS |= frozenset(f'vertebrae_T{i}' for i in range(1, 13))
KNOWN_OWNERS |= frozenset(f'vertebrae_L{i}' for i in range(1, 6))
KNOWN_OWNERS |= frozenset(f'rib_{side}_{i}' for side in ('left', 'right') for i in range(1, 13))
PAGE_BYTES = 32 * 32 * 4


def require_source(source, reference, ct_bytes):
    if any(source.get(key) != reference.get(key) for key in FRAME_KEYS):
        raise ValueError('identidad o marco físico distinto')
    if source.get('person') != 's0028' or source.get('units') != 'mm':
        raise ValueError('persona o unidades inválidas')
    if hashlib.sha256(ct_bytes).hexdigest() != source.get('ctSha256'):
        raise ValueError('hash TAC distinto')


def require_mask(name, source, reference, mask_bytes):
    if name not in reference or source != reference[name] or source.get('person') != 's0028':
        raise ValueError('identidad de máscara distinta')
    if hashlib.sha256(mask_bytes).hexdigest() != source.get('sha256'):
        raise ValueError('hash de máscara distinto')


def collect_owners(candidates):
    """Conserva U y todos los owners geométricos; la certeza de material va aparte."""
    owners, unknown = {}, []
    for name, (provenance, occupied) in candidates.items():
        if name not in KNOWN_OWNERS and name not in UNKNOWN_ONLY:
            raise ValueError('identidad fuera del contrato P3')
        if provenance not in ('O', 'D', 'E', 'U') or (occupied is not None and not isinstance(occupied, (bool, np.bool_))):
            raise ValueError('estado inválido')
        if name in UNKNOWN_ONLY and (provenance != 'U' or occupied is not None):
            raise ValueError('identidad no observada')
        if provenance == 'U' and occupied is not None:
            raise ValueError('U no es ocupación conocida')
        if occupied is None:
            unknown.append(name)
        elif occupied:
            owners[name] = provenance
    return {'state': 'conflict' if len(owners) > 1 else ('known' if owners and not unknown else 'U'),
            'owners': owners, 'unknown': unknown}


def nearest_label(labels, coordinates):
    """La cobertura es la caja de centros; fuera devuelve U, nunca cero."""
    labels = np.asarray(labels)
    q = np.asarray(coordinates, dtype=float)
    if labels.ndim != 3 or q.shape != (3,) or not np.isfinite(q).all():
        raise ValueError('coordenada o rejilla inválida')
    if (q < 0).any() or (q > np.asarray(labels.shape)-1).any():
        return None
    label = labels[tuple(np.floor(q+.5).astype(int))].item()
    if not np.isfinite(label) or label < 0 or label != math.floor(label):
        raise ValueError('etiqueta categórica inválida')
    return int(label)


def field_owner(labels, coordinates, signed_distance, source_labels, *, gas_bit=False):
    """Consulta la etiqueta P1 sólo dentro del SDF y conserva U fuera de cobertura."""
    label = nearest_label(labels, coordinates)
    if label is None or signed_distance is None or not np.isfinite(signed_distance):
        return {'state': 'U', 'owner': None}
    if signed_distance >= 0:
        return {'state': 'outside', 'owner': None}
    if gas_bit and label >= 128:
        label -= 128
    owner = source_labels.get(label, source_labels.get(str(label)))
    if owner not in KNOWN_OWNERS:
        raise ValueError('etiqueta fuente ausente o identidad no autorizada')
    if owner in ('kidney_right', 'kidney_left'):
        return {'state': 'U', 'owner': owner, 'boundaryProvenance': 'D'}
    return {'state': 'D', 'owner': owner}


def source_crops(sources, required_masks, roi_origin, roi_shape):
    """Reproyecta cada crop nativo a una caja sin mezclar identidades."""
    if not required_masks or set(sources) != set(required_masks):
        raise ValueError('inventario de máscaras incompleto')
    origin, shape = np.asarray(roi_origin), np.asarray(roi_shape)
    if (origin.shape != (3,) or shape.shape != (3,) or
            not np.issubdtype(origin.dtype, np.integer) or not np.issubdtype(shape.dtype, np.integer) or
            np.any(origin < 0) or np.any(shape <= 0)):
        raise ValueError('caja inválida')
    result = {}
    for name, (source_origin, data) in sources.items():
        source_origin, data = np.asarray(source_origin), np.asarray(data)
        if (source_origin.shape != (3,) or not np.issubdtype(source_origin.dtype, np.integer) or
                np.any(source_origin < 0) or data.dtype != bool or data.ndim != 3):
            raise ValueError('crop inválido: '+name)
        target = np.zeros(tuple(shape), bool)
        lo = np.maximum(origin, source_origin)
        hi = np.minimum(origin+shape, source_origin+np.asarray(data.shape))
        if np.all(hi > lo):
            dst = tuple(slice(a, b) for a, b in zip(lo-origin, hi-origin))
            src = tuple(slice(a, b) for a, b in zip(lo-source_origin, hi-source_origin))
            target[dst] = data[src]
        result[name] = target
    return result


def fat_candidate(hu, support, masks, required_masks, renal_envelope):
    """Calcula D con soporte y envolvente aportados por el exportador verificado."""
    hu, support, renal_envelope = np.asarray(hu), np.asarray(support), np.asarray(renal_envelope)
    if not required_masks or set(masks) != set(required_masks) or not any(name.startswith('kidney_') for name in masks):
        raise ValueError('faltan máscaras fuente')
    if support.dtype != bool or renal_envelope.dtype != bool or hu.shape != support.shape or hu.shape != renal_envelope.shape:
        raise ValueError('rejillas incompatibles')
    known = np.zeros(hu.shape, dtype=bool)
    for name, mask in masks.items():
        mask = np.asarray(mask)
        if mask.dtype != bool or mask.shape != hu.shape:
            raise ValueError('máscara inválida: '+name)
        known |= mask
        if name.startswith('kidney_') and np.any(mask & ~renal_envelope):
            raise ValueError('envolvente no contiene riñón')
    return support & ~known & ~renal_envelope & np.isfinite(hu) & (hu >= -190) & (hu <= -30)


def require_fat(candidate, hu, support, masks, required_masks, renal_envelope):
    candidate = np.asarray(candidate)
    expected = fat_candidate(hu, support, masks, required_masks, renal_envelope)
    if candidate.dtype != bool or not np.array_equal(candidate, expected):
        raise ValueError('grasa no coincide con fuente, exclusiones o envolvente')


def require_page_layout(occupied, placements):
    """Las coordenadas son xyz; la ocupación suministrada es zyx."""
    used = np.asarray(occupied)
    if used.dtype != bool or used.ndim != 3:
        raise ValueError('ocupación del atlas inválida')
    used = used.copy()
    depth, height, width = used.shape
    for point in placements:
        if len(point) != 3 or any(not isinstance(v, (int, np.integer)) for v in point):
            raise ValueError('coordenadas de página inválidas')
        x, y, z = point
        if x < 0 or y < 0 or z < 0 or x+32 > width or y+32 > height or z >= depth:
            raise ValueError('página fuera del atlas')
        page = used[z, y:y+32, x:x+32]
        if page.any():
            raise ValueError('página solapada')
        page[:] = True


def allocate_pages(occupied, count):
    occupied = np.asarray(occupied)
    if occupied.dtype != bool or occupied.ndim != 3 or not isinstance(count, int) or count < 0:
        raise ValueError('ocupación o cantidad inválida')
    depth, height, width = occupied.shape
    found = []
    for z in range(depth):
        for y in range(0, height-31, 32):
            for x in range(0, width-31, 32):
                if not occupied[z, y:y+32, x:x+32].any():
                    if len(found) < count:
                        found.append([x, y, z])
                    if len(found) == count:
                        require_page_layout(occupied, found)
                        return found
    if count == 0:
        return []
    raise ValueError('páginas libres insuficientes')


def pack_pages(bits):
    bits = np.asarray(bits)
    if bits.dtype != bool or bits.ndim != 1:
        raise ValueError('bitset inválido')
    packed = np.packbits(bits, bitorder='little')
    values = packed.astype('<f2').tobytes()
    page_count = math.ceil(len(values)/PAGE_BYTES)
    payload = values + bytes(page_count*PAGE_BYTES-len(values))
    return payload, {'bitCount': len(bits), 'byteCount': len(packed),
                     'pageCount': page_count, 'sha256': hashlib.sha256(payload).hexdigest()}


def unpack_pages(payload, info):
    bit_count, byte_count, page_count = (info[k] for k in ('bitCount', 'byteCount', 'pageCount'))
    if (bit_count < 0 or byte_count != (bit_count+7)//8 or
            page_count != math.ceil(byte_count*2/PAGE_BYTES) or
            len(payload) != page_count*PAGE_BYTES or
            hashlib.sha256(payload).hexdigest() != info['sha256']):
        raise ValueError('página corrupta o tamaño inválido')
    values = np.frombuffer(payload, dtype='<f2')
    if not np.isfinite(values).all() or np.any(values < 0) or np.any(values > 255) or np.any(values != np.floor(values)):
        raise ValueError('valor categórico inválido')
    if np.any(values[byte_count:] != 0):
        raise ValueError('relleno de página corrupto')
    packed = values[:byte_count].astype(np.uint8)
    unpacked = np.unpackbits(packed, bitorder='little')
    if np.any(unpacked[bit_count:]):
        raise ValueError('relleno de bitset corrupto')
    return unpacked[:bit_count].astype(bool)


def install_payload(raw, wall_offset, wall_size, p2_bytes, p2_sha256, payload, placements, occupied):
    """Escribe dentro de pared y verifica P2, tabla y bytes ajenos a la reserva usada."""
    sizes = (wall_offset, wall_size, p2_bytes)
    if (any(not isinstance(v, int) or v < 0 for v in sizes) or
            wall_offset+wall_size > len(raw) or p2_bytes > wall_size or
            len(payload) != len(placements)*PAGE_BYTES):
        raise ValueError('reserva o longitud inválida')
    p2 = raw[wall_offset:wall_offset+p2_bytes]
    if hashlib.sha256(p2).hexdigest() != p2_sha256:
        raise ValueError('payload P2 distinto')
    require_page_layout(occupied, placements)
    if any(any(int(v) > 65535 for v in point) for point in placements):
        raise ValueError('página no representable')
    table = np.asarray(placements, dtype='<u2').reshape(-1, 3).tobytes()
    start = wall_offset+p2_bytes
    end = start+len(payload)+len(table)
    if end > wall_offset+wall_size:
        raise ValueError('reserva de pared insuficiente')
    result = bytearray(raw)
    result[start:end] = payload+table
    result = bytes(result)
    if result[:start] != raw[:start] or result[end:] != raw[end:]:
        raise ValueError('se alteraron otras reservas')
    if result[start:start+len(payload)] != payload or result[start+len(payload):end] != table:
        raise ValueError('payload no recuperado')
    return result, {'payloadOffsetBytes': start, 'encodedBytes': len(payload),
                    'pageTableOffsetBytes': start+len(payload), 'pageTableBytes': len(table),
                    'endOffset': end}


def p2_used_bytes(part):
    """Bytes P2 de la reserva de pared: payload y, desde P2 final, el bloque derivado E+rampas que lo sigue."""
    if part.get('name') != 'wall' or 'p3Bytes' in part or part.get('derivedBytes', 0) < 0 or part['payloadBytes'] < 0:
        raise ValueError('reserva de pared inválida o con P3 ya instalado')
    return part['payloadBytes']+part.get('derivedBytes', 0)


def install_after_p2(raw, part, p2_bytes, p2_sha256, payload, placements, occupied):
    """`install_payload` sólo tras todo P2 (r1 lo escribió sobre el bloque derivado de P2 final)."""
    if p2_bytes != p2_used_bytes(part):
        raise ValueError('P3 no empieza tras el bloque derivado P2')
    return install_payload(raw, part['offsetBytes'], part['bytes'], p2_bytes, p2_sha256, payload, placements, occupied)


def require_budget(payload_bytes, metadata_bytes, atlas_increment, raw_increment, thoracic_increment):
    if (not 0 <= payload_bytes <= 344*256*8*3 or not 0 <= metadata_bytes <= 4096 or
            atlas_increment != 0 or raw_increment != 0 or thoracic_increment != 0):
        raise ValueError('presupuesto P2/P3: pared/metadatos; atlas/RAW/tórax +0 B')
