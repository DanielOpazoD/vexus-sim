"""Negativos P0c: gas nearest, separaciones y enumeración de ladrillos."""
import importlib.util
from pathlib import Path
import unittest

import numpy as np

SPEC=importlib.util.spec_from_file_location('direct',Path(__file__).with_name('s0028-direct.py'))
lib=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(lib)


class DirectTests(unittest.TestCase):
    def test_gas_bit_preserves_all_occupancy_and_digestive_labels(self):
        gut=np.zeros((2,2,2,2),'<f2');gut[...,0]=-1;gut[...,1]=np.arange(8).reshape(2,2,2)+1
        gas=gut.copy();gas[...,0]=1;gas[0,0,0,0]=-1;gas[1,1,1,0]=-1
        packed=lib.encode_gas(gut,gas)
        np.testing.assert_array_equal(packed[...,0],gut[...,0])
        np.testing.assert_array_equal(packed[...,1]>=128,gas[...,0]<0)
        np.testing.assert_array_equal(packed[...,1]%128,gut[...,1])
        self.assertEqual(packed.dtype,np.dtype('<f2'))

    def test_gas_outside_digestive_mask_is_rejected(self):
        gut=np.zeros((2,2,2,2),'<f2');gut[...,0]=1
        gas=gut.copy();gas[0,0,0,0]=-1
        with self.assertRaisesRegex(ValueError,'fuera'):
            lib.encode_gas(gut,gas)
        with self.assertRaisesRegex(ValueError,'rejilla'):
            lib.encode_gas(gut,gas[:1])

    def test_packing_guard_and_real_texture_allocation(self):
        rows=[{'name':'a','dimensions':[4,3,2]},{'name':'b','dimensions':[4,3,2]}]
        result=lib.pack_boxes(rows,4,3)
        self.assertEqual(result['textureDimensions'],[4,3,5])
        self.assertEqual(result['rawBytes'],4*3*5*4)
        self.assertEqual(result['offsets']['b'],[0,0,3])
        self.assertIsNone(lib.pack_boxes(rows,3,3))

if __name__=='__main__':
    unittest.main()
