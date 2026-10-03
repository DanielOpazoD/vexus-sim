"""Synthetic contracts for the source gate. No downloaded atlas is required."""
import hashlib
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
import numpy as np
from thoracic_source import verify_archive, verify_labels, verified_part, MANIFEST
from costochondral_geometry import load_mesh, topology

TETRA = b'v 0 0 0\nv 1 0 0\nv 0 1 0\nv 0 0 1\nf 1 3 2\nf 1 2 4\nf 1 4 3\nf 2 3 4\n'


def fixture(duplicate=False):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('partof_BP3D_4.0_obj_99/FJ1.obj', TETRA)
        if duplicate:
            archive.writestr('partof_BP3D_4.0_obj_99/FJ1.obj', TETRA)
    stream.seek(0)
    archive = zipfile.ZipFile(stream)
    entry = archive.infolist()[0]
    part = {'id': 'FJ1', 'entry': entry.filename, 'bytes': len(TETRA),
            'crc32': format(entry.CRC, '08x'), 'sha256': hashlib.sha256(TETRA).hexdigest()}
    return archive, part


class SourceContracts(unittest.TestCase):
    def test_pinned_archive_and_part_round_trip(self):
        archive, part = fixture()
        with archive:
            self.assertEqual(verified_part(archive, part), TETRA)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'input.bin'
            path.write_bytes(TETRA)
            manifest = {'archiveBytes': len(TETRA), 'archiveSha256': hashlib.sha256(TETRA).hexdigest()}
            verify_archive(path, manifest)
            path.write_bytes(TETRA[:-1] + b'x')
            with self.assertRaisesRegex(ValueError, 'SHA256'):
                verify_archive(path, manifest)
            path.write_bytes(TETRA[:-1])
            with self.assertRaisesRegex(ValueError, 'size'):
                verify_archive(path, manifest)

    def test_part_metadata_is_not_sufficient_without_hash(self):
        archive, part = fixture()
        with archive:
            for key, wrong in [('sha256', '0'*64), ('crc32', '00000000'), ('bytes', 1),
                               ('entry', '../FJ1.obj'), ('id', '../FJ1')]:
                with self.subTest(key=key), self.assertRaises(ValueError):
                    verified_part(archive, {**part, key: wrong})

    def test_official_label_association_is_required(self):
        raw = b'concept id\tname\telement file id\nFMA1\tfixture\tFJ1\n'
        part = {'conceptId': 'FMA1', 'name': 'fixture', 'id': 'FJ1'}
        manifest = {'elementTable': {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}, 'parts': [part]}
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'labels.tsv'
            path.write_bytes(raw)
            verify_labels(path, manifest)
            for field in ['conceptId', 'name', 'id']:
                with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'association'):
                    verify_labels(path, {**manifest, 'parts': [{**part, field: 'wrong'}]})

    def test_duplicate_and_absent_entries_are_rejected(self):
        archive, part = fixture(duplicate=True)
        with archive, self.assertRaisesRegex(ValueError, 'duplicate'):
            verified_part(archive, part)
        archive, part = fixture()
        with archive, self.assertRaisesRegex(ValueError, 'Missing'):
            verified_part(archive, {**part, 'id': 'FJ2', 'entry': 'partof_BP3D_4.0_obj_99/FJ2.obj'})

    def test_registration_reflects_coordinates_and_preserves_oriented_volume(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder)/'FJ1.obj').write_bytes(TETRA)
            vertices, faces = load_mesh(folder, 'FJ1', expected_sha=hashlib.sha256(TETRA).hexdigest())
            manifest = json.loads(MANIFEST.read_text())
            registration = json.loads((MANIFEST.parents[2]/manifest['registrationFile']).read_text())['registration']
            raw = np.array([[0., 0., 0.], [1., 0., 0.], [0., 1., 0.], [0., 0., 1.]])
            self.assertEqual(registration['sourceUnit'], 'mm')
            expected = (raw-np.array(registration['sourceOrigin'])) @ np.array(registration['axes']).T
            expected += np.array(registration['targetOriginMm'])
            np.testing.assert_array_equal(vertices, expected)
            report = topology(vertices, faces)
            self.assertEqual(report['boundaryEdges'], 0)
            self.assertEqual(report['nonManifoldEdges'], 0)
            self.assertEqual(report['surfaceComponents'], 1)
            self.assertAlmostEqual(report['components'][0]['signedEnclosedVolumeMm3'], 1/6, places=10)
            with self.assertRaisesRegex(ValueError, 'SHA256'):
                load_mesh(folder, 'FJ1', expected_sha='0'*64)

    def test_registry_has_all_requested_pieces_without_claiming_runtime_integration(self):
        manifest = json.loads(MANIFEST.read_text())
        requested = json.loads((MANIFEST.parent/'thoracic-source-requirements.json').read_text())
        ids = [p['id'] for p in manifest['parts']]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertTrue(set(p['id'] for p in requested['parts']).issubset(ids))
        self.assertEqual(len([p for p in manifest['parts'] if p['name'].endswith(' rib')]), 24)
        self.assertEqual(len([p for p in manifest['parts'] if p['name'].endswith('thoracic vertebra')]), 12)
        self.assertFalse(manifest['runtimeIntegration'])
        self.assertTrue(manifest['credit'].startswith('BodyParts3D'))


if __name__ == '__main__':
    unittest.main()
