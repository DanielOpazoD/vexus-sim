import type { SourceVolume } from './sourceVolume';
export interface PersonField extends SourceVolume {
  readonly name: string;
  readonly asset: 'abdominal' | 'thoracic';
}
export interface PersonDescriptors {
  readonly fields: readonly PersonField[];
  readonly depth: SourceVolume;
}
export const CURRENT_BUNDLE = Object.freeze({ person: 'current', frameId: 'registered-las-v1', revision: 'current' } as const);
export const LEGACY_BUNDLE = Object.freeze({ person: 'legacy', frameId: 'procedural-las-v1', revision: 'current' } as const);
export interface AnatomyIdentity {
  readonly person: 'current' | 'legacy' | 's0028';
  readonly frameId: string;
  readonly revision: string;
}
