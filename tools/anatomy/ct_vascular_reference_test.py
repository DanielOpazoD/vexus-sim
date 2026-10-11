"""Controles de coordenadas/entrada y de identidad ausente; sin datos de pacientes."""
import json
from pathlib import Path
import tempfile
import unittest

import nibabel as nib
import numpy as np

from ct_vascular_reference import audit, binary_mask, geometry_matches, physical_affine, summarize


def image(data, affine=None, units="mm"):
    result = nib.Nifti1Image(np.asarray(data), np.eye(4) if affine is None else affine)
    result.header.set_xyzt_units(units)
    return result


class CTReferenceTests(unittest.TestCase):
    def test_oblique_coordinate_phantom_preserves_physical_positions(self):
        # Ocho centros conocidos: x=0/1, y=1/2, z=1/2. Rotación de 90°,
        # pasos 2/3/4 mm: centro físico (5.5, 21, 36), volumen 8*24 mm³.
        affine = np.array([[0, -3, 0, 10], [2, 0, 0, 20], [0, 0, 4, 30], [0, 0, 0, 1]])
        mask = np.zeros((3, 4, 4), dtype=bool)
        mask[0:2, 1:3, 1:3] = True
        result = summarize(mask, affine, np.full(mask.shape, 120))
        np.testing.assert_allclose(result["centroidRASmm"], [5.5, 21, 36])
        # Redondeo float64 del determinante (~6e-14 mm³), no incertidumbre anatómica.
        self.assertAlmostEqual(result["volumeMm3"], 192, delta=1e-10)

    def test_wrong_grid_is_rejected_before_mask_use(self):
        reference = image(np.zeros((2, 3, 4), dtype=np.int16))
        shifted = np.eye(4)
        shifted[0, 3] = 1
        for mask in [image(np.zeros((3, 2, 4), dtype=np.uint8)),
                     image(np.zeros(reference.shape, dtype=np.uint8), shifted)]:
            with self.assertRaisesRegex(ValueError, "rejilla"):
                geometry_matches(mask, reference)

    def test_unknown_units_need_evidence_and_meter_is_not_mm(self):
        undeclared = image(np.zeros((2, 3, 4), dtype=np.int16), units="unknown")
        with self.assertRaisesRegex(ValueError, "Unidades"):
            physical_affine(undeclared)
        physical_affine(undeclared, "Source publication explicitly reports mm")
        with self.assertRaisesRegex(ValueError, "Unidades"):
            physical_affine(image(np.zeros((2, 3, 4), dtype=np.int16), units="meter"), "mm")

    def test_conflicting_sform_qform_is_not_silently_resolved(self):
        data = image(np.zeros((2, 3, 4), dtype=np.int16))
        shifted = np.eye(4)
        shifted[2, 3] = 5
        data.set_qform(shifted, code=1)
        data.set_sform(np.eye(4), code=1)
        with self.assertRaisesRegex(ValueError, "contradictorios"):
            physical_affine(data)

    def test_fallback_affine_is_not_patient_orientation(self):
        data = image(np.zeros((2, 3, 4), dtype=np.int16))
        data.set_qform(None, code=0)
        data.set_sform(None, code=0)
        with self.assertRaisesRegex(ValueError, "física ausente"):
            physical_affine(data)

    def test_multiclass_mask_is_not_merged_into_a_fake_vessel(self):
        mask = np.zeros((2, 3, 4), dtype=np.uint8)
        mask[0, 1, 2] = 2
        with self.assertRaisesRegex(ValueError, "binaria"):
            binary_mask(image(mask))

    def test_joint_class_does_not_complete_separate_vascular_identities(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            nib.save(image(np.ones((3, 3, 3), dtype=np.int16)*100), root/"ct.nii.gz")
            mask = np.zeros((3, 3, 3), dtype=np.uint8)
            mask[1, 1, 1] = 1
            nib.save(image(mask), root/"joint.nii.gz")
            manifest = {"ct": "ct.nii.gz", "masks": {"portal_joint": {
                "path": "joint.nii.gz", "sourceLabel": "portal_and_splenic", "identityStatus": "joint-source-label"}},
                "source": {"case": "synthetic-coordinate-phantom"}, "intensityUnits": "synthetic-HU",
                "vascularLabels": ["portal_joint"], "requiredIdentities": ["portal", "hepatic_veins"]}
            path = root/"manifest.json"
            path.write_text(json.dumps(manifest))
            result = audit(path)
            self.assertEqual(result["missingRequiredIdentities"], ["portal", "hepatic_veins"])
            self.assertEqual(result["contrastPhase"], "unknown")
            self.assertFalse(result["ultrasoundValidated"])
            self.assertFalse(result["runtimeInstalled"])


if __name__ == "__main__":
    unittest.main()
