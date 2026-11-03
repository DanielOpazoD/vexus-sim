"""Contratos B: descarga real, capacidad, profundidad y piel, sin TAC ni red."""
import contextlib
import gzip
import io
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name('s0028-'+name+'.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


domain = load('p0e-domain')
package = load('p0e-package')
capacity = load('capacity')
measure = load('measure')


class ChosenBContract(unittest.TestCase):
    def test_body_reference_preparation_reopens_same_body_without_ct(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            np.savez_compressed(out/'body-source.npz', body=np.ones((9, 9, 4), bool), origin=np.array([-6., -6., -400.]))
            capacity.save(out/'fields.json', {'bodySourceSha256':measure.lib.digest(out/'body-source.npz')})
            measure.prepare_profile(out)
            self.assertEqual(np.fromfile(out/'profile.bin', '<f4').size, 14*65)
            self.assertGreater(np.fromfile(out/'skin-points.f32', '<f4').size, 0)
            self.assertEqual(json.loads((out/'profile-source.json').read_text())['nodes'][0]['zMm'], -400)

    def test_box_extension_is_continuous_without_claiming_native_reference(self):
        sdf = np.full((5, 5, 5), 12., dtype=np.float32)
        points = np.array([[12-1e-6, 6, 6], [12+1e-6, 6, 6], [42, 6, 6]])
        actual, inside = domain.depth_policy(sdf, points, np.zeros(3))
        self.assertEqual(inside.tolist(), [True, False, False])
        self.assertLess(abs(actual[1]-actual[0]), 2e-6)
        self.assertEqual(actual[2], 42)

    def test_missing_reference_is_unknown_instead_of_zero_error_or_pass(self):
        result = domain.consumed_stats(np.array([]))
        self.assertEqual(result['samples'], 0)
        self.assertIsNone(result['maxMm'])
        self.assertFalse(result['pass'])

    def test_skin_is_periodic_and_interpolates_axial_midpoint(self):
        angles = np.arange(1024)*2*np.pi/1024
        xy = np.column_stack([100*np.cos(angles), 100*np.sin(angles)])
        nodes = np.stack([xy, xy+2])
        p = domain.interpolate_xy(nodes, np.array([.375]), 0., 0.)
        np.testing.assert_allclose(p[0], [101, 1, .375])
        np.testing.assert_allclose(domain.interpolate_xy(nodes, np.array([.375]), 1024., 0.), p)

    def test_depth_placement_preserves_original_boxes_and_counts_growth(self):
        fields = [{'offset': [0, 0, 0], 'dimensions': [4, 8, 8]}]
        dims, offset = package.depth_hole([8, 8, 8], fields, [4, 4, 4])
        self.assertEqual(dims, [8, 8, 8])
        self.assertEqual(offset, [4, 0, 0])
        self.assertFalse(package.overlaps(offset, [4, 4, 4], [0, 0, 0], [4, 8, 8]))
        dims, offset = package.depth_hole([8, 8, 8], [{'offset': [0, 0, 0], 'dimensions': [8, 8, 8]}], [4, 4, 4])
        self.assertEqual(dims, [8, 8, 12])
        self.assertEqual(offset, [0, 0, 8])

    def test_resident_and_download_limits_stop_independently(self):
        memory = [{'name': name, 'residentAccountedBytes': value} for name, value in package.RESIDENT_LIMITS.items()]
        package.require_budget(package.DOWNLOAD_LIMIT, memory)
        with self.assertRaisesRegex(ValueError, 'presupuesto'):
            package.require_budget(package.DOWNLOAD_LIMIT+1, memory)
        for row in memory:
            with self.assertRaisesRegex(ValueError, 'presupuesto'):
                package.require_budget(1, [{**row, 'residentAccountedBytes': row['residentAccountedBytes']+1}])
        with self.assertRaisesRegex(ValueError, 'capacidad'):
            capacity.require_mesh_capacity(capacity.capacity_plan(344)['abdominalMesh'], 65537, 1)


class PackageIntegrityContract(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        self.source, self.original, self.dom, self.out, self.cap = [root/name for name in ['source', 'original', 'domain', 'B', 'capacity']]
        for folder in [self.source, self.original, self.dom, self.out, self.cap]:
            folder.mkdir()
        body = np.ones((4, 4, 4), bool)
        origin = np.array([-3., -3., -3.])
        np.savez_compressed(self.source/'body-source.npz', body=body, origin=origin)
        body_sha = capacity.sha((self.source/'body-source.npz').read_bytes())
        rows, fields = [], {}
        for i, name in enumerate(['digestiveTract']+[f'field{k}' for k in range(1, 19)]+['digestiveGas']):
            field = np.zeros((2, 2, 2, 2), '<f2')
            field[..., 0] = -1
            field[..., 1] = i % 10
            if name == 'digestiveGas':
                field[..., 0] = 1
                field[0, 0, 0, 0] = -1
            raw = field.tobytes()
            packed = gzip.compress(raw, mtime=0)
            (self.source/(name+'.gzip.bin')).write_bytes(packed)
            fields[name] = field
            rows.append({'name': name, 'asset': 'abdominal' if i < 16 or name == 'digestiveGas' else 'thoracic',
                         'status': 'source' if name != 'digestiveGas' else 'derived-proxy',
                         'originMm': origin.tolist(), 'dimensions': [2, 2, 2],
                         'sha256Raw': capacity.sha(raw), 'sha256Gzip': capacity.sha(packed)})
        capacity.save(self.source/'fields.json', {'fields': rows, 'physicalFrameSha256': 'synthetic', 'bodySourceSha256': body_sha})
        fields['digestiveTract'] = package.lib.encode_gas(fields['digestiveTract'], fields['digestiveGas'])
        assets = []
        for name in ['abdominal', 'thoracic']:
            selected = [r for r in rows if r['asset'] == name and r['name'] != 'digestiveGas']
            atlas = np.zeros((2, 12, 3*len(selected), 2), '<f2')
            descriptors = []
            for i, row in enumerate(selected):
                atlas[:, :2, 3*i:3*i+2] = fields[row['name']]
                descriptors.append({**row, 'offset': [3*i, 0, 0]})
            raw = atlas.tobytes()
            packed = gzip.compress(raw, mtime=0)
            file = name+'.gzip.bin'
            (self.original/file).write_bytes(packed)
            assets.append({'name': name, 'file': file, 'textureDimensions': list(atlas.shape[-2::-1]),
                           'rawBytes': len(raw), 'gzipBytes': len(packed), 'sha256Raw': capacity.sha(raw),
                           'sha256Gzip': capacity.sha(packed), 'fields': descriptors})
        capacity.save(self.original/'packing.json', {'assets': assets, 'sourcePhysicalFrameSha256': 'synthetic'})
        # Marco calculado a mano: cuerpo 4³, padding XY de 8 nodos, D y halo Z de 6 mm.
        self.write_auxiliary('skin', bytes(1024*7*4), {'format': 'RG16F XY, global periodic polar phi',
            'dimensions': [1024, 7], 'pitchZMm': .75, 'originZMm': -3., 'phiRange': [0, 2*np.pi], 'sourceBodySha256': body_sha})
        self.write_auxiliary('depth', np.arange(11*11*95, dtype='<f2').tobytes(), {
            'format': 'R16F signed EDT, negative inside; 3mm hardware linear', 'dimensions': [11, 11, 95],
            'originMm': [-15., -15., -216.], 'pitchMm': 3., 'sourceBodySha256': body_sha})
        capacity.materialize_capacity(self.cap, 344)
        package.direct(self.source, self.original, self.dom, self.out)

    def write_auxiliary(self, name, raw, descriptor):
        packed = gzip.compress(raw, mtime=0)
        descriptor = {**descriptor, 'file': name+'.gzip.bin', 'rawBytes': len(raw), 'gzipBytes': len(packed),
                      'sha256Raw': capacity.sha(raw), 'sha256Gzip': capacity.sha(packed)}
        (self.dom/descriptor['file']).write_bytes(packed)
        capacity.save(self.dom/(name+'.json'), {'descriptor': descriptor})

    def pack(self):
        with contextlib.redirect_stdout(io.StringIO()):
            package.package(self.out, self.dom, self.cap, self.source)

    def test_download_counts_reopened_gzip_and_manifest_but_memory_counts_raw(self):
        self.pack()
        manifest = json.loads((self.out/'candidate-manifest.json').read_text())
        report = json.loads((self.out/'package.json').read_text())
        stored = (self.out/'annotation-capacity.gzip.bin').read_bytes()
        self.assertEqual(gzip.decompress(stored), (self.cap/'annotation-capacity.bin').read_bytes())
        self.assertLess(len(stored), 10000)
        self.assertEqual(report['totalDownloadBytes'], sum((self.out/f['file']).stat().st_size for f in report['files'])+report['manifestBytes'])
        self.assertEqual(manifest['capacity']['downloadBytes'], len(stored))
        self.assertEqual(sum(m['capacityBytes'] for m in report['memory']), 5671296)
        for row in report['memory']:
            atlas = next(a for a in manifest['packing']['assets'] if a['name'] == row['name'])
            self.assertEqual(row['textureBytes'], len(gzip.decompress((self.out/atlas['file']).read_bytes())))
            self.assertEqual(row['residentAccountedBytes'], row['textureBytes']+row['capacityBytes']+row['skinCPUBytes']+row['manifestAndDescriptorsBytes'])
        # Llenar la reserva cambia la descarga, conserva la residencia y dispara su gate real.
        plan = json.loads((self.cap/'capacity.json').read_text())
        raw = np.random.default_rng(28).bytes(plan['rawBytes'])
        (self.cap/'annotation-capacity.bin').write_bytes(raw)
        plan['sha256'] = capacity.sha(raw)
        capacity.save(self.cap/'capacity.json', plan)
        self.pack()
        filled = json.loads((self.out/'package.json').read_text())
        self.assertGreater(filled['totalDownloadBytes'], report['totalDownloadBytes']+5_600_000)
        self.assertEqual(filled['memory'][0]['residentAccountedBytes']-report['memory'][0]['residentAccountedBytes'], filled['manifestBytes']-report['manifestBytes'])
        self.assertEqual(filled['memory'][1]['residentAccountedBytes'], report['memory'][1]['residentAccountedBytes'])
        with self.assertRaisesRegex(ValueError, 'detener fase'):
            package.require_budget(package.DOWNLOAD_LIMIT+1, filled['memory'])

    def test_direct_reopens_all_fields_and_depth_and_rejects_shifted_descriptor(self):
        result = json.loads((self.out/'packing.json').read_text())
        self.assertEqual(sum(len(a['verification']) for a in result['assets']), 19)
        depth = json.loads((self.dom/'depth.json').read_text())['descriptor']
        for atlas in result['assets']:
            decoded = np.frombuffer(gzip.decompress((self.out/atlas['file']).read_bytes()), '<f2').reshape(*atlas['textureDimensions'][::-1], 2)
            if atlas['name'] == 'abdominal':
                x, y, z = atlas['depthOffset']
                dx, dy, dz = depth['dimensions']
                np.testing.assert_array_equal(decoded[z:z+dz, y:y+dy, x:x+dx, 0].ravel(), np.frombuffer(gzip.decompress((self.dom/depth['file']).read_bytes()), '<f2'))
        original = json.loads((self.original/'packing.json').read_text())
        removed = original['assets'][0]['fields'].pop()
        capacity.save(self.original/'packing.json', original)
        with self.assertRaisesRegex(ValueError, 'Inventario directo'):
            package.direct(self.source, self.original, self.dom, self.out)
        original['assets'][0]['fields'].append(removed)
        removed['originMm'][0] += 1.5
        capacity.save(self.original/'packing.json', original)
        with self.assertRaisesRegex(ValueError, 'marco físico'):
            package.direct(self.source, self.original, self.dom, self.out)

    def test_auxiliary_wrong_body_hash_and_translated_depth_are_rejected(self):
        self.pack()
        for name in ['skin', 'depth']:
            doc = json.loads((self.dom/(name+'.json')).read_text())
            doc['descriptor']['sourceBodySha256'] = '0'*64
            if name == 'depth':
                doc['descriptor']['originMm'][0] += 100
            capacity.save(self.dom/(name+'.json'), doc)
        for entry in ['direct', 'package']:
            with self.subTest(entry=entry), self.assertRaisesRegex(ValueError, 'procedencia|marco'):
                if entry == 'direct':
                    package.direct(self.source, self.original, self.dom, self.out)
                else:
                    self.pack()

    def test_atlas_extra_mebibyte_is_rejected_before_accounting(self):
        self.pack()
        packing = json.loads((self.out/'packing.json').read_text())
        atlas = packing['assets'][0]
        path = self.out/atlas['file']
        raw = gzip.decompress(path.read_bytes())+bytes(1024*1024)
        path.write_bytes(gzip.compress(raw, compresslevel=9, mtime=0))
        self.assertEqual(len(raw), atlas['rawBytes']+1024*1024)
        with self.assertRaisesRegex(ValueError, 'Atlas.*tamaño|Atlas.*hash'):
            self.pack()
        packed = path.read_bytes()
        atlas.update(rawBytes=len(raw), gzipBytes=len(packed), sha256Raw=capacity.sha(raw), sha256Gzip=capacity.sha(packed))
        capacity.save(self.out/'packing.json', packing)
        with self.assertRaisesRegex(ValueError, 'Atlas.*tamaño'):
            self.pack()


    def test_each_auxiliary_hash_and_frame_is_checked_by_both_entry_points(self):
        for name, key, value in [('skin', 'sourceBodySha256', '0'*64), ('depth', 'sourceBodySha256', '0'*64),
                                 ('skin', 'originZMm', 97.), ('depth', 'originMm', [85., -15., -216.]),
                                 ('skin', 'pitchZMm', 1.5), ('depth', 'pitchMm', 6.)]:
            path = self.dom/(name+'.json')
            original = path.read_bytes()
            doc = json.loads(original)
            doc['descriptor'][key] = value
            capacity.save(path, doc)
            for entry in ['direct', 'package']:
                with self.subTest(name=name, key=key, entry=entry), self.assertRaisesRegex(ValueError, 'procedencia|marco'):
                    if entry == 'direct':
                        package.direct(self.source, self.original, self.dom, self.out)
                    else:
                        self.pack()
            path.write_bytes(original)


    def test_valid_high_entropy_atlas_stops_download_budget(self):
        packing = json.loads((self.out/'packing.json').read_text())
        atlas = packing['assets'][0]
        raw = np.random.default_rng(28).bytes(192*192*160*4)
        packed = gzip.compress(raw, mtime=0)
        atlas.update(textureDimensions=[192, 192, 160], rawBytes=len(raw), gzipBytes=len(packed),
                     sha256Raw=capacity.sha(raw), sha256Gzip=capacity.sha(packed))
        (self.out/atlas['file']).write_bytes(packed)
        capacity.save(self.out/'packing.json', packing)
        with self.assertRaisesRegex(ValueError, 'detener fase'):
            self.pack()
        report = json.loads((self.out/'package.json').read_text())
        self.assertFalse(report['allCurrentBudgetsPass'])
        self.assertGreater(report['totalDownloadBytes'], package.DOWNLOAD_LIMIT)
        self.assertTrue(all(m['marginBytes'] >= 0 for m in report['memory']))

    def test_same_size_atlas_corruption_and_gzip_hash_are_rejected_for_each_asset(self):
        packing = json.loads((self.out/'packing.json').read_text())
        original_packing = (self.out/'packing.json').read_bytes()
        for name in ['abdominal', 'thoracic']:
            path = self.out/next(a['file'] for a in packing['assets'] if a['name'] == name)
            original = path.read_bytes()
            for mode in ['raw', 'gzip']:
                packing = json.loads(original_packing)
                atlas = next(a for a in packing['assets'] if a['name'] == name)
                packed = bytearray(original)
                if mode == 'raw':
                    raw = bytearray(gzip.decompress(packed)); raw[-1] ^= 1
                    packed = gzip.compress(raw, mtime=0)
                    atlas['gzipBytes'] = len(packed)
                    atlas['sha256Gzip'] = capacity.sha(packed)
                else:
                    packed[4] ^= 1  # mtime cambia el hash gzip sin cambiar RAW ni longitud.
                path.write_bytes(packed)
                capacity.save(self.out/'packing.json', packing)
                with self.subTest(asset=atlas['name'], mode=mode), self.assertRaisesRegex(ValueError, 'Atlas.*hash'):
                    self.pack()
                path.write_bytes(original)
                packing = json.loads(original_packing)
            (self.out/'packing.json').write_bytes(original_packing)


if __name__ == '__main__':
    unittest.main()
