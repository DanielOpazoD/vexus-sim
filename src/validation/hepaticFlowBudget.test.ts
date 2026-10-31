import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import { PhysiologyEngine } from '../physiology/engine';
import { hepaticFlowShares } from '../physiology/vessels';

describe('suprahepáticas: velocidad del Doppler y reparto entre colectoras', () => {
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
      // El tronco común es la media y la izquierda; las colectoras no agotan el caudal de la red (decisión 299)
      expect(flow('hvCommonTrunk')).toBeCloseTo(flow('hvMiddle') + flow('hvLeft'), 9);
      expect(shares.hvRight + shares.hvMiddle + shares.hvLeft).toBeLessThan(1);
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

  it('sano: la S en el eje queda en lo publicado', () => {
    const peak = (respiratoryPattern: 'apnea-expiratory' | 'quiet') => {
      const patient = { ...NORMAL_ADULT, respiratoryPattern };
      const scene = new AnatomyScene(patient);
      const engine = new PhysiologyEngine(patient, scene.vesselAreas());
      for (let i = 0; i < 2500; i++) engine.step();
      const out = { hvRight: -Infinity, hvMiddle: -Infinity };
      for (let i = 0; i < 7500; i++) {
        const s = engine.step();
        for (const id of ['hvRight', 'hvMiddle'] as const) {
          const def = scene.vesselById.get(id)!;
          out[id] = Math.max(out[id], ((def.profileN + 2) / def.profileN) * (s.velocities[id] / 10));
        }
      }
      return out;
    };
    // Máximo anterógrado 23,1 ± 6,0 cm/s y ningún control > 40, en la derecha (Sudhamshu 2006, respiración normal); S 21 ± 1,9 en la media
    // (Teichgräber 1997, n = 25, inspiración intermedia, sin aclarar si es DE o error estándar): aquí, apnea, otra fase
    const apnea = peak('apnea-expiratory');
    expect(apnea.hvRight).toBeGreaterThan(23.1 - 6);
    expect(apnea.hvRight).toBeLessThan(23.1 + 6);
    expect(apnea.hvMiddle).toBeGreaterThan(21 - 1.9);
    expect(apnea.hvMiddle).toBeLessThan(21 + 1.9);
    expect(peak('quiet').hvRight).toBeLessThan(40);
  });
});
