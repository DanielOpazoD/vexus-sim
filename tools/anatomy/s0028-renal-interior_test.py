"""Contrato sintético del exportador del interior renal P3 r4 (sin TAC ni datos de pacientes).

Fija el formato (nibble, bytes exactos que leerá la GPU, páginas de halves, lectura única por punto), la procedencia
(D/E/U, dominio, otros dueños, banda de cierre, seno = componente más profunda, puerta corticomedular), la EDT con la
caja acolchada y la reproducibilidad contra un hash fijado del fantasma.
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
# Hash del payload del fantasma por defecto (ruido entero determinista): cambia sólo si cambian reglas, parámetros o formato.
PHANTOM_PAYLOAD_SHA256 = 'ddd0753d9a9c0ce06884fa86c715cc76c99f958b2c6134ed5b096ab137459bd2'


def hashed_noise(shape, amplitude):
    """Ruido entero uniforme en [−amplitude, amplitude] por hash de índices en uint64: igual en cualquier versión de
    numpy y plataforma (sin RNG). Con amplitude 33 su SD es ≈ 19 HU, como el ruido por vóxel medido en s0028."""
    i, j, k = (a.astype(np.uint64) for a in np.indices(shape))
    h = (i*np.uint64(73856093)) ^ (j*np.uint64(19349663)) ^ (k*np.uint64(83492791))
    h = (h ^ (h >> np.uint64(13)))*np.uint64(0x9E3779B97F4A7C15)
    h ^= h >> np.uint64(29)
    return (h % np.uint64(2*amplitude+1)).astype(np.int64)-amplitude


def phantom(noise=0, delta=30, flat_hilum=False, hilum=True, dimples=True):
    """Riñón elipsoidal (vóxel 1,5 mm) con seno abierto hacia +x: corteza 165 HU, parénquima profundo 165−delta, grasa −100,
    pelvis líquida 15 HU, vaso 140 HU, un dueño ajeno de densidad grasa dentro de la cavidad y, en la cara lateral, dos
    concavidades someras rellenas de grasa (una < 3 mm y otra de unos 4,5 mm). `flat_hilum` corta el riñón por el plano
    de los labios hiliares (x = 8), que será la cara de la caja al recortar."""
    shape = (44, 38, 52)
    x, y, z = (np.indices(shape).astype(float).T-np.array([20, 19, 26.])).T
    outer = (x/14)**2+(y/12)**2+(z/18)**2 <= 1
    if flat_hilum:
        outer &= x <= 8
    cavity = ((x-4)/7.5)**2+(y/5.5)**2+(z/10)**2 <= 1
    channel = (x > 3) & (np.abs(y) <= 4) & (np.abs(z) <= 6)
    kidney = outer & ~cavity & ~channel if hilum else outer.copy()
    # Hoyuelos centrados en la superficie lateral (x < 0): radio 1,6 vóxeles (< 3 mm de hondo) y 4,2 (≈ 5 mm).
    surface = {(4, -9): -14*np.sqrt(1-(4/12)**2-(9/18)**2), (0, 8): -14*np.sqrt(1-(8/18)**2)}
    pits = {'shallow': (x-surface[4, -9])**2+(y-4)**2+(z+9)**2 <= 1.6**2,
            'moderate': (x-surface[0, 8])**2+y**2+(z-8)**2 <= 4.2**2}
    if dimples:
        for pit in pits.values():
            kidney &= ~pit
    sinus = outer & ~kidney & ~((x < 0) & ~cavity)
    hu = np.full(shape, -100)
    depth = renal.ndi.distance_transform_edt(outer)
    hu[kidney] = 165
    hu[kidney & (depth >= 6)] = 165-delta
    pelvis = sinus & (((x-2)**2+y**2+(z+2)**2) <= 3.3**2)
    vessel = sinus & (np.abs(y) <= 1) & (np.abs(z-4) <= 1) & (x > 0)
    hu[pelvis] = 15
    hu[vessel] = 140
    others = np.zeros(shape, bool)
    if hilum:
        others[cavity & ((x-6)**2+(y-2)**2+(z+6)**2 <= 1.5**2)] = True
    if noise:
        hu = hu+hashed_noise(shape, noise)
    return {'hu': hu.astype(np.float64), 'kidney': kidney, 'others': others, 'pelvis': pelvis, 'vessel': vessel,
            'deep': kidney & (depth >= 6), 'pits': pits}


def crop(case):
    """Caja = crop de la máscara (como el exportador): la envolvente toca las caras."""
    idx = np.argwhere(case['kidney'])
    sl = tuple(slice(a, b+1) for a, b in zip(idx.min(0), idx.max(0)))
    return {k: (v[sl] if isinstance(v, np.ndarray) else v) for k, v in case.items()}


class RenalInteriorContractTest(unittest.TestCase):
    def test_nibble_codes_bind_label_and_provenance(self):
        labels = np.array([[[0, 1, 2, 3, 4]]], np.uint8)
        prov = np.array([[[renal.U, renal.E, renal.E, renal.D, renal.D]]], np.uint8)
        codes = renal.encode(labels, prov)
        self.assertEqual(codes.ravel().tolist(), [0, 9, 10, 3, 4])
        back = renal.decode(codes)
        self.assertTrue(np.array_equal(back[0], labels) and np.array_equal(back[1], prov))
        for label, provenance in ((0, renal.D), (3, renal.U), (5, renal.D), (1, 1)):  # 1 = O: no es interior
            with self.subTest(label=label, provenance=provenance), self.assertRaises(ValueError):
                renal.encode(np.array([[[label]]], np.uint8), np.array([[[provenance]]], np.uint8))
        for invalid in (5, 6, 7, 8, 13, 14, 15):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                renal.decode(np.array([[[invalid]]], np.uint8))

    def test_payload_bytes_are_fixed_by_hand(self):
        # Caja 2×1×3 (x, y, z). Orden C con z más rápida: [9, 1, 3, 4, 0, 10]; vóxel par en el nibble bajo:
        # 9|1<<4 = 0x19 = 25, 3|4<<4 = 0x43 = 67, 0|10<<4 = 0xA0 = 160, cada byte como half exacto little-endian.
        labels = np.array([[[1, 1, 3]], [[4, 0, 2]]], np.uint8)
        prov = np.array([[[renal.E, renal.D, renal.D]], [[renal.D, renal.U, renal.E]]], np.uint8)
        codes = renal.encode(labels, prov)
        payload, info = renal.pack([codes])
        expected = bytes.fromhex('404e30540059')+bytes(4096-6)
        self.assertEqual(payload, expected)
        self.assertEqual(info['sha256'], hashlib.sha256(expected).hexdigest())
        self.assertEqual(info['boxes'], [{'dimensions': [2, 1, 3], 'pageBase': 0, 'pageCount': 1, 'byteCount': 3}])
        for node, code in (((0, 0, 0), 9), ((0, 0, 1), 1), ((0, 0, 2), 3), ((1, 0, 0), 4), ((1, 0, 1), 0), ((1, 0, 2), 10)):
            self.assertEqual(renal.lookup(payload, info, 0, node), code)
        self.assertTrue(np.array_equal(renal.unpack(payload, info, 0), codes))

    def test_pages_roundtrip_single_read_and_corruption(self):
        allowed = np.array([0, 1, 2, 3, 4, 9, 10, 11, 12], np.uint8)
        boxes = [allowed[np.abs(hashed_noise((5, 7, 9), 8))], allowed[np.abs(hashed_noise((3, 4, 6), 8))]]
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
        case = phantom(noise=33)
        kidney, others = case['kidney'], case['others']
        labels, prov, metrics, region = renal.annotate(case['hu'], kidney, others, 6.0)
        self.assertEqual(metrics['parenchyma']['decision'], 'E')
        self.assertEqual(set(np.unique(labels)), {0, 1, 2, 3, 4})
        self.assertTrue(np.all(prov[np.isin(labels, (1, 2))] == renal.E))
        self.assertTrue(np.all(prov[np.isin(labels, (3, 4))] == renal.D))
        self.assertTrue(np.all((labels == 0) == (prov == renal.U)))
        self.assertFalse(np.any((labels > 0) & ~(kidney | region['sinus'])))
        self.assertFalse(np.any((labels > 0) & others))
        self.assertFalse(np.any(region['sinus'] & others), 'el seno excluye toda otra máscara fuente')
        self.assertFalse(np.any((labels > 0) & region['band']))
        self.assertFalse(np.any(np.isin(labels, (1, 2)) & ~kidney))
        self.assertFalse(np.any(np.isin(labels, (3, 4)) & kidney))
        self.assertFalse(np.any((labels > 0) & case['vessel']), 'vaso realzado sin máscara: U')
        self.assertGreaterEqual((labels[case['pelvis'] & ~region['band']] == 4).mean(), 0.9)
        self.assertGreater(metrics['uReasons']['mouthBand'], 0)
        self.assertGreater(metrics['uReasons']['sinusVesselOrInterface'], 0)

    def test_sinus_is_the_deepest_cavity_component(self):
        case = phantom(noise=33)
        labels, _, metrics, region = renal.annotate(case['hu'], case['kidney'], case['others'], 6.0)
        self.assertGreaterEqual(metrics['cavityComponents'], 3)
        lab, _ = renal.ndi.label(region['sinus'], structure=renal.N26)
        self.assertEqual(lab.max(), 1, 'una sola componente: la que contiene el vóxel de cavidad más profundo')
        self.assertEqual(region['depth'][region['sinus']].max(), region['depth'][region['cavity']].max())
        for name, pit in case['pits'].items():
            with self.subTest(pit=name):  # dueños: ninguno; son concavidades de la cara lateral
                self.assertTrue(np.any(pit & region['cavity']))
                self.assertFalse(np.any(region['sinus'] & pit), 'concavidad somera: no es seno')
                self.assertFalse(np.any((labels > 0) & pit))
        self.assertGreaterEqual(region['depth'][case['pits']['moderate'] & region['cavity']].max(), 3.0)
        self.assertLess(region['depth'][case['pits']['shallow'] & region['cavity']].max(), 3.0)
        self.assertGreater(metrics['shallowConcavity']['fatVoxels'], 0)
        # Sin hilio y con un solo hoyuelo somero: la cavidad más profunda no llega a 3 mm y no hay seno.
        solid = phantom(noise=33, hilum=False, dimples=False)
        region = renal.sinus_region(solid['kidney'] & ~solid['pits']['shallow'], solid['others'], renal.PARAMS)
        self.assertTrue(np.any(region['cavity']))
        self.assertLess(region['depth'][region['cavity']].max(), 3.0)
        self.assertFalse(np.any(region['sinus']))

    def test_box_faces_are_exterior_for_depth(self):
        # La caja es el crop de la máscara: los labios hiliares y la boca están en la cara +x de la caja.
        case = crop(phantom(noise=33, flat_hilum=True, dimples=False))
        kidney, others = case['kidney'], case['others']
        region = renal.sinus_region(kidney, others, renal.PARAMS)
        face = np.zeros(kidney.shape, bool)
        face[-1] = True
        self.assertTrue(np.any(region['sinus'] & face))
        self.assertTrue(np.allclose(region['depth'][face & region['hull']], 1.5), 'a un vóxel del exterior')
        self.assertTrue(np.all(region['band'][region['sinus'] & face]))
        labels, _, _, region = renal.annotate(case['hu'], kidney, others, 6.0)
        self.assertFalse(np.any((labels > 0) & face & region['sinus']))
        # Parénquima hipoatenuante en el labio junto a la boca (cuatro capas, para que el núcleo suavizado lo vea; parche
        # pequeño para que la puerta siga en E): en la cara d_out = 1,5 mm, subcapsular → U, nunca médula. Sin acolchar,
        # d_out llega a 9 mm en ese labio y salía médula.
        X, Y, Z = np.indices(kidney.shape)
        cy, cz = np.argwhere(kidney).mean(0)[1:].round().astype(int)
        patch = kidney & (X >= kidney.shape[0]-4) & (np.abs(Y-cy) <= 4) & (Z-cz >= 7) & (Z-cz <= 10)
        hu = case['hu'].copy()
        hu[patch] = 120
        labels, _, metrics, _ = renal.annotate(hu, kidney, others, 6.0)
        self.assertEqual(metrics['parenchyma']['decision'], 'E')
        self.assertGreater(metrics['uReasons']['subcapsularLow'], 0)
        self.assertTrue(np.any(patch & face))
        self.assertFalse(np.any((labels == 2) & patch & face))

    def test_deepest_not_largest_cavity_is_sinus(self):
        # Seno pequeño y hondo con hilio estrecho; concavidad anterior ancha y somera, mayor en volumen: el seno es la
        # componente con el vóxel más profundo, no la más grande.
        shape = (44, 38, 52)
        x, y, z = (np.indices(shape).astype(float).T-np.array([20, 19, 26.])).T
        outer = (x/14)**2+(y/12)**2+(z/18)**2 <= 1
        sinus = (x**2+y**2+z**2 <= 2.5**2) | ((x > 0) & (np.abs(y) <= 1) & (np.abs(z) <= 1))
        dent = x**2+(y-(12+40-4.5))**2+z**2 <= 40**2
        region = renal.sinus_region(outer & ~sinus & ~dent, np.zeros(shape, bool), renal.PARAMS)
        lab, n = renal.ndi.label(region['cavity'], structure=renal.N26)
        sizes = np.bincount(lab.ravel())[1:]
        largest = lab == np.argmax(sizes)+1
        self.assertTrue(np.any(largest & dent), 'precondición: la concavidad es la componente mayor')
        self.assertFalse(np.any(region['sinus'] & dent))
        self.assertTrue(np.all(region['sinus'][(x**2+y**2+z**2 <= 2.5**2) & region['cavity']]))
        self.assertGreater(region['depth'][region['sinus']].max(), region['depth'][largest].max())

    def test_side_inputs_place_every_other_owner(self):
        case = phantom(noise=33)
        ct = case['hu']
        idx = np.argwhere(case['kidney'])
        lo, hi = idx.min(0), idx.max(0)+1
        invader = np.zeros(ct.shape, bool)
        invader[lo[0]+20:hi[0]+5, lo[1]+14:lo[1]+18, lo[2]+20:lo[2]+26] = True  # cruza la cara de la caja

        def crop_of(mask):
            i = np.argwhere(mask)
            a, b = i.min(0), i.max(0)+1
            return a, mask[tuple(slice(x, y) for x, y in zip(a, b))]
        distant = np.zeros(ct.shape, bool)
        distant[0:2, 0:2, 0:2] = True
        masks = {'kidney_right': crop_of(case['kidney']), 'duodenum': crop_of(invader), 'cyst': crop_of(case['others']),
                 'far': crop_of(distant)}
        box_lo, kidney, others, hu = renal.side_inputs(ct, masks, 'kidney_right')
        box = tuple(slice(a, b) for a, b in zip(lo, hi))
        self.assertTrue(np.array_equal(box_lo, lo))
        self.assertTrue(np.array_equal(kidney, case['kidney'][box]))
        self.assertTrue(np.array_equal(hu, ct[box]))
        self.assertTrue(np.array_equal(others, (invader | case['others'] | distant)[box]))
        self.assertTrue(np.any(others & kidney) and np.any(others & ~kidney))
        labels, _, metrics, region = renal.annotate(hu, kidney, others, 6.0)
        self.assertFalse(np.any((labels > 0) & others))
        self.assertFalse(np.any(region['sinus'] & others))
        self.assertEqual(metrics['uReasons']['otherOwnerInMask'], int((kidney & others).sum()))

    def test_corticomedullary_gate(self):
        case = phantom(noise=33, delta=0)
        labels, prov, metrics, _ = renal.annotate(case['hu'], case['kidney'], case['others'], 6.0)
        self.assertEqual(metrics['parenchyma']['decision'], 'U')
        self.assertFalse(np.any(np.isin(labels, (1, 2))), 'sin contraste medular, parénquima U')
        self.assertTrue(np.any(labels == 3))
        # Parénquima hipoatenuante bajo la cápsula lateral: contradice la hipótesis medular y queda U, nunca médula.
        case = phantom(noise=2, delta=40)
        kidney, hu = case['kidney'], case['hu'].copy()
        x = np.indices(hu.shape)[0]
        patch = kidney & (x <= x[kidney].min()+3) & (np.abs(np.indices(hu.shape)[2]-26) <= 3)
        hu[patch] = 120
        labels, _, metrics, region = renal.annotate(hu, kidney, case['others'], 1.0)
        self.assertGreater(metrics['uReasons']['subcapsularLow'], 0)
        self.assertFalse(np.any((labels == 2) & patch & (region['depth'] < 3.0)))
        case = phantom(noise=2, delta=40)
        labels, prov, metrics, _ = renal.annotate(case['hu'], case['kidney'], case['others'], 1.0)
        self.assertEqual(metrics['parenchyma']['decision'], 'D')
        self.assertTrue(np.all(prov[np.isin(labels, (1, 2))] == renal.D))
        # La médula sigue al parénquima profundo del fantasma (no a la profundidad supuesta): Dice ≥ 0,9.
        medulla, deep = labels == 2, case['deep']
        self.assertGreaterEqual(2*(medulla & deep).sum()/(medulla.sum()+deep.sum()), 0.9)

    def test_thin_fat_uses_raw_hu(self):
        # Un septo graso de un vóxel entre orina y realce es grasa por su HU crudo, aunque su entorno suavizado no lo sea.
        case = phantom()
        region = renal.sinus_region(case['kidney'], case['others'], renal.PARAMS)
        inner = region['sinus'] & ~region['band']
        y = np.indices(case['hu'].shape)[1]
        hu = case['hu'].copy()
        hu[inner & (y < 19)] = 15
        hu[inner & (y > 19)] = 140
        septum = inner & (y == 19)
        hu[septum] = -100
        labels, prov, _, _ = renal.annotate(hu, case['kidney'], case['others'], 6.0)
        self.assertTrue(np.any(septum))
        self.assertTrue(np.all(labels[septum] == 3) and np.all(prov[septum] == renal.D))

    def test_interface_partial_volume_is_not_collecting_system(self):
        case = phantom()
        region = renal.sinus_region(case['kidney'], case['others'], renal.PARAMS)
        inner = region['sinus'] & ~region['band']
        y = np.indices(case['hu'].shape)[1]
        ymid = int(np.median(np.argwhere(inner)[:, 1]))
        hu2 = case['hu'].copy()
        hu2[inner & (y < ymid)] = -100
        hu2[inner & (y > ymid)] = 140
        sheet = inner & (y == ymid)
        hu2[sheet] = 20
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

    def test_reproducible_bytes_against_pinned_hash(self):
        case = phantom(noise=33)
        a = renal.annotate(case['hu'], case['kidney'], case['others'], 6.0)
        payload, info = renal.pack([renal.encode(a[0], a[1])])
        self.assertEqual(info['sha256'], PHANTOM_PAYLOAD_SHA256)
        b = renal.annotate(case['hu'].copy(), case['kidney'].copy(), case['others'].copy(), 6.0)
        self.assertEqual(renal.pack([renal.encode(b[0], b[1])])[0], payload)
        digest = renal.parameters_digest(renal.PARAMS)
        self.assertEqual(digest, renal.parameters_digest(copy.deepcopy(renal.PARAMS)))
        changed = copy.deepcopy(renal.PARAMS)
        changed['fatHU'] = [-190, -20]
        self.assertNotEqual(digest, renal.parameters_digest(changed))
        self.assertEqual(renal.PARAMS['fatHU'], [-190, -30])
        self.assertEqual(renal.PARAMS['sinus']['minDepthMm'], 3.0)
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
        case = phantom(noise=33)
        kidney, others = case['kidney'], case['others']
        labels, prov, _, region = renal.annotate(case['hu'], kidney, others, 6.0)
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
