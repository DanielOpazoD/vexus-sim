import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import { PhysiologyEngine } from '../physiology/engine';
import { hepaticFlowShares } from '../physiology/vessels';

describe('tributarias suprahepáticas: presupuesto de caudal y velocidad', () => {
  it.each([NORMAL_ADULT, SEVERE_CONGESTION])('$id: no acelera el flujo periférico ni pierde la inversión real', (patient) => {
    const areas = new AnatomyScene(patient).vesselAreas();
    const shares = hepaticFlowShares(areas);
    const engine = new PhysiologyEngine(patient, areas);
    for (let i = 0; i < 7500; i++) engine.step();
    const signs = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const s = engine.step();
      signs.add(Math.sign(s.qHepaticVein));
      const flow = (id: keyof typeof shares) => (s.velocities[id] * areas[id] * s.hvRadiusScale ** 2) / 1000;
      expect(flow('hvRight') + flow('hvMiddle') + flow('hvLeft')).toBeCloseTo(s.qHepaticVein, 9);
      expect(flow('hvCommonTrunk')).toBeCloseTo(flow('hvMiddle') + flow('hvLeft'), 9);
      for (const [child, parent] of [
        ['hvRightAnterior', 'hvRight'],
        ['hvRightPosterior', 'hvRight'],
        ['hvMiddleTributary', 'hvMiddle'],
        ['hvLeftTributary', 'hvLeft'],
      ] as const) {
        // The old fixed shares made these 1.5–2.2 times faster than their collector.
        expect(Math.abs(s.velocities[child])).toBeLessThanOrEqual(Math.abs(s.velocities[parent]));
        expect(Math.sign(s.velocities[child])).toBe(Math.sign(s.qHepaticVein));
        expect(flow(child)).toBeCloseTo(s.qHepaticVein * shares[child], 9);
      }
    }
    expect(signs.has(1)).toBe(true);
    expect(signs.has(-1)).toBe(true);
    // Explicit tributaries plus the unresolved territory conserve each collector.
    for (const [parent, children] of [
      ['hvRight', ['hvRightAnterior', 'hvRightPosterior']],
      ['hvMiddle', ['hvMiddleTributary']],
      ['hvLeft', ['hvLeftTributary']],
    ] as const) {
      const represented = children.reduce((q, id) => q + shares[id], 0);
      expect(represented).toBeGreaterThan(0);
      expect(represented).toBeLessThan(shares[parent]);
    }
  });
});
