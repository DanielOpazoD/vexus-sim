"""Contrato sintético del exportador del interior renal P3 r4 (sin TAC ni datos de pacientes).

Fija el formato (nibble, páginas de halves exactos, lectura única por punto), la procedencia (D/E/U, dominio,
otros dueños, banda de cierre, puerta corticomedular) y la reproducibilidad (mismos bytes, digest de parámetros).
"""
import copy
import hashlib
import importlib.util
from pathlib import Path
import unittest

import numpy as np

spec = importlib.util.spec_from_file_location('renal_interior', Path(__file__).with_name('s0028-renal-interior.py'))
renal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renal)


def phantom(noise=0.0, delta=30.0, seed=7):
    """Riñón elipsoidal con seno abierto hacia +x (hilio): corteza 165 HU, parénquima profundo 165−delta, grasa −100,
    pelvis líquida 15 HU, vaso 140 HU y un dueño ajeno (quiste) dentro de la cavidad. Vóxel = 1,5 mm."""
    shape = (44, 38, 52)
    x, y, z = (np.indices(shape).astype(float).T - np.array([20, 19, 26.])).T
    outer = (x/14)**2+(y/12)**2+(z/18)**2 <= 1
    cavity = ((x-4)/7.5)**2+(y/5.5)**2+(z/10)**2 <= 1
    channel = (x > 3) & (np.abs(y) <= 4) & (np.abs(z) <= 6)
    kidney = outer & ~cavity & ~channel
    sinus = outer & ~kidney
    hu = np.full(shape, -100.)
    depth = renal.ndi.distance_transform_edt(outer)
    hu[kidney] = 165.
    hu[kidney & (depth >= 6)] = 165.-delta
    pelvis = ((x-2)**2+y**2+(z+2)**2) <= 3.3**2
    vessel = (np.abs(y) <= 1) & (np.abs(z-4) <= 1) & (x > 0) & sinus
    hu[pelvis & sinus] = 15.
    hu[vessel] = 140.
    others = np.zeros(shape, bool)
    others[cavity & ((x-6)**2+(y-2)**2+(z-6)**2 <= 1.5**2)] = True
    hu[others] = -100.  # dueño ajeno de densidad grasa: si no se excluyera, saldría seno graso
    if noise:
        hu = hu+np.random.default_rng(seed).normal(0, noise, shape)
    return hu, kidney, others, pelvis & sinus, vessel, kidney & (depth >= 6)


