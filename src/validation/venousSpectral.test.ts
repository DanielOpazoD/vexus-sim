import { DEFAULT_BMODE } from '../ultrasound/renderer';
import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { AnatomyQuery } from '../anatomy/query';
import { NORMAL_ADULT } from '../cases';
import { PhysiologyEngine } from '../physiology/engine';
import { VenousSpectralAcquisition } from '../app/venousSpectral';
import { VESSEL_META } from '../physiology/vessels';

function fixture() {
  const anatomy = new AnatomyQuery(new AnatomyScene(NORMAL_ADULT));
  const engine = new PhysiologyEngine(NORMAL_ADULT, anatomy.scene.vesselAreas());
  for (let i = 0; i < 1000; i++) engine.step();
  return { anatomy, engine };
}

describe('PW venoso virtual: IQ espacial y reloj compartido', () => {
  it('cambiar equipo durante respiración no recoloca la puerta buscando otra vez el vaso', () => {
    const patient = { ...NORMAL_ADULT, respiratoryPattern: 'quiet' as const };
    const anatomy = new AnatomyQuery(new AnatomyScene(patient));
    const engine = new PhysiologyEngine(patient, anatomy.scene.vesselAreas());
    for (let i = 0; i < 7500; i++) engine.step();
    const a = new VenousSpectralAcquisition(anatomy, engine.sample, patient.seed, patient, DEFAULT_BMODE);
    const before = a.gateInfo.map((g) => g.world);
    for (let i = 0; i < 125; i++) engine.step();
    const reselected = new VenousSpectralAcquisition(anatomy, engine.sample, patient.seed, patient, DEFAULT_BMODE);
    // Counterfactual of the previous UI: a new anatomical search silently moved this portal gate.
    expect(Math.hypot(...reselected.gateInfo[1].world.map((v, i) => v - before[1][i]))).toBeGreaterThan(1);
    a.scales[1] = 80;
    a.wallFilters[1] = 25;
    a.reacquire();
    expect([0, 1, 2].map((i) => a.gate(i, engine.sample).center)).toEqual(before);
  });

  it('reconstruir equipo conserva puertas y reinicia partículas para reproducir exactamente el mismo historial', () => {
    const { anatomy, engine } = fixture();
    const a = new VenousSpectralAcquisition(anatomy, engine.sample, 47, NORMAL_ADULT, DEFAULT_BMODE);
    const centers = [0, 1, 2].map((i) => a.gate(i, engine.sample).center);
    const samples = Array.from({ length: 75 }, () => engine.step());
    a.push(samples, engine.clock.dt);
    const before = a.chains.map((c) => structuredClone(c.spectral.columns));
    const oldChains = [...a.chains];
    a.reacquire();
    expect(a.chains.every((c, i) => c !== oldChains[i])).toBe(true);
    expect(a.chains.every((c) => c.spectral.columns.length === 0)).toBe(true);
    expect(a.gateTracks.every((t) => t.length === 0)).toBe(true);
    a.push(samples, engine.clock.dt);
    expect(a.chains.map((c) => c.spectral.columns)).toEqual(before);
    expect([0, 1, 2].map((i) => a.gate(i, engine.sample).center)).toEqual(centers);
    a.scales[1] = 80;
    a.wallFilters[1] = 25;
    a.reacquire();
    const later = Array.from({ length: 75 }, () => engine.step());
    const unchanged = JSON.stringify(later);
    a.push(later, engine.clock.dt);
    expect([0, 1, 2].map((i) => a.gate(i, engine.sample).center)).toEqual(centers);
    expect(a.chains[1].wallFilter.cutoffHz).toBe(25);
    expect(a.chains[1].spectral.columns.at(-1)!.prfHz).toBeGreaterThan(a.chains[0].spectral.columns.at(-1)!.prfHz);
    expect(a.chains.every((c) => c.spectral.columns[0].t >= later[0].t)).toBe(true);
    expect(JSON.stringify(later)).toBe(unchanged);
  });

  it('cada filtro de pared configura la IQ de su canal sin copiarse a los vecinos', () => {
    const { anatomy, engine } = fixture();
    const a = new VenousSpectralAcquisition(anatomy, engine.sample, 47, NORMAL_ADULT, DEFAULT_BMODE);
    a.wallFilters.splice(0, 3, 25, 5, 15);
    a.push(
      Array.from({ length: 40 }, () => engine.step()),
      engine.clock.dt,
    );
    expect(a.chains.map((c) => c.wallFilter.cutoffHz)).toEqual([25, 5, 15]);
    expect(a.chains[1].wallFilter.magnitude(10)).toBeGreaterThan(a.chains[0].wallFilter.magnitude(10));
  });

  it('sitúa tres puertas reales en los vasos declarados sin cambiar la anatomía del alumno', () => {
    const { anatomy, engine } = fixture();
    const acquisition = new VenousSpectralAcquisition(anatomy, engine.sample, 47, NORMAL_ADULT, DEFAULT_BMODE);
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
    const acquisition = new VenousSpectralAcquisition(anatomy, engine.sample, 47, NORMAL_ADULT, DEFAULT_BMODE);
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
    const acquisition = new VenousSpectralAcquisition(anatomy, engine.sample, 47, NORMAL_ADULT, DEFAULT_BMODE);
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
