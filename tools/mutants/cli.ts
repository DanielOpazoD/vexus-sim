/**
 * Línea de órdenes de los mutantes (decisión 322, punto 8). `run.ts` la llama con el checkout, los manifiestos y Vitest;
 * las pruebas, con un repositorio temporal y un ejecutor falso. Códigos de salida: 0 todos muertos; 1 alguno sobrevive;
 * 2 error, interrupción o caída (línea base roja, manifiesto inválido, cerrojo ocupado, mutante con error, árbol cambiado).
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { feedbackGitEnvironment } from '../workspace/feedbackPlan';
import { manifestErrors, selectMutants, type MutantManifest } from './manifest';
import { acquireLock, fsDeps, outcomeFromReport, recoverJournal, runMutants, sha256, type TestOutcome } from './runner';

export type RunTests = (tests: string[], label: string) => Promise<TestOutcome>;

export interface CliContext {
  root: string;
  manifests: readonly MutantManifest[];
  /** Crea el ejecutor de pruebas; registra su proceso hijo en `track` para que una señal lo detenga. */
  makeRunTests(out: string, timeoutMs: number, track: (child: ChildProcess | null) => void, stopping: () => boolean): RunTests;
}

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;

/** 0 todos muertos; 1 alguno sobrevive; 2 si la corrida no es fiable (línea base, error, sin correr, árbol, señal). */
export function exitCodeFor(r: {
  baselinePassed: boolean;
  errors: number;
  notRun: number;
  survived: number;
  treeUnchanged: boolean;
  restored: boolean;
  stopped: boolean;
}): 0 | 1 | 2 {
  if (!r.baselinePassed || r.errors > 0 || r.notRun > 0 || !r.treeUnchanged || !r.restored || r.stopped) return 2;
  return r.survived > 0 ? 1 : 0;
}

/** Vitest sobre las focales: un trabajador y `nice`; el plazo de la capa lenta sólo si alguna focal es lenta (`// @tier slow`). */
export function vitestRunTests(root: string): CliContext['makeRunTests'] {
  return (out, timeoutMs, track, stopping) => (tests, label) => {
    const report = join(out, 'reports', `${label}.json`);
    const slow = tests.some((t) => readFileSync(join(root, t), 'utf8').split('\n')[0].trim() === '// @tier slow');
    const args = [
      '-n',
      '10',
      process.execPath,
      'node_modules/vitest/vitest.mjs',
      'run',
      ...tests,
      '--reporter=default',
      '--reporter=json',
      `--outputFile=${report}`,
      ...(slow ? ['--testTimeout=180000'] : []),
    ];
    const env: NodeJS.ProcessEnv = { ...feedbackGitEnvironment(process.env), VITEST_TIER: 'all', VITEST_MAX_WORKERS: '1' };
    delete env['VITEST_COVERAGE_PARTITION'];
    // Un informe de una ejecución anterior en la misma carpeta no puede pasar por el de ésta.
    rmSync(report, { force: true });
    const fd = openSync(join(out, 'logs', `${label}.log`), 'w');
    const t0 = performance.now();
    let timedOut = false;
    return new Promise((done) => {
      const finish = (o: Omit<TestOutcome, 'seconds'>) => {
        closeSync(fd);
        track(null);
        done({ ...o, seconds: Math.round((performance.now() - t0) / 100) / 10 });
      };
      const none = { failed: [], failureMessages: [], suiteErrors: [] };
      const child = spawn('nice', args, { cwd: root, env, stdio: ['ignore', fd, fd] });
      track(child);
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeoutMs);
      child.once('error', (error) => {
        clearTimeout(timer);
        finish({ exitCode: null, ...none, error: error.message });
      });
      child.once('close', (code, signal) => {
        clearTimeout(timer);
        if (timedOut) return finish({ exitCode: code, ...none, error: `plazo de ${timeoutMs / 60_000} min agotado` });
        if (signal || stopping()) return finish({ exitCode: code, ...none, error: `interrumpida (${signal ?? 'señal'})` });
        finish(outcomeFromReport(existsSync(report) ? readFileSync(report, 'utf8') : null, code, tests, root));
      });
    });
  };
}

