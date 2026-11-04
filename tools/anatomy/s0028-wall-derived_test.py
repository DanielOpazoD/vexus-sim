"""Contrato del bloque derivado de pared s0028: sintético, sin TAC, red ni renderer."""
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest

import numpy as np


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name('s0028-'+name+'.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


derived = load('wall-derived')
wall = load('wall')
capacity = load('capacity')


def cylinder_seeds(radius=150.):
    phi = 2*np.pi*np.arange(512)/512
    z = -210+1.5*np.arange(181)
    seeds = np.empty((181, 512, 3))
    seeds[..., 0] = radius*np.cos(phi)[None]
    seeds[..., 1] = radius*np.sin(phi)[None]
    seeds[..., 2] = z[:, None]
    return seeds


def patch_surface(rows=range(50, 61), cols=range(100, 111)):
    surface = np.full((181, 512, 4), np.nan, '<f2')
    surface[..., 3] = 0
    for j in rows:
        for i in cols:
            surface[j, i] = [10, 30+.25*j+.125*(i % 7), 30+.25*j+.125*(i % 7), 2*8+2*32+3*128]
    return surface


class DerivedContract(unittest.TestCase):
    def test_nearest_known_is_the_brute_force_nearest_within_twelve_mm(self):
        surface, seeds = patch_surface(), cylinder_seeds()
        self.assertEqual(derived.RADIUS_MM, 12.)
        code, distance = derived.nearest_known(surface, seeds)
        known = derived.known_nodes(surface)
        kj, ki = np.nonzero(known)
        sources = seeds[kj, ki]
        checked = with_e = 0
        for j in range(40, 71):
            for i in range(85, 126):
                if known[j, i]:
                    self.assertEqual(code[j, i], derived.SELF_CODE)
                    continue
                d = np.linalg.norm(sources-seeds[j, i], axis=-1)
                k = int(np.argmin(d))
                checked += 1
                if d[k] > 12.:
                    self.assertEqual(code[j, i], -1, (j, i))
                    self.assertFalse(np.isfinite(distance[j, i]))
                    continue
                with_e += 1
                self.assertAlmostEqual(distance[j, i], d[k], places=9)
                dj, di = derived.offset_of(code[j, i])
                self.assertTrue(known[j+dj, (i+di) % 512])
                self.assertAlmostEqual(np.linalg.norm(seeds[j+dj, (i+di) % 512]-seeds[j, i]), d[k], places=9)
        self.assertGreater(with_e, 100)
        self.assertGreater(checked-with_e, 100)
        # Borde del radio en z: la fila 68 está a 12 mm de la última fila conocida (60) y la 69 a 13,5 mm
        self.assertEqual(code[69, 105], -1)
        self.assertAlmostEqual(distance[68, 105], 12., places=9)

    def test_ties_follow_the_declared_order(self):
        surface = np.full((181, 512, 4), np.nan, '<f2')
        surface[..., 3] = 0
        for i in (99, 101):
            surface[80, i] = [10, 31, 31+(i == 101), 2*8+2*32+3*128]
        seeds = np.zeros((181, 512, 3))
        seeds[..., 0] = 2.*np.arange(512)[None]
        seeds[..., 1] = 1.5*np.arange(181)[:, None]
        code, _ = derived.nearest_known(surface, seeds)
        self.assertEqual(derived.offset_of(code[80, 100]), (0, -1))
        e, _ = derived.e_map(surface, seeds)
        self.assertEqual(float(e[80, 100, 0]), 31.)

    def test_e_map_copies_known_faces_keeps_far_U_and_rejects_invented_sources(self):
        surface, seeds = patch_surface(), cylinder_seeds()
        e, distance = derived.e_map(surface, seeds)
        derived.require_e_map(e, surface)
        known = derived.known_nodes(surface)
        self.assertTrue(np.array_equal(e[known, 0].view('<u2'), surface[known, 2].view('<u2')))
        far = ~known & ~np.isfinite(distance)
        self.assertTrue(np.isnan(e[far]).all())
        self.assertTrue(np.isfinite(e[~known & np.isfinite(distance)]).all())
        for mutate, message in [
            (lambda m: m.__setitem__((5, 5, 0), 30), 'sin fuente'),
            (lambda m: m.__setitem__((5, 5), [30, derived.code_of(1, 0)]), 'nodo U'),
            (lambda m: m.__setitem__((49, 105, 0), m[49, 105, 0]+1), 'otra cara'),
            (lambda m: m.__setitem__((55, 105, 1), derived.code_of(1, 0)), 'propia'),
        ]:
            bad = e.copy()
            mutate(bad)
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                derived.require_e_map(bad, surface)

    def test_ramps_are_row_percentiles_and_unannotated_rows_borrow_the_nearest(self):
        surface = np.full((181, 512, 4), np.nan, '<f2')
        surface[..., 3] = 0
        rng = np.random.default_rng(3)
        for j in range(20, 141):
            values = 25+.1*j+rng.uniform(0, 20, 512)
            surface[j, :, 0], surface[j, :, 1], surface[j, :, 2] = 10, values, values
            surface[j, :, 3] = 2*8+2*32+3*128
        ramp, reach = derived.ramps(surface)
        for j in [20, 77, 140]:
            expected = np.percentile(surface[j, :, 2].astype(np.float64), [10, 90]).astype('<f2')
            self.assertTrue(np.array_equal(ramp[j], expected), j)
        self.assertTrue(np.array_equal(ramp[0], ramp[20]) and np.array_equal(ramp[180], ramp[140]))
        self.assertEqual(int(reach[0]), 20)
        flat = surface.copy()
        flat[20:141, :, 1:3] = 31
        flat_ramp, _ = derived.ramps(flat)
        self.assertTrue((flat_ramp[:, 1]-flat_ramp[:, 0] >= derived.MIN_RAMP_SPAN_MM).all())
        with self.assertRaisesRegex(ValueError, 'rampa'):
            derived.ramps(np.full((181, 512, 4), np.nan, '<f2'))

    def package(self, folder, surface):
        cap = capacity.materialize_capacity(folder, 344)
        raw = bytearray((folder/cap['file']).read_bytes())
        _, count = struct.unpack_from('<4sI', raw)
        header = json.loads(raw[8:8+count])
        start = next(p for p in header['parts'] if p['name'] == 'wall')['offsetBytes']
        centers = np.full((181, 2), 0, '<f2').tobytes()
        payload = wall.tile_surface(surface).tobytes()+centers
        raw[start:start+len(payload)] = payload
        compressed = gzip.compress(bytes(raw), compresslevel=9, mtime=0)
        (folder/'annotation-capacity.gzip.bin').write_bytes(compressed)
        skin = np.zeros((687, 1024, 2), '<f2')
        phi = 2*np.pi*np.arange(1024)/1024
        skin[..., 0], skin[..., 1] = 150*np.cos(phi), 150*np.sin(phi)
        skin_gzip = gzip.compress(skin.tobytes(), mtime=0)
        (folder/'skin-polar.gzip.bin').write_bytes(skin_gzip)
        manifest = {
            'packing': {'assets': [{'name': 'abdominal', 'textureDimensions': [189, 256, 685], 'depthOffset': [0, 104, 589],
                                    'fields': [{'name': 'liver', 'offset': [0, 105, 477], 'dimensions': [173, 117, 112]}]}]},
            'depth': {'dimensions': [147, 93, 96]},
            'skin': {'dimensions': [1024, 687], 'pitchZMm': .75, 'originZMm': -395.98879268882285,
                     'file': 'skin-polar.gzip.bin', 'sha256Gzip': hashlib.sha256(skin_gzip).hexdigest()},
            'capacity': {'sha256Gzip': hashlib.sha256(compressed).hexdigest()},
            'files': [{'file': 'annotation-capacity.gzip.bin', 'bytes': len(compressed)}],
            'wallP2Offline': {'payloadBytes': len(payload), 'payloadSha256': hashlib.sha256(payload).hexdigest(),
                              'tileSize': [65, 91, 2], 'centerOffset': [48, 0, 398],
                              'placements': [[0, 0, 619+2*k] for k in range(16)]},
        }
        (folder/'candidate-manifest.bin').write_bytes((json.dumps(manifest, indent=2)+'\n').encode())
        return bytes(raw), start, len(payload)

    def test_derive_writes_only_after_the_payload_and_is_idempotent(self):
        surface = patch_surface(range(20, 141), range(0, 200))
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            (tmp/'in').mkdir()
            before, start, size = self.package(tmp/'in', surface)
            report = derived.derive(tmp/'in', tmp/'out')
            after = gzip.decompress((tmp/'out'/'annotation-capacity.gzip.bin').read_bytes())
            self.assertEqual(len(after), len(before))
            block, _ = derived.derive_block(surface, cylinder_seeds())
            end = start+size+len(block)
            self.assertEqual(after[start:start+size], before[start:start+size])
            self.assertEqual(after[start+size:end], block)
            self.assertEqual(after[end:], before[end:])
            self.assertEqual(after[4096:start], before[4096:start])
            manifest = json.loads((tmp/'out'/'candidate-manifest.bin').read_bytes())
            d = manifest['wallP2Derived']
            self.assertEqual((d['provenance'], d['offsetBytes'], d['bytes']), ('E', size, len(block)))
            self.assertEqual(d['sha256'], hashlib.sha256(block).hexdigest())
            self.assertEqual(d['payloadSha256'], manifest['wallP2Offline']['payloadSha256'])
            self.assertEqual(report['rawReservationIncrementBytes'], 0)
            (tmp/'out'/'skin-polar.gzip.bin').write_bytes((tmp/'in'/'skin-polar.gzip.bin').read_bytes())
            derived.derive(tmp/'out', tmp/'again')
            for name in ['annotation-capacity.gzip.bin', 'candidate-manifest.bin']:
                self.assertEqual((tmp/'again'/name).read_bytes(), (tmp/'out'/name).read_bytes(), name)

    def test_derive_rejects_foreign_bytes_full_reserve_and_occupied_placement(self):
        surface = patch_surface(range(20, 141), range(0, 200))
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            (tmp/'in').mkdir()
            self.package(tmp/'in', surface)
            manifest = json.loads((tmp/'in'/'candidate-manifest.bin').read_bytes())
            for change, message in [
                (lambda m: m['wallP2Offline'].update(payloadSha256='0'*64), 'payload'),
                (lambda m: m['skin'].update(sha256Gzip='0'*64), 'piel'),
                (lambda m: m['packing']['assets'][0]['fields'].append({'name': 'x', 'offset': [0, 0, 653], 'dimensions': [1, 1, 1]}), 'ajeno'),
                (lambda m: m['packing']['assets'][0]['fields'].append({'name': 'halo', 'offset': [181, 1, 654], 'dimensions': [1, 1, 1]}), 'ajeno'),
                (lambda m: m['wallP2Offline'].update(payloadBytes=2113536-1000), 'payload|reserva'),
            ]:
                bad = json.loads(json.dumps(manifest))
                change(bad)
                (tmp/'in'/'candidate-manifest.bin').write_bytes((json.dumps(bad, indent=2)+'\n').encode())
                with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                    derived.derive(tmp/'in', tmp/'bad')


if __name__ == '__main__':
    unittest.main()
