/** Ciclo corto local. No genera ni sustituye una aceptación completa. */
import { execFileSync, spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { feedbackFiles, feedbackFingerprint, feedbackGitEnvironment, feedbackPlan } from './feedbackPlan';

const root = resolve(import.meta.dirname, '../..');
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { base: { type: 'string' }, out: { type: 'string' }, 'all-fast': { type: 'boolean' }, help: { type: 'boolean' } },
});
if (values.help) {
  console.log('npm run feedback -- [archivos] [--base origin/main] [--all-fast] [--out carpeta-nueva]');
  console.log(
    'Sin archivos usa el diff y los nuevos. Formato/lint focales, tipos y tests relacionados; configuración/UI usa la suite rápida. No ejecuta GPU, cobertura ni matrices completas.',
  );
} else {
  const files = feedbackFiles(root, values.base ?? 'origin/main', positionals);
  const plan = feedbackPlan(root, files, values['all-fast']);
  const out = resolve(root, values.out ?? `.cache/feedback/${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${process.pid}`);
  mkdirSync(dirname(out), { recursive: true });
  mkdirSync(out);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env: feedbackGitEnvironment() }).trim();
  const manifest = {
    scope: 'local-feedback-not-acceptance',
    state: 'running',
    head: git('rev-parse', 'HEAD'),
    changes: git('status', '--short'),
    fingerprint: feedbackFingerprint(root, out),
    files,
    plan,
    startedAt: new Date().toISOString(),
    finishedAt: null as string | null,
    stages: [] as Array<{ name: string; milliseconds: number; exitCode: number | null; signal: string | null }>,
  };
  const save = () => writeFileSync(join(out, 'run.json'), JSON.stringify(manifest, null, 2) + '\n');
  save();
  const run = async (name: string, binary: string, args: string[]) => {
    const started = performance.now();
    const log = createWriteStream(join(out, name + '.log'), { flags: 'wx' });
    console.log(`feedback: ${name}`);
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveRun, reject) => {
      const command = binary.startsWith('tools/')
        ? ['--import', 'tsx', join(root, binary), ...args]
        : [join(root, 'node_modules', binary), ...args];
      const child = spawn(process.execPath, command, {
        cwd: root,
        env: { ...process.env, VITEST_TIER: plan.slow ? 'all' : 'fast', VITEST_COVERAGE_PARTITION: 'all' },
      });
      child.stdout.on('data', (data: Buffer) => {
        log.write(data);
        process.stdout.write(data);
      });
      child.stderr.on('data', (data: Buffer) => {
        log.write(data);
        process.stderr.write(data);
      });
      let requested: NodeJS.Signals | null = null;
      const interrupt = () => {
        requested = 'SIGINT';
        child.kill('SIGINT');
      };
      const terminate = () => {
        requested = 'SIGTERM';
        child.kill('SIGTERM');
      };
      process.on('SIGINT', interrupt);
      process.on('SIGTERM', terminate);
      const cleanup = () => {
        process.off('SIGINT', interrupt);
        process.off('SIGTERM', terminate);
        log.end();
      };
      child.once('error', (error) => {
        cleanup();
        reject(error);
      });
      child.once('close', (code, signal) => {
        cleanup();
        resolveRun({ code, signal: signal ?? requested });
      });
    });
    manifest.stages.push({ name, milliseconds: Math.round(performance.now() - started), exitCode: result.code, signal: result.signal });
    save();
    if (result.code !== 0 || result.signal) throw new Error(`${name} terminó sin aprobar; consultar ${out}`);
  };
  try {
    if (plan.existing.length) await run('format', 'prettier/bin/prettier.cjs', ['--check', '--ignore-unknown', '--', ...plan.existing]);
    const lint = plan.existing.filter((file) => /\.[cm]?[jt]s$/.test(file));
    if (lint.length) await run('lint', 'eslint/bin/eslint.js', ['--', ...lint]);
    if (plan.docsIndex) await run('docs-index', 'tools/docs/decisions-index.ts', ['--check']);
    if (plan.mode !== 'docs') {
      await run('types', 'typescript/bin/tsc', ['-p', 'tsconfig.json', '--noEmit']);
      const args = plan.mode === 'related' ? ['related', '--run', ...files] : ['run', ...(plan.mode === 'tests' ? files : [])];
      if (plan.slow) args.push('--testTimeout=180000');
      await run('tests', 'vitest/vitest.mjs', [
        ...args,
        '--reporter=default',
        '--reporter=json',
        `--outputFile=${join(out, 'tests.json')}`,
      ]);
    }
    if (git('rev-parse', 'HEAD') !== manifest.head || feedbackFingerprint(root, out) !== manifest.fingerprint)
      throw new Error('Cambió el checkout durante el feedback; repetir con el estado actual');
    manifest.state = 'passed-local-feedback';
  } catch (error) {
    manifest.state = 'failed';
    process.exitCode = 1;
    console.error(error);
  } finally {
    manifest.finishedAt = new Date().toISOString();
    save();
    console.log(`Feedback ${plan.mode}: ${manifest.state}. Evidencia: ${out}. Aceptación pendiente: check completo y CI del head final.`);
  }
}
