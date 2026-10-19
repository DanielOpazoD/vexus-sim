import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { validationArgs, validationEvidence, type ValidationPhase } from './validationEvidence';
import { assertLoopbackAvailable } from '../workspace/loopback';
import { executionEnvironment } from '../workspace/executionEnvironment';

/** Un hijo directo: rechaza una interrupción aunque el hijo termine con código cero. */
export function runValidationProcess(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit', env });
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
    };
    child.once('error', (error) => {
      cleanup();
      reject(error);
    });
    child.once('close', (code, signal) => {
      cleanup();
      if (code === 0 && !signal && !requested) resolve();
      else reject(new Error(`Validación interrumpida o fallida: código ${code}, señal ${signal ?? requested ?? 'ninguna'}`));
    });
  });
}

/** Mismos informes y procedencia en CI separada y en el lote CPU local. */
export async function executeValidationPhase(phase: ValidationPhase, workers?: number): Promise<void> {
  const args = validationArgs(phase, workers);
  const head = () => execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const sourceSha = head();
  mkdirSync('.validation', { recursive: true });
  const reportPath = `.validation/${phase}.json`,
    evidencePath = `.validation/${phase}.source.json`;
  rmSync(reportPath, { force: true });
  rmSync(evidencePath, { force: true });
  if (phase === 'core') {
    await assertLoopbackAvailable();
    console.log('core: loopback disponible; comienza cobertura');
  }
  // No mutar process.env: las dos fases conservan selecciones independientes.
  await runValidationProcess(args, { ...process.env, VITEST_TIER: 'all', VITEST_COVERAGE_PARTITION: phase });
  if (head() !== sourceSha) throw new Error('Source commit changed during validation');
  if (phase === 'core') copyFileSync('coverage/coverage-summary.json', '.validation/coverage-summary.json');
  const evidence = validationEvidence(phase, sourceSha, readFileSync(reportPath, 'utf8'));
  writeFileSync(
    evidencePath,
    JSON.stringify({ ...evidence, environment: executionEnvironment(), workers: workers ?? null }, null, 2) + '\n',
  );
  console.log(`${phase}: report bound to source ${sourceSha}, SHA256 ${evidence.reportSha256}`);
}
