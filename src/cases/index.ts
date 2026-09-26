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
 * Casos trampa (decisión 82): confusores de VExUS de la literatura revisada el 26-09-2026 con la fisiología que el
 * motor ya tiene. Cada uno parte de un caso de referencia y cambia solo lo que crea el confusor; la discordancia que
 * enseña (grado frente a PAD) la comprueba `traps.test.ts` con la verdad del motor en respiración tranquila y en apnea
 * espiratoria. Lo que el operador sabe (viñeta, `vignettes.ts`) y los confusores reales con la explicación para el
 * docente (`teaching.ts`) van aparte: el PatientState es la verdad latente. Parámetros [EXTRAPOLACIÓN PROPIA].
 */
function trapCase(base: PatientState, id: string, label: string, seed: number, patch: Partial<PatientState>): PatientState {
  return { ...base, liver: { ...base.liver }, habitus: { ...base.habitus }, ...patch, id, label, seed };
}

/**
 * Presión intraabdominal alta con fallo derecho: la PIA por encima de la PAD comprime la VCI abdominal (14–16 mm y
 * colapsable) con la PAD media en 13–14 mmHg; la suprahepática, que drena a la aurícula por encima de la cava abdominal,
 * conserva la S invertida de la IT funcional (0,7, la del caso grave; sin ella sería S < D) con la PAD alta. 16 mmHg es
 * hipertensión intraabdominal de grado II (WSACS: 16–20). 16 y no 20: con 20 la
 * VCI (8,5 mm) se colapsaba tanto que su tramo retrohepático, que en el modelo comparte el calibre de la abdominal y
 * recibe las suprahepáticas, llevaba la sangre a 5,4 m/s (limitación `iah-collapsed-ivc-velocity`).
 */
export const ABDOMINAL_HYPERTENSION = trapCase(
  SEVERE_CONGESTION,
  'abdominal-hypertension',
  'Trampa · PIA alta con fallo derecho',
  20260924,
  {
    intraAbdominalPressureMmHg: 16,
    rapMeanMmHg: 14,
  },
);

/**
 * Insuficiencia tricuspídea grave con la PAD casi normal: la S se invierte por el chorro regurgitante y la VCI de
 * 24 mm abre la puerta del VExUS con la PAD en 8 mmHg (media del ciclo 7): grado 2 sin congestión (los estudios que
 * comparan el VExUS con la PAD toman > 12 mmHg como congestión). IT 0,9 y PAD 8 en vez de 0,8 y 7: con 0,8 la S invertida
 * era de −4 cm/s, a un paso del umbral, y la VCI de 22,2 mm quedaba en la zona de ±2 mm del corte. Que la VCI de esa PAD
 * ya pase de 20 mm es de la ley de la VCI del modelo (`ivc-law-steep`).
 */
export const TRICUSPID_REGURGITATION = trapCase(
  NORMAL_ADULT,
  'tricuspid-regurgitation',
  'Trampa · IT grave con PAD casi normal',
  20260925,
  {
    tricuspidRegurgitation: 0.9,
    rapMeanMmHg: 8,
    rvFunction: 0.7,
  },
);

/**
 * Ventilación con presión positiva sin congestión: con PEEP 10 la pleural de fin de espiración sube 2,9 mmHg, así que
 * la PAD de 7 mmHg del caso deja una transmural de 7,7 (el sano, 8,7): la VCI ve la PAD absoluta y está dilatada y varía
 * poco (grado 1 por la VCI sola), cuando el mismo llenado respirando solo (PAD 4,1) la deja en 16 mm. PAD 7 y no 5: en
 * la pausa espiratoria, que es donde se miden las venas con el ventilador, la VCI con
 * PAD 5 medía 18,9 mm (grado 0) y la trampa desaparecía. La PEEP del caso no mueve la PAD: la PAD del caso es el punto
 * de trabajo del lazo (decisión 79).
 */
export const MECHANICAL_VENTILATION = trapCase(
  NORMAL_ADULT,
  'mechanical-ventilation',
  'Trampa · ventilación mecánica sin congestión',
  20260926,
  { ventilation: 'positive-pressure', peepCmH2O: 10, respiratoryRateMin: 16, rapMeanMmHg: 7 },
);

/**
 * Cirrosis con hipertensión pulmonar y fallo derecho: la resistencia intrahepática ×5 (gradiente portal ≈ 15 mmHg,
 * hipertensión portal clínicamente significativa) amortigua la pulsatilidad que llega a la porta, PF 32–35 % (leve)
 * frente a 69–76 % del mismo corazón sin cirrosis; la suprahepática y el riñón siguen graves. Resistencia ×5 y
 * distensibilidad 0,6, y no ×4 y 0,4: con 0,4 la porta en apnea espiratoria daba 53 % (grave), y con ×4 y 0,6 (41 %) la
 * envolvente del alumno, que sobrestima 5–13 puntos la PF de una porta lenta, leía 46–54 %. 0,6 sigue siendo un hígado
 * más rígido que el congestivo (0,8) y que el sano (1). Tamaño 1 y no 0,9: la cirrosis lo encoge y la congestión lo
 * agranda, y con 0,9 el árbol procedural perdía un cuarto de sus ramas (30 de ≥ 40: las venas principales son las del
 * avatar y sus puntas quedan junto a la cápsula); el tamaño no cambia la fisiología.
 */
export const CIRRHOSIS_PULMONARY_HYPERTENSION = trapCase(
  SEVERE_CONGESTION,
  'cirrhosis-pulmonary-hypertension',
  'Trampa · cirrosis con fallo derecho',
  20260927,
  {
    liver: { sinusoidalResistance: 5, compliance: 0.6, sizeFactor: 1 },
  },
);

/**
 * Registro de casos: UNA sola fuente (Fase 1). La clave es el id; antes `CASE_IDS` repetía los
 * ids a mano y un caso añadido solo a `CASES` aparecía en el selector pero se ignoraba.
 * `cases.test` exige que cada clave coincida con el `id` de su paciente. Los ids de las trampas nombran lo que dice su
 * viñeta, no la trampa (el valor de la opción del selector está en el DOM del alumno).
 */
const REGISTRY = {
  'normal-adult': NORMAL_ADULT,
  'severe-congestion': SEVERE_CONGESTION,
  'af-moderate-congestion': AF_MODERATE_CONGESTION,
  'abdominal-hypertension': ABDOMINAL_HYPERTENSION,
  'tricuspid-regurgitation': TRICUSPID_REGURGITATION,
  'mechanical-ventilation': MECHANICAL_VENTILATION,
  'cirrhosis-pulmonary-hypertension': CIRRHOSIS_PULMONARY_HYPERTENSION,
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
