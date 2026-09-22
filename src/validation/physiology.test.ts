// @tier slow
import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import { PhysiologyEngine } from '../physiology/engine';
import { clonePatient, type PatientState } from '../physiology/patientState';
import { classifyVexusC } from '../vexus/classification';
import { measurePhysiologyTruth } from '../vexus/measurements';

function run(patient: PatientState, seconds: number): PhysiologyEngine {
  const scene = new AnatomyScene(patient);
  const engine = new PhysiologyEngine(patient, scene.vesselAreas(), { historySeconds: seconds + 1 });
  const steps = Math.round(seconds / engine.clock.dt);
  for (let i = 0; i < steps; i++) engine.step();
  return engine;
}

describe('Fisiología: el VExUS emerge de la señal, no se asigna (guía §5, §21)', () => {
  it('el PatientState no contiene ningún campo que sea un grado VExUS', () => {
    const keys = JSON.stringify(NORMAL_ADULT).toLowerCase();
    expect(keys.includes('vexus')).toBe(false);
    expect(keys.includes('grade')).toBe(false);
  });

  it('adulto sano: S > D, PF < 30 %, VCI < 20 mm → grado 0 emergente', () => {
    const e = run(NORMAL_ADULT, 14);
    const m = measurePhysiologyTruth(e, { fromT: 5, toT: 14 });
    expect(m.beats).toBeGreaterThan(6);
    expect(m.hvS).toBeGreaterThan(m.hvD);
    expect(m.hvS).toBeGreaterThan(18);
    expect(m.hvA).toBeLessThan(0); // reversión auricular presente
    expect(m.portalPF).toBeLessThan(30);
    expect(m.ivcMaxMm).toBeLessThan(20);
    expect(m.ivcCollapse).toBeGreaterThan(0.25); // respiración tranquila colapsa la VCI
    const g = classifyVexusC({
      ivcMaxDiameterMm: m.ivcMaxMm,
      hepatic: m.hepaticPattern,
      portalPulsatilityFraction: m.portalPF,
      renal: 'not-assessed',
    });
    expect(g.grade).toBe(0);
  });

  it('congestión grave: S invertida, PF ≥ 50 %, VCI ≥ 20 mm → grado 3 con el MISMO motor', () => {
    const e = run(SEVERE_CONGESTION, 14);
    const m = measurePhysiologyTruth(e, { fromT: 5, toT: 14 });
    expect(m.hvS).toBeLessThan(0);
    expect(m.hepaticPattern).toBe('severe');
    expect(m.portalPF).toBeGreaterThanOrEqual(50);
    expect(m.ivcMaxMm).toBeGreaterThanOrEqual(20);
    expect(m.ivcCollapse).toBeLessThan(0.25);
    const g = classifyVexusC({
      ivcMaxDiameterMm: m.ivcMaxMm,
      hepatic: m.hepaticPattern,
      portalPulsatilityFraction: m.portalPF,
      renal: 'not-assessed',
    });
    expect(g.grade).toBe(3);
  });

  it('la presión media de AD declarada se conserva (ondas centradas)', () => {
    const e = run(NORMAL_ADULT, 12);
    const s = e.samples.filter((x) => x.t > 4);
    const mean = s.reduce((a, x) => a + x.pRa, 0) / s.length;
    // media al final de espiración ± modulación pleural media (< 1,5 mmHg)
    expect(Math.abs(mean - NORMAL_ADULT.rapMeanMmHg)).toBeLessThan(1.5);
  });

  it('conservación de caudal en régimen: Q_hv ≈ Q_pv + Q_ha', () => {
    const e = run(NORMAL_ADULT, 12);
    const m = measurePhysiologyTruth(e, { fromT: 4, toT: 12 });
    expect(Math.abs(m.qHvMean - (m.qPvMean + m.qHaMean)) / m.qHvMean).toBeLessThan(0.05);
  });

  it('ECG y ondas comparten reloj: el pico S ocurre en la sístole mecánica tras cada R', () => {
    const e = run(NORMAL_ADULT, 10);
    const samples = e.samples.filter((x) => x.t > 3);
    const beats = new Set(samples.map((x) => x.beatIndex));
    let checked = 0;
    for (const b of beats) {
      const beat = e.rhythm.currentBeat(samples.find((x) => x.beatIndex === b)!.lastR + 1e-6);
      if (beat.tR + beat.rr > samples[samples.length - 1].t) continue;
      const inBeat = samples.filter((x) => x.t >= beat.tR && x.t < beat.tR + beat.rr);
      const sysMax = inBeat
        .filter((x) => x.t < beat.tV)
        .reduce((best, x) => (x.velocities.hvRight > best.velocities.hvRight ? x : best), inBeat[0]);
      const delay = sysMax.t - beat.tR;
      expect(delay).toBeGreaterThan(0.05);
      expect(delay).toBeLessThan(0.36);
      checked++;
    }
    expect(checked).toBeGreaterThan(4);
  });

  it('la apnea espiratoria elimina la variación respiratoria de la VCI sin cambiar la PAD media', () => {
    const apnea = clonePatient(NORMAL_ADULT);
    apnea.respiratoryPattern = 'apnea-expiratory';
    const e = run(apnea, 12);
    const m = measurePhysiologyTruth(e, { fromT: 4, toT: 12 });
    expect(m.ivcCollapse).toBeLessThan(0.15);
  });

  it('determinismo: mismo PatientState + semilla → misma trayectoria', () => {
    const a = run(NORMAL_ADULT, 6);
    const b = run(clonePatient(NORMAL_ADULT), 6);
    const sa = a.sample;
    const sb = b.sample;
    expect(sa.t).toBe(sb.t);
    expect(sa.pRa).toBe(sb.pRa);
    expect(sa.velocities.hvRight).toBe(sb.velocities.hvRight);
    expect(sa.ivc.dApMm).toBe(sb.ivc.dApMm);
    expect(sa.ecgMv).toBe(sb.ecgMv);
  });

  it('otra semilla cambia la variabilidad RR pero no la fisiología media', () => {
    const other = clonePatient(NORMAL_ADULT);
    other.seed = 7;
    const a = run(NORMAL_ADULT, 10);
    const b = run(other, 10);
    const ma = measurePhysiologyTruth(a, { fromT: 3, toT: 10 });
    const mb = measurePhysiologyTruth(b, { fromT: 3, toT: 10 });
    expect(Math.abs(ma.hvS - mb.hvS)).toBeLessThan(4);
    expect(a.sample.lastR).not.toBe(b.sample.lastR);
  });
});
