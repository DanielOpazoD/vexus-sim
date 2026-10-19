import { once } from 'node:events';
import { createServer, type Server } from 'node:net';

/** Propaga también el error de listen; esperar solo su callback oculta EPERM hasta el timeout. */
export async function listenLoopback(server: Server): Promise<void> {
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
}

/** Capacidad necesaria para la integración HTTP del core; no inicia Vitest ni conserva un puerto. */
export async function assertLoopbackAvailable(server = createServer()): Promise<void> {
  try {
    await listenLoopback(server);
  } catch (error) {
    throw new Error('El core necesita un puerto local en 127.0.0.1. Cobertura no iniciada; comprueba el permiso de loopback.', {
      cause: error,
    });
  } finally {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}
