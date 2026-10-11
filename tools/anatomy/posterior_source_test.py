"""Adversarial contracts for posterior source derivation; no downloads/runtime."""
import unittest
import numpy as np
from posterior_source import derive


class PosteriorSourceContracts(unittest.TestCase):
    def setUp(self):
        self.vertices = np.array([[0., 0, 0], [1., 0, 0], [0., 1, 0], [0., 0, 1],
                                  [5., 0, 0], [6., 0, 0], [5., 1, 0]])
        self.tetrahedron = np.array([[0, 2, 1], [0, 1, 3], [1, 2, 3], [2, 0, 3]])
        self.faces = np.vstack([self.tetrahedron, [[4, 5, 6], [6, 5, 4]]])

    def test_explicit_opposite_sheet_keeps_entire_volume_and_face_order(self):
        v, f, keep, sheets = derive(self.vertices, self.faces, [4, 5])
        np.testing.assert_array_equal(v[f], self.vertices[self.tetrahedron])
        np.testing.assert_array_equal(keep, [0, 1, 2, 3])
        self.assertEqual(sheets[0]['sourceFaceIndices'], [4, 5])

    def test_no_exclusion_does_not_silently_remove_sheet(self):
        v, f, keep, sheets = derive(self.vertices, self.faces, [])
        np.testing.assert_array_equal(v[f], self.vertices[self.faces])
        self.assertEqual(len(keep), 6)
        self.assertEqual(sheets, [])

    def test_original_shading_seam_indices_do_not_hide_opposite_sheet(self):
        v = np.vstack([self.vertices, self.vertices[4:7]])
        f = self.faces.copy(); f[5] = [9, 8, 7]
        retained, faces, _, _ = derive(v, f, [4, 5])
        np.testing.assert_array_equal(retained[faces], self.vertices[self.tetrahedron])

    def test_partial_sheet_rejected(self):
        with self.assertRaisesRegex(ValueError, 'complete'):
            derive(self.vertices, self.faces, [4])

    def test_small_closed_positive_component_cannot_be_removed(self):
        with self.assertRaisesRegex(ValueError, 'two-face'):
            derive(self.vertices, self.faces, [0, 1, 2, 3])

    def test_same_winding_coincident_faces_rejected(self):
        f = self.faces.copy(); f[5] = f[4]
        with self.assertRaisesRegex(ValueError, 'opposite'):
            derive(self.vertices, f, [4, 5])

    def test_tolerance_welding_is_not_permitted(self):
        v = np.vstack([self.vertices, self.vertices[4:7] + [0, 0, 1e-9]])
        f = self.faces.copy(); f[5] = [9, 8, 7]
        with self.assertRaises(ValueError):
            derive(v, f, [4, 5])

    def test_duplicate_and_out_of_range_exclusions_rejected(self):
        for ids in [[4, 4], [-1], [6], [True]]:
            with self.subTest(ids=ids), self.assertRaises(ValueError):
                derive(self.vertices, self.faces, ids)

    def test_negative_component_is_retained_with_orientation(self):
        f = self.faces.copy(); f[:4] = f[:4, ::-1]
        v, faces, _, _ = derive(self.vertices, f, [4, 5])
        np.testing.assert_array_equal(v[faces], self.vertices[f[:4]])


if __name__ == '__main__':
    unittest.main()
