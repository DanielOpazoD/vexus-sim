import type { PatientState } from '../physiology/patientState';

/**
 * Casos de la iteración 1 (guía §9): un adulto fisiológicamente normal y una
 * congestión venosa marcada. Ambos usan el MISMO motor; solo cambian los
 * parámetros. Los objetivos numéricos proceden de la matriz G.2 de la base
 * (casos 1 y 5, [EXTRAPOLACIÓN PROPIA]); ningún parámetro es un grado VExUS.
 */
export const NORMAL_ADULT: PatientState = {
  id: 'normal-adult',
  label: 'Adulto sano euvolémico',
  seed: 20260921,
  heartRateBpm: 70,
  rhythm: 'sinus',
  rrVariability: 0.03,
  prIntervalMs: 160,
  rapMeanMmHg: 5,
  rvFunction: 0.85,
  raCompliance: 1.0,
  atrialFunction: 0.8,
  tricuspidRegurgitation: 0.05,
  stressedVolume: 1.0,
  intraAbdominalPressureMmHg: 5,
  ventilation: 'spontaneous',
  peepCmH2O: 0,
  respiratoryRateMin: 14,
  respiratoryPattern: 'quiet',
  liver: { sinusoidalResistance: 1, compliance: 1 },
  habitus: { subcutaneousFatMm: 14, muscleMm: 12 },
};

export const SEVERE_CONGESTION: PatientState = {
  id: 'severe-congestion',
  label: 'Congestión venosa grave (fallo derecho)',
  seed: 20260922,
  heartRateBpm: 92,
  rhythm: 'sinus',
  rrVariability: 0.02,
  prIntervalMs: 170,
  rapMeanMmHg: 18,
  rvFunction: 0.3,
  raCompliance: 0.55,
  atrialFunction: 0.7,
  tricuspidRegurgitation: 0.7,
  stressedVolume: 1.3,
  intraAbdominalPressureMmHg: 7,
  ventilation: 'spontaneous',
  peepCmH2O: 0,
  respiratoryRateMin: 20,
  respiratoryPattern: 'quiet',
  liver: { sinusoidalResistance: 1.1, compliance: 0.8 },
  habitus: { subcutaneousFatMm: 16, muscleMm: 11 },
};

export const CASES: PatientState[] = [NORMAL_ADULT, SEVERE_CONGESTION];

export function findCase(id: string): PatientState {
  const c = CASES.find((x) => x.id === id);
  if (!c) throw new Error(`Caso desconocido: ${id}`);
  return c;
}
