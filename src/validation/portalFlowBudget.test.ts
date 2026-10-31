import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import { PhysiologyEngine } from '../physiology/engine';
import { portalFlowShares } from '../physiology/vessels';

describe('ramas portales: presupuesto de caudal y velocidad', () => {
  it.each([NORMAL_ADULT, SEVERE_CONGESTION])('$id: el tronco se reparte entre sus ramas y la periferia no acelera', (patient) => {
    const areas = new AnatomyScene(patient).vesselAreas();
    const shares = portalFlowShares(areas);
    const engine = new PhysiologyEngine(patient, areas);
    for (let i = 0; i < 7500; i++) engine.step();
    for (let i = 0; i < 500; i++) {
      const s = engine.step();
      const flow = (id: keyof typeof shares) => (s.velocities[id] * areas[id] * s.pvRadiusScale ** 2) / 1000;
      expect(flow('pvTrunk')).toBeCloseTo(s.qPortal, 9);
      expect(flow('pvRight') + flow('pvLeft')).toBeCloseTo(flow('pvTrunk'), 9);
      // La razón de máximos de los controles de Verma et al. 2023; con las fracciones fijas las derechas iban a 1,41 de su madre.
      for (const [child, parent, ratio] of [
        ['pvRightAnterior', 'pvRight', 0.84],
        ['pvRightPosterior', 'pvRight', 0.84],
        ['pvLeftLateral', 'pvLeft', 0.64],
        ['pvLeftMedial', 'pvLeft', 0.64],
      ] as const) {
        expect(Math.abs(s.velocities[parent])).toBeGreaterThan(0);
        expect(s.velocities[child] / s.velocities[parent]).toBeCloseTo(ratio, 9);
        expect(flow(child)).toBeCloseTo(s.qPortal * shares[child], 9);
      }
    }
    // Máximos de los controles de Verma et al. 2023, ± 1 DE, con centro = 1,5 × media: las ramas principales bajan respecto al tronco por su
    // área de referencia, un área efectiva algo mayor que la luz de sus nodos de origen (decisión 299)
    if (patient === NORMAL_ADULT) {
      const e = new PhysiologyEngine({ ...patient, respiratoryPattern: 'apnea-expiratory' }, areas);
      for (let i = 0; i < 2500; i++) e.step();
      const v = { pvTrunk: 0, pvRight: 0, pvLeft: 0 };
      for (let i = 0; i < 2500; i++) {
        const s = e.step();
        for (const id of ['pvTrunk', 'pvRight', 'pvLeft'] as const) v[id] = Math.max(v[id], (1.5 * s.velocities[id]) / 10);
      }
      for (const [id, mean, sd] of [
        ['pvTrunk', 25.41, 3.07],
        ['pvRight', 20.74, 3.26],
        ['pvLeft', 18.19, 3.76],
      ] as const) {
        expect(v[id], id).toBeGreaterThan(mean - sd);
        expect(v[id], id).toBeLessThan(mean + sd);
      }
    }
    // Las ramas representadas y el territorio sin representar completan cada rama principal.
    for (const [parent, children] of [
      ['pvRight', ['pvRightAnterior', 'pvRightPosterior']],
      ['pvLeft', ['pvLeftLateral', 'pvLeftMedial']],
    ] as const) {
      const represented = children.reduce((q, id) => q + shares[id], 0);
      expect(represented).toBeGreaterThan(0);
      expect(represented).toBeLessThan(shares[parent]);
    }
  });
});
