"""Controles independientes de distancia física y rayos AP, sin pacientes."""
import unittest

import numpy as np

from ct_posterior_reference import nearest_centers, posterior_rays, surface_centers


class PosteriorReferenceTests(unittest.TestCase):
    def test_distance_uses_physical_oblique_anisotropic_grid(self):
        a, b = np.zeros((4, 4, 4), bool), np.zeros((4, 4, 4), bool)
        a[1, 1, 1], b[1, 3, 1] = True, True
        # Dos pasos de 3mm, girados 90°: distancia de centros 6mm.
        affine = np.array([[0, -3, 0, 20], [2, 0, 0, 30], [0, 0, 4, 40], [0, 0, 0, 1]])
        result = nearest_centers(surface_centers(a, affine), surface_centers(b, affine))
        self.assertEqual(result["minimumMm"], 6)
        self.assertEqual(result["witnessRASmm"], [[17, 32, 44], [11, 32, 44]])

    def test_posterior_ray_keeps_adjacent_and_interposed_cells(self):
        kidney = np.zeros((3, 7, 2), bool)
        muscle = np.zeros_like(kidney)
        kidney[1, 5, 0] = kidney[2, 5, 0] = kidney[0, 5, 1] = True
        muscle[1, 1, 0] = muscle[2, 4, 0] = True
        ct = np.full(kidney.shape, -100.)
        affine = np.diag([2., 3., 4., 1.])
        result = posterior_rays(kidney, muscle, ct, affine)
        self.assertEqual(result["matchedColumns"], 2)
        self.assertEqual(result["noPosteriorMuscleHitColumns"], 1)
        self.assertEqual(result["adjacentLabelColumns"], 1)
        self.assertEqual([r["interposedCellSpanMm"] for r in result["rays"]], [9, 0])
        self.assertEqual(result["rays"][0]["gapAttenuationQuantiles"], [-100, -100, -100])

    def test_oblique_axis_is_not_called_anteroposterior(self):
        mask = np.zeros((3, 3, 3), bool)
        affine = np.eye(4)
        affine[0, 1] = .2
        with self.assertRaisesRegex(ValueError, "oblicuos"):
            posterior_rays(mask, mask, np.zeros_like(mask), affine)

    def test_empty_masks_are_not_fake_zero_distance(self):
        self.assertIsNone(nearest_centers(np.empty((0, 3)), np.ones((1, 3)))["minimumMm"])


if __name__ == "__main__":
    unittest.main()
