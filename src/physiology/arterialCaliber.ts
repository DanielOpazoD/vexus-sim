import { gauss, type Beat } from './rhythm';

export interface ArterialMechanics {
  pulsePressureMmHg: number;
  diastolicPulse: number;
  compliancePerMmHg: number;
}

/**
 * Ddiast = 20 mm, ΔD nominal = 1,6 mm (8 %); 2 mm falla PSV sin compensar Q. EXTRAPOLACIÓN PROPIA / NEEDS_CALIBRATION.
 * El máximo nominal de las dos gaussianas es 1,0569487134195235 sobre el pie −0,3.
 * Referencia fija: NO se renormaliza con el máximo futuro de cada latido (FA incluida).
 * P* = Pmedia + 18·pulse; PdiastRef = Pmedia − 5,4 mmHg. Decisión 313.
 */
export const AORTA_MECHANICS: Readonly<ArterialMechanics> = {
  pulsePressureMmHg: 18,
  diastolicPulse: -0.3,
  compliancePerMmHg: 0.08 / (18 * 1.0569487134195235),
};

/** Mismo contorno arterial de la red; el retraso mecánico ya está en los centros de las gaussianas. */
export function arterialCaliberAt({ t, beats, mechanics }: { t: number; beats: readonly Beat[]; mechanics: ArterialMechanics }): {
  pulse: number;
  radiusScale: number;
  radiusScaleRateS: number;
} {
  let pulse = -0.3;
  let rate = 0;
  for (const b of beats) {
    const s = Math.sqrt(b.rr / 0.8);
    const tau = t - b.tR;
    const a = gauss(tau - 0.12 * s, 0.06 * s);
    const c = 0.4 * gauss(tau - 0.3 * s, 0.09 * s);
    pulse += a + c;
    rate -= (a * (tau - 0.12 * s)) / (0.06 * s) ** 2 + (c * (tau - 0.3 * s)) / (0.09 * s) ** 2;
  }
  const gain = mechanics.compliancePerMmHg * mechanics.pulsePressureMmHg;
  return { pulse, radiusScale: 1 + gain * (pulse - mechanics.diastolicPulse), radiusScaleRateS: gain * rate };
}
