import type { AtrialLoad } from './circulation';
import type { PatientState } from './patientState';
import { gauss, type Beat, type RhythmGenerator } from './rhythm';

/**
 * Contorno de presión de la aurícula derecha (base D.7, «modo de calibración»):
 *
 *   P_AD(t) = P̄_AD + p_a + p_c + p_v + p_TR − p_x − p_y + (P_pl − P_pl,esp)
 *
 * Cada latido aporta ondas gaussianas centradas en sus eventos mecánicos; la
 * suma de un latido se centra numéricamente para conservar la media declarada.
 * La media P̄_AD, la rigidez auricular y la IT salen del lazo cerrado (`circulation.ts`,
 * decisión 79): sin intervenciones son las del caso. La media se lee en cada paso; las
 * amplitudes de cada latido (rigidez e IT) se congelan al entrar en juego (0,5 s antes de su
 * R), así que el centrado del latido sigue valiendo aunque el lazo cambie.
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

/** La carga del caso sin intervenciones: su PAD media y su IT. */
export function caseAtrialLoad(p: PatientState): AtrialLoad {
  return { rapMeanMmHg: p.rapMeanMmHg, fillingRapMmHg: p.rapMeanMmHg, tricuspidRegurgitation: p.tricuspidRegurgitation };
}

/**
 * Amplitudes y anchuras de las ondas. La rigidez auricular crece con el llenado por volumen (`fillingRapMmHg`,
 * que no incluye lo que la PEEP sube la PAD: la PEEP comprime la aurícula, no la llena) y la IT es la efectiva
 * del lazo; con la carga del caso, los valores calibrados de siempre.
 */
export function raWaveParams(p: PatientState, load: AtrialLoad = caseAtrialLoad(p)): RaWaveParams {
  const tr = load.tricuspidRegurgitation;
  const stiffness = 1 / Math.max(0.15, p.raCompliance);
  const pressureGain = 1 + 0.04 * Math.max(0, load.fillingRapMmHg - 5);
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
  /** Parámetros de cada latido (congelados al entrar en juego) y su media sobre el RR. */
  private beatCache = new Map<number, { params: RaWaveParams; mean: number | null }>();

  constructor(
    private readonly patient: PatientState,
    private readonly rhythm: RhythmGenerator,
    /** Carga vigente (lazo cerrado); por omisión, la del caso. */
    private readonly load: () => AtrialLoad = () => caseAtrialLoad(patient),
  ) {}

  private entry(b: Beat): { params: RaWaveParams; mean: number | null } {
    let e = this.beatCache.get(b.index);
    if (!e) {
      e = { params: raWaveParams(this.patient, this.load()), mean: null };
      this.beatCache.set(b.index, e);
      if (this.beatCache.size > 256) {
        const first = this.beatCache.keys().next().value;
        if (first !== undefined) this.beatCache.delete(first);
      }
    }
    return e;
  }

  /**
   * Media de la onda de un latido sobre su propio RR: integral sobre todo su
   * soporte temporal dividida por rr. Así la suma de latidos consecutivos
   * conserva la media declarada aunque las gaussianas se solapen.
   */
  private beatMean(b: Beat, e: { params: RaWaveParams; mean: number | null }): number {
    if (e.mean !== null) return e.mean;
    const t0 = b.tR - 0.5;
    const t1 = b.tR + 1.6;
    const n = 420;
    const h = (t1 - t0) / n;
    let acc = 0;
    for (let i = 0; i < n; i++) acc += beatWave(t0 + (i + 0.5) * h, b, e.params);
    e.mean = (acc * h) / b.rr;
    return e.mean;
  }

  /** Componente cardíaca centrada (media ≈ 0) de la presión de AD, mmHg. */
  cardiacComponent(t: number): number {
    // Las ondas de cada latido se suman en todo su soporte; la media se resta
    // solo dentro del intervalo RR del latido en curso, de modo que la suma
    // conserva la media declarada ciclo a ciclo.
    let v = 0;
    for (const b of this.rhythm.beatsAround(t)) {
      const inSupport = t >= b.tR - 0.5 && t <= b.tR + 1.6;
      const inRr = t >= b.tR && t < b.tR + b.rr;
      if (!inSupport && !inRr) continue;
      const e = this.entry(b);
      if (inSupport) v += beatWave(t, b, e.params);
      if (inRr) v -= this.beatMean(b, e);
    }
    return v;
  }

  /** Presión de AD total: media del lazo + ondas + modulación pleural. */
  pressure(t: number, pleuralMmHg: number, pleuralEndExp: number): number {
    return this.load().rapMeanMmHg + this.cardiacComponent(t) + (pleuralMmHg - pleuralEndExp);
  }
}
