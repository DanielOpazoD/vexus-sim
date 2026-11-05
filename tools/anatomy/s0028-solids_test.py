"""Pruebas sintéticas del contrato offline P3, sin TAC ni dependencias de producto."""
import copy
import hashlib
import importlib.util
from pathlib import Path
import unittest

import numpy as np

spec = importlib.util.spec_from_file_location('solids', Path(__file__).with_name('s0028-solids.py'))
solids = importlib.util.module_from_spec(spec)
spec.loader.exec_module(solids)
capacity_spec = importlib.util.spec_from_file_location('capacity', Path(__file__).with_name('s0028-capacity.py'))
capacity = importlib.util.module_from_spec(capacity_spec)
capacity_spec.loader.exec_module(capacity)


class SolidsContractTest(unittest.TestCase):
    def test_source_identity_frame_and_hash_are_bound(self):
        case = {'person': 's0028', 'frameId': 'frame', 'ctSha256': hashlib.sha256(b'ct').hexdigest(),
                'shape': [2, 2, 2], 'affineRASmm': np.eye(4).tolist(),
                'rasToLASmm': np.eye(4).tolist(), 'pitchMm': 1.5, 'units': 'mm'}
        solids.require_source(case, copy.deepcopy(case), b'ct')
        for key, value in [('person', 'other'), ('frameId', 'other'), ('pitchMm', 2),
                           ('affineRASmm', (np.eye(4)*2).tolist()), ('ctSha256', '0'*64)]:
            bad = copy.deepcopy(case)
            bad[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                solids.require_source(bad, case, b'ct')
        with self.assertRaises(ValueError):
            solids.require_source(case, case, b'wrong')
        mask = {'person': 's0028', 'sha256': hashlib.sha256(b'mask').hexdigest()}
        solids.require_mask('liver', mask, {'liver': mask}, b'mask')
        with self.assertRaises(ValueError):
            solids.require_mask('liver', mask, {'liver': mask}, b'wrong')
        with self.assertRaises(ValueError):
            solids.require_mask('spleen', mask, {'liver': mask}, b'mask')

    def test_independent_owners_and_unknown_are_preserved(self):
        result = solids.collect_owners({'liver': ('O', True), 'kidney_right': ('D', True)})
        self.assertEqual(result['state'], 'conflict')
        self.assertEqual(set(result['owners']), {'liver', 'kidney_right'})
        self.assertEqual(solids.collect_owners({'liver': ('U', None)})['state'], 'U')
        self.assertEqual(solids.collect_owners({'liver': ('O', None)})['state'], 'U')
        self.assertEqual(solids.collect_owners({'liver': ('O', True), 'kidney_right': ('U', None)})['state'], 'U')
        with self.assertRaises(ValueError):
            solids.collect_owners({'liver': ('U', True)})
        with self.assertRaises(ValueError):
            solids.collect_owners({'liver': ('O', 1)})
        with self.assertRaises(ValueError):
            solids.collect_owners({'Gerota': ('D', True)})
        with self.assertRaises(ValueError):
            solids.collect_owners({'quadratus_lumborum': ('O', True)})
        for alias in ('gerota', 'ql', 'perirenal_fat', 'posterior_diaphragm'):
            with self.subTest(alias=alias), self.assertRaises(ValueError):
                solids.collect_owners({alias: ('O', True)})
        self.assertEqual(solids.collect_owners({'kidney_right_interior': ('U', None)})['state'], 'U')

    def test_nearest_never_extrapolates_and_retains_labels(self):
        a = np.array([[[1]], [[2]]], dtype=np.uint8)
        self.assertEqual(solids.nearest_label(a, [0.49, 0, 0]), 1)
        self.assertEqual(solids.nearest_label(a, [0.51, 0, 0]), 2)
        self.assertIsNone(solids.nearest_label(a, [-0.01, 0, 0]))
        self.assertIsNone(solids.nearest_label(a, [1.01, 0, 0]))
        for invalid in (float('nan'), 1.5, -1):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                solids.nearest_label(np.full((1, 1, 1), invalid), [0, 0, 0])

    def test_field_owner_uses_nearest_p1_identity_and_preserves_unknown(self):
        labels = np.array([[[1]], [[2]], [[3]], [[4]]], dtype=np.uint8)
        mapping = {1: 'iliopsoas_left', 2: 'iliopsoas_right',
                   3: 'autochthon_left', 4: 'autochthon_right'}
        self.assertEqual(solids.field_owner(labels, [1.01, 0, 0], -0.25, mapping),
                         {'state': 'D', 'owner': 'iliopsoas_right'})
        self.assertEqual(solids.field_owner(labels, [2.99, 0, 0], -0.25, mapping),
                         {'state': 'D', 'owner': 'autochthon_right'})
        self.assertEqual(solids.field_owner(labels, [-0.1, 0, 0], -0.25, mapping)['state'], 'U')
        self.assertEqual(solids.field_owner(labels, [0, 0, 0], None, mapping)['state'], 'U')
        self.assertEqual(solids.field_owner(labels, [0, 0, 0], 0.5, mapping)['state'], 'outside')
        with self.assertRaises(ValueError):
            solids.field_owner(labels, [1, 0, 0], -1, {1: 'iliopsoas_left'})
        with self.assertRaises(ValueError):
            solids.field_owner(labels, [0, 0, 0], -1, {1: 'Gerota'})
        renal = solids.field_owner(labels, [0, 0, 0], -1, {1: 'kidney_right'})
        self.assertEqual(renal['state'], 'U')
        self.assertEqual(renal['owner'], 'kidney_right')
        self.assertEqual(renal['boundaryProvenance'], 'D')
        self.assertEqual(solids.field_owner(labels, [0, 0, 0], -1, {1: 'vertebrae_L3'})['owner'], 'vertebrae_L3')
        with self.assertRaises(ValueError):
            solids.field_owner(labels, [0, 0, 0], -1, {1: 'vertebrae_C5'})
        self.assertEqual(solids.field_owner(np.array([[[129]]]), [0, 0, 0], -1,
                                             {1: 'stomach'}, gas_bit=True)['owner'], 'stomach')

    def test_all_source_crops_are_transferred_into_the_fat_box(self):
        source = {'kidney_right': ([1, 1, 1], np.ones((2, 2, 2), bool)),
                  'other': ([3, 2, 1], np.ones((2, 1, 1), bool)),
                  'distant': ([8, 8, 8], np.ones((1, 1, 1), bool))}
        crops = solids.source_crops(source, list(source), [2, 1, 1], [2, 2, 2])
        self.assertEqual(int(crops['kidney_right'].sum()), 4)
        self.assertEqual(int(crops['other'].sum()), 1)
        self.assertEqual(int(crops['distant'].sum()), 0)
        with self.assertRaises(ValueError):
            solids.source_crops(source, ['kidney_right'], [2, 1, 1], [2, 2, 2])
        with self.assertRaises(ValueError):
            solids.source_crops(source, list(source), [2, 1, 1], [-1, 2, 2])

    def test_fat_excludes_every_source_and_renal_convex_envelope(self):
        hu = np.full((3, 3, 3), -100)
        support = np.ones(hu.shape, bool)
        masks = {'kidney_right': np.zeros(hu.shape, bool), 'other': np.zeros(hu.shape, bool)}
        masks['kidney_right'][0, 0, 0] = True
        masks['other'][1, 1, 1] = True
        envelope = np.zeros(hu.shape, bool)
        envelope[0, 0, 0] = envelope[0, 1, 0] = True
        fat = solids.fat_candidate(hu, support, masks, list(masks), envelope)
        self.assertFalse(fat[0, 0, 0])
        self.assertFalse(fat[0, 1, 0])
        self.assertFalse(fat[1, 1, 1])
        self.assertTrue(fat[2, 2, 2])
        with self.assertRaises(ValueError):
            solids.require_fat(fat | envelope, hu, support, masks, list(masks), envelope)
        with self.assertRaises(ValueError):
            solids.fat_candidate(hu, support, {}, list(masks), envelope)
        with self.assertRaises(ValueError):
            solids.fat_candidate(hu, support, {'kidney_right': masks['kidney_right']}, list(masks), envelope)

    def test_page_placements_do_not_overlap_fields_or_each_other(self):
        occupied = np.zeros((2, 64, 64), dtype=bool)
        occupied[0, 0:32, 0:32] = True
        pages = solids.allocate_pages(occupied, 3)
        self.assertEqual(len(pages), 3)
        solids.require_page_layout(occupied, pages)
        with self.assertRaises(ValueError):
            solids.require_page_layout(occupied, [[0, 0, 0]])
        with self.assertRaises(ValueError):
            solids.require_page_layout(occupied, [pages[0], pages[0]])
        with self.assertRaises(ValueError):
            solids.require_page_layout(occupied, [[33, 0, 0]])
        with self.assertRaises(ValueError):
            solids.allocate_pages(occupied, 8)

    def test_payload_does_not_change_p2_or_other_reservations(self):
        occupied = np.zeros((1, 32, 64), bool)
        payload, info = solids.pack_pages(np.array([True, False, True]))
        raw = bytes(range(64))*100
        p2 = raw[16:32]
        result, layout = solids.install_payload(raw, 16, 5000, len(p2),
                                                 hashlib.sha256(p2).hexdigest(),
                                                 payload, [[0, 0, 0]], occupied)
        self.assertEqual(result[:32], raw[:32])
        self.assertEqual(result[layout['endOffset']:], raw[layout['endOffset']:])
        self.assertEqual(layout['pageTableBytes'], 6)
        self.assertTrue(np.array_equal(solids.unpack_pages(result[32:32+len(payload)], info),
                                       [True, False, True]))
        with self.assertRaises(ValueError):
            solids.install_payload(raw, 16, 5000, len(p2), '0'*64, payload, [[0, 0, 0]], occupied)
        with self.assertRaises(ValueError):
            solids.install_payload(raw, 16, 100, len(p2), hashlib.sha256(p2).hexdigest(),
                                   payload, [[0, 0, 0]], occupied)
        with self.assertRaises(ValueError):
            solids.install_payload(raw, 16, 5000, len(p2), hashlib.sha256(p2).hexdigest(),
                                   payload, [[0, 0, 0], [32, 0, 0]], occupied)

    def test_p3_starts_after_the_p2_derived_block(self):
        # r1 escribió P3 en payloadBytes: en P2 final ahí empieza el bloque derivado E+rampas (371.412 B).
        part = {'name': 'wall', 'offsetBytes': 4096, 'bytes': 2113536, 'payloadBytes': 757844, 'derivedBytes': 371412}
        self.assertEqual(solids.p2_used_bytes(part), 757844+371412)
        self.assertEqual(solids.p2_used_bytes({**part, 'derivedBytes': 0}), 757844)
        for bad in ({**part, 'p3Bytes': 315854}, {**part, 'name': 'tubes'}, {**part, 'derivedBytes': -1}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                solids.p2_used_bytes(bad)
        raw = bytes(64)*100
        payload, _ = solids.pack_pages(np.array([True]))
        small = {**part, 'offsetBytes': 16, 'bytes': 5000, 'payloadBytes': 16, 'derivedBytes': 16}
        with self.assertRaises(ValueError):
            solids.install_after_p2(raw, small, 16, hashlib.sha256(raw[16:32]).hexdigest(), payload, [[0, 0, 0]],
                                    np.zeros((1, 32, 32), bool))
        result, layout = solids.install_after_p2(raw, small, 32, hashlib.sha256(raw[16:48]).hexdigest(), payload,
                                                 [[0, 0, 0]], np.zeros((1, 32, 32), bool))
        self.assertEqual(layout['payloadOffsetBytes'], 48)
        self.assertEqual(result[:48], raw[:48])

    def test_pages_roundtrip_and_corruption(self):
        bits = np.array([True, False, True, True, False]*1200, dtype=bool)
        payload, info = solids.pack_pages(bits)
        self.assertTrue(np.array_equal(solids.unpack_pages(payload, info), bits))
        corrupt = bytearray(payload)
        corrupt[8] ^= 1
        with self.assertRaises(ValueError):
            solids.unpack_pages(bytes(corrupt), info)

    def test_combined_p2_p3_budget_counts_each_allocation(self):
        capacity.require_solids_budget(757844, 315854, 2459, 838, 0, 0, 0)
        for args in [(757844, 315854, 2459, 1638, 0, 0, 0),
                     (757844, 315854, 2459, 838, 0, 0, 1),
                     (757844, 344*256*8*3, 2459, 838, 0, 0, 0),
                     (-1, 1, 0, 0, 0, 0, 0)]:
            with self.subTest(args=args), self.assertRaises(ValueError):
                capacity.require_solids_budget(*args)

    def test_capacity_budget_rejects_thoracic_byte(self):
        solids.require_budget(100, 3297, 0, 0, 0)
        with self.assertRaises(ValueError):
            solids.require_budget(100, 3297, 0, 0, 1)
        with self.assertRaises(ValueError):
            solids.require_budget(100, 4097, 0, 0, 0)


if __name__ == '__main__':
    unittest.main()
