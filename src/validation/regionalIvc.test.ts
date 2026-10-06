import { describe, expect, it } from 'vitest';
import { AnatomyScene, vesselApScale } from '../anatomy/scene';
import { AnatomyQuery } from '../anatomy/query';
import { venousExperimentPatient } from '../app/venousExperiment';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import { PhysiologyEngine, nonFiniteFields } from '../physiology/engine';
import { supraIvcAreaMm2, supraIvcSection } from '../physiology/supraIvc';

describe('regional cava area before velocity and rendering', () => {
  it('has monotonic pressure response and preserves ellipse area through flattening', () => {
    let previous = 0;
    for (const ptm of [-30, -10, -5, 0, 4, 10, 20, 40]) {
      const area = supraIvcAreaMm2(ptm);
      const s = supraIvcSection(area);
      expect(area).toBeGreaterThanOrEqual(previous);
      expect((Math.PI * s.dApMm * s.dLatMm) / 4).toBeCloseTo(area, 10);
      expect(s.dApMm).toBeLessThanOrEqual(s.dLatMm);
      previous = area;
    }
  });
  it('uses the actual regional ellipse in CPU, GPU packing and 3D rather than the abdominal area', () => {
    for (const patient of [NORMAL_ADULT, SEVERE_CONGESTION]) {
      const scene = new AnatomyScene(patient);
      const engine = new PhysiologyEngine(patient, scene.vesselAreas());
      const query = new AnatomyQuery(scene);
      for (let i = 0; i < 1500; i++) engine.step();
      const s = engine.sample;
      const cal = query.caliberFor(s);
      const vessel = scene.vesselById.get('ivcSupra')!;
      const radius = vessel.refRadius * cal.radiusScale('ivcSupra');
      const ap = vesselApScale('ivcSupra', vessel.tube.apScale, cal);
      const geometryArea = Math.PI * radius * radius * ap;
      expect(geometryArea).toBeCloseTo((Math.PI * s.ivcSupra!.dApMm * s.ivcSupra!.dLatMm) / 4, 9);
      expect((s.velocities.ivcSupra * geometryArea) / 1000).toBeCloseTo(s.qHepaticVein + s.qIvcToRa, 9);
      expect(vesselApScale('ivcInfra', 0.8, cal)).toBe(s.ivc.dApMm / s.ivc.dLatMm);
      expect(vesselApScale('pvTrunk', 0.73, cal)).toBe(0.73);
      expect(nonFiniteFields({ ...s, ivcSupra: { ...s.ivcSupra!, dLatMm: Infinity } })).toEqual(['ivcSupra.dLatMm']);
    }
  });
  it('reproduces the 19 m/s counterfactual and resolves it using regional Q/A without clipping', () => {
    const p = venousExperimentPatient({
      heartRateBpm: 50,
      rapMeanMmHg: 2,
      intraAbdominalPressureMmHg: 25,
      rvFunction: 1,
      tricuspidRegurgitation: 0,
      raCompliance: 0.3,
      venousReservoirCompliance: 2,
    });
    const e = new PhysiologyEngine(p, new AnatomyScene(p).vesselAreas());
    let legacyPeak = 0,
      regionalPeak = 0;
    for (let i = 0; i < 7500; i++) {
      const s = e.step();
      if (s.t < 24) continue;
      const q = (s.qHepaticVein + s.qIvcToRa) * 1000;
      const legacyArea = (Math.PI * s.ivc.dApMm * s.ivc.dLatMm) / 4;
      const regionalArea = (Math.PI * s.ivcSupra!.dApMm * s.ivcSupra!.dLatMm) / 4;
      legacyPeak = Math.max(legacyPeak, Math.abs(q / legacyArea));
      regionalPeak = Math.max(regionalPeak, Math.abs(s.velocities.ivcSupra));
      expect(s.velocities.ivcSupra).toBeCloseTo(q / regionalArea, 9);
    }
    expect(legacyPeak).toBeGreaterThan(19000);
    expect(regionalPeak).toBeGreaterThan(1000);
    expect(regionalPeak).toBeLessThan(2000);
  });
});
