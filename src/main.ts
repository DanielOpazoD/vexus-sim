import { loadReferenceBody } from './anatomy/loadReferenceBody';
import { loadAbdominalAtlas } from './anatomy/loadAbdominalAtlas';
import { gpuPageTurns } from './app/gpuPageTurns';
import { markStartup } from './app/startupTrace';

// No scene or worker exists until the reference field has loaded successfully.
// An explicit legacy torso remains available for comparisons and regression fixtures.
async function start(): Promise<void> {
  try {
    if (new URLSearchParams(location.search).get('abdomen') !== 'legacy') await loadAbdominalAtlas();
    if (new URLSearchParams(location.search).get('reference') === '1') await loadReferenceBody();
    markStartup('bootstrap:begin');
    await gpuPageTurns.prepare();
    await import('./bootstrap');
  } catch (error) {
    gpuPageTurns.dispose();
    const message = document.createElement('div');
    message.className = 'error';
    message.textContent = `No se pudo iniciar el simulador: ${error instanceof Error ? error.message : String(error)}`;
    document.body.replaceChildren(message);
    console.error(error);
  }
}
void start();
