import { AnatomyScene as CoreScene } from '../../../anatomy/scene';
import type { PatientState } from '../../../physiology/patientState';
import { fixturePerson } from './state';
export * from '../../../anatomy/scene';
export class AnatomyScene extends CoreScene {
  constructor(patient: PatientState, body?: Float32Array, person = fixturePerson()) {
    super(patient, body, person);
  }
}
