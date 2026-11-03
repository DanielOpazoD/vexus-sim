"""Contrato P2 offline: no requiere TAC, red, renderer ni anotación del propietario."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest

import numpy as np


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name('s0028-'+name+'.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


wall = load('wall')
capacity = load('capacity')
CASE = json.loads(Path(__file__).with_name('s0028-case.json').read_text())


class WallContract(unittest.TestCase):
    def record(self):
        return {
            'id': 'synthetic-adjacent-slice-1',
            'boundaries': [{'value': v, 'provenance': p, 'source': 'synthetic-trace'}
                           for v, p in [(18., 'D'), (29., 'D'), (31., 'E')]],
            'region': {'value': None, 'provenance': 'U', 'hypothesis': 'obliques'},
            'regionEvidence': 'U',
        }

    def test_same_person_frame_and_mm_are_mandatory(self):
        identity = {key: copy.deepcopy(CASE[key]) for key in wall.FRAME_KEYS}
        wall.require_identity(identity, CASE)
        for key, bad in [('person', 's0440'), ('units', 'cm'), ('pitchMm', 1.),
                         ('affineRASmm', np.eye(4).tolist()), ('rasToLASmm', np.eye(4).tolist()),
                         ('ctSha256', '0'*64), ('frameId', 'other')]:
            changed = {**identity, key: bad}
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, 'fuente|unidades'):
                wall.require_identity(changed, CASE)

    def test_unknown_identity_cannot_be_promoted_to_observed(self):
        record = self.record()
        wall.require_record(record)
        record['region'] = {'value': 'obliques', 'provenance': 'O'}
        with self.assertRaisesRegex(ValueError, 'identidad'):
            wall.require_record(record)

    def test_crossed_boundaries_and_missing_as_zero_fail(self):
        for values in [[30, 29, 31], [18, 29, 28], [0, 0, 0]]:
            record = self.record()
            for boundary, value in zip(record['boundaries'], values):
                boundary['value'] = value
            with self.subTest(values=values), self.assertRaisesRegex(ValueError, 'orden|ausencia'):
                wall.require_record(record)
        record = self.record()
        for boundary in record['boundaries']:
            boundary.update(value=None, provenance='U')
        wall.require_record(record)
        record['boundaries'][0]['value'] = 0
        with self.assertRaisesRegex(ValueError, 'ausencia'):
            wall.require_record(record)

    def test_each_encoded_value_preserves_provenance_and_unknown(self):
        record = self.record()
        encoded = wall.encode_record(record)
        self.assertEqual(wall.decode_code(encoded[3]), (0, ['D', 'D', 'E'], 'U'))
        for boundary in record['boundaries']:
            boundary.update(value=None, provenance='U')
        encoded = wall.encode_record(record)
        self.assertTrue(np.isnan(encoded[:3]).all())
        self.assertEqual(wall.decode_code(encoded[3]), (0, ['U', 'U', 'U'], 'U'))
        for region in range(5):
            for code in range(4**4):
                word = region + 8*(code % 4) + 32*(code//4 % 4) + 128*(code//16 % 4) + 512*(code//64)
                self.assertEqual(float(np.float16(word)), word)

    def test_periodic_and_axial_halos_are_checked_after_decoding(self):
        surface = np.zeros((181, 512, 4), '<f2')
        surface[..., :3] = [18, 29, 31]
        surface[..., 3] = wall.encode_record(self.record())[3]
        tiles = wall.tile_surface(surface)
        wall.require_halos(tiles)
        np.testing.assert_equal(wall.untile_surface(tiles), surface)
        for index in [(0, 0, 2, 64, 0), (0, 0, 90, 4, 0), (7, 1, 3, 64, 1)]:
            corrupt = tiles.copy()
            corrupt[index] += 1
            with self.subTest(index=index), self.assertRaisesRegex(ValueError, 'halo'):
                wall.require_halos(corrupt)

    def test_other_fields_and_thoracic_byte_are_protected(self):
        layout = {'dimensions': [10, 10, 10], 'occupied': [{'offset': [0, 0, 0], 'dimensions': [4, 4, 4]}]}
        wall.require_placement([4, 0, 0], [2, 2, 2], layout)
        with self.assertRaisesRegex(ValueError, 'ocupación'):
            wall.require_placement([3, 0, 0], [2, 2, 2], layout)
        with self.assertRaisesRegex(ValueError, 'ocupación'):
            wall.require_placement([9, 0, 0], [2, 2, 2], layout)
        capacity.require_wall_budget(757844, 4096, 0, 0, 0)
        for args in [(757844, 4096, 0, 0, 1), (757844, 4097, 0, 0, 0),
                     (757844, 0, 1, 0, 0), (757844, 0, 0, 1, 0), (2113537, 0, 0, 0, 0)]:
            with self.subTest(args=args), self.assertRaisesRegex(ValueError, 'presupuesto'):
                capacity.require_wall_budget(*args)

    def test_ten_anchor_negative_and_unknown_do_not_pass_anatomical_review(self):
        with self.assertRaisesRegex(ValueError, 'anclas'):
            wall.require_reviewable({'method': 'ten-anchor-interpolation', 'missingBands': 0, 'unknownRegions': 0, 'collisions': 0})
        for key in ['missingBands', 'unknownRegions', 'collisions']:
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, 'revisión'):
                wall.require_reviewable({'method': 'adjacent-ct-traces', 'missingBands': 0, 'unknownRegions': 0, 'collisions': 0, key: 1})


if __name__ == '__main__':
    unittest.main()
