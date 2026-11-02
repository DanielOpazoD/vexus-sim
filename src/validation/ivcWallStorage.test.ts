import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { NORMAL_ADULT, TRICUSPID_REGURGITATION } from '../cases';
import { PhysiologyEngine } from '../physiology/engine';

describe('VCI: frontera de almacenamiento y luz (decisión 316)', () => {
  // ivc-wall-lag-not-in-network sigue vigente: el ensayo de pared única falla
  // respiración y patrones renales. Son negativos de la base, no una pared aceptada.
  // Al unir de verdad red y luz deben pasar y retirarse los marcadores .fails.
  for (const patient of [NORMAL_ADULT, TRICUSPID_REGURGITATION])
    it.fails(`${patient.id}: la elipse visible conserva el volumen abdominal en cada paso`, () => {
      const e = new PhysiologyEngine(patient, new AnatomyScene(patient).vesselAreas());
      for (let i = 0; i < 250; i++) {
        const s = e.step();
        const area = (Math.PI * s.ivc.dApMm * s.ivc.dLatMm) / 4;
        expect((area * e.network.k.ivcLengthMm) / 1000).toBeCloseTo(e.network.state.vIvc, 9);
      }
    });
});
