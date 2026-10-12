"""Controles sintéticos de admisión; no incluyen imágenes clínicas."""
import json
from pathlib import Path
import tempfile
import unittest

import nibabel as nib
import numpy as np

from paired_renal_reference import audit, file_hash, inspect_annotation


class PairedIntakeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.manifest = {"schemaVersion": 1, "dataset": "TRUSTED", "patientId": "418", "side": "R",
                         "role": "development", "source": "synthetic-test", "accessEvidence": "synthetic"}
        for name, filename, offset in [("ct", "418_imgCT.nii.gz", 900), ("us", "418R_imgUS.nii.gz", 0)]:
            affine = np.diag([.3, .5, 1.2, 1.]); affine[2, 3] = offset
            image = nib.Nifti1Image(np.arange(24, dtype=np.int16).reshape(2, 3, 4), affine)
            image.header.set_xyzt_units("mm")
            nib.save(image, self.root/filename)
            self.manifest[name] = {"path": filename, "sha256": file_hash(self.root/filename),
                                   "patientId": "418", "side": "R", "annotations": {}}

    def run_audit(self):
        path = self.root/"manifest.json"; path.write_text(json.dumps(self.manifest))
        return audit(path)

    def test_patient_pair_is_not_a_registered_plane(self):
        result = self.run_audit()
        self.assertFalse(result["registered"])
        self.assertFalse(result["clinicalAcceptance"])
        self.assertEqual(result["pair"]["us"]["annotationStatus"], "incomplete")
        self.assertEqual(result["pair"]["ct"]["annotationScope"], "both-kidneys")
        self.assertEqual(result["pair"]["ct"]["voxelToWorldMm"][2][3], 900)
        self.assertEqual(result["pair"]["us"]["voxelToWorldMm"][2][3], 0)

    def test_swapped_patient_side_and_changed_content_rejected(self):
        for key, wrong in [("patientId", "419"), ("side", "L"), ("sha256", "0"*64)]:
            before = self.manifest["us"][key]
            self.manifest["us"][key] = wrong
            with self.subTest(key=key), self.assertRaises(ValueError): self.run_audit()
            self.manifest["us"][key] = before

    def test_matching_hash_does_not_override_wrong_filename(self):
        (self.root/"418R_imgUS.nii.gz").rename(self.root/"418L_imgUS.nii.gz")
        self.manifest["us"]["path"] = "418L_imgUS.nii.gz"
        with self.assertRaisesRegex(ValueError, "Nombre TRUSTED"): self.run_audit()

    def test_mask_encoding_and_grid_are_checked(self):
        image = nib.load(self.root/"418_imgCT.nii.gz")
        values = np.zeros(image.shape, dtype=np.uint8); values[0, 1, 2] = 255
        label = nib.Nifti1Image(values, image.affine); label.header.set_xyzt_units("mm")
        path = self.root/"mask.nii.gz"; nib.save(label, path)
        self.assertEqual(inspect_annotation(path, image, 255, None)["occupiedVoxels"], 1)
        with self.assertRaisesRegex(ValueError, "codificación"): inspect_annotation(path, image, 1, None)
        moved = image.affine.copy(); moved[0, 3] += 2
        label.set_sform(moved); nib.save(label, path)
        with self.assertRaisesRegex(ValueError, "rejilla"): inspect_annotation(path, image, 255, None)

    def test_nonfinite_and_invalid_values_after_first_slab_are_rejected(self):
        affine = np.eye(4)
        image = nib.Nifti1Image(np.ones((2, 3, 35), dtype=np.uint8), affine)
        image.header.set_xyzt_units("mm")
        for invalid in [2, np.nan, np.inf]:
            values = np.zeros(image.shape, dtype=np.float32); values[0, 0, 0] = 1; values[1, 2, 34] = invalid
            label = nib.Nifti1Image(values, affine); label.header.set_xyzt_units("mm")
            path = self.root/"late-invalid.nii.gz"; nib.save(label, path)
            with self.subTest(invalid=invalid), self.assertRaisesRegex(ValueError, "codificación"):
                inspect_annotation(path, image, 1, None)

    def test_roundoff_is_explicit_bounded_and_preserves_source(self):
        image = nib.Nifti1Image(np.ones((2, 3, 35), dtype=np.uint8), np.eye(4))
        image.header.set_xyzt_units("mm")
        values = np.full(image.shape, 2.842170943040401e-14); values[1, 2, 34] = 1-2.842170943040401e-14
        label = nib.Nifti1Image(values, image.affine); label.header.set_xyzt_units("mm")
        path = self.root/"roundoff.nii.gz"; nib.save(label, path); original = file_hash(path)
        with self.assertRaisesRegex(ValueError, "codificación"): inspect_annotation(path, image, 1, None)
        for tolerance, evidence in [(1e-12, None), (.1, "cannot justify a segmentation threshold")]:
            with self.assertRaisesRegex(ValueError, "Tolerancia"):
                inspect_annotation(path, image, 1, None, tolerance, evidence)
        result = inspect_annotation(path, image, 1, None, 1e-12, "synthetic representation error")
        self.assertEqual(result["occupiedVoxels"], 1)
        self.assertAlmostEqual(result["maxCodingResidual"], 2.842170943040401e-14, delta=1e-20)
        self.assertEqual(file_hash(path), original)
        values[1, 2, 33] = .01; label = nib.Nifti1Image(values, image.affine); label.header.set_xyzt_units("mm"); nib.save(label, path)
        with self.assertRaisesRegex(ValueError, "codificación"):
            inspect_annotation(path, image, 1, None, 1e-12, "cannot conceal a fractional mask")

    def test_role_and_access_cannot_disappear(self):
        for key in ["role", "accessEvidence", "source"]:
            value = self.manifest.pop(key)
            with self.subTest(key=key), self.assertRaises(ValueError): self.run_audit()
            self.manifest[key] = value


if __name__ == "__main__":
    unittest.main()
