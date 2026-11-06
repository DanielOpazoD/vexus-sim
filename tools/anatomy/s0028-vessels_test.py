"""Contrato P5 offline: fantasmas, sin datos humanos ni runtime nuevo."""
import copy
import json
import importlib.util
from pathlib import Path
import struct
import tempfile
import unittest

import numpy as np
import nibabel as nib

spec = importlib.util.spec_from_file_location('vessels', Path(__file__).with_name('s0028-vessels.py'))
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)


class VascularContractTests(unittest.TestCase):
    def test_connections_not_order_resolve_identity(self):
        candidate = np.zeros((12, 9, 9), bool)
        candidate[2:10, 4, 4] = True
        a = np.zeros_like(candidate); a[1, 4, 4] = True
        b = np.zeros_like(candidate); b[10, 4, 4] = True
        result = v.connected_identities(candidate, {'cava': a, 'portal': b})
        self.assertEqual(result['components'][0]['roots'], ['cava', 'portal'])
        self.assertEqual(result['components'][0]['certainty'], 'U')
        self.assertEqual(result['components'][0]['reason'], 'identity-conflict')
        reverse = v.connected_identities(candidate, {'portal': b, 'cava': a})
        self.assertEqual(result['components'], reverse['components'])
        candidate[6, 4, 4] = False
        result = v.connected_identities(candidate, {'cava': a, 'portal': b})
        self.assertEqual([r['roots'] for r in result['components']], [['cava'], ['portal']])
        self.assertTrue(all(r['certainty'] == 'D' for r in result['components']))

    def test_orphan_and_diagonal_contact_remain_explicit(self):
        candidate = np.zeros((8, 8, 8), bool)
        candidate[2, 2, 2] = candidate[6, 6, 6] = True
        seed = np.zeros_like(candidate); seed[1, 1, 1] = True
        result = v.connected_identities(candidate, {'cava': seed})
        self.assertEqual(result['components'][0]['roots'], ['cava'])
        self.assertEqual(result['components'][1]['reason'], 'unrooted')
        self.assertEqual(result['components'][1]['certainty'], 'U')

    def test_touching_source_masks_are_not_resolved_by_precedence(self):
        a = np.zeros((7, 7, 7), bool); a[2, 2, 2] = True
        b = np.zeros_like(a); b[3, 2, 2] = True
        conflict = v.source_conflicts({'aorta': a, 'cava': b})
        self.assertTrue(conflict[2, 2, 2] and conflict[3, 2, 2])
        self.assertEqual(int(conflict.sum()), 2)
        np.testing.assert_array_equal(conflict, v.source_conflicts({'cava': b, 'aorta': a}))

    def test_centerline_stays_in_mask_and_one_las_transform(self):
        x, y, z = np.indices((15, 15, 27))
        mask = ((x-7)**2+(y-7)**2 <= 9) & (z>=2) & (z<=24)
        affine = np.array([[-1.5, 0, 0, 19], [0, 1.5, 0, -23], [0, 0, 1.5, -42], [0, 0, 0, 1]])
        graph = v.centerline(mask, affine, root_mode='superior', flow='toward-root')
        self.assertGreater(len(graph['nodes']), 12)
        for node in graph['nodes']:
            self.assertTrue(mask[tuple(node['ijk'])])
            np.testing.assert_allclose(node['p'], (affine@np.r_[node['ijk'], 1])[:3])
            self.assertGreater(node['r'], 0)
        self.assertEqual(len(graph['roots']), 1)
        for edge in graph['edges']:
            if edge['flow']:
                a, b = [graph['nodes'][i]['p'][2] for i in edge['nodes']]
                self.assertGreater((b-a)*edge['flow'], 0)
        center = graph['nodes'][len(graph['nodes'])//2]
        self.assertAlmostEqual(center['r'], np.sqrt(10)*1.5-.75)

    def test_separate_components_never_get_a_fictitious_bridge(self):
        mask = np.zeros((9, 9, 25), bool)
        mask[3:6, 3:6, 2:10] = True; mask[3:6, 3:6, 15:23] = True
        graph = v.centerline(mask, np.diag([1.5, 1.5, 1.5, 1]), root_mode=None, flow='unknown')
        self.assertEqual(len(graph['roots']), 2)
        self.assertTrue(all(e['flow'] == 0 for e in graph['edges']))
        for e in graph['edges']:
            a, b = [np.array(graph['nodes'][i]['ijk']) for i in e['nodes']]
            self.assertLessEqual(np.abs(a-b).max(), 1)

    def test_component_lost_by_skeletonization_is_counted_even_when_another_survives(self):
        mask=np.zeros((20,20,20),bool)
        mask[2:5,2:5,2:10]=True;mask[12:14,12:14,2:10]=True
        graph=v.centerline(mask,np.eye(4))
        self.assertEqual(int(mask.sum()),104)
        self.assertEqual(graph['unrepresentedVoxels'],32)
        self.assertEqual(graph['unrepresentedComponents'],1)

    def test_known_binary_bytes_and_corruption(self):
        nodes = [{'p': [1., -2., 3.], 'r': 2.5, 'ijk': [4, 5, 6], 'group': 0, 'certainty': 'D'},
                 {'p': [2., -2., 3.], 'r': 1.5, 'ijk': [5, 5, 6], 'group': 0, 'certainty': 'U'}]
        edges = [{'nodes': [0, 1], 'flow': 0, 'certainty': 'U', 'group': 0}]
        payload, info = v.pack(nodes, edges)
        expected = (b'VXV1'+struct.pack('<II', 2, 1)+struct.pack('<ffffHHHBB', 1, -2, 3, 2.5, 4, 5, 6, 0, 1)
                    +struct.pack('<ffffHHHBB', 2, -2, 3, 1.5, 5, 5, 6, 0, 0)+struct.pack('<IIbBH', 0, 1, 0, 0, 0))
        self.assertEqual(payload, expected)
        self.assertEqual(info['encodedBytes'], 72)
        self.assertEqual(v.unpack(payload, info), (nodes, edges))
        for bad in (payload[:-1], payload+b'\0', payload[:18]+b'\xff'+payload[19:]):
            with self.assertRaises(ValueError): v.unpack(bad, info)
        self.assertEqual(v.pack(nodes, edges)[0], payload)

    def test_contract_rejects_invalid_graph_and_unknown_flow(self):
        nodes = [{'p': [1., -2., 3.], 'r': 2.5, 'ijk': [4, 5, 6], 'group': 0, 'certainty': 'D'},
                 {'p': [2., -2., 3.], 'r': 1.5, 'ijk': [5, 5, 6], 'group': 0, 'certainty': 'U'}]
        edges = [{'nodes': [0, 1], 'flow': 0, 'certainty': 'U', 'group': 0}]
        cases=[]
        for key, value in [('r', 0), ('r', float('nan')), ('p', [float('inf'), 0, 0]), ('ijk', [70000, 0, 0]), ('group', 256)]:
            n=copy.deepcopy(nodes);n[0][key]=value;cases.append((n, edges))
        for patch in [{'nodes':[0,2]}, {'nodes':[0,0]}, {'flow':1}, {'certainty':'D'}, {'flow':2}]:
            cases.append((nodes, [{**edges[0], **patch}]))
        cases.append((nodes, edges+edges))
        for n,e in cases:
            with self.subTest(n=n,e=e), self.assertRaises(ValueError): v.pack(n,e)

    def test_bad_frame_and_binary_input_are_rejected(self):
        for bad in (np.full((8,8,8), 2), np.full((8,8,8), np.nan)):
            with self.assertRaises(ValueError): v.centerline(bad, np.eye(4))
        a=np.zeros((8,8,8), bool);a[2:5,2:5,2:6]=True
        for bad in (np.zeros((4,4)), np.diag([1.,2.,1.,1.]), np.full((4,4),np.nan)):
            with self.assertRaises(ValueError): v.centerline(a,bad)

    def test_hashes_and_budget_are_checked_when_reopening(self):
        with tempfile.TemporaryDirectory() as tmp:
            out=Path(tmp)
            nodes=[{'p':[0.,0.,0.], 'r':.75, 'ijk':[0,0,0], 'group':0, 'certainty':'U'}]
            payload,info=v.pack(nodes,[])
            descriptor={'format':v.FORMAT, 'person':'s0028','runtimeInstalled':False,
                        'physicalFrameSha256':'a'*64,'geometry':info,
                        'groups':[{'id':'unknown','nodeRange':[0,1],'edgeRange':[0,0],'identityCertainty':'U','physiologyId':None}],
                        'baselineDownloadBytes':20_432_944}
            receipt=v.write_package(out,payload,descriptor)
            self.assertLess(receipt['totalDownloadBytes'],25_000_000)
            v.verify_package(out,expected_frame='a'*64)
            with self.assertRaises(ValueError):v.verify_package(out,expected_frame='b'*64)
            p=out/'vessels.gzip.bin';p.write_bytes(p.read_bytes()+b'junk')
            with self.assertRaises(ValueError):v.verify_package(out,expected_frame='a'*64)
            with self.assertRaises(ValueError):v.write_package(out,payload,{**descriptor,'baselineDownloadBytes':25_000_000})

    def test_cycle_is_retained_as_unknown_never_directed(self):
        mask=np.zeros((9,9,9),bool)
        mask[2:7,2,4]=True;mask[2:7,6,4]=True
        mask[2,2:7,4]=True;mask[6,2:7,4]=True
        graph=v.centerline(mask,np.eye(4),root_mode='superior',flow='toward-root')
        self.assertEqual(graph['cycleComponents'],1)
        self.assertTrue(all(e['certainty']=='U' and e['flow']==0 for e in graph['edges']))
        nodes=[{'p':[float(i==1),float(i==2),0.], 'r':1.,'ijk':[i,0,0], 'group':0,'certainty':'D'} for i in range(3)]
        edges=[{'nodes':[a,b],'flow':0,'certainty':'D','group':0} for a,b in [(0,1),(1,2),(2,0)]]
        with self.assertRaisesRegex(ValueError,'ciclo'):v.pack(nodes,edges)
        mixed=copy.deepcopy(edges);mixed[-1]['certainty']='U'
        with self.assertRaisesRegex(ValueError,'ciclo'):v.pack(nodes,mixed)
        v.pack(nodes,[{**e,'certainty':'U'} for e in edges])

    def test_root_attachment_follows_connected_support_not_proximity(self):
        a=np.zeros((12,12,5),bool)
        a[2:10,2,2]=True;a[9,2:10,2]=True;a[2:10,9,2]=True
        path=v.attachment_path(a,[2,2,2],[[2,9,2]])
        self.assertIsNotNone(path)
        self.assertEqual(path[0],(2,2,2));self.assertEqual(path[-1],(2,9,2))
        self.assertTrue(all(a[q] for q in path))
        self.assertGreater(len(path),10)
        a[9,5,2]=False
        self.assertIsNone(v.attachment_path(a,[2,2,2],[[2,9,2]]))

    def test_reference_flow_must_match_declared_root(self):
        nodes=[{'p':[0.,0.,float(i)],'r':.5,'ijk':[0,0,i],'group':0,'certainty':'D'} for i in range(3)]
        edges=[{'nodes':[i,i+1],'flow':1,'certainty':'D','group':0} for i in range(2)]
        payload,info=v.pack(nodes,edges)
        group={'id':'cava','nodeRange':[0,3],'edgeRange':[0,2],'identityCertainty':'U','physiologyId':None,
               'positiveFlow':'toward-root','roots':[{'node':2,'kind':'superior','certainty':'D','cycle':False}]}
        d={'format':v.FORMAT,'person':'s0028','runtimeInstalled':False,'physicalFrameSha256':'a'*64,
           'geometry':info,'groups':[group],'baselineDownloadBytes':0}
        with tempfile.TemporaryDirectory() as tmp:
            v.write_package(tmp,payload,d)
            for patch in ({'positiveFlow':'away-from-root'},{'roots':[]},
                          {'roots':[{'node':0,'kind':'superior','certainty':'D','cycle':False}]}):
                with self.subTest(patch=patch),self.assertRaises(ValueError):
                    v.write_package(tmp,payload,{**d,'groups':[{**group,**patch}]})

    def test_connection_requires_conserved_support_and_edt_radius(self):
        nodes=[{'p':[float(i),0.,0.],'r':.5,'ijk':[i,0,0],'group':g,'certainty':'U'} for g,i in enumerate((0,6))]
        payload,info=v.pack(nodes,[])
        groups=[{'id':name,'nodeRange':[i,i+1],'edgeRange':[0,0],'identityCertainty':'U','physiologyId':None}
                for i,name in enumerate(('branch','parent'))]
        path=[[i,0,0] for i in range(7)]
        connection={'fromGroup':'branch','toGroup':'parent','fromNode':0,'toNode':1,'pathIJK':path,
                    'radiiMm':[.5]*7,'status':'connected-support','geometryCertainty':'U','flowCertainty':'U',
                    'referenceDirection':1,'supportBounds':{'lo':[0,0,0],'shape':[7,1,1]}}
        d={'format':v.FORMAT,'person':'s0028','runtimeInstalled':False,'physicalFrameSha256':'a'*64,
           'affineRASmm':np.eye(4).tolist(),'rasToLASmm':np.eye(4).tolist(),'nativeShape':[7,1,1],
           'geometry':info,'groups':groups,'connections':[connection],'baselineDownloadBytes':0}
        with tempfile.TemporaryDirectory() as tmp:
            # Neither a rehashed manifest nor a contiguous path demonstrates source support.
            with self.assertRaises(ValueError):v.write_package(tmp,payload,d)
            with self.assertRaises(ValueError):
                v.write_package(tmp,payload,d,support={'branch':[[0,0,0]],'parent':[[6,0,0]]})
            support={'branch':path[:4],'parent':path[4:]}
            v.write_package(tmp,payload,d,support=support)
            v.verify_package(tmp,'a'*64)
            bad=copy.deepcopy(d);bad['connections'][0]['radiiMm'][3]=2.
            with self.assertRaises(ValueError):v.write_package(tmp,payload,bad,support=support)

    def test_exporter_rejects_source_hash_units_and_grid(self):
        export=v.module('s0028-vessels-export')
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'segmentations').mkdir()
            affine=np.diag([1.5,1.5,1.5,1.]);affine[:3,3]=[10,-20,-40]
            im=nib.Nifti1Image(np.full((9,9,9),110,np.int16),affine);im.header.set_xyzt_units('mm')
            nib.save(im,root/'ct.nii.gz')
            data=np.zeros((9,9,9),np.uint8);data[3:6,3:6,2:8]=1
            mask=nib.Nifti1Image(data,affine);mask.header.set_xyzt_units('mm')
            entries={}
            for name in export.SOURCE_NAMES:
                path=root/'segmentations'/f'{name}.nii.gz';nib.save(mask,path)
                entries[name]={'person':'s0028','path':str(path.relative_to(root)),'sha256':v.sha(path.read_bytes())}
            case={'person':'s0028','ctSha256':v.sha((root/'ct.nii.gz').read_bytes()),'shape':[9,9,9],
                  'affineRASmm':affine.tolist(),'rasToLASmm':np.diag([-1.,1.,1.,1.]).tolist(),
                  'pitchMm':1.5,'headerUnits':['mm','unknown'],'millimeterEvidence':'synthetic phantom',
                  'revision':'synthetic','masks':entries}
            ct,m,a,_=export.load(root,case)
            self.assertEqual(ct.shape,(9,9,9));self.assertEqual(a[0,0],-1.5)
            for key,value in [('ctSha256','0'*64),('person','other'),('pitchMm',3.),('headerUnits',['unknown','unknown'])]:
                with self.subTest(key=key),self.assertRaises(ValueError):export.load(root,{**case,key:value})
            other=copy.deepcopy(case);other['masks']['aorta']['sha256']='0'*64
            with self.assertRaises(ValueError):export.load(root,other)
            other=copy.deepcopy(case);other['affineRASmm'][0][3]+=1
            with self.assertRaises(ValueError):export.load(root,other)

    def test_rehashed_payload_with_another_las_position_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            out=Path(tmp);nodes=[{'p':[0.,0.,0.],'r':1.,'ijk':[0,0,0],'group':0,'certainty':'D'}]
            data,info=v.pack(nodes,[])
            d={'format':v.FORMAT,'person':'s0028','runtimeInstalled':False,'physicalFrameSha256':'a'*64,
               'affineRASmm':np.eye(4).tolist(),'rasToLASmm':np.diag([-1.,1.,1.,1.]).tolist(),'nativeShape':[2,2,2],
               'geometry':info,'groups':[{'id':'aorta','identityCertainty':'D','physiologyId':'aorta','nodeRange':[0,1],'edgeRange':[0,0]}],
               'baselineDownloadBytes':0}
            v.write_package(out,data,d)
            # Fraude con hash actualizado: un segundo registro oculto sigue fallando.
            nodes[0]['p'][0]=4.;data,info=v.pack(nodes,[])
            with self.assertRaisesRegex(ValueError,'registro LAS'):v.write_package(out,data,{**d,'geometry':info})


if __name__=='__main__': unittest.main()
