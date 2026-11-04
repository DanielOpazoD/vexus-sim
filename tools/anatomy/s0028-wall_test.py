"""Contrato P2 offline: no requiere TAC, red, renderer ni anotación del propietario."""
import copy
import gzip
import importlib.util
import json
from pathlib import Path
import unittest
import tempfile

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
        record = self.record()
        record['boundaries'][2]['provenance'] = 'O'
        with self.assertRaisesRegex(ValueError, 'fina'):
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

    def test_export_reopens_p1_reserve_preserves_neighbors_and_binds_records_to_tiles(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            baseline, annotation, output = [root/p for p in ['baseline', 'annotation', 'out']]
            baseline.mkdir()
            annotation.mkdir()
            plan = capacity.materialize_capacity(baseline, 344)
            original = (baseline/'annotation-capacity.bin').read_bytes()
            (baseline/'annotation-capacity.bin').unlink()
            (baseline/'annotation-capacity.gzip.bin').write_bytes(gzip.compress(original, mtime=0))
            (root/'abdominal-body.bin').write_bytes(b'profile')
            manifest = {'packing': {'sourcePhysicalFrameSha256': 'fixture', 'assets': [
                {'name': 'abdominal', 'textureDimensions': [189, 256, 685], 'fields': [
                    {'name': 'liver', 'offset': [0, 0, 0], 'dimensions': [4, 4, 4]}], 'depthOffset': [4, 0, 0]}]},
                'depth': {'dimensions': [4, 4, 4]}, 'capacity': plan, 'files': []}
            (baseline/'candidate-manifest.bin').write_text(json.dumps(manifest, indent=2)+'\n')
            record = {**self.record(), 'cell': [0, 0]}
            source = {'id': 'synthetic', 'source': {k: CASE[k] for k in wall.FRAME_KEYS},
                      'physicalFrameSha256': 'fixture', 'records': [record],
                      'placements': [[0, 0, 619+2*i] for i in range(16)], 'centerOffset': [48, 0, 398]}
            surface = np.empty(wall.SHAPE, '<f2')
            surface[..., :3], surface[..., 3] = np.nan, 0
            surface[0, 0] = wall.encode_record(record)
            (annotation/'tiles.f16').write_bytes(wall.tile_surface(surface).tobytes())
            (annotation/'centers.f16').write_bytes(np.zeros((181, 2), '<f2').tobytes())
            path = annotation/'annotation.json'
            path.write_text(json.dumps(source))
            report = wall.export(annotation, baseline, output, CASE)
            self.assertEqual(report['atlasIncrementBytes'], 0)
            self.assertEqual(report['thoracicIncrementBytes'], 0)
            self.assertLessEqual(report['metadataBytes'], 4096)
            actual = gzip.decompress((output/'annotation-capacity.gzip.bin').read_bytes())
            self.assertEqual(len(actual), len(original))
            end = 4096+report['payloadBytes']
            self.assertEqual(actual[end:], original[end:])
            source.update(method='surface-own-profiles-v1', surfaceGeometry=copy.deepcopy(wall.SURFACE_GEOMETRY))
            record.update(sourceProfile='surface-profile:0:0', surfaceEvidence={
                'profileCell': [0, 0], 'method': 'own-profile', 'profileStepMm': .5,
                'organSkeletonStopMm': 32.})
            path.write_text(json.dumps(source))
            wall.export(annotation, baseline, output, CASE)
            reopened = json.loads((output/'candidate-manifest.bin').read_text())
            self.assertEqual(reopened['wallP2Offline']['surfaceGeometry'], wall.SURFACE_GEOMETRY)
            source['surfaceGeometry']['prismResidualMaxMm'] = 3.
            path.write_text(json.dumps(source))
            with self.assertRaisesRegex(ValueError, 'celda finita'):
                wall.export(annotation, baseline, output, CASE)
            source['surfaceGeometry'] = copy.deepcopy(wall.SURFACE_GEOMETRY)
            source['records'] = []
            path.write_text(json.dumps(source))
            with self.assertRaisesRegex(ValueError, 'muestra ausente'):
                wall.export(annotation, baseline, output, CASE)
            source['records'] = [record]
            source['placements'][0] = [0, 0, 0]
            path.write_text(json.dumps(source))
            with self.assertRaisesRegex(ValueError, 'campo ajeno'):
                wall.export(annotation, baseline, output, CASE)

    def surface_record(self):
        record = self.record()
        record.update(cell=[50, 128], sourceProfile='surface-profile:50:128',
                      surfaceEvidence={'profileCell': [50, 128], 'method': 'own-profile',
                                       'profileStepMm': .5, 'organSkeletonStopMm': 32.})
        return record

    def test_surface_D_requires_its_own_profile_and_preserves_posterior_U(self):
        record = self.surface_record()
        wall.require_surface_record(record)
        for key, value in [('profileCell', [51, 128]), ('profileStepMm', 1.),
                           ('method', 'ten-anchor-interpolation'), ('method', 'uniform-ring')]:
            changed = copy.deepcopy(record)
            changed['surfaceEvidence'][key] = value
            with self.subTest(key=key, value=value), self.assertRaisesRegex(ValueError, 'perfil'):
                wall.require_surface_record(changed)
        record['cell'] = [50, 384]
        record['surfaceEvidence']['profileCell'] = record['cell']
        record['sourceProfile'] = 'surface-profile:50:384'
        with self.assertRaisesRegex(ValueError, 'posterior'):
            wall.require_surface_record(record)

    def test_surface_organ_limit_and_short_E_gap_are_hard_bounds(self):
        record = self.surface_record()
        record['surfaceEvidence']['organSkeletonStopMm'] = 30
        with self.assertRaisesRegex(ValueError, 'órgano'):
            wall.require_surface_record(record)
        record = self.surface_record()
        for boundary in record['boundaries'][:2]:
            boundary['provenance'] = 'E'
        record['surfaceEvidence'].update(method='short-surface-gap', maxHoleSpanMm=6.,
                                         supportCells=[[49, 128], [50, 127], [51, 128]])
        wall.require_surface_record(record)
        for key, value in [('maxHoleSpanMm', 6.01), ('supportCells', [])]:
            changed = copy.deepcopy(record)
            changed['surfaceEvidence'][key] = value
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, 'hueco'):
                wall.require_surface_record(changed)

    def test_logical_complex_requires_own_boundary_support_and_visceral_cap(self):
        record = self.surface_record()
        record['boundaries'][2]['value'] = 29.
        record['surfaceEvidence'].update(visceralStopMm=32., boundarySupportMm=[[17, 19], [28, 30]])
        wall.require_logical_surface_record(record)
        for key, value in [('boundarySupportMm', [[10, 12], [28, 30]]),
                           ('boundarySupportMm', [[15, 20], [28, 30]]), ('visceralStopMm', 28.)]:
            changed = copy.deepcopy(record)
            changed['surfaceEvidence'][key] = value
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, 'perfil|órgano'):
                wall.require_logical_surface_record(changed)

        changed = copy.deepcopy(record)
        changed['boundaries'][2]['value'] = 30.
        with self.assertRaisesRegex(ValueError, 'interfaz'):
            wall.require_logical_surface_record(changed)

    def test_logical_gradient_needs_source_costal_transition_and_keeps_U(self):
        surface = np.zeros(wall.SHAPE, '<f2')
        surface[..., :3] = np.nan
        surface[50, 128] = [18, 29, 29, wall.encode_record(self.record())[3]]
        surface[50, 129] = [22, 34, 34, wall.encode_record(self.record())[3]]
        with self.assertRaisesRegex(ValueError, 'gradiente'):
            wall.require_logical_surface(surface, {})
        edge = {'cells': [[50, 128], [50, 129]], 'anatomy': 'source-costal-rim',
                'sourceCostalDistanceMm': [1., 2.], 'sourceMasksSha256': 'synthetic-source'}
        annotation = {'transitionEdges': [edge]}
        wall.require_logical_surface(surface, annotation)
        for key, value in [('sourceCostalDistanceMm', [1, 6.01]), ('anatomy', 'unexplained'),
                           ('sourceMasksSha256', '')]:
            changed = copy.deepcopy(annotation)
            changed['transitionEdges'][0][key] = value
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, 'costal'):
                wall.require_logical_surface(surface, changed)
        surface[50, 129, :3] += 20
        with self.assertRaisesRegex(ValueError, 'gradiente'):
            wall.require_logical_surface(surface, annotation)

    def test_E_hole_must_include_U_across_periodic_seam_and_exact_corners(self):
        surface = np.zeros(wall.SHAPE, '<f2')
        surface[..., :3] = np.nan
        phi = np.arange(512)*2*np.pi/512
        region = np.zeros((181, 512), bool)
        region[20:141, (phi <= 3.55) | (phi >= 2*np.pi-.35)] = True
        surface[region] = [18, 29, 29, wall.encode_record(self.record())[3]]
        for cell in [(50, 0), (50, 1)]:
            surface[cell] = [np.nan, np.nan, np.nan, 0]
        record = self.surface_record()
        record['cell'] = [50, 511]
        for boundary in record['boundaries'][:2]:
            boundary['provenance'] = 'E'
        record['boundaries'][2]['value'] = 29
        surface[50, 511] = wall.encode_record(record)
        cells = [[50, 511], [50, 0], [50, 1]]
        corners = np.array([[x+dx, dy, 0] for x in [-1, 0, 1] for dx in [-.5, .5] for dy in [-.5, .5]])
        span = float(np.max(np.linalg.norm(corners[:, None]-corners[None], axis=-1)))
        record['surfaceEvidence'].update(holeCells=[[50, 511]], holeCornersLASmm=corners.tolist(), maxHoleSpanMm=span)
        annotation = {'records': [record]}
        with self.assertRaisesRegex(ValueError, 'periódico'):
            wall.require_logical_surface(surface, annotation)
        record['surfaceEvidence']['holeCells'] = cells
        wall.require_logical_surface(surface, annotation)
        record['surfaceEvidence']['holeCornersLASmm'][0][0] -= 10
        with self.assertRaisesRegex(ValueError, 'físico'):
            wall.require_logical_surface(surface, annotation)


if __name__ == '__main__':
    unittest.main()
