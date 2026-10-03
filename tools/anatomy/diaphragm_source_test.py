"""Synthetic adversarial contracts. No atlas download, no clinical tolerances."""
import unittest
import hashlib
import json
import numpy as np
from diaphragm_source import apply_plan, components, nonmanifold_vertices, PLAN as PLAN_PATH

V = np.array([[0., 0., 0.], [1., 0., 0.], [0., 1., 0.], [0., 0., 1.]])
F = np.array([[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]])
PLAN = {'excludedFaceIndices': [], 'maxRemovedComponentExtentMm': .4,
        'maxRemovedSurfaceAreaMm2': .2, 'maxRemovedAbsoluteVolumeMm3': .001, 'expectedRetainedGenus': 0}


def satellite():
    v = np.concatenate([V, np.array([[2., 0., 0.], [2.01, 0., 0.], [2., .01, 0.]])])
    f = np.concatenate([F, np.array([[4, 5, 6], [4, 6, 5]])])
    return v, f


class SourceCleanup(unittest.TestCase):
    def test_closed_primary_surface_preserved_exactly(self):
        v, f = satellite()
        out, faces, ids, report = apply_plan(v, f, {**PLAN, 'excludedFaceIndices': [4, 5]})
        np.testing.assert_array_equal(out[faces], v[f[:4]])
        np.testing.assert_array_equal(ids, [0, 1, 2, 3])
        self.assertEqual(report['removedTriangleCount'], 2)
        self.assertEqual(report['retainedTopologyInvariant']['genus'], 0)
        self.assertFalse(report['runtimeIntegration'])
        self.assertFalse(report['selfIntersectionsValidated'])
        self.assertEqual(report['nonManifoldVertexLinks'], 0)
        self.assertAlmostEqual(report['retained']['components'][0]['signedEnclosedVolumeMm3'], 1/6)

    def test_no_automatic_largest_component_selection(self):
        v, f = satellite()
        with self.assertRaisesRegex(ValueError, 'Retained component'):
            apply_plan(v, f, PLAN)

    def test_partial_component_removal_is_rejected(self):
        v, f = satellite()
        with self.assertRaisesRegex(ValueError, 'whole disconnected'):
            apply_plan(v, f, {**PLAN, 'excludedFaceIndices': [4]})

    def test_major_component_cannot_be_removed(self):
        v, f = satellite()
        with self.assertRaisesRegex(ValueError, 'extent bound'):
            apply_plan(v, f, {**PLAN, 'excludedFaceIndices': [0, 1, 2, 3]})

    def test_area_and_volume_bounds_are_independent(self):
        v, f = satellite()
        with self.assertRaisesRegex(ValueError, 'area or volume'):
            apply_plan(v, f, {**PLAN, 'excludedFaceIndices': [4, 5], 'maxRemovedSurfaceAreaMm2': 0})
        v = np.concatenate([V, V*.1+[2, 0, 0]])
        f = np.concatenate([F, F+4])
        with self.assertRaisesRegex(ValueError, 'area or volume'):
            apply_plan(v, f, {**PLAN, 'excludedFaceIndices': [4, 5, 6, 7], 'maxRemovedAbsoluteVolumeMm3': 0})

    def test_invalid_plans_are_rejected(self):
        for ids in [[-1], [4], [True], [1.5], [0, 0], '0']:
            with self.subTest(ids=ids), self.assertRaises(ValueError):
                apply_plan(V, F, {**PLAN, 'excludedFaceIndices': ids})
        for bound in [float('nan'), float('inf'), -1]:
            with self.subTest(bound=bound), self.assertRaises(ValueError):
                apply_plan(V, F, {**PLAN, 'maxRemovedComponentExtentMm': bound})
        with self.assertRaisesRegex(ValueError, 'genus contract'):
            apply_plan(V, F, {**PLAN, 'expectedRetainedGenus': .5})

    def test_no_tolerance_welding(self):
        # Two nearly coincident tetrahedra must remain two surfaces, not be fused.
        v = np.concatenate([V, V+1e-8])
        f = np.concatenate([F, F+4])
        self.assertEqual(len(components(v, f)), 2)

    def test_open_degenerate_and_negative_surfaces_rejected(self):
        for f in [F[:-1], np.concatenate([F, [[0, 0, 1]]]), F[:, [0, 2, 1]]]:
            with self.subTest(faces=f.tolist()), self.assertRaises(ValueError):
                apply_plan(V, f, PLAN)

    def test_genus_contract_not_satisfied_by_closedness_alone(self):
        with self.assertRaisesRegex(ValueError, 'genus contract'):
            apply_plan(V, F, {**PLAN, 'expectedRetainedGenus': 1})

    def test_checked_in_plan_report_and_source_agree(self):
        raw = PLAN_PATH.read_bytes()
        plan = json.loads(raw)
        report = json.loads((PLAN_PATH.parent/'diaphragm-source-component-report.json').read_text())
        manifest = json.loads((PLAN_PATH.parent/'thoracic-source-manifest.json').read_text())
        source = next(p for p in manifest['parts'] if p['id'] == plan['sourceElement'])
        self.assertEqual(source['sha256'], plan['sourceSha256'])
        self.assertEqual(report['sourceSha256'], source['sha256'])
        self.assertEqual(report['planSha256'], hashlib.sha256(raw).hexdigest())
        removed = sorted(i for c in report['removedComponents'] for i in c['originalFaceIndices'])
        self.assertEqual(removed, sorted(plan['excludedFaceIndices']))
        self.assertEqual(report['removedTriangleCount'], len(removed))
        self.assertEqual(report['retainedTopologyInvariant']['genus'], plan['expectedRetainedGenus'])
        self.assertTrue(report['retainedTrianglesExactlyPreserved'])
        self.assertFalse(report['runtimeIntegration'])
        self.assertFalse(report['selfIntersectionsValidated'])
        self.assertEqual(report['nonManifoldVertexLinks'], 0)

    def test_vertex_pinches_are_detected_even_when_each_edge_has_two_faces(self):
        self.assertEqual(nonmanifold_vertices(F), [])
        # Two closed tetrahedra meet only at vertex 0: its link has two cycles.
        second = np.array([[0, 5, 4], [0, 4, 6], [0, 6, 5], [4, 5, 6]])
        self.assertEqual(nonmanifold_vertices(np.concatenate([F, second])), [0])

    def test_invalid_source_arrays_rejected(self):
        for v, f in [(V*np.nan, F), (V, F.astype(float)), (V, np.array([[0, 1, 20]]))]:
            with self.subTest(), self.assertRaises(ValueError):
                apply_plan(v, f, PLAN)


if __name__ == '__main__':
    unittest.main()
