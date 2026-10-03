"""Reproduce the registered thoracic source audit from an explicit local archive.
No network, downloads, runtime writes, per-organ scaling or mesh repair.
BodyParts3D / DBCLS, CC BY 4.0. The atlas is one reference, not clinical validation.
"""
import argparse
import csv
import hashlib
import json
import re
import tempfile
import zipfile
from pathlib import Path
from costochondral_geometry import load_mesh, topology

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / 'docs/anatomy/thoracic-source-manifest.json'


def verify_archive(path, manifest):
    path = Path(path)
    if path.stat().st_size != manifest['archiveBytes']:
        raise ValueError('Archive size differs from the pinned source')
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    if digest.hexdigest() != manifest['archiveSha256']:
        raise ValueError('Archive SHA256 differs from the pinned source')


def verify_labels(path, manifest):
    table = manifest['elementTable']
    verify_archive(path, {'archiveBytes': table['bytes'], 'archiveSha256': table['sha256']})
    with Path(path).open() as source:
        rows = csv.DictReader(source, delimiter='\t')
        keys = {(row['concept id'], row['name'], row['element file id']) for row in rows}
    for part in manifest['parts']:
        if (part['conceptId'], part['name'], part['id']) not in keys:
            raise ValueError('Concept/name/element association absent from official table: ' + part['id'])


def verified_part(archive, part):
    if not re.fullmatch(r'FJ[0-9]+', part['id']):
        raise ValueError('Invalid anatomical element ID')
    expected = 'partof_BP3D_4.0_obj_99/' + part['id'] + '.obj'
    if part['entry'] != expected:
        raise ValueError('Entry differs from its anatomical element ID')
    matches = [info for info in archive.infolist() if info.filename == expected]
    if len(matches) != 1:
        raise ValueError('Missing or duplicate anatomical entry')
    info = matches[0]
    if info.file_size != part['bytes'] or format(info.CRC, '08x') != part['crc32']:
        raise ValueError('Entry size/CRC differs from the pinned source')
    raw = archive.read(info)  # ZipFile also validates the actual CRC after decompression.
    if hashlib.sha256(raw).hexdigest() != part['sha256']:
        raise ValueError('Part SHA256 differs from the pinned source')
    return raw


def audit(archive_path, labels_path, manifest):
    verify_archive(archive_path, manifest)
    verify_labels(labels_path, manifest)
    reports = []
    with zipfile.ZipFile(archive_path) as archive, tempfile.TemporaryDirectory(prefix='vexus-thoracic-source-') as folder:
        for part in manifest['parts']:
            raw = verified_part(archive, part)
            (Path(folder) / (part['id'] + '.obj')).write_bytes(raw)
            vertices, faces = load_mesh(folder, part['id'], expected_sha=part['sha256'])
            reports.append({
                **part,
                'vertices': len(vertices),
                'triangles': len(faces),
                'minLasMm': vertices.min(axis=0).tolist(),
                'maxLasMm': vertices.max(axis=0).tolist(),
                'topology': topology(vertices, faces),
            })
    return {
        'source': manifest['source'], 'archiveSha256': manifest['archiveSha256'],
        'license': manifest['license'], 'credit': manifest['credit'],
        'registration': {'sourceOriginMm': [-.3152345, -205.92635, 1164.5735],
                         'axes': [[1, 0, 0], [0, -1, 0], [0, 0, 1]],
                         'targetOriginMm': [0, 85.25, 0], 'reverseWinding': True},
        'sourceBytesVerified': True, 'officialLabelsVerified': True, 'runtimeIntegration': False,
        'note': 'Exact source components retained. Non-manifold edges and tiny components are reported, never silently repaired or discarded. Source validation is not clinical validation.',
        'parts': reports,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--labels', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError('Choose a new output path; existing evidence is not overwritten')
    manifest = json.loads(MANIFEST.read_text())
    report = audit(args.archive, args.labels, manifest)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x') as output:
        json.dump(report, output, ensure_ascii=False, indent=2)
        output.write('\n')
    print(json.dumps({'parts': len(report['parts']), 'output': str(args.output)}))


if __name__ == '__main__':
    main()
