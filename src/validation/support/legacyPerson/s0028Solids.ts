import type { createSolidsQueries } from '../../../anatomy/people/s0028/solids';
import { fixturePerson, stageChecked } from './state';
export type * from '../../../anatomy/people/s0028/solids';
export { S0028_RENAL_FACE_MM, s0028FatPages } from '../../../anatomy/people/s0028/solidsData';
export function setS0028Solids(capacity: ArrayBuffer) {
  stageChecked({ capacity });
}
export const s0028SolidsUploads = (...args: Parameters<ReturnType<typeof createSolidsQueries>['s0028SolidsUploads']>) =>
  fixturePerson().cpu.regional!.s0028SolidsUploads(...args);
export const s0028KidneyGradient = (...args: Parameters<ReturnType<typeof createSolidsQueries>['s0028KidneyGradient']>) =>
  fixturePerson().cpu.regional!.s0028KidneyGradient(...args);
export const s0028CompatibleFat = (...args: Parameters<ReturnType<typeof createSolidsQueries>['s0028CompatibleFat']>) =>
  fixturePerson().cpu.regional!.s0028CompatibleFat(...args);
export const s0028RigidSpan = (...args: Parameters<ReturnType<typeof createSolidsQueries>['s0028RigidSpan']>) =>
  fixturePerson().cpu.regional!.s0028RigidSpan(...args);
export const s0028Owners = (...args: Parameters<ReturnType<typeof createSolidsQueries>['s0028Owners']>) =>
  fixturePerson().cpu.regional!.s0028Owners(...args);
