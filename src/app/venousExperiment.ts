import { NORMAL_ADULT } from '../cases';
import { clonePatient, validatePatient, type PatientState } from '../physiology/patientState';

/** Parameters already represented by the current pressure-driven model.
 * These are independent scenario boundaries, not validated causal interventions.
 */
export const VENOUS_EXPERIMENT_FIELDS = [
  { key: 'heartRateBpm', label: 'Frecuencia cardíaca sinusal', unit: 'lpm', min: 50, max: 120, step: 1 },
  { key: 'rapMeanMmHg', label: 'PAD basal', unit: 'mmHg', min: 2, max: 25, step: 0.5 },
  { key: 'intraAbdominalPressureMmHg', label: 'Presión intraabdominal', unit: 'mmHg', min: 0, max: 25, step: 0.5 },
  { key: 'rvFunction', label: 'Función sistólica VD (modelo)', unit: 'relativa', min: 0.2, max: 1, step: 0.05 },
  { key: 'tricuspidRegurgitation', label: 'Regurgitación tricuspídea (modelo)', unit: 'relativa', min: 0, max: 1, step: 0.05 },
  { key: 'raCompliance', label: 'Distensibilidad AD (modelo)', unit: 'relativa', min: 0.3, max: 2, step: 0.05 },
  { key: 'venousReservoirCompliance', label: 'Compliance reservorios venosos', unit: 'relativa', min: 0.5, max: 2, step: 0.05 },
] as const;
export type VenousExperimentKey = (typeof VENOUS_EXPERIMENT_FIELDS)[number]['key'];
export type VenousExperimentParameters = Required<Pick<PatientState, VenousExperimentKey>>;

/** A bounded, explicit adult scenario. Never mutate a case singleton or the observed patient. */
export function venousExperimentPatient(parameters: VenousExperimentParameters): PatientState {
  const p = clonePatient(NORMAL_ADULT);
  for (const field of VENOUS_EXPERIMENT_FIELDS) {
    const value = parameters[field.key];
    if (!Number.isFinite(value) || value < field.min || value > field.max)
      throw new RangeError(`Parámetro experimental fuera de dominio: ${field.key}`);
    p[field.key] = value;
  }
  p.id = 'venous-experiment';
  p.label = `Experimento hemodinámico · sinusal ${p.heartRateBpm} lpm`;
  p.respiratoryPattern = 'apnea-expiratory';
  validatePatient(p);
  return p;
}

/** Continuous control coordinates. The engine never receives a VExUS grade.
 * Endpoints reflect the existing normal/severe parameter range while anatomy remains normal.
 */
export function congestionParameters(fraction: number): VenousExperimentParameters {
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) throw new RangeError('Progresión fuera de [0,1]');
  return {
    heartRateBpm: NORMAL_ADULT.heartRateBpm,
    rapMeanMmHg: 5 + 13 * fraction,
    intraAbdominalPressureMmHg: 5 + 2 * fraction,
    rvFunction: 0.85 - 0.55 * fraction,
    tricuspidRegurgitation: 0.05 + 0.65 * fraction,
    raCompliance: 1 - 0.45 * fraction,
    venousReservoirCompliance: 1,
  };
}

import { AnatomyScene } from '../anatomy/scene';
import { AnatomyQuery } from '../anatomy/query';
import { PhysiologyEngine } from '../physiology/engine';

/** Independent steady-state experiment; advancing it never mutates the observed patient.
 * Warm-up is work-bounded so a control change does not integrate 30 seconds in one UI turn.
 */
export class VenousExperiment {
  readonly patient: PatientState;
  readonly anatomy: AnatomyQuery;
  readonly engine: PhysiologyEngine;
  private remaining = 7500;
  constructor(parameters: VenousExperimentParameters) {
    this.patient = venousExperimentPatient(parameters);
    const scene = new AnatomyScene(this.patient);
    this.anatomy = new AnatomyQuery(scene);
    this.engine = new PhysiologyEngine(this.patient, scene.vesselAreas());
  }
  get ready(): boolean {
    return this.remaining === 0;
  }
  advance(elapsedSeconds: number): void {
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) throw new RangeError('Tiempo experimental inválido');
    if (this.remaining > 0) {
      const steps = Math.min(250, this.remaining);
      for (let i = 0; i < steps; i++) this.engine.step();
      this.remaining -= steps;
    } else this.engine.advanceRealTime(Math.min(elapsedSeconds, 0.1));
  }
}