export async function mutantsCli(argv: string[], ctx: CliContext): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      module: { type: 'string' },
      only: { type: 'string' },
      out: { type: 'string' },
      list: { type: 'boolean' },
      'timeout-min': { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  const { root } = ctx;
  if (values.help) {
    console.log(
      'npm run mutants -- [--module solids|src/anatomy/people/s0028/solids.ts] [--only a,b] [--out carpeta] [--list] [--timeout-min 10]\n' +
        'Salida: 0 todos muertos; 1 alguno sobrevive; 2 error, interrupción o caída.',
    );
    return 0;
  }
  const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : null);
  const only = values.only ? values.only.split(',').map((s) => s.trim()) : [];
  // --list sólo lee: ni cerrojo ni diario (otra corrida en curso puede tener un módulo mutado).
  if (values.list) {
    for (const e of manifestErrors(ctx.manifests, read)) console.error(`Manifiesto: ${e}`);
    for (const { module, mutant } of selectMutants(ctx.manifests, { module: values.module, only }))
      console.log(`${mutant.name}  ${module}  [${mutant.origin}]  ${mutant.breaks}`);
    return 0;
  }
  let release: () => void;
  try {
    release = acquireLock(root);
  } catch (error) {
    console.error((error as Error).message);
    return 2;
  }
  let child: ChildProcess | null = null;
  let stopping = false;
  const onSignal = () => {
    stopping = true;
    child?.kill('SIGTERM');
  };
  // Último recurso ante una caída: restaurar desde el diario de forma síncrona y soltar el cerrojo.
  const onExit = () => {
    try {
      const recovered = recoverJournal(root);
      if (recovered) console.error(`mutantes: ${recovered}`);
    } catch (error) {
      console.error((error as Error).message);
    }
    release();
  };
  const onCrash = (error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    child?.kill('SIGTERM');
    process.exit(2);
  };
  for (const s of SIGNALS) process.on(s, onSignal);
  process.on('exit', onExit);
  process.on('uncaughtException', onCrash);
  process.on('unhandledRejection', onCrash);
  try {
    const recovered = recoverJournal(root);
    if (recovered) console.log(`mutantes: ${recovered}`);
    const errors = manifestErrors(ctx.manifests, read);
    if (errors.length) {
      for (const e of errors) console.error(`Manifiesto: ${e}`);
      return 2;
    }
    const selection = selectMutants(ctx.manifests, { module: values.module, only });
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env: feedbackGitEnvironment() });
    const status = () => git('status', '--porcelain=v1', '--untracked-files=all');
    const out = resolve(root, values.out ?? `.cache/mutants/${new Date().toISOString().replaceAll(/[:.]/g, '-')}`);
    for (const d of ['logs', 'reports']) mkdirSync(join(out, d), { recursive: true });
    const timeoutMs = Number(values['timeout-min'] ?? 10) * 60_000;
    const statusBefore = status();
    const modules = [...new Set(selection.map((s) => s.module))];
    const hashes = new Map(modules.map((m) => [m, sha256(readFileSync(join(root, m)))]));
    const head = git('rev-parse', 'HEAD').trim();
    const startedUtc = new Date().toISOString();
    const t0 = performance.now();
    const report = await runMutants(selection, {
      ...fsDeps(root),
      runTests: ctx.makeRunTests(
        out,
        timeoutMs,
        (c) => (child = c),
        () => stopping,
      ),
      log: (line) => console.log(`[mutantes] ${line}`),
      interrupted: () => stopping,
    });
    const statusAfter = status();
    const restored = modules.every((m) => existsSync(join(root, m)) && sha256(readFileSync(join(root, m))) === hashes.get(m));
    const count = (s: string) => report.results.filter((r) => r.status === s).length;
    const summary = {
      total: selection.length,
      killed: count('killed'),
      survived: count('survived'),
      error: count('error'),
      notRun: report.notRun.length,
      seconds: Math.round((performance.now() - t0) / 100) / 10,
      modules,
    };
    const exitCode = exitCodeFor({
      baselinePassed: report.baseline.passed,
      errors: summary.error,
      notRun: summary.notRun,
      survived: summary.survived,
      treeUnchanged: statusAfter === statusBefore,
      restored,
      stopped: stopping,
    });
    writeFileSync(
      join(out, 'mutants.json'),
      JSON.stringify(
        {
          schema: 'vexus-mutants/1',
          head,
          startedUtc,
          endedUtc: new Date().toISOString(),
          environment: { node: process.version, VITEST_TIER: 'all', VITEST_MAX_WORKERS: '1', nice: 10 },
          filter: { module: values.module ?? null, only },
          baseline: report.baseline,
          mutants: report.results,
          notRun: report.notRun,
          aborted: report.aborted ?? (stopping ? 'interrumpida por una señal' : null),
          summary,
          tree: { statusBefore, statusAfter, unchanged: statusAfter === statusBefore, modulesRestored: restored },
          exitCode,
          passed: exitCode === 0,
        },
        null,
        2,
      ) + '\n',
    );
    for (const r of report.results.filter((r) => r.status !== 'killed'))
      console.error(`${r.name}: ${r.status}${r.error ? ` (${r.error})` : ''}`);
    if (report.aborted) console.error(report.aborted);
    console.log(
      `Mutantes: ${summary.killed}/${summary.total} muertos, ${summary.survived} sobreviven, ${summary.error} con error, ${summary.notRun} sin correr; ` +
        `línea base ${report.baseline.passed ? 'verde' : 'ROJA'}; árbol ${statusAfter === statusBefore && restored ? 'intacto' : 'CAMBIADO'}; ` +
        `${summary.seconds} s; salida ${exitCode}. ${join(out, 'mutants.json')}`,
    );
    return exitCode;
  } finally {
    for (const s of SIGNALS) process.off(s, onSignal);
    process.off('uncaughtException', onCrash);
    process.off('unhandledRejection', onCrash);
    process.off('exit', onExit);
    release();
  }
}
