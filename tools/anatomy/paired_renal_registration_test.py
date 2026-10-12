"""Phantoms de registro con referencia analítica, incluidos errores que no debe ocultar."""
import unittest
import json
import tempfile
from pathlib import Path
import numpy as np
from paired_renal_registration import rigid_initialization, audit
from paired_renal_reference import file_hash


class RegistrationTests(unittest.TestCase):
    def setUp(self):
        self.us = np.array([[0, 0, 12], [2, 3, 4], [0, 0, 0], [30, 0, 0],
                            [0, 40, 0], [5, 8, 15], [10, 20, -10]], dtype=float)
        self.rotation = np.array([[0, -1, 0], [1, 0, 0], [0, 0, 1]])
        self.translation = np.array([90, -40, 700])
        self.ct = self.us @ self.rotation.T + self.translation

    def test_known_rotation_translation_without_scale_or_reflection(self):
        result = rigid_initialization(self.us, self.ct)
        t = np.asarray(result["usWorldToCtWorldMm"])
        # Tolerancia de álgebra float64, no exactitud clínica.
        np.testing.assert_allclose(t[:3, :3], self.rotation, atol=1e-12)
        np.testing.assert_allclose(t[:3, 3], self.translation, atol=1e-12)
        np.testing.assert_allclose(t @ result["ctWorldToUsWorldMm"], np.eye(4), atol=1e-12)
        self.assertLess(result["pelvisTreMm"], 1e-10)
        self.assertEqual(result["scale"], 1)
        self.assertFalse(result["clinicalAcceptance"])

    def test_moving_reserved_pelvis_does_not_improve_fit(self):
        before = rigid_initialization(self.us, self.ct)
        shifted = self.ct.copy(); shifted[0] += [0, 0, 8]
        after = rigid_initialization(self.us, shifted)
        np.testing.assert_array_equal(before["usWorldToCtWorldMm"], after["usWorldToCtWorldMm"])
        self.assertAlmostEqual(after["pelvisTreMm"], 8, delta=1e-10)
        self.assertLess(after["fitRmsMm"], 1e-10)

    def test_mirrored_shape_is_not_certified_by_three_fit_points(self):
        mirrored = self.us.copy(); mirrored[:, 2] *= -1
        result = rigid_initialization(self.us, mirrored)
        self.assertAlmostEqual(result["rotationDeterminant"], 1, delta=1e-12)
        self.assertLess(result["fitRmsMm"], 1e-10)
        self.assertAlmostEqual(result["pelvisTreMm"], 24, delta=1e-10)
        self.assertFalse(result["clinicalAcceptance"])

    def test_size_difference_remains_visible(self):
        result = rigid_initialization(self.us, 1.2*self.ct)
        self.assertEqual(result["scale"], 1)
        self.assertGreater(result["fitRmsMm"], 3)

    def test_collinear_and_nonfinite_landmarks_rejected(self):
        invalid = self.us.copy(); invalid[4] = [15, 0, 0]
        with self.assertRaisesRegex(ValueError, "degenerados"): rigid_initialization(invalid, self.ct)
        invalid = self.us.copy(); invalid[1, 0] = np.nan
        with self.assertRaisesRegex(ValueError, "finitos"): rigid_initialization(invalid, self.ct)


class RegistrationAdmissionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        points = np.array([[10, 10, 22], [12, 13, 14], [10, 10, 10], [40, 10, 10],
                           [10, 50, 10], [15, 18, 25], [20, 30, 0.]])
        image = {"sha256": "b"*64, "voxelToWorldMm": np.eye(4).tolist(), "shape": [100]*3}
        admission = {"schemaVersion": 1, "dataset": "TRUSTED", "patientId": "418", "side": "R",
                     "role": "development", "samePatientDeclaredAndFilenamesChecked": True,
                     "pair": {"ct": image, "us": image}}
        path = self.root/"admission.json"; path.write_text(json.dumps(admission))
        self.spec = {"schemaVersion": 1, "admission": {"path": path.name, "sha256": file_hash(path)}}
        for name in ["ct", "us"]:
            path = self.root/("418R_ldk"+name.upper()+".txt"); np.savetxt(path, points)
            self.spec[name] = {"path": path.name, "sha256": file_hash(path), "patientId": "418", "side": "R",
                               "imageSha256": "b"*64, "frame": "image-world-RAS-mm"}

    def run_audit(self):
        path = self.root/"registration.json"; path.write_text(json.dumps(self.spec))
        return audit(path)

    def test_admitted_pair_retains_source_links(self):
        result = self.run_audit()
        self.assertEqual(result["admissionSha256"], self.spec["admission"]["sha256"])
        self.assertLess(result["pelvisTreMm"], 1e-10)
        self.assertEqual(result["role"], "development")
        self.assertEqual(result["evaluationLandmarkIds"], [1, 2, 6, 7])

    def test_unrelated_frames_patients_and_hashes_rejected(self):
        for key, invalid in [("patientId", "348"), ("side", "L"), ("frame", "voxel"),
                              ("imageSha256", "a"*64), ("sha256", "0"*64)]:
            before = self.spec["us"][key]; self.spec["us"][key] = invalid
            with self.subTest(key=key), self.assertRaises(ValueError): self.run_audit()
            self.spec["us"][key] = before

    def test_matching_hash_does_not_admit_opposite_side_filename(self):
        (self.root/"418R_ldkUS.txt").rename(self.root/"418L_ldkUS.txt")
        self.spec["us"]["path"] = "418L_ldkUS.txt"
        with self.assertRaisesRegex(ValueError, "Nombre de hitos"): self.run_audit()

    def test_outside_volume_and_changed_admission_rejected(self):
        path = self.root/"418R_ldkUS.txt"; points = np.loadtxt(path); points[0, 2] = 1000
        np.savetxt(path, points); self.spec["us"]["sha256"] = file_hash(path)
        with self.assertRaisesRegex(ValueError, "fuera del volumen"): self.run_audit()
        self.spec["admission"]["sha256"] = "0"*64
        with self.assertRaisesRegex(ValueError, "Contenido distinto"): self.run_audit()


if __name__ == "__main__": unittest.main()
