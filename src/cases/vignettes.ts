import type { CaseId } from './index';

/**
 * Viñeta de cada caso (decisión 82): lo que el operador sabe antes de medir (historia, ventilador, presión vesical,
 * ECG), sin nombrar el diagnóstico ni el grado. La ve también el alumno, en la pestaña Medir, así que viaja en el chunk
 * principal; los confusores reales y la explicación de la trampa van aparte, en `teaching.ts`, que solo carga la
 * pestaña Docente. Fuera del `PatientState`, que es la verdad latente del motor. `blindMode.test.ts` exige que ninguna
 * delate el grado, la congestión, la trampa o la PAD.
 */
export const CASE_VIGNETTES: Readonly<Record<CaseId, string>> = {
  'normal-adult':
    'Varón de 30 años sin antecedentes ni medicación, voluntario en un taller de ecografía. Respira espontáneamente; ECG en ritmo sinusal.',
  'severe-congestion':
    'Mujer de 72 años con disnea progresiva, edemas en las piernas y oliguria desde hace dos semanas; la creatinina sube desde el ingreso. Respira espontáneamente; ECG en ritmo sinusal.',
  'af-moderate-congestion':
    'Varón de 68 años con palpitaciones y disnea de una semana. ECG: fibrilación auricular a unos 95 lpm. Respira espontáneamente.',
  'abdominal-hypertension':
    'Varón de 64 años en el segundo día tras una laparotomía urgente por obstrucción intestinal: abdomen distendido y tenso, oliguria. Presión vesical 16 mmHg. Tiene hipertensión pulmonar con disfunción del ventrículo derecho e insuficiencia tricuspídea. Respira espontáneamente; ECG en ritmo sinusal.',
  'tricuspid-regurgitation':
    'Varón de 59 años en control por insuficiencia tricuspídea grave (ecocardiograma del mes pasado, FEVI conservada). Asintomático, sin edemas y con el peso estable con su diurético habitual. Respira espontáneamente; ECG en ritmo sinusal.',
  'mechanical-ventilation':
    'Mujer de 52 años intubada en la UCI por una neumonía grave, sedada, en ventilación controlada por volumen: PEEP 10 cmH₂O y frecuencia 16/min. Balance hídrico neutro en las últimas 48 h; ECG en ritmo sinusal.',
  'cirrhosis-pulmonary-hypertension':
    'Varón de 61 años con cirrosis alcohólica y varices esofágicas ligadas; la ascitis está controlada con diuréticos. Un ecocardiograma reciente mostró hipertensión pulmonar con el ventrículo derecho dilatado. Ingresa por disnea y edemas en las piernas. Respira espontáneamente; ECG en ritmo sinusal.',
};
