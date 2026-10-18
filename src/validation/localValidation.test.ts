import { afterEach, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { localValidationPlan, runValidationSchedule } from '../../tools/ci/localValidation';

it('limita el lote local, reserva dos plazas y conserva la ejecución secuencial en CI o por petición', () => {
  expect(localValidationPlan(10, false)).toEqual({ parallel: true, workers: { core: 5, matrix: 3 } });
  for (const count of [10, 12, 32]) {
    const plan = localValidationPlan(count, false);
    expect(plan.workers.core! + plan.workers.matrix!).toBe(count - 2);
  }
  for (const plan of [localValidationPlan(8, false), localValidationPlan(10, true), localValidationPlan(10, false, 'serial')]) {
    expect(plan.parallel).toBe(false);
    expect(plan.workers).toEqual({ core: null, matrix: null });
  }
  for (const count of [0, NaN, 2.5]) expect(() => localValidationPlan(count, false)).toThrow();
  expect(() => localValidationPlan(10, false, 'turbo')).toThrow();
});

it('espera ambas fases paralelas y rechaza todos sus errores sin convertir una aprobación parcial en éxito', async () => {
  const called: string[] = [];
  let finishMatrix!: () => void;
  const matrix = new Promise<void>((resolve) => {
    finishMatrix = resolve;
  });
  const error = new Error('core failed');
  let finished = false;
  const result = runValidationSchedule(localValidationPlan(10, false), async (phase) => {
    called.push(phase);
    if (phase === 'core') throw error;
    await matrix;
  });
  void result.then(
    () => {
      finished = true;
    },
    () => {
      finished = true;
    },
  );
  await Promise.resolve();
  expect(called).toEqual(['core', 'matrix']);
  expect(finished).toBe(false);
  finishMatrix();
  await expect(result).rejects.toHaveProperty('errors', [error]);
});

it('la ruta secuencial se detiene en el primer fallo como antes', async () => {
  const called: string[] = [];
  await expect(
    runValidationSchedule(localValidationPlan(10, true), (phase) => {
      called.push(phase);
      return Promise.reject(new Error('failed'));
    }),
  ).rejects.toThrow('failed');
  expect(called).toEqual(['core']);
});

const children = new Set<ChildProcess>();
afterEach(() => {
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  children.clear();
});

it('una interrupción real no aprueba aunque el hijo cierre con código cero', async () => {
  const moduleUrl = new URL('../../tools/ci/validationPhase.ts', import.meta.url).href;
  const fixture =
    "process.on('SIGINT',()=>{console.log('child-stopped');process.exit(0)});console.log('child-ready');setInterval(()=>{},1000);";
  const code = `import {runValidationProcess} from ${JSON.stringify(moduleUrl)};try { await runValidationProcess(['-e',${JSON.stringify(fixture)}]); }catch {console.log('interruption-rejected');process.exitCode=7;}`;
  const driver = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(driver);
  let output = '',
    sent = false;
  driver.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString();
    if (!sent && output.includes('child-ready')) {
      sent = true;
      driver.kill('SIGINT');
    }
  });
  const exit = await new Promise<number | null>((resolve, reject) => {
    driver.once('error', reject);
    driver.once('close', (code) => resolve(code));
  });
  expect(exit).toBe(7);
  expect(output).toContain('child-stopped');
  expect(output).toContain('interruption-rejected');
});
