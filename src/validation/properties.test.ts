// @tier slow
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { NORMAL_ADULT } from '../cases';
import { PhysiologyEngine, nonFiniteFields } from '../physiology/engine';
import { clonePatient, validatePatient, type PatientState } from '../physiology/patientState';

/**
 * Propiedades del motor fisiológico sobre TODO el dominio que acepta `validatePatient`
 * (Fase 0): la arquitectura promete «un caso nuevo = un PatientState», así que el motor
 * debe ser estable para cualquier combinación válida, no solo para los 3 casos.
 * Semilla fija: los fallos son reproducibles (fast-check imprime el contraejemplo).
 */
const SEED = 20260922;

const patientArb: fc.Arbitrary<PatientState> = fc
  .record({
    heartRateBpm: fc.integer({ min: 50, max: 150 }),
    // PAD ≥ 2 y volumen ≥ 0,8: por debajo, la PAD prescrita cae en picado y sin cascada
    // torácica (`no-thoracic-waterfall`) la VCI se vacía a caudales irreales (ver it.fails)
    rapMeanMmHg: fc.double({ min: 2, max: 30, noNaN: true }),
    rvFunction: fc.double({ min: 0.3, max: 1, noNaN: true }),
    // compliancias < 0,6 con PAD baja disparan el contorno auricular prescrito (ver it.fails abajo)
    raCompliance: fc.double({ min: 0.6, max: 1.5, noNaN: true }),
    tricuspidRegurgitation: fc.double({ min: 0, max: 0.8, noNaN: true }),
    stressedVolume: fc.double({ min: 0.8, max: 1.6, noNaN: true }),
    intraAbdominalPressureMmHg: fc.double({ min: 0, max: 20, noNaN: true }),
    respiratoryRateMin: fc.integer({ min: 8, max: 30 }),
    rhythm: fc.constantFrom('sinus' as const, 'atrial-fibrillation' as const),
    sinusoidalResistance: fc.double({ min: 0.5, max: 4, noNaN: true }),
    sizeFactor: fc.double({ min: 0.9, max: 1.2, noNaN: true }),
  })
  // Coherencia clínica: un VD que falla (< 0,6) no cursa con PAD baja (≥ 8 − 10·(fVD − 0,3))
  .filter((r) => r.rvFunction >= 0.6 || r.rapMeanMmHg >= 8 - 10 * (r.rvFunction - 0.3))
  .map((r) => {
    const p = clonePatient(NORMAL_ADULT);
    p.heartRateBpm = r.heartRateBpm;
    p.rapMeanMmHg = r.rapMeanMmHg;
    p.rvFunction = r.rvFunction;
    p.raCompliance = r.raCompliance;
    p.tricuspidRegurgitation = r.tricuspidRegurgitation;
    p.stressedVolume = r.stressedVolume;
    p.intraAbdominalPressureMmHg = r.intraAbdominalPressureMmHg;
    p.respiratoryRateMin = r.respiratoryRateMin;
    p.rhythm = r.rhythm;
    p.liver = { ...p.liver, sinusoidalResistance: r.sinusoidalResistance, sizeFactor: r.sizeFactor };
    return p;
  });

