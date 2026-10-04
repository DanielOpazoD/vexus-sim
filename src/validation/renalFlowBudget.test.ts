import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import { PhysiologyEngine } from '../physiology/engine';
import { INTERLOBAR_FLOW_SHARE, VESSEL_IDS, VESSEL_META } from '../physiology/vessels';

describe('presupuesto de flujo renal y unidades Q/A', () => {
  for (const patient of [NORMAL_ADULT, SEVERE_CONGESTION]) {
    it(`${patient.id}: ramas y territorio omitido conservan flujo, incluido el retrógrado`, () => {
      const scene = new AnatomyScene(patient),
        areas = scene.vesselAreas();
      const e = new PhysiologyEngine(patient, areas);
      for (let i = 0; i < 4000; i++) e.step();
      for (let step = 0; step < 250; step++) {
        const s = e.step();
        if (step % 25) continue;
        for (const system of ['interlobarArtery', 'interlobarVein'] as const) {
          const branches = VESSEL_IDS.filter((id) => VESSEL_META[id].system === system);
          const total = system === 'interlobarArtery' ? s.qRenalArtery : s.qRenalVein;
          const right = total / 2;
          const fraction = branches.length * INTERLOBAR_FLOW_SHARE;
          expect(fraction).toBeGreaterThan(0);
          expect(fraction).toBeLessThan(1);
          let represented = 0;
          for (const id of branches) {
            // mm/s × mm² /1000 = mL/s. Reference areas, not a sampled point radius.
            const q = (s.velocities[id] * areas[id]) / 1000;
            expect(q).toBeCloseTo(right * INTERLOBAR_FLOW_SHARE, 10);
            expect(Math.sign(q)).toBe(Math.sign(right));
            represented += q;
          }
          expect(represented + right * (1 - fraction)).toBeCloseTo(right, 10);
        }
      }
    });
  }
});
