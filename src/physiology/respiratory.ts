import { cmH2OToMmHg } from '../core/units';
import type { PatientState } from './patientState';

/**
 * Modelo respiratorio (guía §15; base B.4 y D.6): una fase compartida que
 * produce (1) fracción de volumen inspirado v(t) ∈ [0,1], (2) presión pleural,
 * (3) presión abdominal y (4) amplitud de desplazamiento diafragmático.
 *
 * Espontánea: inspiración activa (presión pleural más negativa, presión
 * abdominal algo mayor por descenso diafragmático). Presión positiva: la
 * inspiración eleva la presión pleural. La PEEP se transmite a la pleura con
 * una fracción (hoja consolidada) en los dos modos: con respiración espontánea
 * es una CPAP (decisión 79); lo que sube la PAD lo decide el lazo cerrado
 * (`circulation.ts`). Todos los coeficientes son [EXTRAPOLACIÓN PROPIA] /
 * NEEDS_CALIBRATION.
 */
export interface RespiratorySample {
  /** Hay un ciclo activo (la pausa sostiene la referencia espiratoria o inspiratoria). */
  cycling: boolean;
  /** Fase 0–1 del ciclo respiratorio; en pausa es la fase sostenida. */
  phase: number;
  /** Fracción de volumen inspirado 0–1. */
  volume: number;
  /** dv/dt (1/s), útil para velocidades tisulares. */
  volumeRate: number;
  pleuralMmHg: number;
  abdominalMmHg: number;
  /** Desplazamiento caudal del diafragma/hígado respecto a espiración, mm (≥0). */
  diaphragmCaudalMm: number;
  /** Velocidad caudal del diafragma, mm/s. */
  diaphragmVelocityMmS: number;
}

const PLEURAL_BASELINE_MMHG = cmH2OToMmHg(-5);
const PLEURAL_SWING_SPONT_MMHG = cmH2OToMmHg(-3);
const PLEURAL_SWING_PPV_MMHG = cmH2OToMmHg(6);
/** Fracción de la PEEP que llega a la pleura (hoja consolidada). */
export const PEEP_PLEURAL_TRANSMISSION = 0.4;
const ABDOMINAL_SWING_SPONT_MMHG = 1.0;
const ABDOMINAL_SWING_PPV_MMHG = 1.0;

/** Subida de la presión pleural de fin de espiración que da una PEEP (mmHg). */
export function peepPleuralShiftMmHg(peepCmH2O: number): number {
  return cmH2OToMmHg(peepCmH2O) * PEEP_PLEURAL_TRANSMISSION;
}

export class RespiratoryModel {
  /** PEEP vigente (cmH₂O): la del caso; el motor la cambia con la intervención (decisión 79). */
  peepCmH2O: number;

  constructor(private readonly patient: PatientState) {
    this.peepCmH2O = patient.peepCmH2O;
  }

  /** Excursión craneocaudal del diafragma para el patrón (B.6: 10 mm tranquila). */
  excursionMm(): number {
    switch (this.patient.respiratoryPattern) {
      case 'deep':
      case 'apnea-inspiratory':
        return 30;
      default:
        return 10;
    }
  }

  sample(t: number): RespiratorySample {
    const p = this.patient;
    const period = 60 / p.respiratoryRateMin;
    const phase = (((t / period) % 1) + 1) % 1;
    let volume: number;
    let volumeRate: number;
    const pattern = p.respiratoryPattern;
    if (pattern === 'apnea-expiratory') {
      volume = 0;
      volumeRate = 0;
    } else if (pattern === 'apnea-inspiratory') {
      volume = 1;
      volumeRate = 0;
    } else {
      // Inspiración 40 % del ciclo (coseno elevado), espiración 50 % (decaimiento
      // suave), pausa espiratoria 10 %.
      const ti = 0.4;
      const te = 0.5;
      if (phase < ti) {
        const u = phase / ti;
        volume = 0.5 - 0.5 * Math.cos(Math.PI * u);
        volumeRate = (0.5 * Math.PI * Math.sin(Math.PI * u)) / (ti * period);
      } else if (phase < ti + te) {
        const u = (phase - ti) / te;
        // Decaimiento tipo (1−u)^2 suavizado con coseno para derivada continua.
        volume = 0.5 + 0.5 * Math.cos(Math.PI * u);
        volumeRate = (-0.5 * Math.PI * Math.sin(Math.PI * u)) / (te * period);
      } else {
        volume = 0;
        volumeRate = 0;
      }
    }
    const excursion = this.excursionMm();
    const spontaneous = p.ventilation === 'spontaneous';
    const pleural =
      PLEURAL_BASELINE_MMHG +
      peepPleuralShiftMmHg(this.peepCmH2O) +
      (spontaneous ? PLEURAL_SWING_SPONT_MMHG : PLEURAL_SWING_PPV_MMHG) * volume;
    const abdominal = p.intraAbdominalPressureMmHg + (spontaneous ? ABDOMINAL_SWING_SPONT_MMHG : ABDOMINAL_SWING_PPV_MMHG) * volume;
    return {
      cycling: pattern === 'quiet' || pattern === 'deep',
      phase: pattern === 'apnea-expiratory' ? 0 : pattern === 'apnea-inspiratory' ? 0.4 : phase,
      volume,
      volumeRate,
      pleuralMmHg: pleural,
      abdominalMmHg: abdominal,
      diaphragmCaudalMm: excursion * volume,
      diaphragmVelocityMmS: excursion * volumeRate,
    };
  }

  /** Presión pleural de fin de espiración (para centrar la PAD «al final de espiración»). */
  pleuralAtEndExpiration(): number {
    return PLEURAL_BASELINE_MMHG + peepPleuralShiftMmHg(this.peepCmH2O);
  }
}