function run(p: PatientState, seconds: number) {
  const engine = new PhysiologyEngine(p, new AnatomyScene(p).vesselAreas(), { historySeconds: seconds + 1 });
  const n = Math.round(seconds / engine.clock.dt);
  for (let i = 0; i < n; i++) engine.step(); // lanza NonFiniteStateError si algo deja de ser finito
  return engine.samples;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('Propiedades del motor fisiológico (fast-check)', () => {
  let rigidSamples: ReturnType<typeof run>;
  beforeAll(() => {
    const p = {
      ...clonePatient(NORMAL_ADULT),
      heartRateBpm: 40,
      rapMeanMmHg: 0,
      rvFunction: 0.55,
      raCompliance: 0.3,
      stressedVolume: 0.6,
      respiratoryRateMin: 8,
      liver: { sinusoidalResistance: 0.5, compliance: 1, sizeFactor: 0.9 },
    };
    rigidSamples = run(p, 3);
  });

  it('el contraejemplo rígido produce todo el registro finito antes de evaluar su límite conocido', () => {
    expect(rigidSamples).toHaveLength(751);
    expect(rigidSamples[0].t).toBe(0);
    expect(rigidSamples.at(-1)!.t).toBeCloseTo(3, 9);
    for (const sample of rigidSamples) expect(nonFiniteFields(sample)).toEqual([]);
  });

  it('cualquier paciente válido da un estado finito y físicamente acotado durante 3 s', () => {
    fc.assert(
      fc.property(patientArb, (p) => {
        validatePatient(p);
        const samples = run(p, 3);
        for (const s of samples) {
          expect(nonFiniteFields(s)).toEqual([]);
          expect(s.ivc.dApMm).toBeGreaterThan(1);
          expect(s.ivc.dApMm).toBeLessThan(45);
          expect(s.hvRadiusScale).toBeGreaterThanOrEqual(0.5);
          // cordura numérica (< 3 m/s; antes del resistor de Starling salían 288 m/s). El límite
          // fisiológico de 2 m/s en los extremos es la limitación `no-thoracic-waterfall` (it.fails)
          for (const v of Object.values(s.velocities)) expect(Math.abs(v)).toBeLessThan(3000);
        }
      }),
      { seed: SEED, numRuns: 30 },
    );
  });

  it('subir la presión auricular media no baja la presión hepática media ni el diámetro máximo de la VCI', () => {
    fc.assert(
      fc.property(fc.double({ min: 1, max: 20, noNaN: true }), fc.double({ min: 2, max: 8, noNaN: true }), (rap, delta) => {
        const lo = { ...clonePatient(NORMAL_ADULT), rapMeanMmHg: rap, respiratoryPattern: 'apnea-expiratory' as const };
        const hi = { ...lo, rapMeanMmHg: rap + delta };
        const a = run(lo, 3).filter((s) => s.t > 1.5);
        const b = run(hi, 3).filter((s) => s.t > 1.5);
        expect(mean(b.map((s) => s.pHepatic))).toBeGreaterThanOrEqual(mean(a.map((s) => s.pHepatic)) - 0.05);
        expect(Math.max(...b.map((s) => s.ivc.dApMm))).toBeGreaterThanOrEqual(Math.max(...a.map((s) => s.ivc.dApMm)) - 0.05);
      }),
      { seed: SEED, numRuns: 12 },
    );
  });

  // Limitación conocida `prescribed-ra-contour` (hallada por fast-check): con la aurícula muy
  // rígida y PAD media ≈ 0 el contorno prescrito oscila hasta −11 mmHg y la VCI suprahepática
  // (un solo compartimento) supera 2 m/s. Este primer contraejemplo ya no la supera desde la pared
  // viscoelástica de la VCI (decisión 73): la luz no se cierra dentro de un latido. El segundo
  // (`it.fails`, abajo) sigue documentando la limitación: el lazo cerrado de la decisión 79 solo
  // cierra la media (sin intervenciones la PAD es la del caso) y la forma de onda sigue prescrita;
  // cuando el modelo auricular la resuelva, empezará a «pasar» y avisará para retirarla.
  it('contraejemplo (hipovolemia + PAD ≈ 0, sin cascada torácica): con la pared viscoelástica la VCI no supera 2 m/s', () => {
    const p = {
      ...clonePatient(NORMAL_ADULT),
      heartRateBpm: 40,
      rapMeanMmHg: 0,
      rvFunction: 0.2,
      raCompliance: 0.6,
      stressedVolume: 0.6,
      intraAbdominalPressureMmHg: 1.2,
      respiratoryRateMin: 29,
      liver: { sinusoidalResistance: 0.5, compliance: 1, sizeFactor: 0.9 },
    };
    for (const s of run(p, 3)) for (const v of Object.values(s.velocities)) expect(Math.abs(v)).toBeLessThan(2000);
  });

  it('regresión de aurícula rígida con PAD ≈ 0: todas las velocidades conservan la cota de 2 m/s', () => {
    for (const s of rigidSamples) for (const v of Object.values(s.velocities)) expect(Math.abs(v)).toBeLessThan(2000);
  });
});
