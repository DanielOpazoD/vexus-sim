/**
 * Estado del paciente virtual (guía §3.A). Es la «verdad» latente: el alumno
 * no la modifica al mover la sonda. Ningún campo de este objeto es un grado
 * VExUS: el grado se calcula después sobre los observables (guía §5).
 *
 * Todos los valores por defecto están etiquetados en la base de conocimiento
 * como [EXTRAPOLACIÓN PROPIA] (G.1 y hoja consolidada) salvo indicación.
 */
/**
 * Ritmo: sinusal, o fibrilación auricular (RR irregular sin patrón, sin onda P
 * ni contracción auricular organizada; ondas f en el ECG). En FA
 * `atrialFunction` se ignora (vale 0) y `rrVariability` es la dispersión
 * relativa de RR (típica 0,2–0,3).
 */
export type Rhythm = 'sinus' | 'atrial-fibrillation';
export type VentilationMode = 'spontaneous' | 'positive-pressure';
export type RespiratoryPattern = 'quiet' | 'deep' | 'apnea-expiratory' | 'apnea-inspiratory';

export interface PatientState {
  id: string;
  label: string;
  /** Semilla de todas las fuentes estocásticas del caso (guía §20). */
  seed: number;

  // --- Ritmo y frecuencia ---
  heartRateBpm: number;
  rhythm: Rhythm;
  /** Variabilidad RR relativa (0,02 = 2 %). */
  rrVariability: number;
  /** Intervalo PR sintético en ms (hoja consolidada: 160). */
  prIntervalMs: number;

  // --- Hemodinámica derecha (modo de calibración: PAD media impuesta como
  //     condición de contorno, hoja consolidada). ---
  /** Presión auricular derecha media al final de espiración, mmHg. */
  rapMeanMmHg: number;
  /** Función sistólica longitudinal del VD, 0–1 (gobierna el descenso x). */
  rvFunction: number;
  /** Distensibilidad relativa de la AD, 0–1 (1 normal; menor → ondas a/v mayores). */
  raCompliance: number;
  /** Contracción auricular relativa, 0–1 (0 = sin onda a organizada). */
  atrialFunction: number;
  /** Conductancia regurgitante tricuspídea relativa, 0–1 (0 ausente … 1 masiva). */
  tricuspidRegurgitation: number;
  /** Volumen estresado relativo al basal del avatar (hoja: 1,0; 0,6–1,5). */
  stressedVolume: number;

  // --- Presiones externas y respiración ---
  intraAbdominalPressureMmHg: number;
  ventilation: VentilationMode;
  /**
   * PEEP (cmH₂O): solo desplaza la presión pleural (40 %); no tiene efecto hemodinámico porque la PAD
   * se prescribe respecto a la pleural de fin de espiración (`peep-no-hemodynamic-effect`).
   */
  peepCmH2O: number;
  respiratoryRateMin: number;
  respiratoryPattern: RespiratoryPattern;

  // --- Propiedades locales ---
  liver: {
    /** Resistencia sinusoidal relativa (1 normal; >1 fibrosis). */
    sinusoidalResistance: number;
    /** Distensibilidad relativa del compartimento sinusoidal (1 normal). */
    compliance: number;
    /** Tamaño del hígado respecto al avatar basal (1 normal; 1,05–1,12 hepatomegalia congestiva). */
    sizeFactor: number;
  };

  // --- Hábito corporal y ventana ---
  habitus: {
    subcutaneousFatMm: number;
    muscleMm: number;
  };
}

export function clonePatient(p: PatientState): PatientState {
  return JSON.parse(JSON.stringify(p)) as PatientState;
}

/** Comprueba dominios básicos; lanza si un valor es físicamente imposible. */
export function validatePatient(p: PatientState): void {
  const inRange = (v: number, lo: number, hi: number, name: string) => {
    if (!(v >= lo && v <= hi)) throw new Error(`PatientState.${name}=${v} fuera de [${lo}, ${hi}]`);
  };
  inRange(p.heartRateBpm, 30, 220, 'heartRateBpm');
  inRange(p.rapMeanMmHg, -2, 40, 'rapMeanMmHg');
  inRange(p.rvFunction, 0, 1, 'rvFunction');
  inRange(p.raCompliance, 0.1, 2, 'raCompliance');
  inRange(p.atrialFunction, 0, 1, 'atrialFunction');
  inRange(p.tricuspidRegurgitation, 0, 1, 'tricuspidRegurgitation');
  inRange(p.stressedVolume, 0.4, 2, 'stressedVolume');
  inRange(p.intraAbdominalPressureMmHg, 0, 40, 'intraAbdominalPressureMmHg');
  inRange(p.peepCmH2O, 0, 30, 'peepCmH2O');
  inRange(p.respiratoryRateMin, 4, 50, 'respiratoryRateMin');
  inRange(p.liver.sinusoidalResistance, 0.3, 10, 'liver.sinusoidalResistance');
  inRange(p.liver.compliance, 0.2, 3, 'liver.compliance');
  inRange(p.liver.sizeFactor, 0.8, 1.3, 'liver.sizeFactor');
}
