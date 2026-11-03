"""Contratos P0 con NIfTI sintéticos; Python -I, sin TAC ni red en CI."""
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

import nibabel as nib
import numpy as np

SPEC = importlib.util.spec_from_file_location('s0028_source', Path(__file__).with_name('s0028-source.py'))
lib = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(lib)


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


class SourceContract(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root/'segmentations').mkdir()
        self.affine = np.diag([1.5, 1.5, 1.5, 1.])
        self.a = np.zeros((8, 8, 8), np.uint8)
        self.a[2:5, 2:5, 2:5] = 1
        self.b = self.a.copy()
        self.write('ct.nii.gz', np.zeros(self.a.shape, np.int16))
        for name, data in [('a', self.a), ('b', self.b)]:
            self.write('segmentations/'+name+'.nii.gz', data)
        self.manifest = {'person': 'synthetic', 'frameId': 'synthetic-las', 'revision': 'p0',
                         'ctSha256': sha(self.root/'ct.nii.gz'), 'shape': [8, 8, 8],
                         'affineRASmm': self.affine.tolist(), 'headerUnits': ['mm', 'unknown'],
                         'pitchMm': 1.5, 'requiredMasks': ['a', 'b'],
                         'rasToLASmm': np.diag([-1., 1, 1, 1]).tolist(),
                         'masks': {n: {'person': 'synthetic', 'path': 'segmentations/'+n+'.nii.gz',
                                      'sha256': sha(self.root/'segmentations'/f'{n}.nii.gz')}
                                   for n in ['a', 'b']}}

    def write(self, name, data, affine=None, units='mm'):
        image = nib.Nifti1Image(data, self.affine if affine is None else affine)
        image.header.set_xyzt_units(units)
        nib.save(image, self.root/name)

    def test_missing_mask_fails_even_if_manifest_entry_deleted(self):
        del self.manifest['masks']['b']
        with self.assertRaisesRegex(ValueError, 'faltante'):
            lib.inventory(self.root, self.manifest)

    def test_missing_file_fails(self):
        (self.root/'segmentations/b.nii.gz').unlink()
        with self.assertRaisesRegex(ValueError, 'faltante'):
            lib.inventory(self.root, self.manifest)

    def test_changed_affine_fails_even_with_updated_hash(self):
        shifted = self.affine.copy()
        shifted[0, 3] = 1.5
        self.write('segmentations/b.nii.gz', self.b, shifted)
        self.manifest['masks']['b']['sha256'] = sha(self.root/'segmentations/b.nii.gz')
        with self.assertRaisesRegex(ValueError, 'affine'):
            lib.inventory(self.root, self.manifest)

    def test_changed_units_fail_even_with_updated_hash(self):
        self.write('segmentations/b.nii.gz', self.b, units='meter')
        self.manifest['masks']['b']['sha256'] = sha(self.root/'segmentations/b.nii.gz')
        with self.assertRaisesRegex(ValueError, 'unidades'):
            lib.inventory(self.root, self.manifest)

    def test_mixed_donor_fails(self):
        self.manifest['masks']['b']['person'] = 'another-person'
        with self.assertRaisesRegex(ValueError, 'donante'):
            lib.inventory(self.root, self.manifest)

    def test_overlap_survives_and_priority_merge_fails(self):
        result = lib.inventory(self.root, self.manifest)
        self.assertEqual(result['conflicts'][0]['voxels'], 27)
        self.assertEqual(result['masks']['a']['voxels'], 27)
        with self.assertRaisesRegex(ValueError, 'overlap'):
            lib.merge_disjoint([self.a, self.b], [1, 2])
        with self.assertRaisesRegex(ValueError, 'overlap'):
            lib.assemble({'a': (np.zeros(3, int), self.a.astype(bool)),
                          'b': (np.zeros(3, int), self.b.astype(bool))}, ['a', 'b'])

    def test_interpolated_labels_fail_instead_of_rounding(self):
        with self.assertRaisesRegex(ValueError, 'categ'):
            lib.validate_labels(np.array([1., 1.25, 2.]), {0, 1, 2})
        with self.assertRaisesRegex(ValueError, 'categ'):
            lib.validate_labels(np.array([1.25]), {1.25})

    def test_registration_cannot_scale_or_rotate_a_crop_independently(self):
        self.manifest['rasToLASmm'][0][0] = -.8
        with self.assertRaisesRegex(ValueError, 'registro'):
            lib.inventory(self.root,self.manifest)

    def test_hash_corruption_fails(self):
        self.manifest['masks']['b']['sha256'] = '0'*64
        with self.assertRaisesRegex(ValueError, 'hash'):
            lib.inventory(self.root, self.manifest)

    def test_signed_field_retains_every_voxel_and_labels(self):
        mask = self.a.astype(bool)
        field = lib.signed_field(mask, self.a)
        np.testing.assert_array_equal(field[..., 0] < 0, mask)
        self.assertTrue(np.isin(field[..., 1], [0, 1]).all())

    def candidate_fixture(self):
        self.manifest['fieldGroups'] = [{'name':n,'masks':[n]} for n in ['a','b']]
        out=self.root/'candidate';out.mkdir()
        independent=self.root/'independent';independent.mkdir()
        inventory=lib.inventory(self.root,self.manifest,independent)
        origin = nib.affines.apply_affine(np.array(self.manifest['rasToLASmm']),
            nib.affines.apply_affine(self.affine, [7, 0, 0])).tolist()
        inventory['originLASmm']=origin
        lib.save(out/'inventory.json',inventory)
        rows=[]
        for name,asset in [('a','abdominal'),('b','thoracic')]:
            mask=self.a[::-1].astype(bool)
            field=lib.signed_field(mask,mask.astype(np.uint8))
            raw=field.transpose(2,1,0,3).tobytes()
            compressed=gzip.compress(raw,mtime=0)
            (out/(name+'.gzip.bin')).write_bytes(compressed)
            rows.append({'name':name,'asset':asset,'status':'source','dimensions':[8,8,8],
                         'originMm':list(origin),'rawBytes':len(raw),'occupiedVoxels':27,
                         'labelValues':[0,1],'sourceLabels':{'1':name},'sha256Raw':hashlib.sha256(raw).hexdigest()})
        lib.save(out/'fields.json',{'fields':rows})
        return out

    def test_saved_candidate_preserves_identity_and_rejects_relabel(self):
        out=self.candidate_fixture()
        lib.verify_exports(out,self.manifest,self.root)
        value=json.loads((out/'fields.json').read_text())
        value['fields'][0]['sourceLabels']={'1':'b'}
        lib.save(out/'fields.json',value)
        with self.assertRaisesRegex(ValueError,'Identidad'):
            lib.verify_exports(out,self.manifest,self.root)

    def test_missing_source_field_is_rejected(self):
        out = self.candidate_fixture()
        meta = json.loads((out/'fields.json').read_text())
        meta['fields'].pop()
        lib.save(out/'fields.json', meta)
        with self.assertRaisesRegex(ValueError, 'Inventario'):
            lib.verify_exports(out, self.manifest, self.root)

    def test_physical_identity_includes_transform_revision_and_source(self):
        identity=lib.physical_id(self.manifest)
        self.manifest['rasToLASmm'][0][3]=1.5
        self.assertNotEqual(identity,lib.physical_id(self.manifest))

    def test_verified_frame_uses_ct_affine_and_manifest_translation(self):
        self.affine[:3, 3] = [12., -18., 24.]
        self.manifest['affineRASmm'] = self.affine.tolist()
        self.write('ct.nii.gz', np.zeros(self.a.shape, np.int16))
        self.manifest['ctSha256'] = sha(self.root/'ct.nii.gz')
        for name in ['a', 'b']:
            self.write('segmentations/'+name+'.nii.gz', self.a)
            self.manifest['masks'][name]['sha256'] = sha(self.root/'segmentations'/f'{name}.nii.gz')
        self.manifest['rasToLASmm'][0][3] = 3.
        self.manifest['rasToLASmm'][1][3] = 6.
        self.manifest['rasToLASmm'][2][3] = -9.
        out = self.candidate_fixture()
        lib.verify_exports(out, self.manifest, self.root)
        self.assertEqual(json.loads((out/'inventory.json').read_text())['originLASmm'], [-19.5, -12., 15.])

    def test_translated_twenty_fields_and_inventory_fail_against_ct_frame(self):
        out = self.candidate_fixture()
        metadata = json.loads((out/'fields.json').read_text())
        template = metadata['fields'][0]
        metadata['fields'] = []
        self.manifest['fieldGroups'] = []
        for i in range(20):
            name = f'field{i}'
            metadata['fields'].append({**template, 'name': name, 'originMm': list(template['originMm'])})
            self.manifest['fieldGroups'].append({'name': name, 'masks': ['a']})
            (out/(name+'.gzip.bin')).write_bytes((out/'a.gzip.bin').read_bytes())
        lib.save(out/'fields.json', metadata)
        independent = out.parent/'independent/inventory.json'
        original = json.loads(independent.read_text())
        original['physicalFrameSha256'] = lib.physical_id(self.manifest)
        lib.save(independent, original)
        body, _ = lib.trunk_mask(np.zeros(self.a.shape, np.int16))
        np.savez_compressed(out/'body-source.npz', body=body, origin=np.array([-10.5, 0., 0.]))
        lib.verify_exports(out, self.manifest, self.root)
        report = json.loads((out/'export-verification.json').read_text())
        self.assertTrue(report['derivedBodyVerifiedAgainstCT'])
        self.assertEqual(report['physicalFrameSha256'], lib.physical_id(self.manifest))
        metadata = json.loads((out/'fields.json').read_text())
        for row in metadata['fields']:
            row['originMm'][0] += 100
        inventory = json.loads((out/'inventory.json').read_text())
        inventory['originLASmm'][0] += 100
        lib.save(out/'fields.json', metadata)
        lib.save(out/'inventory.json', inventory)
        (out/'export-verification.json').unlink()
        with self.assertRaisesRegex(ValueError, 'marco|Geometría'):
            lib.verify_exports(out, self.manifest, self.root)
        self.assertFalse((out/'export-verification.json').exists())


if __name__ == '__main__':
    unittest.main()
