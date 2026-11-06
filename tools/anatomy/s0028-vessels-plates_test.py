"""Oráculo geométrico del corte de grafos, sin TAC ni captura del producto."""
import importlib.util
from pathlib import Path
import unittest
import tempfile
import json
import numpy as np

spec=importlib.util.spec_from_file_location('plates',Path(__file__).with_name('s0028-vessels-plates.py'))
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)


def plane():
    return {'id':'synthetic','frame':{'face':[0,0,0],'lateral':[1,0,0],'axial':[0,0,1],'elevation':[0,1,0]},
            'width':21,'height':21,'u0':-5,'r0':-5,'pitchMm':.5}


class PlateTests(unittest.TestCase):
    def test_source_unknown_nodes_or_edges_are_visible_as_unknown(self):
        nodes=[{'p':[0,-4,0],'r':2.,'group':0,'certainty':'U'},{'p':[0,4,0],'r':2.,'group':0,'certainty':'U'}]
        edges=[{'nodes':[0,1],'group':0,'certainty':'U','flow':0}]
        result=p.raster_graph(plane(),nodes,edges,[{'id':'source-aorta','system':'aorta'}])
        self.assertGreater(int(((result&128)>0).sum()),0)
        self.assertTrue(np.all((result[result!=0]&128)>0))

    def test_comparator_requires_complete_hash_inventory_and_person(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory=Path(tmp)
            data={'frameId':'s0028-audit-las-v1','person':'s0028','ctSha256':'a'*64,
                  'planes':[{**plane(),'id':name} for name in sorted(p.WINDOWS)],'hashes':{}}
            (directory/'planes.json').write_text(json.dumps(data))
            with self.assertRaises(ValueError):p.read_planes(directory,'s0028')
            for q in data['planes']:
                name=f'procedural-{q["id"]}.u16';raw=np.zeros((21,21),dtype='<u2').tobytes()
                (directory/name).write_bytes(raw);data['hashes'][name]=p.v.sha(raw)
            (directory/'planes.json').write_text(json.dumps(data));p.read_planes(directory,'s0028')
            data['person']='other';(directory/'planes.json').write_text(json.dumps(data))
            with self.assertRaises(ValueError):p.read_planes(directory,'s0028')
    def test_circular_section_at_independent_physical_plane(self):
        nodes=[{'p':[0,-4,0],'r':2.,'group':0,'certainty':'D'}, {'p':[0,4,0],'r':2.,'group':0,'certainty':'D'}]
        edges=[{'nodes':[0,1],'group':0,'certainty':'D','flow':1}]
        groups=[{'id':'source-aorta','system':'aorta'}]
        result=p.raster_graph(plane(),nodes,edges,groups)
        x,y=np.meshgrid(np.arange(-5,5.01,.5),np.arange(-5,5.01,.5))
        np.testing.assert_array_equal(result!=0,x*x+y*y<4)
        self.assertTrue(np.all(result[result!=0]==2))
        shifted=plane();shifted['frame']['face']=[0,0,4]
        self.assertLess(p.raster_graph(shifted,nodes,edges,groups).sum(),result.sum())

    def test_unknown_overlap_keeps_both_bits_and_off_plane_is_absent(self):
        nodes=[{'p':[0,-4,0],'r':2.,'group':0,'certainty':'D'},{'p':[0,4,0],'r':2.,'group':0,'certainty':'D'},
               {'p':[0,-4,0],'r':1.,'group':1,'certainty':'U'},{'p':[0,4,0],'r':1.,'group':1,'certainty':'U'}]
        edges=[{'nodes':[0,1],'group':0,'certainty':'D','flow':1},{'nodes':[2,3],'group':1,'certainty':'U','flow':0}]
        groups=[{'id':'source-aorta','system':'aorta'},{'id':'candidate','system':None}]
        result=p.raster_graph(plane(),nodes,edges,groups)
        self.assertEqual(result[10,10],2|128)
        off=plane();off['frame']['face']=[20,0,0]
        self.assertEqual(int(p.raster_graph(off,nodes,edges,groups).sum()),0)

    def test_native_sampling_has_no_double_reflection(self):
        x,y,z=np.indices((12,12,12));volume=(100*x+10*y+z).astype(float)
        affine=np.array([[-1.5,0,0,20],[0,1.5,0,-20],[0,0,1.5,-10],[0,0,0,1.]])
        points=np.array([[17,-15.5,-4],[100,100,100]])
        values=p.reslice(volume,affine,points,order=1)
        self.assertAlmostEqual(values[0],234)
        self.assertTrue(np.isnan(values[1]))


if __name__=='__main__':unittest.main()
