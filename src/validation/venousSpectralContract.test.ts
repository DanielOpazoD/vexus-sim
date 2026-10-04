import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { AnatomyQuery } from '../anatomy/query';
import { CASES, NORMAL_ADULT } from '../cases';
import { PhysiologyEngine } from '../physiology/engine';
import { VenousSpectralAcquisition } from '../doppler/venousSpectral';
import { measureObservedHepatic, measureObservedPortal, measureObservedRenal } from '../doppler/spectralMeasure';
import { captureProtocolVessel } from '../doppler/capture';
import { VENOUS_COMPARISON_CHANNELS } from '../physiology/venousComparison';
import { prfFromNyquistCms } from '../core/units';
import { VESSEL_META } from '../physiology/vessels';

describe('contratos de adquisición PW comparada', () => {
  it('encuentra cada territorio y conserva tres ventanas fijas sin mover el paciente observado', () => {
    for (const patient of CASES) {
      const scene = new AnatomyScene(patient),
        anatomy = new AnatomyQuery(scene),
        engine = new PhysiologyEngine(patient, scene.vesselAreas());
      const source = JSON.stringify({ vessels: scene.vessels, bowel: scene.bowelRadii });
      const a = new VenousSpectralAcquisition(anatomy, engine.sample, patient.seed, patient);
      expect(a.materialCenters).toHaveLength(3);
      const centers = [0, 1, 2].map((i) => a.gate(i, engine.sample).center);
      for (const [i, system] of ['hepaticVein', 'portal', 'interlobarVein'].entries()) {
        expect(a.gateInfo[i].vessel).not.toBeNull();
        expect(VESSEL_META[a.gateInfo[i].vessel!].system).toBe(system);
      }
      for (let cycle = 0; cycle < 4; cycle++) {
        for (const i of [0, 1, 2]) {
          const gate = a.gate(i, engine.sample);
          expect(gate.center).toEqual(centers[i]);
          expect(Number.isFinite(gate.transmission)).toBe(true);
          expect(gate.transmission).toBeGreaterThanOrEqual(0);
          expect(gate.transmission).toBeLessThanOrEqual(1);
        }
        for (let step = 0; step < 500; step++) engine.step();
      }
      expect(JSON.stringify({ vessels: scene.vessels, bowel: scene.bowelRadii })).toBe(source);
      expect(anatomy.probeCompression).toBeNull();
    }
  });

  it('particionar los mismos pasos no cambia una sola columna IQ/STFT', () => {
    const scene = new AnatomyScene(NORMAL_ADULT),
      anatomy = new AnatomyQuery(scene),
      engine = new PhysiologyEngine(NORMAL_ADULT, scene.vesselAreas());
    const a = new VenousSpectralAcquisition(anatomy, engine.sample, 31, NORMAL_ADULT),
      b = new VenousSpectralAcquisition(anatomy, engine.sample, 31, NORMAL_ADULT);
    const samples = Array.from({ length: 60 }, () => engine.step());
    a.push(samples, engine.clock.dt);
    for (let i = 0; i < samples.length; i += 7) b.push(samples.slice(i, i + 7), engine.clock.dt);
    for (let i = 0; i < 3; i++) expect(a.chains[i].spectral.columns).toEqual(b.chains[i].spectral.columns);
    expect(() => a.push([], 0)).toThrow('Paso temporal');
    expect(() => a.push([{ ...engine.sample, t: NaN }], engine.clock.dt)).toThrow('Tiempo no finito');
  });

  it('el sano en apnea conserva un espectro medible y las marcas se obtienen de su señal', () => {
    const patient = { ...NORMAL_ADULT, respiratoryPattern: 'apnea-expiratory' as const };
    const scene = new AnatomyScene(patient),
      anatomy = new AnatomyQuery(scene),
      engine = new PhysiologyEngine(patient, scene.vesselAreas());
    for (let i = 0; i < 7500; i++) engine.step();
    const a = new VenousSpectralAcquisition(anatomy, engine.sample, patient.seed, patient);
    const samples = Array.from({ length: 1625 }, () => engine.step());
    a.push(samples, engine.clock.dt);
    const beats = engine.rhythm.beatsBetween(samples[0].t, samples.at(-1)!.t);
    const opts = { f0Hz: a.f0Hz, angleCorrectionRad: 0, invert: false, fftSize: 128, wallFilterHz: 15, gainDb: 0 };
    const functions = [measureObservedHepatic, measureObservedPortal, measureObservedRenal];
    for (let i = 0; i < 3; i++) {
      const columns = a.chains[i].spectral.columns;
      expect(columns.at(-1)!.prfHz).toBe(prfFromNyquistCms(a.scales[i], a.f0Hz));
      const m = functions[i](columns, beats, opts)!;
      expect(m.quality.issue).toBeNull();
      expect(m.anterogradeSign).toBe(i === 1 ? 1 : -1);
      expect(m.marks.length).toBeGreaterThanOrEqual(8);
      const capture = captureProtocolVessel(
        VENOUS_COMPARISON_CHANNELS[i].id,
        columns,
        engine.rhythm,
        samples.at(-1)!.t,
        opts,
        a.gateTracks[i],
      );
      expect(capture?.quality.issue).toBeNull();
      expect(capture!.marks.length).toBeGreaterThanOrEqual(8);
      expect(m.marks.every((p) => p.t >= columns[0].t && p.t <= columns.at(-1)!.t)).toBe(true);
      if (i === 0) expect(new Set(m.marks.map((x) => x.label))).toEqual(new Set(['A', 'S', 'D']));
      if (i === 1) expect(new Set(m.marks.map((x) => x.label))).toEqual(new Set(['Vmáx', 'Vmín']));
    }
  });
});
