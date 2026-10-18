import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { executeValidationPhase } from './validationPhase';
import type { ValidationPhase } from './validationEvidence';
import { assertLoopbackAvailable } from '../workspace/loopback';
import { executionEnvironment } from '../workspace/executionEnvironment';

const phases = ['core', 'matrix'] as const;
export function localValidationPlan(parallelism: number, ci: boolean, mode = 'auto') {
  if (!Number.isSafeInteger(parallelism) || parallelism < 1) throw new Error('Invalid available parallelism');
  if (mode !== 'auto' && mode !== 'serial') throw new Error('VEXUS_VALIDATION_MODE debe ser auto o serial');
  const parallel = !ci && mode === 'auto' && parallelism >= 10;
  return { parallel, workers: parallel ? { core: parallelism - 5, matrix: 3 } : { core: null, matrix: null } };
}
type Plan = ReturnType<typeof localValidationPlan>;

/** Si falla una fase paralela, espera también la otra y conserva ambos resultados. */
export async function runValidationSchedule(
  plan: Plan,
  run: (phase: ValidationPhase, workers: number | null) => Promise<void>,
): Promise<void> {
  if (!plan.parallel) {
    for (const phase of phases) await run(phase, plan.workers[phase]);
    return;
  }
  const results = await Promise.allSettled(phases.map(async (phase) => run(phase, plan.workers[phase])));
  const errors = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map((r) => r.reason as unknown);
  if (errors.length) throw new AggregateError(errors, 'Una o más fases de validación fallaron');
}

export async function runLocalValidation(): Promise<void> {
  const environment = executionEnvironment();
  const plan = localValidationPlan(environment.availableParallelism, Boolean(process.env['CI']), process.env['VEXUS_VALIDATION_MODE']);
  mkdirSync('.validation', { recursive: true });
  // Un preflight fallido tampoco deja informes antiguos que parezcan una ejecución nueva.
  for (const phase of phases) for (const suffix of ['.json', '.source.json']) rmSync(`.validation/${phase}${suffix}`, { force: true });
  writeFileSync(
    '.validation/local-schedule.json',
    JSON.stringify({ scope: 'schedule-only-not-acceptance', environment, plan }, null, 2) + '\n',
  );
  await assertLoopbackAvailable();
  console.log(`Validación local ${plan.parallel ? 'paralela acotada' : 'secuencial'}: ${JSON.stringify(plan.workers)}`);
  await runValidationSchedule(plan, async (phase, workers) => executeValidationPhase(phase, workers ?? undefined));
}
