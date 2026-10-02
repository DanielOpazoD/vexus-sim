import { describe, expect, it } from 'vitest';
import { NORMAL_ADULT } from '../cases';
import { clonePatient } from '../physiology/patientState';
import { RespiratoryModel } from '../physiology/respiratory';
import { hasRespiratoryCycle } from '../vexus/ivcCollapse';

function trace(pattern: 'quiet' | 'apnea-expiratory', from: number, to: number) {
  const patient = clonePatient(NORMAL_ADULT);
  patient.respiratoryPattern = pattern;
  patient.respiratoryRateMin = 12;
  const model = new RespiratoryModel(patient);
  const out = [];
  for (let t = from; t <= to + 1e-8; t += 0.02) out.push({ t, resp: model.sample(t) });
  return out;
}

describe('referencia respiratoria y validez de la colapsabilidad', () => {
  it('la pausa sostiene espiración mientras el tiempo puede seguir avanzando', () => {
    const samples = trace('apnea-expiratory', 0, 8);
    for (const { resp } of samples) {
      expect(resp.cycling).toBe(false);
      expect(resp.phase).toBe(0);
      expect(resp.volume).toBe(0);
      expect(resp.diaphragmCaudalMm).toBe(0);
      expect(resp.diaphragmVelocityMmS).toBe(0);
    }
    expect(hasRespiratoryCycle(samples, 0, 8)).toBe(false);
  });
  it('un ciclo completo desde fase arbitraria acredita cobertura, una fracción no', () => {
    const full = trace('quiet', 0.7, 6);
    expect(hasRespiratoryCycle(full, 0.7, 6)).toBe(true);
    expect(hasRespiratoryCycle(full, 0.7, 4)).toBe(false);
  });
  it('las pausas y las muestras escasas no se suman como un ciclo observado', () => {
    const mixed = [...trace('quiet', 0, 3), ...trace('apnea-expiratory', 3.02, 4), ...trace('quiet', 4.02, 7)];
    expect(hasRespiratoryCycle(mixed, 0, 7)).toBe(false);
    const sparse = trace('quiet', 0, 6).filter((_, i) => i % 50 === 0);
    expect(hasRespiratoryCycle(sparse, 0, 6)).toBe(false);
  });
  it('la pausa inspiratoria conserva su fase de referencia', () => {
    const patient = clonePatient(NORMAL_ADULT);
    patient.respiratoryPattern = 'apnea-inspiratory';
    const model = new RespiratoryModel(patient);
    expect(model.sample(0)).toEqual(model.sample(8));
    expect(model.sample(8)).toMatchObject({ phase: 0.4, cycling: false, volume: 1, volumeRate: 0 });
  });
});
