import type { PatientState } from './patientState';
import { gauss, type Beat, type RhythmGenerator } from './rhythm';

/**
 * Contorno de presión de la aurícula derecha (base D.7, «modo de calibración»):
 *
 *   P_AD(t) = P̄_AD + p_a + p_c + p_v + p_TR − p_x − p_y + (P_pl − P_pl,esp)
 *
 * Cada latido aporta ondas gaussianas centradas en sus eventos mecánicos; la
 * suma de un latido se centra numéricamente para conservar la media declarada.
 *
 * Mecanismos representados (D.6, matriz de confusores):
 *  - onda a ∝ contracción auricular;
 *  - descenso x ∝ función longitudinal del VD (descenso anular);
 *  - onda v: llenado con tricúspide cerrada;
 *  - insuficiencia tricuspídea: onda sistólica positiva adicional y reducción
 *    del descenso x (ventricularización);
 *  - distensibilidad auricular baja y PAD alta amplifican las ondas.
 *
 * Amplitudes: [EXTRAPOLACIÓN PROPIA] / NEEDS_CALIBRATION (tools/calibrate.ts).
 */
export interface RaWaveParams {
  aAmp: number;
  cAmp: number;
  xAmp: number;
  vAmp: number;
  yAmp: number;
  trAmp: number;
  aSigma: number;
  cSigma: number;
  xSigma: number;
  vSigma: number;
  ySigma: number;
  trSigma: number;
}

export function raWaveParams(p: PatientState): RaWaveParams {
  const tr = p.tricuspidRegurgitation;
  const stiffness = 1 / Math.max(0.15, p.raCompliance);
  const pressureGain = 1 + 0.04 * Math.max(0, p.rapMeanMmHg - 5);
  const g = stiffness * pressureGain;
  return {
    aAmp: 3.4 * g,
    cAmp: 0.6 * g,
    xAmp: 5.2 * g * p.rvFunction * (1 - 0.65 * tr),
    vAmp: 1.8 * g,
    yAmp: 2.4 * g,
    trAmp: 9 * g * tr * tr,
    aSigma: 0.055,
    cSigma: 0.02,
    xSigma: 0.075,
    vSigma: 0.06,
    ySigma: 0.055,
    trSigma: 0.09,
  };
}

/** Contribución (sin centrar) de un latido a la presión de AD en t. */
function beatWave(t: number, b: Beat, w: RaWaveParams): number {
  let v = 0;
  if (Number.isFinite(b.tP)) v += w.aAmp * b.atrialAmplitude * gauss(t - b.tAtrialContraction, w.aSigma);
  v += w.cAmp * gauss(t - (b.tR + 0.04), w.cSigma);
  v -= w.xAmp * gauss(t - b.tX, w.xSigma);
  v += w.vAmp * gauss(t - b.tV, w.vSigma);
  v += w.trAmp * gauss(t - (b.tX + 0.04), w.trSigma);
  v -= w.yAmp * gauss(t - b.tY, w.ySigma);
  return v;
}

export class RightAtriumModel {
  private params: RaWaveParams;
  private meanCache = new Map<number, number>();

  constructor(
    private readonly patient: PatientState,
    private readonly rhythm: RhythmGenerator,
  ) {
    this.params = raWaveParams(patient);
  }

  /**
   * Media de la onda de un latido sobre su propio RR: integral sobre todo su
   * soporte temporal dividida por rr. Así la suma de latidos consecutivos
   * conserva la media declarada aunque las gaussianas se solapen.
   */
  private beatMean(b: Beat): number {
    const cached = this.meanCache.get(b.index);
    if (cached !== undefined) return cached;
    const t0 = b.tR - 0.5;
    const t1 = b.tR + 1.6;
    const n = 420;
    const h = (t1 - t0) / n;
    let acc = 0;
    for (let i = 0; i < n; i++) acc += beatWave(t0 + (i + 0.5) * h, b, this.params);
    const m = (acc * h) / b.rr;
    this.meanCache.set(b.index, m);
    if (this.meanCache.size > 256) {
      const first = this.meanCache.keys().next().value;
      if (first !== undefined) this.meanCache.delete(first);
    }
    return m;
  }

  /** Componente cardíaca centrada (media ≈ 0) de la presión de AD, mmHg. */
  cardiacComponent(t: number): number {
    // Las ondas de cada latido se suman en todo su soporte; la media se resta
    // solo dentro del intervalo RR del latido en curso, de modo que la suma
    // conserva la media declarada ciclo a ciclo.
    let v = 0;
    for (const b of this.rhythm.beatsAround(t)) {
      if (t >= b.tR - 0.5 && t <= b.tR + 1.6) v += beatWave(t, b, this.params);
      if (t >= b.tR && t < b.tR + b.rr) v -= this.beatMean(b);
    }
    return v;
  }

  /** Presión de AD total: media del paciente + ondas + modulación pleural. */
  pressure(t: number, pleuralMmHg: number, pleuralEndExp: number): number {
    return this.patient.rapMeanMmHg + this.cardiacComponent(t) + (pleuralMmHg - pleuralEndExp);
  }
}
