import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { sharedCutMapWorker } from '../../tools/build/sharedCutMapWorker';

// Vite envuelve import() con este helper también en el Worker emitido en el grafo de página.
const helper = `function preload(baseModule, deps, importerUrl) {
  document.querySelector('meta[property=csp-nonce]');
  return baseModule().catch(error => { window.dispatchEvent(error); throw error; });
}
preload;`;
function compile(code = helper, globals = {}) {
  const transform = sharedCutMapWorker().transform as (code: string, id: string) => { code: string } | null;
  return runInNewContext(transform(code, '\0vite/preload-helper.js')?.code ?? code, globals) as (
    factory: () => Promise<unknown>,
    deps: string[],
  ) => Promise<unknown>;
}

describe('preload del Worker compartido', () => {
  it('importa CPU sin document/window incluso con dependencias para precarga', async () => {
    await expect(compile()(() => Promise.resolve('cpu'), ['shared.js'])).resolves.toBe('cpu');
  });
  it('conserva el rechazo del chunk sin sustituirlo por un error de DOM', async () => {
    const error = new Error('CPU chunk HTTP 404');
    await expect(compile()(() => Promise.reject(error), ['shared.js'])).rejects.toBe(error);
  });
  it('conserva la ruta de precarga y notificación de error en la página', async () => {
    const events: unknown[] = [];
    let queries = 0;
    const preload = compile(helper, {
      document: { querySelector: () => queries++ },
      window: { dispatchEvent: (event: unknown) => events.push(event) },
    });
    const error = new Error('page chunk');
    await expect(preload(() => Promise.reject(error), [])).rejects.toBe(error);
    expect(queries).toBe(1);
    expect(events).toEqual([error]);
  });
  it('falla cerrado si una actualización de Vite cambia el helper', () => {
    expect(() => compile('function differentHelper() {}')).toThrow('Helper preload de Vite incompatible');
  });
});
