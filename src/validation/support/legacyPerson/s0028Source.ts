import type { createSourceQueries } from '../../../anatomy/people/s0028/atlas';
import { fixturePerson } from './state';
export const s0028SourceValue = (...args: Parameters<ReturnType<typeof createSourceQueries>['s0028SourceValue']>) =>
  fixturePerson().cpu.regional!.s0028SourceValue(...args);
