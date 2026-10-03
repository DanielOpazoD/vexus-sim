"""Independent CGAL witness and adversarial local-repair contracts."""
import json
import hashlib
import unittest
from unittest.mock import patch
import numpy as np
from diaphragm_source_repair import REPAIR_PLAN, intersection_pairs, directed_boundary, deviation_bound, repair

V = np.array([[0.,0.,0.],[1.,0.,0.],[1.,1.,0.],[0.,1.,0.],
              [0.,0.,1.],[1.,0.,1.],[1.,1.,1.],[0.,1.,1.]])
F = np.array([[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],
              [1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]])
PLAN = {'originalFaceIndices':[0,1], 'replacementSourceVertexIndices':[[0,3,1],[1,3,2]],
        'maxPatchExtentMm':2, 'maxBidirectionalSurfaceDeviationMm':.2,
        'maxAbsoluteVolumeChangeMm3':.02, 'expectedInitialSelfIntersectionPairs':0,
        'expectedRemainingSelfIntersectionPairs':0, 'expectedRetainedGenus':0}


def witness():
    data=json.loads((REPAIR_PLAN.parent/'diaphragm-source-repair-witness.json').read_text())
    return data,np.array(data['verticesLasMm']),np.array(data['facesBefore']),np.array(data['facesAfter'])


class RepairContracts(unittest.TestCase):
    def test_exact_predicate_witness_red_then_green(self):
        data,v,old,new=witness()
        self.assertEqual(len(intersection_pairs(v,old)),data['expectedSelfIntersectionsBefore'])
        self.assertEqual(intersection_pairs(v,new),[])
        self.assertEqual(directed_boundary(old),directed_boundary(new))
        self.assertEqual(set(old.flat),set(new.flat))

    def test_whole_cell_distance_certificate_in_both_directions(self):
        _,v,old,new=witness()
        for a,b in [(old,new),(new,old)]:
            result=deviation_bound(v,a,b,.075)
            self.assertLessEqual(result['certifiedUpperMm'],.075)
            self.assertGreaterEqual(result['certifiedUpperMm'],result['lowerWitnessMm'])
            self.assertGreater(result['evaluatedCells'],len(a))

    def test_uncertified_work_budget_is_not_a_pass(self):
        with patch('diaphragm_source_repair.TriangleQuery') as query:
            query.return_value.distance.side_effect=lambda p:np.zeros(len(p))
            with self.assertRaisesRegex(ValueError,'not certified'):
                deviation_bound(V,F[:1],F[:1],1e-12)

    def test_distance_threshold_rejects_far_surfaces(self):
        with self.assertRaisesRegex(ValueError,'exceeds explicit'):
            deviation_bound(V,F[:2],F[2:4],.1)
        for bad in [0,-1,float('nan'),float('inf')]:
            with self.subTest(bad=bad),self.assertRaises(ValueError):
                deviation_bound(V,F[:2],F[:2],bad)

    def test_planar_cube_retriangulation_preserves_closed_volume(self):
        result,report=repair(V,F,np.arange(len(F)),V,PLAN)
        np.testing.assert_array_equal(result[2:],F[2:])
        self.assertEqual(report['topologyInvariant']['genus'],0)
        self.assertEqual(report['primaryVolumeBeforeMm3'],report['primaryVolumeAfterMm3'])
        self.assertEqual(report['selfIntersectionPairsAfter'],[])
        self.assertTrue(report['allRetainedVertexPositionsPreserved'])
        self.assertFalse(report['runtimeIntegration'])

    def test_changed_boundary_or_new_vertices_are_rejected(self):
        for tri in [[[0,1,3],[1,3,2]],[[0,3,4],[1,3,2]]]:
            with self.subTest(tri=tri),self.assertRaisesRegex(ValueError,'vertex set and directed boundary'):
                repair(V,F,np.arange(len(F)),V,{**PLAN,'replacementSourceVertexIndices':tri})

    def test_bad_face_and_vertex_references_rejected(self):
        for ids in [[99,1],[0,0],[-1,1],[True,1]]:
            with self.subTest(ids=ids),self.assertRaises(ValueError):
                repair(V,F,np.arange(len(F)),V,{**PLAN,'originalFaceIndices':ids})
        for tri in [[[0,3,99],[1,3,2]],[[0,3,-1],[1,3,2]],[[0.,3.,1.],[1.,3.,2.]]]:
            with self.subTest(tri=tri),self.assertRaises(ValueError):
                repair(V,F,np.arange(len(F)),V,{**PLAN,'replacementSourceVertexIndices':tri})

    def test_final_report_is_tied_to_plans_and_passed_geometry_gates(self):
        report=json.loads((REPAIR_PLAN.parent/'diaphragm-source-local-repair-report.json').read_text())
        self.assertEqual(report['repairPlanSha256'],hashlib.sha256(REPAIR_PLAN.read_bytes()).hexdigest())
        component=REPAIR_PLAN.parent/'diaphragm-source-component-plan.json'
        self.assertEqual(report['componentPlanSha256'],hashlib.sha256(component.read_bytes()).hexdigest())
        self.assertEqual(report['modifiedTriangleCount'],6)
        self.assertEqual(report['unmodifiedRetainedTriangles'],68484)
        self.assertEqual(report['selfIntersectionPairsAfter'],[])
        self.assertTrue(report['selfIntersectionsValidated'])
        self.assertTrue(report['allRetainedVertexPositionsPreserved'])
        self.assertTrue(report['directedBoundaryPreserved'])
        self.assertEqual(report['topologyInvariant']['genus'],3)
        for certificate in report['deviationCertificates']:
            self.assertLessEqual(certificate['certifiedUpperMm'],certificate['thresholdMm'])
        self.assertFalse(report['runtimeIntegration'])

    def test_source_plan_and_witness_are_pinned_together(self):
        plan=json.loads(REPAIR_PLAN.read_text());data,_,_,_=witness()
        for key in ['sourceElement','sourceSha256','originalFaceIndices']:
            self.assertEqual(plan[key],data[key])
        self.assertEqual(plan['expectedInitialSelfIntersectionPairs'],6)
        self.assertEqual(plan['expectedRemainingSelfIntersectionPairs'],0)
        self.assertFalse(plan['runtimeIntegration'])


if __name__=='__main__':
    unittest.main()
