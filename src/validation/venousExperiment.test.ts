import { describe, expect, it } from 'vitest';
import { NORMAL_ADULT } from '../cases';
import { congestionParameters, venousExperimentPatient, VENOUS_EXPERIMENT_FIELDS } from '../app/venousExperiment';
describe('parámetros de escenario hemodinámico', () => {
  it('conserva anatomía sana y casos originales, sin incluir un grado en el paciente', () => {
    const original = JSON.stringify(NORMAL_ADULT);
    const p = venousExperimentPatient(congestionParameters(1));
    expect(p.liver).toEqual(NORMAL_ADULT.liver);
    expect(p.habitus).toEqual(NORMAL_ADULT.habitus);
    expect(p.liver).not.toBe(NORMAL_ADULT.liver);
    expect(p.respiratoryPattern).toBe('apnea-expiratory');
    expect(p).not.toHaveProperty('grade');
    expect(p.heartRateBpm).toBe(NORMAL_ADULT.heartRateBpm);
    expect(JSON.stringify(NORMAL_ADULT)).toBe(original);
  });
  it('cada paso intermedio cambia parámetros de forma continua, dentro de sus dominios', () => {
    let before = congestionParameters(0);
    for (let i = 1; i <= 1000; i++) {
      const now = congestionParameters(i / 1000);
      expect(now.heartRateBpm).toBe(NORMAL_ADULT.heartRateBpm);
      venousExperimentPatient(now);
      expect(now.rapMeanMmHg - before.rapMeanMmHg).toBeCloseTo(0.013, 10);
      for (const f of VENOUS_EXPERIMENT_FIELDS)
        expect(Math.abs(now[f.key] - before[f.key])).toBeLessThanOrEqual((f.max - f.min) / 1000 + 1e-12);
      before = now;
    }
  });
  it('rechaza valores no finitos y fuera de dominio sin recortarlos silenciosamente', () => {
    for (const x of [NaN, Infinity, -0.01, 1.01]) expect(() => congestionParameters(x)).toThrow(RangeError);
    for (const f of VENOUS_EXPERIMENT_FIELDS)
      for (const value of [NaN, f.min - 1, f.max + 1])
        expect(() => venousExperimentPatient({ ...congestionParameters(0.5), [f.key]: value })).toThrow(RangeError);
  });
});

import { VenousExperiment } from '../app/venousExperiment';
import { measurePhysiologyTruth } from '../vexus/measurements';
import { classifyVexusC } from '../vexus/classification';
describe('escenarios estables derivados de la red', () => {
  it.each([
    [0, 0],
    [0.4, 1],
    [0.775, 2],
    [1, 3],
  ])('trayectoria %s: referencia %s calculada, nunca introducida en la red', (fraction, grade) => {
    const source = JSON.stringify(NORMAL_ADULT);
    const x = new VenousExperiment(congestionParameters(fraction));
    for (let i = 0; i < 29; i++) x.advance(0);
    expect(x.ready).toBe(false);
    expect(x.engine.clock.t).toBe(29);
    x.advance(0);
    expect(x.ready).toBe(true);
    expect(x.engine.clock.t).toBe(30);
    for (const end of [24, 26, 28, 30]) {
      const m = measurePhysiologyTruth(x.engine, { fromT: end - 6, toT: end });
      const result = classifyVexusC({
        ivcMaxDiameterMm: m.ivcMaxMm,
        hepatic: m.hepaticPattern,
        portalPulsatilityFraction: m.portalPF,
        renal: m.renalPattern,
      });
      expect(result.grade).toBe(grade);
    }
    expect(JSON.stringify(NORMAL_ADULT)).toBe(source);
    x.advance(1000);
    expect(x.engine.clock.t).toBeCloseTo(30.1, 8);
    expect(() => x.advance(NaN)).toThrow(RangeError);
  });
  it('los extremos de cada control conservan finitud en su escenario, sin certificar combinaciones', () => {
    for (const f of VENOUS_EXPERIMENT_FIELDS)
      for (const v of [f.min, f.max]) {
        const x = new VenousExperiment({ ...congestionParameters(0), [f.key]: v });
        for (let i = 0; i < 30; i++) x.advance(0);
        expect(x.ready).toBe(true);
        for (const value of Object.values(x.engine.sample.velocities)) expect(Number.isFinite(value)).toBe(true);
      }
  });
});

describe('frecuencia cardíaca sinusal como entrada del motor, no estiramiento de imagen', () => {
  it('modifica RR y el número de ciclos con ECG y flujo en el mismo reloj, sin modificar anatomía ni el caso original', () => {
    const original = JSON.stringify(NORMAL_ADULT);
    const states = [50, 75, 120].map((heartRateBpm) => {
      const x = new VenousExperiment({ ...congestionParameters(0), heartRateBpm });
      for (let i = 0; i < 30; i++) x.advance(0);
      const samples = x.engine.samples.filter((s) => s.t >= 24);
      const beats = x.engine.rhythm.beatsBetween(24, 30);
      expect(x.engine.rhythm.nominalRR()).toBe(60 / heartRateBpm);
      expect(beats.length).toBeGreaterThanOrEqual(Math.floor(heartRateBpm / 10) - 1);
      for (const s of samples) {
        const b = x.engine.rhythm.currentBeat(s.t);
        expect(s.lastR).toBe(b.tR);
        expect(s.rr).toBe(b.rr);
        expect(s.ecgMv).toBe(x.engine.rhythm.ecg(s.t));
        expect(Number.isFinite(s.qHepaticVein + s.qPortal + s.qRenalVein)).toBe(true);
      }
      expect(x.patient.liver).toEqual(NORMAL_ADULT.liver);
      return { x, beats };
    });
    expect(states[2].beats.length).toBeGreaterThan(states[0].beats.length);
    expect(states[0].x.engine.sample.qHepaticVein).not.toBe(states[2].x.engine.sample.qHepaticVein);
    expect(JSON.stringify(NORMAL_ADULT)).toBe(original);
  });
});
