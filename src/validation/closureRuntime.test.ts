import { describe, expect, it } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { copyAttemptArtifacts } from '../../tools/workspace/closureRuntime';
import { feedbackGitEnvironment } from '../../tools/workspace/feedbackPlan';
import type { ClosureRecord } from '../../tools/workspace/closurePlan';

const tool = join(import.meta.dirname, '../../tools/workspace/closure.ts');
async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('La condición del proceso no llegó');
    await setTimeout(30);
  }
}
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('Evidencia y procesos reales del cierre', () => {
  it('copia sólo los artefactos escritos desde el inicio del intento', () => {
    const root = mkdtempSync(join(tmpdir(), 'vexus-closure-artifacts-'));
    try {
      mkdirSync(join(root, '.validation'));
      mkdirSync(join(root, 'out'));
      for (const file of ['core', 'matrix']) writeFileSync(join(root, `.validation/${file}.json`), '{}');
      utimesSync(join(root, '.validation/core.json'), 100, 100);
      utimesSync(join(root, '.validation/matrix.json'), 300, 300);
      copyAttemptArtifacts(
        root,
        join(root, 'out'),
        ['.validation/core.json', '.validation/matrix.json', '.validation/missing.json'],
        new Date(200_000).toISOString(),
      );
      expect(existsSync(join(root, 'out/.validation_core.json'))).toBe(false);
      expect(readFileSync(join(root, 'out/.validation_matrix.json'), 'utf8')).toBe('{}');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(['SIGINT', 'SIGTERM', 'SIGHUP'] as const)('%s durante --wait-load finaliza el recibo sin ejecutar etapas', async (signal) => {
    await signalFixture(signal, true);
  });
  it('SIGHUP durante una etapa termina también el nieto que ignora la señal', async () => {
    await signalFixture('SIGHUP', false);
  });
  it.each(['EPERM', 'ESRCH', 'EIO'])('SIGHUP con kill %s finaliza el recibo y conserva la interrupción', async (code) => {
    await signalFixture('SIGHUP', false, code);
  });
});

async function signalFixture(signal: NodeJS.Signals, waiting: boolean, killError?: string): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'vexus-closure-signal-'));
  const checkout = join(dir, 'checkout');
  const evidence = join(dir, 'evidence');
  const output = join(dir, 'output.log');
  const pids = join(dir, 'pids.json');
  const ready = join(dir, 'ready');
  const injected = join(dir, 'kill-error');
  const preload = join(dir, 'kill-error.mjs');
  if (killError)
    writeFileSync(
      preload,
      `import { writeFileSync } from 'node:fs';
const kill = process.kill.bind(process);
process.kill = (pid, signal) => {
  if (pid < 0 && signal === 'SIGKILL') {
    // Termina primero los procesos del fixture; sólo simula el error devuelto al cierre.
    try { kill(pid, signal); } catch (error) { if (!['ESRCH', 'EPERM'].includes(error.code)) throw error; }
    writeFileSync(${JSON.stringify(injected)}, ${JSON.stringify(killError)});
    throw Object.assign(new Error('kill ${killError} inyectado'), { code: '${killError}' });
  }
  return kill(pid, signal);
};\n`,
    );
  const env = {
    ...feedbackGitEnvironment(),
    FIXTURE_PIDS: pids,
    FIXTURE_READY: ready,
  };
  mkdirSync(join(checkout, 'tools/anatomy'), { recursive: true });
  writeFileSync(join(checkout, 'seed'), 'fixture');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: checkout, env, stdio: 'pipe' });
  git('init');
  git('config', 'user.name', 'Closure fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  const grandchild =
    'process.on("SIGHUP", () => {}); require("node:fs").writeFileSync(process.env.FIXTURE_READY, "ready"); setInterval(() => {}, 1000);';
  writeFileSync(
    join(checkout, 'fixture.cjs'),
    `#!${process.execPath}\nconst fs = require('node:fs');\nconst child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore' });\nfs.writeFileSync(process.env.FIXTURE_PIDS, JSON.stringify([process.pid, child.pid]));\nprocess.on('SIGHUP', () => process.exit(0));\nsetInterval(() => {}, 1000);\n`,
    { mode: 0o755 },
  );
  writeFileSync(join(checkout, 'package.json'), JSON.stringify({ scripts: { 'format:check': 'node fixture.cjs' } }));
  git('add', '.');
  git('commit', '-m', 'fixture');
  const fd = openSync(output, 'w');
  const child = spawn(
    process.execPath,
    [
      ...(killError ? ['--import', preload] : []),
      '--import',
      'tsx',
      tool,
      '--checkout',
      checkout,
      '--evidence',
      evidence,
      '--only',
      'prettier',
      ...(waiting ? ['--wait-load', '0.000001'] : []),
    ],
    { env, stdio: ['ignore', fd, fd] },
  );
  const ended = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  try {
    await until(() => (waiting ? readFileSync(output, 'utf8').includes('espera carga') : existsSync(ready)));
    child.kill(signal);
    await until(() => child.exitCode !== null || child.signalCode !== null);
    const exitCode = await ended;
    const record = JSON.parse(readFileSync(join(evidence, 'closure.json'), 'utf8')) as ClosureRecord;
    if (killError) expect(readFileSync(injected, 'utf8')).toBe(killError);
    expect(record.endedUtc).not.toBeNull();
    expect(record.result).toMatchObject({ passed: false, complete: false });
    expect(record.result.aborted).not.toBeNull();
    expect(exitCode, readFileSync(output, 'utf8')).toBe(1);
    if (waiting) {
      expect(record.result.aborted).toContain(signal);
      expect(record.stages[0]).toMatchObject({ status: 'pending', current: null });
    } else {
      expect(record.stages[0].current).toMatchObject({ status: 'interrupted', signal });
      // Los errores inesperados también finalizan el recibo, pero no se ocultan como grupo desaparecido.
      if (killError === 'EIO') expect(record.stages[0].current!.error).toContain('kill EIO inyectado');
      else expect(record.stages[0].current!.error).toBeNull();
      const descendants = JSON.parse(readFileSync(pids, 'utf8')) as number[];
      await until(() => descendants.every((pid) => !alive(pid)));
    }
  } catch (error) {
    throw new Error(`${String(error)}\n${readFileSync(output, 'utf8')}`, { cause: error });
  } finally {
    child.kill('SIGKILL');
    if (existsSync(pids))
      for (const pid of JSON.parse(readFileSync(pids, 'utf8')) as number[]) if (alive(pid)) process.kill(pid, 'SIGKILL');
    await ended;
    closeSync(fd);
    rmSync(dir, { recursive: true, force: true });
  }
}
