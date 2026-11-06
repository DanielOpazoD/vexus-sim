import { spawn } from 'node:child_process';
import { copyFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

/** Las señales también se atienden entre etapas y durante --wait-load. */
export function closureSignals() {
  const controller = new AbortController();
  const handlers = (['SIGINT', 'SIGTERM', 'SIGHUP'] as const).map((signal) => {
    const handler = () => controller.abort(signal);
    process.on(signal, handler);
    return { signal, handler };
  });
  return {
    signal: controller.signal,
    dispose: () => {
      for (const { signal, handler } of handlers) process.off(signal, handler);
    },
  };
}

export async function waitForLoad(ms: number, signal: AbortSignal): Promise<void> {
  try {
    await setTimeout(ms, undefined, { signal });
  } catch (error) {
    if (!signal.aborted) throw error;
  }
}

/** Grupo propio: npm, shell y nietos reciben la señal, incluso si el padre sale primero. */
export function spawnLogged(
  argv: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  fd: number,
  signal: AbortSignal,
): Promise<{ code: number | null; signal: string | null }> {
  if (signal.aborted) return Promise.resolve({ code: null, signal: String(signal.reason) });
  return new Promise((done, fail) => {
    const grouped = process.platform !== 'win32';
    const child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: ['ignore', fd, fd], detached: grouped });
    let escalation: ReturnType<typeof globalThis.setTimeout> | undefined;
    const kill = (requested: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        if (grouped) process.kill(-child.pid, requested);
        else child.kill(requested);
      } catch (error) {
        // ESRCH/EPERM se tratan como grupo ya inaccesible; no impiden finalizar el recibo.
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ESRCH' && code !== 'EPERM') fail(error instanceof Error ? error : new Error(String(error), { cause: error }));
      }
    };
    const interrupt = () => {
      kill(signal.reason as NodeJS.Signals);
      escalation = globalThis.setTimeout(() => kill('SIGKILL'), 1000);
    };
    signal.addEventListener('abort', interrupt, { once: true });
    const cleanup = () => {
      signal.removeEventListener('abort', interrupt);
      clearTimeout(escalation);
      if (signal.aborted) kill('SIGKILL');
    };
    child.once('error', (error) => {
      cleanup();
      fail(error);
    });
    child.once('close', (code, endedSignal) => {
      cleanup();
      done({ code, signal: signal.aborted ? String(signal.reason) : endedSignal });
    });
  });
}

/** Un JSON previo no es evidencia de este intento, aunque sobreviva a un check fallido. */
export function copyAttemptArtifacts(root: string, dir: string, artifacts: string[], startedUtc: string): void {
  for (const artifact of artifacts) {
    const source = join(root, artifact);
    const stat = statSync(source, { throwIfNoEntry: false });
    if (stat?.isFile() && stat.mtimeMs >= Date.parse(startedUtc)) copyFileSync(source, join(dir, artifact.replaceAll('/', '_')));
  }
}
