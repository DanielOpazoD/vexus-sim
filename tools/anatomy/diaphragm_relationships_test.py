"""Analytical and adversarial tests for source relationship evidence."""
import hashlib
import json
import unittest
import numpy as np
from diaphragm_relationships import ClosedSurfaceOracle, audit_surface, SOURCES, CANDIDATE_SHA

V = np.array([[0.,0.,0.],[1.,0.,0.],[1.,1.,0.],[0.,1.,0.],
              [0.,0.,1.],[1.,0.,1.],[1.,1.,1.],[0.,1.,1.]])
F = np.array([[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],
              [1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]])


class RelationshipContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.oracle = ClosedSurfaceOracle(V, F)

    def test_independent_cube_sign_distance_and_boundary(self):
        np.testing.assert_allclose(self.oracle.distances([[.5,.5,.5],[2,.5,.5],[0,.5,.5],[-1,-1,0]]),[-.5,1,0,np.sqrt(2)],atol=1e-12)

    def test_negative_centroid_is_retained_when_vertices_are_outside(self):
        v=np.array([[-1,.5,.5],[2,.5,.5],[.5,2,.5]])
        # Centroid on boundary is not a penetration: move third point to y=1.7.
        v[2,1]=1.7
        r=audit_surface(self.oracle,v,np.array([[0,1,2]]))
        self.assertEqual(r['negativeSamples'],1)
        self.assertEqual(r['interpretation'],'penetration-witness')
        self.assertEqual(r['worstSample']['kind'],'face-centroid')
        self.assertEqual(r['worstSample']['sourceIndex'],0)
        self.assertFalse(r['anatomicalAcceptance'])

    def test_unsampled_crossing_is_never_declared_disjoint(self):
        # Triangle crosses the cube near its first edge, while vertices and centroid are outside.
        v=np.array([[-1,.5,.5],[2,.5,.5],[20,20,.5]])
        r=audit_surface(self.oracle,v,np.array([[0,1,2]]))
        self.assertEqual(r['negativeSamples'],0)
        self.assertEqual(r['interpretation'],'inconclusive-no-sampled-penetration')
        self.assertTrue(r['surfaceIntersectionDetected'])
        self.assertFalse(r['globalMinimumDistanceCertified'])
        self.assertFalse(r['anatomicalAcceptance'])

    def test_containment_is_not_confused_with_disjoint_volumes(self):
        r=audit_surface(self.oracle,V*.6+.2,F)
        self.assertFalse(r['surfaceIntersectionDetected'])
        self.assertEqual(r['interpretation'],'penetration-witness')
        self.assertGreater(r['negativeSamples'],0)
        self.assertFalse(r['anatomicalAcceptance'])

    def test_unused_vertices_do_not_pollute_source_samples(self):
        v=np.vstack([V+3,[.5,.5,.5]])
        r=audit_surface(self.oracle,v,F)
        self.assertEqual(r['vertexSamples'],8)
        self.assertEqual(r['sampleCount'],20)
        self.assertEqual(r['negativeSamples'],0)
        self.assertFalse(r['surfaceIntersectionDetected'])

    def test_boundary_is_distinguished_from_interior(self):
        r=audit_surface(self.oracle,V,F)
        self.assertEqual(r['negativeSamples'],0)
        self.assertEqual(r['sampledMinSignedDistanceMm'],0)
        self.assertTrue(r['surfaceIntersectionDetected'])
        self.assertFalse(r['globalMinimumDistanceCertified'])

    def test_invalid_queries_and_source_arrays_are_rejected(self):
        for p in [[],[[np.nan,0,0]],[[1,2]],[[np.inf,0,0]]]:
            with self.subTest(p=p),self.assertRaises(ValueError):self.oracle.distances(p)
        for f in [np.array([[0.,1.,2.]]),np.array([[0,1,90]]),np.array([[0,1,-1]]),np.array([[0,0,1]])]:
            with self.subTest(f=f),self.assertRaises(ValueError):audit_surface(self.oracle,V,f)

    def test_unwelded_or_unused_oracle_vertices_are_rejected(self):
        for extra in [[0,0,0],[5,5,5]]:
            with self.subTest(extra=extra),self.assertRaisesRegex(ValueError,'exact welding'):
                ClosedSurfaceOracle(np.vstack([V,extra]),F)

    def test_open_oracle_is_rejected(self):
        with self.assertRaisesRegex(ValueError,'closed embedded'):
            ClosedSurfaceOracle(V,F[:-1])

    def test_checked_report_does_not_promote_anatomy_or_hide_witnesses(self):
        report=json.loads((SOURCES.parent/'diaphragm-relationship-report.json').read_text())
        self.assertEqual(report['candidateSha256'],CANDIDATE_SHA)
        self.assertEqual(report['manifestSha256'],hashlib.sha256(SOURCES.read_bytes()).hexdigest())
        self.assertEqual(report['status'],'blocked-pending-anatomical-reconciliation')
        for flag in ['runtimeIntegration','clinicalValidation','registrationChanged','sourceVerticesMoved','sourceFacesClipped']:
            self.assertFalse(report[flag])
        manifest=json.loads(SOURCES.read_text())
        self.assertEqual([(p['id'],p['sha256']) for p in report['parts']],
                         [(p['id'],p['sha256']) for p in manifest['parts']])
        self.assertEqual(len(report['parts']),6)
        self.assertEqual([p['surfaceIntersectionDetected'] for p in report['parts']],
                         [True,True,True,True,False,False])
        self.assertEqual(sum(x['negativeSamples']>0 for x in report['parts']),4)
        for part in report['parts']:
            self.assertEqual(part['sampleCount'],part['vertexSamples']+part['faceCentroidSamples'])
            self.assertGreaterEqual(part['sampledMinUnsignedDistanceMm'],0)
            self.assertEqual(part['surfaceIntersectionMethod'],'CGAL do_intersect over every source triangle')
            self.assertFalse(part['anatomicalAcceptance'])
            self.assertFalse(part['globalMinimumDistanceCertified'])
            if part['negativeSamples']:
                self.assertLess(part['worstSample']['signedDistanceMm'],0)


if __name__=='__main__':unittest.main()
