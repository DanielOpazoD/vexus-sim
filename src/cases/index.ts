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
  liver: { sinusoidalResistance: 1, compliance: 1, sizeFactor: 1 },
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
  liver: { sinusoidalResistance: 1.1, compliance: 0.8, sizeFactor: 1.1 },
  habitus: { subcutaneousFatMm: 16, muscleMm: 11 },
};

/**
 * Fibrilación auricular con congestión moderada (matriz G.2, caso intermedio,
 * [EXTRAPOLACIÓN PROPIA]): sin onda A, S amortiguada por pérdida de la
 * contribución auricular y VD moderadamente deprimido; RR irregular, con lo que
 * la medición latido a latido exige promediar varios ciclos.
 */
export const AF_MODERATE_CONGESTION: PatientState = {
  id: 'af-moderate-congestion',
  label: 'FA · congestión moderada',
  seed: 20260923,
  heartRateBpm: 96,
  rhythm: 'atrial-fibrillation',
  rrVariability: 0.22,
  prIntervalMs: 160,
  rapMeanMmHg: 13,
  rvFunction: 0.5,
  raCompliance: 0.7,
  atrialFunction: 0,
  tricuspidRegurgitation: 0.35,
  stressedVolume: 1.15,
  intraAbdominalPressureMmHg: 6,
  ventilation: 'spontaneous',
  peepCmH2O: 0,
  respiratoryRateMin: 18,
  respiratoryPattern: 'quiet',
  liver: { sinusoidalResistance: 0.8, compliance: 0.5, sizeFactor: 1.05 },
  habitus: { subcutaneousFatMm: 18, muscleMm: 11 },
};

/**
 * Registro de casos: UNA sola fuente (Fase 1). La clave es el id; antes `CASE_IDS` repetía los
 * ids a mano y un caso añadido solo a `CASES` aparecía en el selector pero se ignoraba.
 * `cases.test` exige que cada clave coincida con el `id` de su paciente.
 */
const REGISTRY = {
  'normal-adult': NORMAL_ADULT,
  'severe-congestion': SEVERE_CONGESTION,
  'af-moderate-congestion': AF_MODERATE_CONGESTION,
} as const satisfies Record<string, PatientState>;

export type CaseId = keyof typeof REGISTRY;
/** Identificadores en el orden del selector. */
export const CASE_IDS = Object.keys(REGISTRY) as CaseId[];
export const CASES: readonly PatientState[] = CASE_IDS.map((id) => REGISTRY[id]);

export function isCaseId(id: string): id is CaseId {
  return (CASE_IDS as readonly string[]).includes(id);
}

export function findCase(id: CaseId): PatientState {
  return REGISTRY[id];
}
