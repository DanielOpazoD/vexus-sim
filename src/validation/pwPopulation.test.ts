// @tier slow
import { describe, expect, it } from 'vitest';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import { pwGate } from '../app/pwGate';
import { PwDopplerChain } from '../doppler/pwChain';
import { SampleVolumeIQ, type GateGeometry } from '../doppler/sampleVolume';
import type { RespiratoryPattern } from '../physiology/patientState';
import { DEFAULT_BMODE } from '../ultrasound/renderer';
import type { ProbeContact } from '../probe/contact';
import { acquire, openSession, placeGate, probeAt, PROFILE, TR, type ChainSession } from './support/studentChain';

const RENAL_VEINS = ['interlobarVein1', 'interlobarVein2', 'interlobarVein3'] as const;

/**
 * Peso de sangre de la población transportada (Σ w_sangre / N) frente al de siembras nuevas en la misma puerta y el mismo
 * instante (decisión 294), durante `seconds` de adquisición con la cadena de la sesión. Se lee cuando la composición se
 * renueva (cada 384 pulsos), con la muestra del cuadro: la diferencia de tiempo con la referencia es menor que un cuadro
 * (32 ms). Solo cuentan los instantes con sangre en la puerta (referencia ≥ 0,02): la salida física del vaso con la
 * respiración no es un fallo que haya que rellenar.
 */
function sampleRatio(
  session: ChainSession,
  contact: ProbeContact,
  cursor: { theta: number; depthMm: number; gateMm: number },
  chain: PwDopplerChain,
  seed: number,
  seconds: number,
) {
  const { engine, anatomy } = session;
  let transported = 0;
  let fresh = 0;
  let samples = 0;
  const t0 = engine.clock.t;
  let composition = chain.sampleVolume.lastComposition;
  while (engine.clock.t < t0 + seconds) {
    chain.begin(2600, TR.f0Doppler, 0, 25, engine.clock.t + engine.clock.dt);
    let gate: GateGeometry | null = null;
    let sample = engine.sample;
    for (let i = 0; i < 8; i++) {
      sample = engine.step();
      if (i === 0) {
        gate = pwGate(anatomy, contact.frame, contact, PROFILE, DEFAULT_BMODE.focusMm, cursor, sample).gate;
        chain.setGate(gate, sample);
      }
      chain.step(sample, [0, 0, 0], engine.clock.dt);
    }
    chain.flush();
    const now = chain.sampleVolume.lastComposition;
    if (now === composition) continue;
    composition = now;
    if (engine.clock.t - t0 < 0.5) continue;
    let reference = 0;
    for (let k = 0; k < 4; k++) {
      const volume = new SampleVolumeIQ(anatomy, 10_000 + 31 * seed + k);
      volume.setGate(gate!, sample);
      reference += volume.lastComposition.bloodWeight / 4;
    }
    if (reference < 0.02) continue;
    transported += now.bloodWeight;
    fresh += reference;
    samples++;
  }
  return { transported, fresh, samples };
}

function transportedOverFresh(respiratory: RespiratoryPattern, seeds: readonly number[], seconds: number) {
  const session = openSession(NORMAL_ADULT, respiratory);
  const contact = probeAt(session, 'renal');
  const best = placeGate(session, contact, RENAL_VEINS)!;
  let transported = 0;
  let fresh = 0;
  let samples = 0;
  for (const seed of seeds) {
    const r = sampleRatio(
      session,
      contact,
      { theta: best.theta, depthMm: best.r, gateMm: 4 },
      new PwDopplerChain(session.anatomy, seed),
      seed,
      seconds,
    );
    transported += r.transported;
    fresh += r.fresh;
    samples += r.samples;
  }
  return { ratio: transported / fresh, samples };
}

