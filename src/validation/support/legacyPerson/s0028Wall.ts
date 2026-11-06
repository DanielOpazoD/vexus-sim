import type { createWallQueries } from '../../../anatomy/people/s0028/wall';
import { fixturePerson, stageChecked } from './state';
export type * from '../../../anatomy/people/s0028/wall';
export function setS0028Wall(capacity: ArrayBuffer, skin: ArrayBuffer) {
  stageChecked({ capacity, skin });
}
export const s0028WallUploads = (...args: Parameters<ReturnType<typeof createWallQueries>['s0028WallUploads']>) =>
  fixturePerson().cpu.regional!.s0028WallUploads(...args);
export const s0028SkinPoint = (...args: Parameters<ReturnType<typeof createWallQueries>['s0028SkinPoint']>) =>
  fixturePerson().cpu.regional!.s0028SkinPoint(...args);
export const s0028WallSurface = (...args: Parameters<ReturnType<typeof createWallQueries>['s0028WallSurface']>) =>
  fixturePerson().cpu.regional!.s0028WallSurface(...args);
export const s0028WallAt = (...args: Parameters<ReturnType<typeof createWallQueries>['s0028WallAt']>) =>
  fixturePerson().cpu.regional!.s0028WallAt(...args);
export const s0028WallFaceGradient = (...args: Parameters<ReturnType<typeof createWallQueries>['s0028WallFaceGradient']>) =>
  fixturePerson().cpu.regional!.s0028WallFaceGradient(...args);
export const s0028InsideWall = (...args: Parameters<ReturnType<typeof createWallQueries>['s0028InsideWall']>) =>
  fixturePerson().cpu.regional!.s0028InsideWall(...args);
export const s0028ContactInside = (...args: Parameters<ReturnType<typeof createWallQueries>['s0028ContactInside']>) =>
  fixturePerson().cpu.regional!.s0028ContactInside(...args);
export const s0028ContactFace = (...args: Parameters<ReturnType<typeof createWallQueries>['s0028ContactFace']>) =>
  fixturePerson().cpu.regional!.s0028ContactFace(...args);
export const s0028RespiratoryWall = (...args: Parameters<ReturnType<typeof createWallQueries>['s0028RespiratoryWall']>) =>
  fixturePerson().cpu.regional!.s0028RespiratoryWall(...args);
export const s0028RespiratoryRamp = (...args: Parameters<ReturnType<typeof createWallQueries>['s0028RespiratoryRamp']>) =>
  fixturePerson().cpu.regional!.s0028RespiratoryRamp(...args);
