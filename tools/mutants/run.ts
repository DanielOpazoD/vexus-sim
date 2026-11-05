/**
 * Mutantes reproducibles (decisión 322, punto 8). Uso: `npm run mutants -- [--module X] [--only a,b] [--out carpeta]`.
 * Focales con un trabajador (VITEST_MAX_WORKERS=1) y `nice`; código 1 si algún mutante sobrevive, hay error, la línea
 * base falla o el árbol no queda como estaba. `--list` muestra los mutantes sin ejecutar nada.
 */
import { execFileSync, spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { feedbackGitEnvironment } from '../workspace/feedbackPlan';
import { manifestErrors, selectMutants } from './manifest';
import { MANIFESTS } from './manifests';
import { fsDeps, recoverJournal, runMutants, sha256, type TestOutcome } from './runner';

const root = resolve(import.meta.dirname, '../..');
const { values } = parseArgs({
  options: {
    module: { type: 'string' },
    only: { type: 'string' },
    out: { type: 'string' },
    list: { type: 'boolean' },
    'timeout-min': { type: 'string' },
    help: { type: 'boolean' },
  },
});
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env: feedbackGitEnvironment() });
const status = () => git('status', '--porcelain=v1', '--untracked-files=all');

let child: ReturnType<typeof spawn> | null = null;
let stopping = false;

/** Vitest sobre las focales: un trabajador; el plazo de la capa lenta sólo si alguna focal es lenta (`// @tier slow`, vite.config.ts). */
function runTests(out: string, timeoutMs: number) {
  return (tests: string[], label: string): Promise<TestOutcome> => {
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
        child = null;
        done({ ...o, seconds: Math.round((performance.now() - t0) / 100) / 10 });
      };
      child = spawn('nice', args, { cwd: root, env, stdio: ['ignore', fd, fd] });
      const timer = setTimeout(() => {
        timedOut = true;
        child?.kill('SIGTERM');
      }, timeoutMs);
      child.once('error', (error) => {
        clearTimeout(timer);
        finish({ exitCode: null, failed: [], suiteErrors: [], error: error.message });
      });
      child.once('close', (code, signal) => {
        clearTimeout(timer);
        if (timedOut) return finish({ exitCode: code, failed: [], suiteErrors: [], error: `plazo de ${timeoutMs / 60_000} min agotado` });
        if (signal || stopping)
          return finish({ exitCode: code, failed: [], suiteErrors: [], error: `interrumpida (${signal ?? 'señal'})` });
        if (!existsSync(report)) return finish({ exitCode: code, failed: [], suiteErrors: [], error: 'Vitest no escribió su informe' });
        const json = JSON.parse(readFileSync(report, 'utf8')) as {
          testResults: Array<{ name: string; status: string; assertionResults: Array<{ status: string; fullName: string }> }>;
        };
        const rel = (p: string) => relative(root, p).replaceAll('\\', '/');
        const failed = json.testResults.flatMap((r) =>
          r.assertionResults.filter((a) => a.status === 'failed').map((a) => `${rel(r.name)} > ${a.fullName}`),
        );
        const seen = new Set(json.testResults.map((r) => rel(r.name)));
        const suiteErrors = [
          ...json.testResults
            .filter((r) => r.status === 'failed' && !r.assertionResults.some((a) => a.status === 'failed'))
            .map((r) => rel(r.name)),
          ...tests.filter((t) => !seen.has(t)),
        ];
        finish({ exitCode: code, failed, suiteErrors, error: null });
      });
    });
  };
}

async function main(): Promise<number> {
  if (values.help) {
    console.log(
      'npm run mutants -- [--module s0028Solids|src/anatomy/s0028Solids.ts] [--only a,b] [--out carpeta] [--list] [--timeout-min 10]',
    );
    return 0;
  }
  const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : null);
  const recovered = recoverJournal(root);
  if (recovered) console.log(`mutantes: ${recovered}`);
  const errors = manifestErrors(MANIFESTS, read);
  if (errors.length) {
    for (const e of errors) console.error(`Manifiesto: ${e}`);
    return 1;
  }
  const only = values.only ? values.only.split(',').map((s) => s.trim()) : [];
  const selection = selectMutants(MANIFESTS, { module: values.module, only });
  if (values.list) {
    for (const { module, mutant } of selection) console.log(`${mutant.name}  ${module}  [${mutant.origin}]  ${mutant.breaks}`);
    return 0;
  }
  const out = resolve(root, values.out ?? `.cache/mutants/${new Date().toISOString().replaceAll(/[:.]/g, '-')}`);
  for (const d of ['logs', 'reports']) mkdirSync(join(out, d), { recursive: true });
  const timeoutMs = Number(values['timeout-min'] ?? 10) * 60_000;
  const statusBefore = status();
  const modules = [...new Set(selection.map((s) => s.module))];
  const hashes = new Map(modules.map((m) => [m, sha256(readFileSync(join(root, m)))]));
  const head = git('rev-parse', 'HEAD').trim();
  const startedUtc = new Date().toISOString();
  const onSignal = () => {
    stopping = true;
    child?.kill('SIGTERM');
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  const t0 = performance.now();
  const report = await runMutants(selection, {
    ...fsDeps(root),
    runTests: runTests(out, timeoutMs),
    log: (line) => console.log(`[mutantes] ${line}`),
    interrupted: () => stopping,
  });
  const statusAfter = status();
  const restored = modules.every((m) => sha256(readFileSync(join(root, m))) === hashes.get(m));
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
  const passed = report.baseline.passed && summary.killed === summary.total && statusAfter === statusBefore && restored && !stopping;
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
        summary,
        tree: { statusBefore, statusAfter, unchanged: statusAfter === statusBefore, modulesRestored: restored },
        passed,
      },
      null,
      2,
    ) + '\n',
  );
  for (const r of report.results.filter((r) => r.status !== 'killed'))
    console.error(`${r.name}: ${r.status}${r.error ? ` (${r.error})` : ''}`);
  console.log(
    `Mutantes: ${summary.killed}/${summary.total} muertos, ${summary.survived} sobreviven, ${summary.error} con error, ${summary.notRun} sin correr; ` +
      `línea base ${report.baseline.passed ? 'verde' : 'ROJA'}; árbol ${statusAfter === statusBefore && restored ? 'intacto' : 'CAMBIADO'}; ` +
      `${summary.seconds} s. ${join(out, 'mutants.json')}`,
  );
  return passed ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  },
);
