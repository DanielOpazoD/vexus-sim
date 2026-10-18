import { createServer } from 'node:net';
import { expect, it, vi } from 'vitest';
import { assertLoopbackAvailable, listenLoopback } from '../../tools/workspace/loopback';

it('rechaza el error de listen sin dejar una espera ni un error sin receptor', async () => {
  const server = createServer();
  const error = Object.assign(new Error('listen denied'), { code: 'EPERM' });
  vi.spyOn(server, 'listen').mockImplementation(() => {
    queueMicrotask(() => server.emit('error', error));
    return server;
  });
  await expect(listenLoopback(server)).rejects.toBe(error);
  expect(server.listenerCount('listening')).toBe(0);
  expect(server.listenerCount('error')).toBe(0);
});

it('explica la capacidad ausente y conserva la causa original del preflight', async () => {
  const server = createServer();
  const error = Object.assign(new Error('listen denied'), { code: 'EPERM' });
  vi.spyOn(server, 'listen').mockImplementation(() => {
    queueMicrotask(() => server.emit('error', error));
    return server;
  });
  const result = assertLoopbackAvailable(server);
  await expect(result).rejects.toThrow('Cobertura no iniciada');
  await expect(result).rejects.toHaveProperty('cause', error);
  expect(server.listening).toBe(false);
});