class RenalInteriorContractTest(unittest.TestCase):
    def test_nibble_codes_bind_label_and_provenance(self):
        labels = np.array([[[0, 1, 2, 3, 4]]], np.uint8)
        prov = np.array([[[renal.U, renal.E, renal.E, renal.D, renal.D]]], np.uint8)
        codes = renal.encode(labels, prov)
        self.assertEqual(codes.ravel().tolist(), [0, 9, 10, 3, 4])
        back = renal.decode(codes)
        self.assertTrue(np.array_equal(back[0], labels) and np.array_equal(back[1], prov))
        for bad in ([[[0]]], [[[3]]]):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                renal.encode(np.array(bad, np.uint8), np.array([[[renal.D if bad == [[[0]]] else renal.U]]], np.uint8))
        with self.assertRaises(ValueError):
            renal.encode(np.array([[[5]]], np.uint8), np.array([[[renal.D]]], np.uint8))
        with self.assertRaises(ValueError):
            renal.encode(np.array([[[1]]], np.uint8), np.array([[[1]]], np.uint8))  # O no es interior
        for invalid in (5, 6, 7, 8, 13, 14, 15):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                renal.decode(np.array([[[invalid]]], np.uint8))

    def test_pages_roundtrip_single_read_and_corruption(self):
        rng = np.random.default_rng(3)
        allowed = np.array([0, 1, 2, 3, 4, 9, 10, 11, 12], np.uint8)
        boxes = [allowed[rng.integers(0, 9, (5, 7, 9))], allowed[rng.integers(0, 9, (3, 4, 6))]]
        payload, info = renal.pack(boxes)
        self.assertEqual(len(payload) % 4096, 0)
        self.assertEqual([b['pageBase'] for b in info['boxes']], [0, 1])
        for i, box in enumerate(boxes):
            self.assertTrue(np.array_equal(renal.unpack(payload, info, i), box))
            for node in np.argwhere(np.ones(box.shape, bool))[::7]:
                self.assertEqual(renal.lookup(payload, info, i, node), int(box[tuple(node)]))
            self.assertIsNone(renal.lookup(payload, info, i, [box.shape[0], 0, 0]))
            self.assertIsNone(renal.lookup(payload, info, i, [0, -1, 0]))
        corrupt = bytearray(payload)
        corrupt[10] ^= 1
        with self.assertRaises(ValueError):
            renal.unpack(bytes(corrupt), info, 0)
        halves = np.frombuffer(payload, '<f2').copy()
        halves[info['boxes'][0]['byteCount']] = 1  # relleno de página no nulo
        forged = halves.tobytes()
        with self.assertRaises(ValueError):
            renal.unpack(forged, {**info, 'sha256': hashlib.sha256(forged).hexdigest()}, 0)
        halves = np.frombuffer(payload, '<f2').copy()
        halves[0] = 0.5  # half no entero
        forged = halves.tobytes()
        with self.assertRaises(ValueError):
            renal.unpack(forged, {**info, 'sha256': hashlib.sha256(forged).hexdigest()}, 0)
        with self.assertRaises(ValueError):
            renal.pack([np.full((2, 2, 2), 7, np.uint8)])

    def test_annotation_domain_and_provenance(self):
        hu, kidney, others, pelvis, vessel, _ = phantom(noise=19.0)
        labels, prov, metrics, region = renal.annotate(hu, kidney, others, 6.0)
        self.assertEqual(metrics['parenchyma']['decision'], 'E')
        self.assertTrue(set(np.unique(labels)) == {0, 1, 2, 3, 4})
        self.assertTrue(np.all(prov[np.isin(labels, (1, 2))] == renal.E))
        self.assertTrue(np.all(prov[np.isin(labels, (3, 4))] == renal.D))
        self.assertTrue(np.all((labels == 0) == (prov == renal.U)))
        self.assertFalse(np.any((labels > 0) & ~(kidney | region['sinus'])))
        self.assertFalse(np.any((labels > 0) & others))
        self.assertFalse(np.any(region['sinus'] & others), 'el seno excluye toda otra máscara fuente')
        self.assertFalse(np.any((labels > 0) & region['band']))
        self.assertFalse(np.any(np.isin(labels, (1, 2)) & ~kidney))
        self.assertFalse(np.any(np.isin(labels, (3, 4)) & kidney))
        self.assertFalse(np.any((labels > 0) & vessel), 'vaso realzado sin máscara: U')
        inner_pelvis = pelvis & ~region['band']
        self.assertGreaterEqual((labels[inner_pelvis] == 4).mean(), 0.9)
        self.assertGreater(metrics['uReasons']['mouthBand'], 0)
        self.assertGreater(metrics['uReasons']['sinusVesselOrInterface'], 0)

    def test_corticomedullary_gate(self):
        hu, kidney, others, _, _, _ = phantom(noise=19.0, delta=0.0)
        labels, prov, metrics, _ = renal.annotate(hu, kidney, others, 6.0)
        self.assertEqual(metrics['parenchyma']['decision'], 'U')
        self.assertFalse(np.any(np.isin(labels, (1, 2))), 'sin contraste medular, parénquima U')
        self.assertTrue(np.any(labels == 3))
        # Parénquima hipoatenuante bajo la cápsula: contradice la hipótesis medular y queda U, nunca médula.
        hu, kidney, others, _, _, _ = phantom(noise=2.0, delta=40.0)
        x = np.indices(hu.shape)[0]
        patch = kidney & (x <= x[kidney].min()+3) & (np.abs(np.indices(hu.shape)[2]-26) <= 3)
        hu[patch] = 120.
        labels, _, metrics, _ = renal.annotate(hu, kidney, others, 1.0)
        self.assertGreater(metrics['uReasons']['subcapsularLow'], 0)
        self.assertFalse(np.any((labels == 2) & patch & (renal.ndi.distance_transform_edt(np.pad(kidney, 1))[1:-1, 1:-1, 1:-1] < 2)))
        hu, kidney, others, _, _, deep = phantom(noise=2.0, delta=40.0)
        labels, prov, metrics, _ = renal.annotate(hu, kidney, others, 1.0)
        self.assertEqual(metrics['parenchyma']['decision'], 'D')
        self.assertTrue(np.all(prov[np.isin(labels, (1, 2))] == renal.D))
        # La médula sigue al parénquima profundo del fantasma (no a la profundidad supuesta): Dice ≥ 0,9.
        medulla = labels == 2
        self.assertGreaterEqual(2*(medulla & deep).sum()/(medulla.sum()+deep.sum()), 0.9)

    def test_interface_partial_volume_is_not_collecting_system(self):
        hu, kidney, others, _, _, _ = phantom()
        region = renal.sinus_region(kidney, others, renal.PARAMS)
        inner = region['sinus'] & ~region['band']
        sheet = np.zeros(hu.shape, bool)
        idx = np.argwhere(inner)
        ymid = int(np.median(idx[:, 1]))
        hu2 = hu.copy()
        hu2[inner & (np.indices(hu.shape)[1] < ymid)] = -100.
        hu2[inner & (np.indices(hu.shape)[1] > ymid)] = 140.
        sheet[inner & (np.indices(hu.shape)[1] == ymid)] = True
        hu2[sheet] = 20.
        candidates = inner & ~((hu2 >= -190) & (hu2 <= -30))
        lumen, _ = renal.collecting_lumen(hu2, candidates, renal.PARAMS)
        self.assertFalse(np.any(lumen & sheet), 'borde grasa/realce de volumen parcial: U')
        # Regla de borde por sí sola: un vóxel líquido que toca grasa y realce en su vecindad 26 no es luz, aunque su
        # HU suavizado (sólo vóxeles no grasos) siga en la ventana; sin la regla pasaría: la prueba detecta esa regresión.
        block = np.full((9, 9, 9), 20.)
        block[4, 4, 3], block[4, 4, 5] = -100., 140.
        weights = block > -30
        strict = renal.collecting_lumen(block, weights, renal.PARAMS)[0]
        loose = copy.deepcopy(renal.PARAMS)
        loose['collecting']['interfaceLowHU'] = -1000
        self.assertFalse(strict[4, 4, 4])
        self.assertTrue(renal.collecting_lumen(block, weights, loose)[0][4, 4, 4])
        self.assertTrue(strict[0, 0, 0], 'el resto del bloque líquido sigue siendo luz')
        # Un pico aislado fuera del HU crudo líquido (ruido o realce puntual) queda U aunque su entorno sea luz.
        spike = np.full((9, 9, 9), 20.)
        spike[4, 4, 4] = 100.
        self.assertFalse(renal.collecting_lumen(spike, spike > -30, renal.PARAMS)[0][4, 4, 4])
        wide = copy.deepcopy(renal.PARAMS)
        wide['collecting']['rawHU'] = [-40, 1000]
        self.assertTrue(renal.collecting_lumen(spike, spike > -30, wide)[0][4, 4, 4])

    def test_reproducible_bytes_and_parameter_digest(self):
        hu, kidney, others, _, _, _ = phantom(noise=19.0)
        a = renal.annotate(hu, kidney, others, 6.0)
        b = renal.annotate(hu.copy(), kidney.copy(), others.copy(), 6.0)
        self.assertTrue(np.array_equal(a[0], b[0]) and np.array_equal(a[1], b[1]))
        pa, ia = renal.pack([renal.encode(a[0], a[1])])
        pb, ib = renal.pack([renal.encode(b[0], b[1])])
        self.assertEqual(pa, pb)
        self.assertEqual(ia['sha256'], ib['sha256'])
        digest = renal.parameters_digest(renal.PARAMS)
        self.assertEqual(digest, renal.parameters_digest(copy.deepcopy(renal.PARAMS)))
        changed = copy.deepcopy(renal.PARAMS)
        changed['fatHU'] = [-190, -20]
        self.assertNotEqual(digest, renal.parameters_digest(changed))
        self.assertEqual(renal.PARAMS['fatHU'], [-190, -30])
        self.assertEqual(renal.PARAMS['labels'], ['U', 'cortex', 'medulla', 'sinusFat', 'collectingSystem'])

    def test_box_is_the_unpadded_p1_field_on_the_same_lattice(self):
        origin = np.array([-219.48527431275116, -230.21478450019774, -395.98879268882285])
        lo, shape = np.array([94, 114, 149]), (41, 41, 56)
        field = {'name': 'kidneyRight', 'pitchMm': 1.5, 'originMm': (origin+(lo-6)*1.5).tolist(), 'dimensions': [53, 53, 68]}
        frame = renal.box_frame(field, origin, lo, shape)
        self.assertEqual(frame['nodeOffset'], [6, 6, 6])
        self.assertTrue(np.allclose(frame['originMm'], origin+lo*1.5))
        for bad in ({**field, 'originMm': (origin+(lo-6)*1.5+0.75).tolist()}, {**field, 'dimensions': [53, 53, 67]},
                    {**field, 'pitchMm': 3.0}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                renal.box_frame(bad, origin, lo, shape)

    def test_invariants_reject_out_of_contract_annotations(self):
        hu, kidney, others, _, _, _ = phantom(noise=19.0)
        labels, prov, _, region = renal.annotate(hu, kidney, others, 6.0)
        args = (kidney, others, region['sinus'], region['band'])
        cases = []
        bad = prov.copy(); bad[labels == 3] = renal.E; cases.append((labels, bad))
        bad_l = labels.copy(); bad_p = prov.copy(); spot = tuple(np.argwhere(~kidney & ~region['sinus'])[0])
        bad_l[spot] = 1; bad_p[spot] = renal.E; cases.append((bad_l, bad_p))
        bad_l = labels.copy(); bad_p = prov.copy(); spot = tuple(np.argwhere(others)[0])
        bad_l[spot] = 3; bad_p[spot] = renal.D; cases.append((bad_l, bad_p))
        bad_l = labels.copy(); bad_p = prov.copy(); spot = tuple(np.argwhere(region['band'])[0])
        bad_l[spot] = 3; bad_p[spot] = renal.D; cases.append((bad_l, bad_p))
        bad_p = prov.copy(); spot = tuple(np.argwhere(labels == 1)[0]); bad_p[spot] = renal.D; cases.append((labels, bad_p))
        bad_l = labels.copy(); spot = tuple(np.argwhere(labels == 3)[0]); bad_l[spot] = 1; cases.append((bad_l, prov))
        for i, (l, p) in enumerate(cases):
            with self.subTest(case=i), self.assertRaises(ValueError):
                renal.require_annotation(l, p, *args)


if __name__ == '__main__':
    unittest.main()
