import { selectAnatomy, installAnatomyBundle } from './anatomy/anatomyBundle';
import { loadReferenceBody } from './anatomy/loadReferenceBody';
import { loadAbdominalAtlas } from './anatomy/loadAbdominalAtlas';

// No scene or worker exists until the reference field has loaded successfully.
// An explicit legacy torso remains available for comparisons and regression fixtures.
async function start(): Promise<void> {
  try {
    const bundle = selectAnatomy(new URLSearchParams(location.search));
    const controller = new AbortController();
    window.addEventListener('pagehide', () => controller.abort(), { once: true });
    if (bundle.person === 's0028') {
      await (await import('./anatomy/loadS0028')).loadS0028(controller.signal);
    } else {
      installAnatomyBundle(bundle);
      if (bundle.person === 'current') await loadAbdominalAtlas();
    }
    if (new URLSearchParams(location.search).get('reference') === '1') await loadReferenceBody();
    await (await import('./bootstrap')).start();
  } catch (error) {
    const message = document.createElement('div');
    message.className = 'error';
    message.textContent = `No se pudo iniciar el simulador: ${error instanceof Error ? error.message : String(error)}`;
    document.body.replaceChildren(message);
    console.error(error);
  }
}
void start();
