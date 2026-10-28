import { assert, expect, it } from 'vitest';
import { MECHANICAL_VENTILATION } from '../cases';
import { maxPrfForDepth } from '../app/equipment';
import { prfFromNyquistCms } from '../core/units';
import { measurePhysiologyTruth } from '../vexus/measurements';
import { acquire, openSession, placeGate, probeAt, TR } from './support/studentChain';

it('porta con ventilación: el cambio de escala no acepta una pulsatilidad falsa', () => {
  // Testigo breve de examChainScale: misma semilla, respiración, puerta y secuencia ±20 → ±40.
  // El recambio PW de f6ce803 daba PF 59 frente a 39 y la aceptaba; la matriz completa lo detectó.
  const session = openSession(MECHANICAL_VENTILATION, 'quiet', 0);
  const contact = probeAt(session, 'portalTrunk');
  const gate = placeGate(session, contact, ['pvTrunk']);
  assert(gate, 'sin tronco portal en la ventana');
  for (const scale of [20, 40]) {
    const prfHz = Math.min(prfFromNyquistCms(scale, TR.f0Doppler), maxPrfForDepth(gate.r + 2, 1_540_000));
    const { captures } = acquire(session, contact, gate, 'portal', { prfHz, seconds: 8.5 });
    expect(captures).toHaveLength(1);
    const m = captures.at(-1)?.m;
    // Como en la matriz, una adquisición rechazada no certifica una PF. Se conserva su diagnóstico.
    if (!m || m.quality.issue !== null) continue;
    const first = m.measuredBeats[0];
    const last = m.measuredBeats.at(-1);
    assert(first && last, 'una captura aceptada debe identificar sus latidos');
    const truth = measurePhysiologyTruth(session.engine, { fromT: first.tR - 1e-6, toT: last.tR + last.rr + 1e-6 }).portalPF;
    // Mismo límite por captura que examChainScale; no se ajusta a este candidato.
    expect(Math.abs(m.pulsatilityFraction - truth), `±${scale}: PF ${m.pulsatilityFraction}, verdad ${truth}`).toBeLessThanOrEqual(15);
  }
});
