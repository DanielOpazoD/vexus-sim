import { loadPerson } from './anatomy/loadPerson';
async function start(): Promise<void> {
  const controller = new AbortController();
  window.addEventListener('pagehide', () => controller.abort(), { once: true });
  try {
    const person = await loadPerson(new URLSearchParams(location.search), controller.signal);
    const bootstrap = await import('./bootstrap');
    controller.signal.throwIfAborted();
    await bootstrap.start(person, controller.signal);
  } catch (error) {
    if (controller.signal.aborted) return;
    const message = document.createElement('div');
    message.className = 'error';
    const person = new URLSearchParams(location.search).get('abdomen') ?? 'default';
    message.textContent = `No se pudo cargar ${person} (inicio): ${error instanceof Error ? error.message : String(error)}`;
    const retry = document.createElement('button');
    retry.textContent = 'Recargar esta persona';
    retry.onclick = () => location.reload();
    message.append(retry);
    document.body.replaceChildren(message);
    console.error(error);
  }
}
void start();
