"""Referencia analítica independiente: campo lineal en coordenadas físicas."""
import unittest
import json
import tempfile
from pathlib import Path
import nibabel as nib
import numpy as np
from paired_renal_reslice import reslice, rigid_matrix, review
from paired_renal_reference import audit, file_hash


class ResliceTests(unittest.TestCase):
    def setUp(self):
        # CT anisótropo con origen desplazado y campo físico x+2y+3z.
        self.ct_affine = np.diag([2., 3., 4., 1.]); self.ct_affine[:3, 3] = [-10, -20, -30]
        indices = np.indices((20, 20, 20))
        x, y, z = 2*indices[0]-10, 3*indices[1]-20, 4*indices[2]-30
        self.ct = (x+2*y+3*z).astype(np.int16)
        self.us_affine = np.diag([.7, 1.1, 1.3, 1.]); self.us_affine[:3, 3] = [-2, -3, -4]
        self.transform = np.eye(4)
        self.transform[:3, :3] = [[0, -1, 0], [1, 0, 0], [0, 0, 1]]
        self.transform[:3, 3] = [1, 2, 3]

    def test_physical_ramp_all_axes_and_transform_direction(self):
        for axis in [0, 1, 2]:
            plane, valid, others = reslice(self.ct, self.ct_affine, (7, 8, 9), self.us_affine,
                                           self.transform, axis, 3)
            self.assertTrue(valid.all())
            for i, j in [(0, 0), (2, 3), (plane.shape[0]-1, plane.shape[1]-1)]:
                voxel = [0, 0, 0]; voxel[axis] = 3; voxel[others[0]] = i; voxel[others[1]] = j
                # Calculado explícitamente; no reutiliza nibabel ni el mapeo del código.
                ux, uy, uz = .7*voxel[0]-2, 1.1*voxel[1]-3, 1.3*voxel[2]-4
                expected = (-uy+1)+2*(ux+2)+3*(uz+3)
                self.assertAlmostEqual(float(plane[i, j]), expected, delta=2e-5)

    def test_outside_support_is_nan_and_not_zero_tissue(self):
        move = np.eye(4); move[0, 3] = 28
        plane, valid, _ = reslice(self.ct, self.ct_affine, (7, 8, 9), self.us_affine, move, 2, 3)
        self.assertTrue(valid.any()); self.assertTrue((~valid).any())
        self.assertTrue(np.isnan(plane[~valid]).all())
        self.assertTrue(np.isfinite(plane[valid]).all())

    def test_index_scale_reflection_and_nonfinite_rejected(self):
        for index in [-1, 9, 1.5]:
            with self.assertRaises(ValueError):
                reslice(self.ct, self.ct_affine, (7, 8, 9), self.us_affine, np.eye(4), 2, index)
        for scale in [-1, 1.01, float('nan')]:
            invalid = np.eye(4); invalid[0, 0] = scale
            with self.assertRaises(ValueError): rigid_matrix(invalid)


class ReviewChainTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        source = {"schemaVersion": 1, "dataset": "TRUSTED", "patientId": "418", "side": "R",
                  "role": "development", "source": "phantom", "accessEvidence": "synthetic"}
        for modality, name in [("ct", "418_imgCT.nii.gz"), ("us", "418R_imgUS.nii.gz")]:
            values = np.arange(7*8*9, dtype=np.int16).reshape((7, 8, 9))
            image = nib.Nifti1Image(values, np.eye(4)); image.header.set_xyzt_units("mm")
            path = self.root/name; nib.save(image, path)
            source[modality] = {"path": name, "sha256": file_hash(path), "patientId": "418", "side": "R"}
        path = self.root/"source.json"; path.write_text(json.dumps(source))
        admitted = audit(path)
        self.spec = {"schemaVersion": 1, "axis": 2, "index": 4,
                     "sourceManifest": {"path": path.name, "sha256": file_hash(path)}}
        path = self.root/"admission.json"; path.write_text(json.dumps(admitted))
        self.spec["admission"] = {"path": path.name, "sha256": file_hash(path)}
        registration = {"schemaVersion": 1, "patientId": "418", "side": "R", "role": "development",
                        "admissionSha256": file_hash(path), "status": "rigid-initialization-only",
                        "usWorldToCtWorldMm": np.eye(4).tolist(), "pelvisTreMm": 0., "evaluationRmsMm": 0.}
        path = self.root/"registration.json"; path.write_text(json.dumps(registration))
        self.spec["registration"] = {"path": path.name, "sha256": file_hash(path)}

    def run_review(self):
        path = self.root/"review.json"; path.write_text(json.dumps(self.spec))
        return review(path)

    def test_identity_plane_keeps_us_samples_and_units(self):
        us, ct, valid, meta = self.run_review()
        np.testing.assert_array_equal(us, ct)
        self.assertEqual(us.shape, (7, 8)); self.assertTrue(valid.all())
        self.assertEqual(meta["pixelSpacingMm"], [1., 1.])
        self.assertFalse(meta["clinicalAcceptance"])

    def test_unrelated_registration_admission_rejected_even_with_updated_file_hash(self):
        path = self.root/"registration.json"; data = json.loads(path.read_text())
        data["admissionSha256"] = "a"*64; path.write_text(json.dumps(data))
        self.spec["registration"]["sha256"] = file_hash(path)
        with self.assertRaisesRegex(ValueError, "misma cadena"): self.run_review()

    def test_source_mutation_rejected(self):
        path = self.root/"418R_imgUS.nii.gz"
        with path.open("ab") as stream: stream.write(b"changed")
        with self.assertRaisesRegex(ValueError, "Contenido distinto"): self.run_review()


if __name__ == "__main__": unittest.main()
