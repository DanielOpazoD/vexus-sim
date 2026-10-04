import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { AnatomyQuery } from '../anatomy/query';
import { NORMAL_ADULT } from '../cases';
import { PhysiologyEngine } from '../physiology/engine';
import { VenousSpectralAcquisition } from '../doppler/venousSpectral';
import { VESSEL_META } from '../physiology/vessels';

function fixture() {
  const anatomy = new AnatomyQuery(new AnatomyScene(NORMAL_ADULT));
  const engine = new PhysiologyEngine(NORMAL_ADULT, anatomy.scene.vesselAreas());
  for (let i = 0; i < 1000; i++) engine.step();
  return { anatomy, engine };
}

describe('PW venoso virtual: IQ espacial y reloj compartido', () => {
  it('sitúa tres puertas reales en los vasos declarados sin cambiar la anatomía del alumno', () => {
    const { anatomy, engine } = fixture();
    const acquisition = new VenousSpectralAcquisition(anatomy, engine.sample, 47, NORMAL_ADULT);
    for (const [i, system] of ['hepaticVein', 'portal', 'interlobarVein'].entries()) {
      const gate = acquisition.gate(i, engine.sample);
      const info = acquisition.gateInfo[i];
      expect(info.vessel).not.toBeNull();
      expect(VESSEL_META[info.vessel!].system).toBe(system);
      expect(info.transmission).toBeGreaterThan(0);
      expect(info.transmission).toBeLessThan(1);
      expect(info.beamAngleToFlowDeg).toBeGreaterThan(0);
      expect(Math.hypot(...gate.beamDir)).toBeCloseTo(1, 12);
    }
    expect(anatomy.probeCompression).toBeNull();
  });

  it('emite potencia multibin desde dispersores y conserva los tiempos del ECG', () => {
    const { anatomy, engine } = fixture();
    const acquisition = new VenousSpectralAcquisition(anatomy, engine.sample, 47, NORMAL_ADULT);
    const samples = Array.from({ length: 75 }, () => engine.step());
    const before = JSON.stringify(samples);
    acquisition.push(samples, engine.clock.dt);
    expect(JSON.stringify(samples)).toBe(before);
    for (const chain of acquisition.chains) {
      const columns = chain.spectral.columns;
      expect(columns.length).toBeGreaterThan(5);
      expect(columns[0].t).toBeGreaterThan(samples[0].t);
      expect(columns.at(-1)!.t).toBeLessThan(samples.at(-1)!.t + engine.clock.dt);
      expect(columns.every((c) => c.powerDb.length === 128 && c.powerDb.every(Number.isFinite))).toBe(true);
      const last = columns.at(-1)!.powerDb;
      const maximum = Math.max(...last);
      expect([...last].filter((v) => v > maximum - 20).length).toBeGreaterThan(2);
      expect(chain.sampleVolume.lastComposition.bloodWeight).toBeGreaterThan(0.01);
    }
  });

  it('no fabrica continuidad a través de un intervalo ausente', () => {
    const { anatomy, engine } = fixture();
    const acquisition = new VenousSpectralAcquisition(anatomy, engine.sample, 47, NORMAL_ADULT);
    acquisition.push(
      Array.from({ length: 50 }, () => engine.step()),
      engine.clock.dt,
    );
    for (let i = 0; i < 100; i++) engine.step();
    const resumed = Array.from({ length: 50 }, () => engine.step());
    acquisition.push(resumed, engine.clock.dt);
    for (const chain of acquisition.chains) expect(chain.spectral.columns[0].t).toBeGreaterThan(resumed[0].t);
  });
});
