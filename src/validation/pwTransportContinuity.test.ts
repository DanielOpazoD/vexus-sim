import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { AnatomyQuery } from '../anatomy/query';
import { NORMAL_ADULT } from '../cases';
import { PhysiologyEngine } from '../physiology/engine';
import { Tissue } from '../anatomy/tissues';
import { PwDopplerChain } from '../doppler/pwChain';
import type { GateGeometry } from '../doppler/sampleVolume';
import { dopplerShiftHz } from '../core/units';

/** Analytical uniform-flow phantom. No haemodynamic waveform or clinical grade is used. */
function acquire(u: number, prf: number, seed: number, angle = 0) {
  const patient = { ...NORMAL_ADULT, respiratoryPattern: 'apnea-expiratory' as const };
  const scene = new AnatomyScene(patient);
  const anatomy = new AnatomyQuery(scene);
  const base = new PhysiologyEngine(patient, scene.vesselAreas()).sample;
  const template = anatomy.classifyWorld([0, 0, 0], base);
  anatomy.classifyWorld = (p) => ({
    ...template,
    tissue: Tissue.Blood,
    vessel: 'hvRight',
    material: p,
    bloodVelocity: [0, 0, u],
    flowBasis: [0, 0, 1],
    tissueVelocity: [0, 0, 0],
  });
  const chain = new PwDopplerChain(anatomy, seed, undefined, { maxColumns: 2048 });
  const gate: GateGeometry = {
    center: [0, 0, 0],
    beamDir: [-Math.sin(angle), 0, -Math.cos(angle)],
    lateral: [Math.cos(angle), 0, -Math.sin(angle)],
    elevation: [0, 1, 0],
    lengthMm: 2,
    lateralSigmaMm: 0.6,
    elevationSigmaMm: 0.6,
    pulseSigmaMm: 0.25,
    apertureAngleSigmaRad: 0,
    transmission: 1,
  };
  const weights: number[] = [];
  for (let k = 0; k < 750; k++) {
    const s = { ...base, t: k * 0.004, velocities: { ...base.velocities, hvRight: u } };
    chain.begin(prf, 2.5e6, 0, 15, s.t);
    chain.setGate(gate, s);
    chain.step(s, [0, 0, 0], 0.004);
    chain.flush();
    if (k > 250) weights.push(chain.sampleVolume.lastComposition.bloodWeight);
  }
  const columns = chain.spectral.columns.filter((c) => c.t > 1);
  const expectedHz = dopplerShiftHz(u * Math.cos(angle), 2.5e6);
  const binHz = prf / 128;
  const circularDistance = (f: number) => Math.abs(((f - expectedHz + 1.5 * prf) % prf) - prf / 2);
  // Broad finite-transit neighbourhood, not a zero-width ideal line: transit broadening is physical.
  const widthHz = (4 * Math.abs(u)) / gate.lengthMm;
  const leakage = columns
    .map((c) => {
      let total = 0,
        outside = 0;
      for (let k = 0; k < c.powerDb.length; k++) {
        const power = 10 ** (c.powerDb[k] / 10);
        total += power;
        if (circularDistance((k - 64) * binHz) > widthHz) outside += power;
      }
      return 10 * Math.log10(outside / total);
    })
    .sort((a, b) => a - b);
  // Random interference and transit-time broadening move a single column's peak.
  // The circular power centroid over the acquisition tests the Doppler frequency,
  // including spectra that straddle Nyquist, without mistaking that broadening for bias.
  let re = 0,
    im = 0;
  for (const c of columns)
    for (let k = 0; k < c.powerDb.length; k++) {
      const p = 10 ** (c.powerDb[k] / 10),
        phase = (2 * Math.PI * (k - 64)) / 128;
      re += p * Math.cos(phase);
      im += p * Math.sin(phase);
    }
  const frequencyError = circularDistance((Math.atan2(im, re) * prf) / (2 * Math.PI));
  return {
    p95LeakageDb: leakage[Math.floor(leakage.length * 0.95)],
    frequencyError,
    binHz,
    meanWeight: weights.reduce((a, b) => a + b, 0) / weights.length,
  };
}

describe('transporte de dispersores: invariantes del fantoma de flujo uniforme', () => {
  it('no genera réplicas intensas de PRF/8 al renovar sangre rápida', () => {
    for (const seed of [11, 47]) {
      const result = acquire(300, 2000, seed);
      // Regression: the lagged 8-pulse update produced about −20 dB here.
      // Require <0.1% out-of-neighbourhood energy in at least 95% of columns.
      expect(result.p95LeakageDb).toBeLessThan(-30);
      expect(result.frequencyError).toBeLessThanOrEqual(result.binHz);
    }
  });
  it('conserva densidad y frecuencia al cambiar PRF o velocidad sin cambiar el volumen', () => {
    const results = [acquire(100, 2000, 41), acquire(300, 2000, 41), acquire(300, 4000, 41)];
    const weights = results.map((r) => r.meanWeight);
    expect(Math.max(...weights) / Math.min(...weights)).toBeLessThan(1.03);
    for (const r of results) expect(r.frequencyError).toBeLessThanOrEqual(r.binHz);
  });
  it('la frecuencia observada respeta coseno angular y sentido del flujo', () => {
    for (const u of [100, -100]) {
      const r = acquire(u, 2000, 29, Math.PI / 3);
      expect(r.frequencyError).toBeLessThanOrEqual(r.binHz);
    }
  });
});
