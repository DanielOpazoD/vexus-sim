"""Contratos geométricos del banco; fixtures sintéticos, sin modelos ni red."""
import unittest
import numpy as np
from costochondral_geometry import TriangleQuery, YRays, topology, profile_mesh, profile_field
from costochondral_bench import connectivity


def cube(lo=0., hi=1.):
    v = np.array([[lo, lo, lo], [hi, lo, lo], [hi, hi, lo], [lo, hi, lo],
                  [lo, lo, hi], [hi, lo, hi], [hi, hi, hi], [lo, hi, hi]])
    f = np.array([[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4],
                  [3, 7, 6], [3, 6, 2], [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5]])
    return v, f


class OracleTest(unittest.TestCase):
    def test_exact_face_edge_corner_distance_and_conservative_pruning(self):
        v, f = cube(); q = TriangleQuery(v, f)
        points = np.array([[.2, .3, 2], [2, .5, 2], [2, 2, 2], [.5, .5, .5]])
        np.testing.assert_allclose(q.distance(points), [1, np.sqrt(2), np.sqrt(3), .5], atol=1e-12)

    def test_shared_edge_rays_and_thin_shell_parity(self):
        v, f = cube(); inner, inner_f = cube(.2, .8)
        ray = YRays(v, f); np.testing.assert_allclose(ray.hits(.5, .5), [0, 1])
        shell = YRays(np.r_[v, inner], np.r_[f, inner_f+len(v)])
        np.testing.assert_allclose(shell.hits(.5, .5), [0, .2, .8, 1])
        mask, odd = shell.classify_grid([.5], [.1, .5, .9, 1.1], [.5])
        self.assertEqual(mask.ravel().tolist(), [True, False, True, False]); self.assertEqual(odd, 0)

    def test_surface_component_does_not_imply_enclosed_solid(self):
        v, f = cube(); result = topology(v, f)
        self.assertEqual(result['boundaryEdges'], 0); self.assertEqual(result['inconsistentOrientedEdges'], 0)
        self.assertAlmostEqual(result['components'][0]['signedEnclosedVolumeMm3'], 1.)
        tri = np.array([[0., 0., 0.], [1., 0., 0.], [0., 1., 0.]])
        facet = topology(tri, np.array([[0, 1, 2], [0, 2, 1]]))
        self.assertEqual(facet['boundaryEdges'], 0); self.assertEqual(facet['components'][0]['signedEnclosedVolumeMm3'], 0.)

    def test_zero_shell_end_caps_and_side_domain(self):
        rows = [[theta, 5., 0., .5, .25, 0.] for theta in np.linspace(.3, 1., 16)]
        part = {'rows': rows, 'side': 'right'}
        v, f = profile_mesh(part, 32, 32)
        np.testing.assert_allclose(profile_field(v, part), 0., atol=1e-12)
        self.assertEqual(topology(v, f)['inconsistentOrientedEdges'], 0)
        mirrored = v.copy(); mirrored[:, 0] *= -1
        self.assertTrue((profile_field(mirrored, part) > 0).all())

    def test_voxel_diagonal_contact_and_bounded_void(self):
        mask = np.zeros((3, 3, 3), dtype=bool); mask[0, 0, 0] = True; mask[1, 1, 1] = True
        result = connectivity(mask)
        self.assertEqual(result['6']['components'], 2); self.assertEqual(result['26']['components'], 1)
        self.assertFalse(result['6']['spansRoiFacesXYZ'][0])


if __name__ == '__main__':
    unittest.main()
