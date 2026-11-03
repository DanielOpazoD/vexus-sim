import { anatomyBundle } from '../anatomy/anatomyBundle';
import type { SourceSurface } from '../anatomy/sourceSurface';
import { abdominalAtlas } from '../anatomy/abdominalAtlas';
import { thoracicAtlas } from '../anatomy/thoracicAtlas';
import cutMapWorkerUrl from './cutMapWorkerUrl';
let preparedWorker: Worker | undefined;
export let s0028Surfaces: readonly SourceSurface[] = [];
export function takeS0028Worker(): Worker | undefined {
  const worker = preparedWorker;
  preparedWorker = undefined;
  return worker;
}
export async function loadS0028Surfaces(signal: AbortSignal): Promise<void> {
  if (anatomyBundle.person !== 's0028') throw new Error('Superficies de otra persona');
  signal.throwIfAborted();
  const worker = new Worker(cutMapWorkerUrl, { type: 'module' });
  try {
    s0028Surfaces = await new Promise<SourceSurface[]>((resolve, reject) => {
      const abort = () => {
        worker.terminate();
        reject(signal.reason instanceof Error ? signal.reason : new Error('Carga cancelada'));
      };
      signal.addEventListener('abort', abort, { once: true });
      worker.onerror = (error) => {
        signal.removeEventListener('abort', abort);
        reject(new Error(error.message));
      };
      worker.onmessage = (event: MessageEvent<{ type: 'surfaces'; surfaces: SourceSurface[] } | { type: 'error'; message: string }>) => {
        if (event.data.type === 'error') {
          signal.removeEventListener('abort', abort);
          reject(new Error(event.data.message));
        } else if (event.data.type === 'surfaces') {
          signal.removeEventListener('abort', abort);
          resolve(event.data.surfaces);
        }
      };
      worker.postMessage({ type: 'surfaces', abdominalField: abdominalAtlas, thoracicField: thoracicAtlas });
    });
    signal.throwIfAborted();
    preparedWorker = worker;
  } catch (error) {
    worker.terminate();
    throw error;
  }
}
