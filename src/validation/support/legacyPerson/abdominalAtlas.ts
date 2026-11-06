import { ABDOMINAL_ATLAS } from '../../../anatomy/abdominalAtlasData';
import type { Vec3 } from '../../../core/vec3';
import { anatomyBundle, fixturePerson, stage } from './state';
export { ABDOMINAL_ATLAS_GLSL } from '../../../anatomy/abdominalAtlas';
export let abdominalAtlas: Uint16Array | undefined;
export function setAbdominalAtlas(values?: Uint16Array) {
  if (values && values.byteLength !== (anatomyBundle.person === 's0028' ? anatomyBundle.abdominal.rawBytes : ABDOMINAL_ATLAS.rawBytes))
    throw new Error('Campo abdominal incompleto');
  abdominalAtlas = values;
  stage({ abdominal: values });
}
export const abdominalAtlasValue = (...args: Parameters<ReturnType<typeof fixturePerson>['cpu']['atlas']['abdominalAtlasValue']>) =>
  fixturePerson().cpu.atlas.abdominalAtlasValue(...args);
export const abdominalAtlasSdf = (...args: Parameters<ReturnType<typeof fixturePerson>['cpu']['atlas']['abdominalAtlasSdf']>) =>
  fixturePerson().cpu.atlas.abdominalAtlasSdf(...args);
export const registeredDomeHeight = (...args: Parameters<ReturnType<typeof fixturePerson>['cpu']['atlas']['registeredDomeHeight']>) =>
  fixturePerson().cpu.atlas.registeredDomeHeight(...args);
export const registeredDomeValue = (x: number, y: number) => fixturePerson().cpu.atlas.registeredDomeValue(x, y);
export const registeredDomeSample = (...args: Parameters<ReturnType<typeof fixturePerson>['cpu']['atlas']['registeredDomeSample']>) =>
  fixturePerson().cpu.atlas.registeredDomeSample(...args);
export const hepaticDomeValue = (...args: Parameters<ReturnType<typeof fixturePerson>['cpu']['atlas']['hepaticDomeValue']>) =>
  fixturePerson().cpu.atlas.hepaticDomeValue(...args);
export const abdominalAtlasGradient = (p: Vec3, field: number) => fixturePerson().cpu.atlas.abdominalAtlasGradient(p, field);
export const s0028DepthXyz = (...args: Parameters<NonNullable<ReturnType<typeof fixturePerson>['cpu']['regional']>['s0028DepthXyz']>) =>
  fixturePerson().cpu.regional?.s0028DepthXyz(...args);
export const s0028Depth = (...args: Parameters<NonNullable<ReturnType<typeof fixturePerson>['cpu']['regional']>['s0028Depth']>) =>
  fixturePerson().cpu.regional?.s0028Depth(...args);
export const s0028DepthGradient = (
  ...args: Parameters<NonNullable<ReturnType<typeof fixturePerson>['cpu']['regional']>['s0028DepthGradient']>
) => fixturePerson().cpu.regional?.s0028DepthGradient(...args);
export const sourceGas = (...args: Parameters<NonNullable<ReturnType<typeof fixturePerson>['cpu']['regional']>['sourceGas']>) =>
  fixturePerson().cpu.regional?.sourceGas(...args);
