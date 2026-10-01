import { loadReferenceBody } from './anatomy/referenceBody';

// No scene or worker exists until the reference field has loaded successfully.
// An explicit legacy torso remains available for comparisons and regression fixtures.
async function start(): Promise<void> {
  try {
    if (new URLSearchParams(location.search).get('torso') !== 'legacy') await loadReferenceBody();
    await import('./bootstrap');
  } catch (error) {
    const message = document.createElement('div');
    message.className = 'error';
    message.textContent = `No se pudo iniciar el simulador: ${error instanceof Error ? error.message : String(error)}`;
    document.body.replaceChildren(message);
    console.error(error);
  }
}
void start();
