import type { InstalledPerson } from './person';
import { selectPerson } from './selectPerson';
/** The two selected edges are audited by the production bundle graph. No fallback. */
export async function loadPerson(params: URLSearchParams, signal: AbortSignal): Promise<InstalledPerson> {
  const person = selectPerson(params);
  signal.throwIfAborted();
  const installed =
    person === 's0028'
      ? await (await import('./people/s0028/runtime')).loadPerson(signal)
      : await (await import('./people/default/runtime')).loadPerson(signal, person === 'legacy', params.get('reference') === '1');
  signal.throwIfAborted();
  return installed;
}
