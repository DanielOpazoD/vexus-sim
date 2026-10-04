import { C_RECONSTRUCTION_MM_S, nyquistVelocityCms, prfFromNyquistCms } from '../core/units';
import { maxPrfForDepth } from '../app/equipment';
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
  it('la longitud cambia el volumen físico y su IQ sin mover puertas ni alterar otros canales', () => {
    const { anatomy, engine } = fixture();
    const a = new VenousSpectralAcquisition(anatomy, engine.sample, 47, NORMAL_ADULT, DEFAULT_BMODE);
    const b = new VenousSpectralAcquisition(anatomy, engine.sample, 47, NORMAL_ADULT, DEFAULT_BMODE);
    expect([0, 1, 2].map((i) => a.gateLengthMm(i))).toEqual([4, 6, 4]);
    b.setGateLengthMm(1, 2);
    const before = a.gateInfo.map((g) => g.world);
    expect(b.gate(1, engine.sample).lengthMm).toBe(2);
    expect(b.gate(1, engine.sample).center).toEqual(a.gate(1, engine.sample).center);
    const history = Array.from({ length: 75 }, () => engine.step());
    const source = JSON.stringify(history);
    a.push(history, engine.clock.dt);
    b.push(history, engine.clock.dt);
    expect(b.chains[1].spectral.columns).not.toEqual(a.chains[1].spectral.columns);
    for (const i of [0, 2]) expect(b.chains[i].spectral.columns).toEqual(a.chains[i].spectral.columns);
    expect(b.gateInfo.map((g) => g.world)).toEqual(before);
    expect(JSON.stringify(history)).toBe(source);
    b.setGateLengthMm(1, 6);
    b.reacquire();
    b.push(history, engine.clock.dt);
    expect(b.chains.map((c) => c.spectral.columns)).toEqual(a.chains.map((c) => c.spectral.columns));
    a.scales[1] = 120;
    b.scales[1] = 120;
    b.setGateLengthMm(1, 2);
    expect(b.prfHz(1)).toBeGreaterThan(a.prfHz(1));
    expect(b.prfHz(1)).toBeCloseTo(1_540_000 / (2 * (b.gateDepthsMm[1] + 1)), 10);
    for (const mm of [NaN, Infinity, -2, 0, 3, 8]) expect(() => b.setGateLengthMm(1, mm)).toThrow(RangeError);
    expect(() => b.setGateLengthMm(3, 2)).toThrow(RangeError);
  });

  it('respeta el retorno del eco de la cara distal de cada puerta al solicitar una escala alta', () => {
    const { anatomy, engine } = fixture();
    const a = new VenousSpectralAcquisition(anatomy, engine.sample, 47, NORMAL_ADULT, DEFAULT_BMODE);
    a.scales.fill(120);
    a.push(
      Array.from({ length: 30 }, () => engine.step()),
      engine.clock.dt,
    );
    const rows = a.chains.map((chain, i) => ({
      depth: a.gateDepthsMm[i],
      prf: chain.spectral.columns.at(-1)!.prfHz,
      limit: maxPrfForDepth(a.gateDepthsMm[i] + a.gate(i, engine.sample).lengthMm / 2, C_RECONSTRUCTION_MM_S),
    }));

    expect(rows.some((r) => prfFromNyquistCms(120, a.f0Hz) > r.limit)).toBe(true);
    for (const [i, row] of rows.entries()) {
      expect(row.prf).toBeLessThanOrEqual(row.limit);
      expect(row.prf).toBe(a.prfHz(i));
      expect(a.nyquistCms(i)).toBeCloseTo(nyquistVelocityCms(row.prf, a.f0Hz), 12);
    }
    expect(a.scales).toEqual([120, 120, 120]);
    expect(a.nyquistCms(1)).toBeLessThan(120);
  });

  it('las escalas basales físicamente posibles conservan PRF y vuelven tras una solicitud limitada', () => {
    const { anatomy, engine } = fixture();
    const a = new VenousSpectralAcquisition(anatomy, engine.sample, 47, NORMAL_ADULT, DEFAULT_BMODE);
    const original = [...a.scales];
    for (let i = 0; i < 3; i++) expect(a.prfHz(i)).toBe(prfFromNyquistCms(original[i], a.f0Hz));
    const centers = a.gateInfo.map((g) => g.world);
    a.scales.fill(120);
    a.reacquire();
    a.scales.splice(0, 3, ...original);
    a.reacquire();
    for (let i = 0; i < 3; i++) expect(a.prfHz(i)).toBe(prfFromNyquistCms(original[i], a.f0Hz));
    expect(a.gateInfo.map((g) => g.world)).toEqual(centers);
  });

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
