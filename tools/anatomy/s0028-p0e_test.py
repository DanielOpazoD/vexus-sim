"""Contratos B: descarga real, capacidad, profundidad y piel, sin TAC ni red."""
import gzip
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

    def test_download_counts_reopened_gzip_and_manifest_but_memory_counts_raw(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cap, dom, out = [root/name for name in ['capacity', 'domain', 'B']]
            for p in [cap, dom, out]:
                p.mkdir()
            plan = capacity.materialize_capacity(cap, 344)
            self.assertEqual(plan['rawBytes'], 5671296)
            skin = {'file': 'skin.gzip.bin', 'rawBytes': 128}
            (dom/skin['file']).write_bytes(gzip.compress(bytes(128), mtime=0))
            (dom/'skin.json').write_text(json.dumps({'descriptor': skin}))
            (dom/'depth.json').write_text(json.dumps({'descriptor': {'dimensions': [2, 2, 2]}}))
            assets = []
            for name in ['abdominal', 'thoracic']:
                file = name+'.gzip.bin'
                (out/file).write_bytes(gzip.compress(bytes(32), mtime=0))
                assets.append({'name': name, 'file': file, 'rawBytes': 32, 'textureDimensions': [2, 2, 2], 'depthBytesInAtlas': 0})
            package.lib.save(out/'packing.json', {'assets': assets})
            package.package(out, dom, cap)
            manifest = json.loads((out/'candidate-manifest.json').read_text())
            report = json.loads((out/'package.json').read_text())
            stored = (out/'annotation-capacity.gzip.bin').read_bytes()
            self.assertEqual(gzip.decompress(stored), (cap/'annotation-capacity.bin').read_bytes())
            self.assertLess(len(stored), 10000)
            self.assertEqual(report['totalDownloadBytes'], sum((out/f['file']).stat().st_size for f in report['files'])+report['manifestBytes'])
            self.assertEqual(manifest['capacity']['downloadBytes'], len(stored))
            self.assertEqual(sum(m['capacityBytes'] for m in report['memory']), 5671296)
            # Una fase que llene la reserva cambia la descarga aunque no cambie la residencia.
            raw = np.random.default_rng(28).bytes(plan['rawBytes'])
            (cap/'annotation-capacity.bin').write_bytes(raw)
            plan['sha256'] = capacity.sha(raw)
            capacity.save(cap/'capacity.json', plan)
            (out/'abdominal.gzip.bin').write_bytes(bytes(14000000))
            with self.assertRaisesRegex(ValueError, 'detener fase'):
                package.package(out, dom, cap)
            self.assertFalse(json.loads((out/'package.json').read_text())['allCurrentBudgetsPass'])

    def test_direct_reopens_all_fields_and_depth_and_rejects_shifted_descriptor(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source, original, dom, out = [root/name for name in ['source', 'original', 'domain', 'B']]
            for p in [source, original, dom, out]:
                p.mkdir()
            rows, fields = [], {}
            for i, name in enumerate(['digestiveTract']+[f'field{k}' for k in range(1, 19)]+['digestiveGas']):
                a = np.zeros((2, 2, 2, 2), '<f2')
                a[..., 0] = -1
                a[..., 1] = i % 10
                if name == 'digestiveGas':
                    a[..., 0] = 1
                    a[0, 0, 0, 0] = -1
                raw = a.tobytes()
                compressed = gzip.compress(raw, mtime=0)
                (source/(name+'.gzip.bin')).write_bytes(compressed)
                fields[name] = a
                rows.append({'name':name, 'asset':'abdominal' if i < 16 or name == 'digestiveGas' else 'thoracic',
                             'status':'source' if name != 'digestiveGas' else 'derived-proxy',
                             'originMm':[1., 2., 3.], 'dimensions':[2, 2, 2],
                             'sha256Raw':capacity.sha(raw), 'sha256Gzip':capacity.sha(compressed)})
            capacity.save(source/'fields.json', {'fields':rows, 'physicalFrameSha256':'synthetic'})
            fields['digestiveTract'] = package.lib.encode_gas(fields['digestiveTract'], fields['digestiveGas'])
            assets = []
            for asset in ['abdominal', 'thoracic']:
                selected = [r for r in rows if r['asset'] == asset and r['name'] != 'digestiveGas']
                atlas = np.zeros((2, 2, 3*len(selected), 2), '<f2')
                descriptors = []
                for i, row in enumerate(selected):
                    atlas[:, :, 3*i:3*i+2] = fields[row['name']]
                    descriptors.append({**row, 'offset':[3*i, 0, 0]})
                raw = atlas.tobytes()
                file = asset+'.gzip.bin'
                (original/file).write_bytes(gzip.compress(raw, mtime=0))
                assets.append({'name':asset, 'file':file, 'textureDimensions':list(atlas.shape[-2::-1]),
                               'sha256Raw':capacity.sha(raw), 'fields':descriptors})
            capacity.save(original/'packing.json', {'assets':assets, 'sourcePhysicalFrameSha256':'synthetic'})
            depth = np.arange(8, dtype='<f2').reshape(2, 2, 2)
            raw = depth.tobytes()
            (dom/'depth.gzip.bin').write_bytes(gzip.compress(raw, mtime=0))
            capacity.save(dom/'depth.json', {'descriptor':{'file':'depth.gzip.bin', 'dimensions':[2, 2, 2], 'sha256Raw':capacity.sha(raw)}})
            package.direct(source, original, dom, out)
            result = json.loads((out/'packing.json').read_text())
            self.assertEqual(sum(len(a['verification']) for a in result['assets']), 19)
            for a in result['assets']:
                decoded = np.frombuffer(gzip.decompress((out/a['file']).read_bytes()), '<f2').reshape(*a['textureDimensions'][::-1], 2)
                if a['name'] == 'abdominal':
                    x, y, z = a['depthOffset']
                    np.testing.assert_array_equal(decoded[z:z+2, y:y+2, x:x+2, 0], depth)
            original_fields = list(assets[0]['fields'])
            assets[0]['fields'].pop()
            capacity.save(original/'packing.json', {'assets':assets, 'sourcePhysicalFrameSha256':'synthetic'})
            with self.assertRaisesRegex(ValueError, 'Inventario directo'):
                package.direct(source, original, dom, out)
            assets[0]['fields'] = original_fields
            assets[0]['fields'][0]['originMm'][0] += 1.5
            capacity.save(original/'packing.json', {'assets':assets, 'sourcePhysicalFrameSha256':'synthetic'})
            with self.assertRaisesRegex(ValueError, 'marco físico'):
                package.direct(source, original, dom, out)

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


if __name__ == '__main__':
    unittest.main()
