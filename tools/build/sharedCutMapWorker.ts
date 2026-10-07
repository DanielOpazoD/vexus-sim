import { join } from 'node:path';
import { normalizePath, type Plugin } from 'vite';

/** Una entrada ES del mismo grafo comparte código CPU, sin compartir estado entre entornos. */
export function sharedCutMapWorker(): Plugin {
  let entry = '';
  let urlModule = '';
  return {
    name: 'shared-cut-map-worker',
    apply: 'build',
    enforce: 'pre',
    configResolved(config) {
      entry = normalizePath(join(config.root, 'src/ui/cutMapWorker.ts'));
      urlModule = normalizePath(join(config.root, 'src/ui/cutMapWorkerUrl.ts'));
    },
    transform(_code, id) {
      if (normalizePath(id) !== urlModule) return null;
      const ref = this.emitFile({ type: 'chunk', id: entry, name: 'cutMapWorker' });
      return { code: `export default import.meta.ROLLDOWN_FILE_URL_${ref};`, map: null };
    },
  };
}
