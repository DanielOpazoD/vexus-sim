/** Reproducción focalizada con evidencia nueva por ejecución; nunca sustituye la CI protegida. */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { e2eOptions } from './e2eOptions';

const root = resolve(import.meta.dirname, '../..');
const options = e2eOptions(process.argv.slice(2), root);
if (options.help) {
  console.log(
    'npm run workspace:e2e -- --backend metal|swiftshader --out <carpeta nueva> [--url http://127.0.0.1:puerto] -- [filtros Playwright]',
  );
  console.log('Sin --url construye este checkout e inicia preview. Con --url usa un build externo cuya identidad debe comprobarse aparte.');
  console.log('Un trabajador, cero reintentos, CI=true y plazos originales. --list solo recoge pruebas; no las aprueba.');
} else {
  mkdirSync(dirname(options.out), { recursive: true });
  mkdirSync(options.out); // Rechaza incluso un directorio vacío existente: ningún resultado se sobrescribe.
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const collectOnly = options.tests.includes('--list');
  const manifest = {
    state: 'preparing',
    finishedAt: null as string | null,
    startedAt: new Date().toISOString(),
    testCheckoutSha: git('rev-parse', 'HEAD'),
    testCheckoutStatus: git('status', '--short'),
    backend: options.backend,
    url: options.url,
    buildMode: collectOnly ? 'not-started-collection-only' : options.external ? 'external-unverified' : 'built-from-this-checkout',
    scope: 'local reproduction; not protected CI approval',
    startupSourceRole: 'test-checkout-commit; not preview identity',
    args: options.tests,
    workers: 1,
    retries: 0,
    ci: true,
    exitCode: null as number | null,
    signal: null as string | null,
  };
  const save = () => writeFileSync(join(options.out, 'run.json'), JSON.stringify(manifest, null, 2) + '\n');
  save();
  const env = {
    ...process.env,
    CI: 'true',
    VEXUS_GPU: options.backend,
    VEXUS_PREVIEW_URL: options.url,
    VEXUS_EXTERNAL_PREVIEW: String(options.external),
    VEXUS_RUN_DIR: options.out,
    // The existing evidence sink requires a commit. This identifies the TEST checkout, not an external build.
    E2E_SOURCE_SHA: manifest.testCheckoutSha,
    E2E_STARTUP_EVIDENCE: join(options.out, 'startup.jsonl'),
  };
  const run = (executable: string, args: string[]) =>
    new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      const child = spawn(executable, args, { cwd: root, env, stdio: 'inherit' });
      let requestedSignal: NodeJS.Signals | null = null;
      const interrupt = () => {
        requestedSignal = 'SIGINT';
        child.kill('SIGINT');
      };
      const terminate = () => {
        requestedSignal = 'SIGTERM';
        child.kill('SIGTERM');
      };
      process.on('SIGINT', interrupt);
      process.on('SIGTERM', terminate);
      const cleanup = () => {
        process.off('SIGINT', interrupt);
        process.off('SIGTERM', terminate);
      };
      child.once('error', (error) => {
        cleanup();
        reject(error);
      });
      child.once('close', (code, signal) => {
        cleanup();
        resolve({ code, signal: signal ?? requestedSignal });
      });
    });
  try {
    let result = { code: 0 as number | null, signal: null as NodeJS.Signals | null };
    if (!options.external && !collectOnly) result = await run('npm', ['run', 'build']);
    if (result.code === 0 && !result.signal) {
      manifest.state = 'running';
      save();
      result = await run(process.execPath, [
        join(root, 'node_modules/@playwright/test/cli.js'),
        'test',
        '--config',
        join(root, 'tools/workspace/playwright.config.ts'),
        ...options.tests,
      ]);
    }
    manifest.exitCode = result.code;
    manifest.signal = result.signal;
    manifest.state = result.signal ? 'interrupted' : result.code === 0 ? (collectOnly ? 'collected-only' : 'command-succeeded') : 'failed';
    process.exitCode = result.signal ? (result.signal === 'SIGINT' ? 130 : 143) : (result.code ?? 1);
  } catch (error) {
    manifest.state = 'failed';
    process.exitCode = 1;
    console.error(error);
  } finally {
    manifest.finishedAt = new Date().toISOString();
    save();
    console.log(`Evidencia local: ${options.out} (${manifest.state})`);
  }
}
