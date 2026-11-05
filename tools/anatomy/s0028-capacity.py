"""Capacidad fija de anotación de B; vacía significa desconocido, no anatomía."""
import argparse
import hashlib
import json
from pathlib import Path
import struct

import numpy as np


def save(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False)+'\n')


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def capacity_plan(rows):
    wall = {'rows': rows, 'angles': 256, 'boundaries': 8, 'bytesPerSample': 3,
            'bytes': rows*256*8*3, 'format': 'uint16 depth 1/16mm + uint8 identity, 65535=unknown'}
    def mesh(vertices, triangles):
        return {'vertices': vertices, 'triangles': triangles, 'bytes': vertices*12+triangles*12,
                'format': 'float32 xyz + uint32 indexed triangles, arbitrary connectivity/holes'}
    return {'wall': wall, 'abdominalMesh': mesh(65536, 131072), 'thoracicMesh': mesh(32768, 65536),
            'tubes': {'nodes': 512, 'tubes': 102, 'bytes': 512*4*4+102*16*4},
            'anatomyAnnotated': False, 'guarantee': 'fixed array capacity, not sufficient anatomy or future triangle count'}


def require_mesh_capacity(plan, vertices, triangles):
    if vertices > plan['vertices'] or triangles > plan['triangles']:
        raise ValueError('Anotación excede capacidad')


def require_wall_budget(payload_bytes, metadata_bytes, atlas_increment, raw_increment, thoracic_increment):
    if (payload_bytes < 0 or payload_bytes > capacity_plan(344)['wall']['bytes'] or
            not 0 <= metadata_bytes <= 4096 or atlas_increment != 0 or
            raw_increment != 0 or thoracic_increment != 0):
        raise ValueError('presupuesto P2: reserva pared/metadatos; atlas/RAW/tórax +0 B')


def require_solids_budget(p2_payload_bytes, p3_payload_bytes, p2_metadata_bytes,
                          p3_metadata_bytes, atlas_increment, raw_increment, thoracic_increment):
    values = (p2_payload_bytes, p3_payload_bytes, p2_metadata_bytes, p3_metadata_bytes)
    if any(not isinstance(value, int) or value < 0 for value in values):
        raise ValueError('presupuesto P2/P3 inválido')
    require_wall_budget(p2_payload_bytes+p3_payload_bytes, p2_metadata_bytes+p3_metadata_bytes,
                        atlas_increment, raw_increment, thoracic_increment)


def materialize_capacity(out, rows):
    plan = capacity_plan(rows)
    offset, parts = 4096, []
    for name in ['wall', 'abdominalMesh', 'thoracicMesh', 'tubes']:
        part = {**plan[name], 'name': name, 'offsetBytes': offset}
        parts.append(part)
        offset += part['bytes']
    header = {'format': 's0028-fixed-annotation-capacity-v1', 'parts': parts,
              'anatomyAnnotated': False, 'activeVertices': 0, 'activeTriangles': 0,
              'meaning': 'allocated upper bound; empty slots are unknown, never source anatomy'}
    encoded = json.dumps(header, separators=(',', ':')).encode()
    if len(encoded)+8 > 4096:
        raise ValueError('Cabecera capacidad llena')
    raw = bytearray(offset)
    raw[:8] = struct.pack('<4sI', b'S28C', len(encoded))
    raw[8:8+len(encoded)] = encoded
    # Unknown depths, identities zero. No synthetic anatomical surface is used as compression proxy.
    wall = parts[0]
    target = np.ndarray((rows, 256, 8, 3), np.uint8, buffer=raw, offset=wall['offsetBytes'])
    target[..., :2] = 255
    file = out/'annotation-capacity.bin'
    file.write_bytes(raw)
    stored = file.read_bytes()
    magic, size = struct.unpack_from('<4sI', stored)
    decoded = json.loads(stored[8:8+size])
    if magic != b'S28C' or decoded != header or len(stored) != offset:
        raise ValueError('Capacidad no recuperada')
    total = 4096
    for part in decoded['parts']:
        if part['offsetBytes'] != total:
            raise ValueError('Capacidad con huecos/overlap')
        total += part['bytes']
    if total != len(stored):
        raise ValueError('Capacidad truncada')
    report = {**plan, 'file': file.name, 'rawBytes': len(stored), 'downloadBytes': len(stored),
              'abdominalBytes': 4096+plan['wall']['bytes']+plan['abdominalMesh']['bytes']+plan['tubes']['bytes'],
              'thoracicBytes': plan['thoracicMesh']['bytes'], 'sha256': sha(stored),
              'descriptorsDecoded': True, 'compressionCredit': 0}
    save(out/'capacity.json', report)
    return report


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--rows', type=int, default=344)
    a = p.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    materialize_capacity(a.out, a.rows)
