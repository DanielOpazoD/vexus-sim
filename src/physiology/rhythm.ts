import { SeededRandom } from '../core/random';
import type { PatientState } from './patientState';

/**
 * Generador de eventos eléctricos y mecánicos del corazón (guía §4: el ECG es
 * parte del modelo de señal, no una tira decorativa).
 *
 * Cada latido conserva sus propios tiempos: inicio de P, R, fin de T y los
 * eventos mecánicos derivados (contracción auricular, sístole ventricular,
 * cierre/apertura tricuspídea). Los tiempos mecánicos no se estiran
 * proporcionalmente con el RR: la sístole escala con √RR (relación tipo QT) y
 * la diástasis absorbe el resto (base de conocimiento D.3, [EXTRAPOLACIÓN
 * PROPIA]). La arquitectura admite FA/extrasístoles: basta cambiar cómo se
 * programan los latidos.
 */
export interface Beat {
  /** Índice del latido desde el inicio de la simulación. */
  index: number;
  /** Instante de la onda R (s). */
  tR: number;
  /** Intervalo RR de este latido (hasta la siguiente R), s. */
  rr: number;
  /** Inicio de la onda P (s); NaN si no hay activación auricular organizada. */
  tP: number;
  /** Centro de la contracción auricular mecánica (onda a de presión). */
  tAtrialContraction: number;
  /** Centro del descenso x (sístole ventricular, descenso anular). */
  tX: number;
  /** Centro de la onda v (telesístole, llenado con tricúspide cerrada). */
  tV: number;
  /** Centro del descenso y (apertura tricuspídea, diástole temprana). */
  tY: number;
  /** Fin de la onda T (s). */
  tTend: number;
  /** Amplitud relativa de la contracción auricular de este latido (0–1). */
  atrialAmplitude: number;
}

export class RhythmGenerator {
  private rng: SeededRandom;
  private beats: Beat[] = [];
  private nextIndex = 0;
  private lastR = 0;
  /** Intervalo desde el último latido programado hasta el siguiente (s). */
  private pendingRR = 0;

  constructor(
    private readonly patient: PatientState,
    seed: number,
  ) {
    this.rng = new SeededRandom(seed);
    // Primer latido en t = 0,2 s para que el ECG no empiece a mitad de QRS.
    this.pendingRR = this.nextRR();
    this.lastR = 0.2 - this.pendingRR;
    this.scheduleUntil(4);
  }

  nominalRR(): number {
    return 60 / this.patient.heartRateBpm;
  }

  /** Garantiza latidos programados hasta el instante t (más margen). */
  scheduleUntil(t: number): void {
    while (this.lastR < t + 2) {
      const tR = this.lastR + this.pendingRR;
      // `rr` del latido = intervalo hasta la SIGUIENTE R (contrato de `Beat`): se sortea
      // ahora para que las ventanas [tR, tR + rr] terminen exactamente en la R siguiente.
      this.pendingRR = this.nextRR();
      this.beats.push(this.makeBeat(this.nextIndex++, tR, this.pendingRR));
      this.lastR = tR;
    }
    // Olvidar latidos muy antiguos.
    while (this.beats.length > 64 && this.beats[1].tR < t - 6) this.beats.shift();
  }

  private nextRR(): number {
    const rr0 = this.nominalRR();
    const jitter = this.rng.gaussian() * this.patient.rrVariability;
    return rr0 * Math.max(0.6, 1 + jitter);
  }

  private makeBeat(index: number, tR: number, rr: number): Beat {
    const p = this.patient;
    const pr = p.prIntervalMs / 1000;
    const s = Math.sqrt(rr / 0.8); // factor de escala sistólica (√RR)
    const tP = tR - pr;
    return {
      index,
      tR,
      rr,
      tP,
      // Tabla ilustrativa D.3: A centrada ≈ −40 ms respecto a R con PR 160.
      tAtrialContraction: tP + 0.12,
      tX: tR + 0.16 * s,
      tV: tR + 0.35 * s,
      tY: tR + 0.46 * s,
      tTend: tR + 0.4 * s,
      atrialAmplitude: p.atrialFunction,
    };
  }

  /** Latidos cuyo efecto mecánico puede solaparse con t (anterior y siguiente). */
  beatsAround(t: number): Beat[] {
    this.scheduleUntil(t);
    const out: Beat[] = [];
    for (const b of this.beats) {
      if (b.tR > t + 1.6) break;
      if (b.tR + b.rr + 0.6 < t) continue;
      out.push(b);
    }
    return out;
  }

  /** Último latido con R ≤ t. */
  currentBeat(t: number): Beat {
    this.scheduleUntil(t);
    let cur = this.beats[0];
    for (const b of this.beats) {
      if (b.tR <= t) cur = b;
      else break;
    }
    return cur;
  }

  /** Fase cardíaca 0–1 respecto a la última R. */
  cardiacPhase(t: number): number {
    const b = this.currentBeat(t);
    return Math.min(1, Math.max(0, (t - b.tR) / b.rr));
  }

  /**
   * ECG sintético (derivación II aproximada, mV): suma de gaussianas por onda,
   * anclada a los mismos eventos que gobiernan la mecánica.
   */
  ecg(t: number): number {
    let v = 0;
    for (const b of this.beatsAround(t)) {
      const s = Math.sqrt(b.rr / 0.8);
      if (Number.isFinite(b.tP)) v += 0.15 * b.atrialAmplitude * gauss(t - (b.tP + 0.045), 0.022);
      // QRS: q, R, s
      v += -0.1 * gauss(t - (b.tR - 0.02), 0.008);
      v += 1.0 * gauss(t - b.tR, 0.011);
      v += -0.2 * gauss(t - (b.tR + 0.022), 0.009);
      // T
      v += 0.3 * gauss(t - (b.tR + 0.3 * s), 0.05 * s);
    }
    return v;
  }
}

export function gauss(x: number, sigma: number): number {
  const z = x / sigma;
  return Math.exp(-0.5 * z * z);
}
