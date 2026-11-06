import { THORACIC_ATLAS } from '../../../anatomy/thoracicAtlasData';
import type { Vec3 } from '../../../core/vec3';
import { anatomyBundle, fixturePerson, stage } from './state';
export { boneSurfaceFrame, THORACIC_GLSL } from '../../../anatomy/thoracicAtlas';
export let thoracicAtlas: Uint16Array | undefined;
export function setThoracicAtlas(values?: Uint16Array) {
  if (values && values.byteLength !== (anatomyBundle.person === 's0028' ? anatomyBundle.thoracic.rawBytes : THORACIC_ATLAS.rawBytes))
    throw new Error('Campo torácico incompleto');
  thoracicAtlas = values;
  stage({ thoracic: values });
}
export const thoracicValue = (...args: Parameters<ReturnType<typeof fixturePerson>['cpu']['atlas']['thoracicValue']>) =>
  fixturePerson().cpu.atlas.thoracicValue(...args);
export const thoracicSdf = (...args: Parameters<ReturnType<typeof fixturePerson>['cpu']['atlas']['thoracicSdf']>) =>
  fixturePerson().cpu.atlas.thoracicSdf(...args);
export const thoracicMaterial = (...args: Parameters<ReturnType<typeof fixturePerson>['cpu']['atlas']['thoracicMaterial']>) =>
  fixturePerson().cpu.atlas.thoracicMaterial(...args);
export const thoracicGradient = (p: Vec3) => fixturePerson().cpu.atlas.thoracicGradient(p);
export const thoracicFrame = (p: Vec3) => fixturePerson().cpu.atlas.thoracicFrame(p);