describe('población PW de una vena fina frente a una siembra nueva (decisión 294)', () => {
  it('en apnea, la interlobar conserva el peso de sangre de una siembra nueva', () => {
    // Antes, la sangre avanzaba en recta, salía de la luz curva y la reclasificación parcial la convertía en tejido: ≈0,66.
    const { ratio, samples } = transportedOverFresh('apnea-expiratory', [11, 12, 13, 14], 3);
    expect(samples).toBeGreaterThanOrEqual(60);
    expect(ratio).toBeGreaterThan(0.9);
    expect(ratio).toBeLessThan(1.1);
  });

  it('con respiración tranquila, la interlobar recupera la sangre cada vez que vuelve a la puerta', () => {
    // Antes, la población se vaciaba en cada ciclo y no volvía: ≈0,21 de la siembra nueva con el vaso en la puerta.
    const { ratio, samples } = transportedOverFresh('quiet', [21, 22, 23, 24], 6);
    expect(samples).toBeGreaterThanOrEqual(20);
    expect(ratio).toBeGreaterThan(0.8);
    expect(ratio).toBeLessThan(1.2);
  });

  // Escenario del alumno: puerta colocada en apnea, 10 s de respiración tranquila, apnea otra vez y captura sin mover la
  // puerta. Antes la población se vaciaba un poco más en cada ciclo y la apnea no la reponía: «no-signal» en todas las
  // capturas (peso 0 frente a 0,093 de una siembra nueva) hasta mover la puerta. Ahora la población vuelve a ≈0,84 de una
  // siembra nueva (16 semillas: 0,62–0,98); queda ese déficit residual (`pw-population-after-breathing`). Cuatro semillas
  // de la población por brazo; los umbrales se fijaron con esa distribución medida. Los dos brazos van en pruebas aparte:
  // juntos pasaban de 180 s con la cobertura instrumentada en el check completo.
  function studentScenario(breathe: boolean) {
    const tag = breathe ? 'tras respirar' : 'en apnea';
    let transported = 0;
    let fresh = 0;
    for (const seed of [31, 32, 33, 34]) {
      const session = openSession(SEVERE_CONGESTION, 'apnea-expiratory', 0, 30);
      session.chain = new PwDopplerChain(session.anatomy, seed);
      const contact = probeAt(session, 'renal');
      const best = placeGate(session, contact, RENAL_VEINS, { acoustic: false, maxDepthMm: 170 })!;
      const gateMm = Math.min(4, 2 * best.bd);
      if (breathe) {
        session.patient.respiratoryPattern = 'quiet';
        acquire(session, contact, best, 'renal', { prfHz: 2600, seconds: 10, gateMm });
        session.patient.respiratoryPattern = 'apnea-expiratory';
      }
      const { captures } = acquire(session, contact, best, 'renal', { prfHz: 2600, seconds: 8.5, gateMm });
      const result = captures.at(-1)!.m;
      // Todas las semillas se evalúan y se informan aunque falle una.
      expect.soft(result, `${tag}, semilla ${seed}`).not.toBeNull();
      expect.soft(result?.quality.issue, `${tag}, semilla ${seed}`).toBeNull();
      expect.soft(result && 'pattern' in result && result.pattern, `${tag}, semilla ${seed}`).toBe('monophasic');
      const population = sampleRatio(session, contact, { theta: best.theta, depthMm: best.r, gateMm }, session.chain, seed, 2);
      expect.soft(population.samples, `${tag}, semilla ${seed}`).toBeGreaterThanOrEqual(5);
      transported += population.transported;
      fresh += population.fresh;
    }
    const ratio = transported / fresh;
    expect.soft(ratio, tag).toBeGreaterThan(breathe ? 0.7 : 0.85);
    expect.soft(ratio, tag).toBeLessThan(1.15);
  }

  it('sin haber respirado, la interlobar del caso grave se capta en apnea (brazo de control del escenario)', () => {
    studentScenario(false);
  });

  it('tras respirar y volver a apnea, la interlobar del caso grave se capta como sin haber respirado', () => {
    studentScenario(true);
  });
});
