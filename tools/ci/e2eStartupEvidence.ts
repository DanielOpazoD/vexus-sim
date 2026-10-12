import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { StartupEntry } from '../../src/app/startupTrace';

export interface StartupIdentity {
  sourceSha: string;
  testId: string;
  retry: number;
  query: string;
}
export type StartupEvent = { type: 'boot:begin' } | { type: 'boot:stage'; entry: StartupEntry } | { type: 'boot:end'; completed: boolean };

/** Evidencia diagnóstica incremental; nunca sustituye el informe ni el veredicto E2E. */
export function startupEvidenceSink(
  output: string | undefined,
  identity: StartupIdentity,
  now: () => number = Date.now,
): (event: StartupEvent) => void {
  if (!output) return () => {};
  if (!/^[a-f0-9]{40}$/.test(identity.sourceSha) || !identity.testId || !Number.isInteger(identity.retry) || identity.retry < 0)
    throw new Error('Invalid startup evidence identity');
  mkdirSync(dirname(output), { recursive: true });
  const started = now();
  return (event) => {
    // Se escribe en el host al recibir la consola, sin consultar el hilo de la página.
    // Una cancelación conserva el prefijo recibido; no inventa un evento de finalización.
    appendFileSync(output, JSON.stringify({ ...identity, hostElapsedMs: now() - started, ...event }) + '\n');
  };
}
