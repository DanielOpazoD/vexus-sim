import { validateReferenceBody } from '../../../anatomy/referenceBody';
import { stage } from './state';
export * from '../../../anatomy/referenceBody';
export let abdominalBody: Float32Array | undefined;
export let referenceBody: Float32Array | undefined;
export function setReferenceBody(values?: Float32Array) {
  referenceBody = values ? validateReferenceBody(values) : undefined;
  stage({ reference: referenceBody });
}
export function setAbdominalBody(values?: Float32Array) {
  if (values && values.length !== 14 * 65) throw new Error('Perfil abdominal inválido');
  abdominalBody = values ? validateReferenceBody(values) : undefined;
  stage({ body: abdominalBody });
}
