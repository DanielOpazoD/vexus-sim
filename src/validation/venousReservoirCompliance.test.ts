import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { CASES, NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import { PhysiologyEngine, nonFiniteFields } from '../physiology/engine';
import { validatePatient } from '../physiology/patientState';
import { defaultNetworkParams, VenousNetwork } from '../physiology/venousNetwork';

const initial = { pSplanchnic: 10, pHepatic: 2, pLowerBody: 8, pIvcTransmural: 3 };
describe('compliance de reservorios venosos: ley volumen-presión', () => {
  it('el factor solo cambia los dos reservorios, sin confundir órganos, AD, VCI o resistencias', () => {
    const base = defaultNetworkParams(NORMAL_ADULT);
    for (const factor of [0.5, 1, 2]) {
      const p = { ...NORMAL_ADULT, venousReservoirCompliance: factor };
      validatePatient(p);
      const k = defaultNetworkParams(p);
      expect(k).toEqual({ ...base, cSplanchnic: base.cSplanchnic * factor, cLowerBody: base.cLowerBody * factor });
      const n = new VenousNetwork(k, initial);
      const before = n.evaluate(0, 5, 5);
      n.state.vSplanchnic += 20;
      n.state.vLowerBody += 20;
      const after = n.evaluate(0, 5, 5);
      expect(after.pSplanchnic - before.pSplanchnic).toBeCloseTo(20 / k.cSplanchnic, 12);
      expect(after.pLowerBody - before.pLowerBody).toBeCloseTo(20 / k.cLowerBody, 12);
    }
  });
  it('el volumen desplazado coincide con la suma de compartimentos, sin normalizar caudales', () => {
    const moved = [];
    for (const factor of [0.5, 1, 2]) {
      const n = new VenousNetwork(defaultNetworkParams({ ...NORMAL_ADULT, venousReservoirCompliance: factor }), initial);
      const volume = () => n.state.vSplanchnic + n.state.vHepatic + n.state.vLowerBody + n.state.vIvc + n.state.vRenal;
      const before = volume();
      moved.push(n.shiftVenousPressures(0.25));
      expect(volume() - before).toBeCloseTo(moved.at(-1)!, 10);
    }
    expect(moved[2] - moved[0]).toBeCloseTo((40 + 60) * (2 - 0.5) * 0.25, 10);
  });
  it('el parámetro omitido y factor uno producen exactamente la misma trayectoria de cada caso', () => {
    for (const p of CASES) {
      const a = new PhysiologyEngine(p, new AnatomyScene(p).vesselAreas());
      const withFactor = { ...p, venousReservoirCompliance: 1 };
      const b = new PhysiologyEngine(withFactor, new AnatomyScene(withFactor).vesselAreas());
      for (let i = 0; i < 500; i++) expect(a.step()).toEqual(b.step());
    }
  });
  it('rechaza dominios inválidos sin recortar el parámetro', () => {
    for (const value of [0, -1, 0.49, 2.01, NaN, Infinity])
      expect(() => validatePatient({ ...NORMAL_ADULT, venousReservoirCompliance: value })).toThrow(/venousReservoirCompliance/);
  });
  for (const base of [NORMAL_ADULT, SEVERE_CONGESTION])
    it(`${base.id}: a igual bolo, menor compliance aumenta más la PAD del lazo`, () => {
      const deltas: number[] = [];
      const volumes: number[] = [];
      for (const factor of [0.5, 1, 2]) {
        const p = { ...base, respiratoryPattern: 'apnea-expiratory' as const, venousReservoirCompliance: factor };
        const e = new PhysiologyEngine(p, new AnatomyScene(p).vesselAreas());
        for (let i = 0; i < 7500; i++) e.step();
        const before = e.circulation.state.rapMeanMmHg;
        expect(before).toBe(base.rapMeanMmHg); // Independent scenarios retain their specified basal operating point.
        expect(e.intervene({ kind: 'bolus', volumeMl: 250 })).not.toBeNull();
        for (let i = 0; i < 7500; i++) e.step();
        expect(nonFiniteFields(e.sample)).toEqual([]);
        deltas.push(e.circulation.state.rapMeanMmHg - before);
        volumes.push(e.circulation.state.fluidDeltaMl);
      }
      expect(volumes[0]).toBe(volumes[1]);
      expect(volumes[1]).toBe(volumes[2]);
      expect(deltas[0]).toBeGreaterThan(deltas[1]);
      expect(deltas[1]).toBeGreaterThan(deltas[2]);
      expect(deltas[2]).toBeGreaterThan(0);
    });
});
