import { CURRENT_BUNDLE, LEGACY_BUNDLE } from '../../../anatomy/anatomyBundle';
import { S0028_BUNDLE } from '../../../anatomy/people/s0028/descriptor';
import { selectPerson } from '../../../anatomy/selectPerson';
import { select } from './state';
export * from '../../../anatomy/anatomyBundle';
export { anatomyBundle } from './state';
export { S0028_BUNDLE };
export const installAnatomyBundle = select;
export function selectAnatomy(params: URLSearchParams) {
  const person = selectPerson(params);
  return person === 's0028' ? S0028_BUNDLE : person === 'legacy' ? LEGACY_BUNDLE : CURRENT_BUNDLE;
}
