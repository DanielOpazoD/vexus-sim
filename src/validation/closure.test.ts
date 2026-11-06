import { describe, expect, it } from 'vitest';
import { BUDGET_UNAVAILABLE_EXIT_CODE, HOOK_BUDGET_SECONDS, TIMING_MAX_LOAD } from '../../tools/ci/testTiers';
import {
  closureStages,
  runClosure,
  selectStages,
  STAGE_ORDER,
  type ClosureDeps,
  type ClosureRecord,
  type ClosureRun,
  type ExecutionResult,
  type PreparedStage,
  type StageName,
} from '../../tools/workspace/closurePlan';

/** Cierre de la decisión 322 (punto 7) con un ejecutor falso: ninguna etapa real corre en estas pruebas. */
const HEAD = 'a'.repeat(40);
const config = {
  python: 'py',
  pythonTests: ['tools/anatomy/a_test.py'],
  pythonExcluded: { files: ['b_test.py'], reason: 'CGAL no instalado' },
  e2e: { swiftshader: null, metal: ['e2e/smoke.spec.ts'] },
};
const all = closureStages(config);
const DEFAULT = STAGE_ORDER.filter((s) => !s.startsWith('e2e-'));

function harness(
  opts: { dirty?: string[]; loads?: number[]; outcomes?: Partial<Record<StageName, Array<Partial<ExecutionResult>>>> } = {},
) {
  const calls: PreparedStage[] = [];
  const saved: ClosureRecord[] = [];
  const progress: string[] = [];
  const waits: number[] = [];
  const loads = [...(opts.loads ?? [])];
  const state = { head: HEAD, fingerprint: 'f1', dirty: opts.dirty ?? [] };
  const outcomes = structuredClone(opts.outcomes ?? {});
  const deps: ClosureDeps = {
    state: () => ({ ...state }),
    sample: () => ({ utc: '2026-11-05T07:00:00.000Z', load: [loads.length ? loads.shift()! : 1.5, 2, 3], lowPowerMode: true }),
    execute: (stage) => {
      calls.push(stage);
      const o = outcomes[stage.name]?.shift() ?? {};
      if (o.error) return Promise.reject(new Error(o.error));
      return Promise.resolve({ exitCode: 0, signal: null, error: null, seconds: 2, loadDuring: [2, 4], ...o });
    },
    wait: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
    now: () => new Date('2026-11-05T07:00:00Z'),
    save: (r) => saved.push(structuredClone(r)),
    progress: (line) => progress.push(line),
    log: () => {},
  };
  return { deps, calls, saved, progress, waits, state };
}

function run(previous: ClosureRecord | null, extra: Partial<ClosureRun> = {}): ClosureRun {
  return {
    evidence: '/evidencia',
    selection: selectStages(all, { only: [], skip: [], requested: [] }),
    previous,
    resume: previous !== null,
    allowDirty: false,
    waitLoad: null,
    maxWaitMinutes: null,
    failFast: false,
    only: [],
    skip: [],
    branch: 'feat/x',
    checkout: '/checkout',
    environment: { node: 'v24' },
    pythonExcluded: config.pythonExcluded,
    includedPython: config.pythonTests,
    pollMs: 30_000,
    ...extra,
  };
}

describe('Planificador del cierre', () => {
  it('orden canónico; las E2E sólo con su bandera; --only y --skip filtran; nombres desconocidos fallan', () => {
    const base = selectStages(all, { only: [], skip: [], requested: [] });
    expect(base.selected.map((s) => s.name)).toEqual(DEFAULT);
    expect(base.excluded).toEqual([
      { name: 'e2e-swiftshader', reason: 'opcional, sin su bandera', optional: true },
      { name: 'e2e-metal', reason: 'opcional, sin su bandera', optional: true },
    ]);
    expect(selectStages(all, { only: ['check', 'prettier'], skip: [], requested: [] }).selected.map((s) => s.name)).toEqual([
      'prettier',
      'check',
    ]);
    const skipped = selectStages(all, { only: [], skip: ['check'], requested: ['e2e-metal'] });
    expect(skipped.selected.map((s) => s.name)).toEqual([...DEFAULT.filter((s) => s !== 'check'), 'e2e-metal']);
    expect(skipped.excluded).toContainEqual({ name: 'check', reason: '--skip', optional: false });
    expect(() => selectStages(all, { only: ['chek'], skip: [], requested: [] })).toThrow('Etapa desconocida');
    expect(() => selectStages(all, { only: ['e2e-metal'], skip: [], requested: [] })).toThrow('--e2e-metal');
    expect(() => selectStages(all, { only: ['check'], skip: ['check'], requested: [] })).toThrow('Ninguna etapa');
  });

  it('el gancho se mide como un push real y las capas dejan su informe; Python sin los excluidos', () => {
    const by = (name: StageName) => all.find((s) => s.name === name)!;
    expect(by('push-hook')).toMatchObject({
      commands: [['sh', '.githooks/pre-push']],
      niceless: true,
      budgetSeconds: HOOK_BUDGET_SECONDS,
      budgetMaxLoad: TIMING_MAX_LOAD,
      env: { VITEST_MAX_WORKERS: null, VEXUS_VALIDATION_MODE: null },
    });
    expect(by('tests-fast').commands[1]).toEqual([
      'node',
      '--import',
      'tsx',
      'tools/ci/tier-budget.ts',
      'fast',
      '{dir}/vitest.json',
      '--out',
      '{dir}/tier.json',
    ]);
    expect(by('tests-slow').commands[0]).toContain('--outputFile={dir}/vitest.json');
    expect(by('python-contracts').commands).toEqual([['py', '-B', '-I', 'tools/anatomy/run-tests.py', 'tools/anatomy/a_test.py']]);
    expect(by('e2e-metal').commands[0].slice(-2)).toEqual(['--', 'e2e/smoke.spec.ts']);
    for (const s of all) if (s.name !== 'push-hook') expect(s.niceless ?? false, s.name).toBe(false);
    // Otro checkout: su informe de capas lo calcula la herramienta que lo acredita, sobre las capas de ese checkout.
    const other = closureStages({
      ...config,
      tierBudget: ['node', '--import', 'tsx', '/herramienta/tools/ci/tier-budget.ts', '--root', '/otro'],
    });
    expect(other.find((s) => s.name === 'tests-slow')!.commands[1]).toEqual([
      'node',
      '--import',
      'tsx',
      '/herramienta/tools/ci/tier-budget.ts',
      '--root',
      '/otro',
      'slow',
      '{dir}/vitest.json',
      '--out',
      '{dir}/tier.json',
    ]);
  });
});

describe('Ejecución y reanudación con un ejecutor falso', () => {
  it('finaliza el recibo incluso si falla la escritura del progreso después de una etapa interrumpida', async () => {
    const h = harness({ outcomes: { prettier: [{ exitCode: 129, signal: 'SIGHUP' }] } });
    h.deps.progress = () => {
      throw new Error('no se pudo escribir progress.md');
    };
    const record = await runClosure(run(null), h.deps);
    expect(record.endedUtc).not.toBeNull();
    expect(record.result).toMatchObject({ passed: false, complete: false });
    expect(record.result.aborted).toContain('no se pudo escribir progress.md');
    expect(record.stages[0].current).toMatchObject({ exitCode: 129, signal: 'SIGHUP', status: 'interrupted' });
    expect(h.saved.at(-1)).toEqual(record);
  });

  it('cierre completo: etapas en orden, evidencia por intento, closure.json tras cada etapa y líneas «Cierre»', async () => {
    const h = harness();
    const record = await runClosure(run(null), h.deps);
    expect(h.calls.map((c) => c.name)).toEqual(DEFAULT);
    expect(h.calls[5]).toMatchObject({ log: 'logs/tests-fast-1.log', dir: 'runs/tests-fast-1', nice: true });
    expect(h.calls[5].commands[0]).toContain('--outputFile=/evidencia/runs/tests-fast-1/vitest.json');
    expect(h.calls[4]).toMatchObject({ name: 'push-hook', nice: false });
    expect(h.saved.length).toBe(DEFAULT.length + 2);
    expect(record.result).toMatchObject({
      passed: true,
      complete: true,
      headUnchanged: true,
      treeCleanAtEnd: true,
      failed: [],
      pending: [],
    });
    expect(h.saved.at(-2)!.result).toMatchObject({ passed: false, headUnchanged: null });
    // Sin las E2E opcionales el cierre es completo; las etapas excluidas quedan declaradas.
    expect(record.stages.filter((s) => s.status === 'excluded').map((s) => s.name)).toEqual(['e2e-swiftshader', 'e2e-metal']);
    expect(record.exclusions.python).toEqual(config.pythonExcluded);
    expect(h.progress[0]).toMatch(/^- Cierre prettier: código 0; HEAD aaaaaaa; 2 s; intento 1; carga antes «1\.50 2\.00 3\.00», /);
    expect(h.progress[0]).toContain('máx. durante 4.00; bajo consumo sí; log logs/prettier-1.log.');
    expect(record.stages.find((s) => s.name === 'check')!.current!.load.during).toEqual({ samples: 2, max: 4, mean: 3 });
  });

  it.each(['skip', 'only'] as const)('--resume --%s no oculta una etapa antes fallida', async (filter) => {
    const failed = await runClosure(run(null), harness({ outcomes: { check: [{ exitCode: 1 }] } }).deps);
    const opts = { only: filter === 'only' ? ['lint'] : [], skip: filter === 'skip' ? ['check'] : [], requested: [] };
    const h = harness();
    const resumed = await runClosure(run(failed, { ...opts, selection: selectStages(all, opts) }), h.deps);
    expect(h.calls).toEqual([]);
    expect(resumed.result).toMatchObject({ passed: false, complete: false, failed: ['check'] });
    expect(resumed.stages.find((s) => s.name === 'check')).toMatchObject({ status: 'failed', current: { exitCode: 1 } });
  });

  it('una etapa fallida no detiene el cierre; --resume corre sólo lo no aprobado y conserva el intento previo', async () => {
    const first = harness({ outcomes: { 'tests-slow': [{ exitCode: 1 }], calibrate: [{ exitCode: 2 }] } });
    const failed = await runClosure(run(null), first.deps);
    expect(first.calls.map((c) => c.name)).toEqual(DEFAULT);
    expect(failed.result).toMatchObject({ passed: false, failed: ['tests-slow', 'calibrate'] });
    const second = harness();
    const resumed = await runClosure(run(failed), second.deps);
    expect(second.calls.map((c) => [c.name, c.attempt, c.log])).toEqual([
      ['tests-slow', 2, 'logs/tests-slow-2.log'],
      ['calibrate', 2, 'logs/calibrate-2.log'],
    ]);
    const slow = resumed.stages.find((s) => s.name === 'tests-slow')!;
    expect(slow.previousAttempts.map((a) => [a.attempt, a.exitCode, a.status])).toEqual([[1, 1, 'failed']]);
    expect(slow.current).toMatchObject({ attempt: 2, exitCode: 0, status: 'passed' });
    expect(resumed.resumedUtc).toHaveLength(1);
    expect(resumed.startedUtc).toBe(failed.startedUtc);
    expect(resumed.result).toMatchObject({ passed: true, failed: [] });
    // Una etapa aprobada cuya definición cambió (otro intérprete) se repite.
    const other = closureStages({ ...config, python: 'otro' });
    const third = harness();
    await runClosure(run(resumed, { selection: selectStages(other, { only: [], skip: [], requested: [] }) }), third.deps);
    expect(third.calls.map((c) => c.name)).toEqual(['python-contracts']);
  });

  it('--resume con --only conserva las demás aprobadas; rechaza otro HEAD, otro contenido o una carpeta sin cierre', async () => {
    const done = await runClosure(run(null), harness().deps);
    const only = harness();
    const again = await runClosure(
      run(done, { selection: selectStages(all, { only: ['check'], skip: [], requested: [] }), only: ['check'] }),
      only.deps,
    );
    expect(only.calls).toEqual([]);
    expect(again.result).toMatchObject({ passed: true, complete: true });
    // Un cierre parcial desde cero aprueba lo pedido, pero no es completo.
    const partial = await runClosure(
      run(null, { selection: selectStages(all, { only: ['lint'], skip: [], requested: [] }) }),
      harness().deps,
    );
    expect(partial.result).toMatchObject({ passed: true, complete: false });
    expect(partial.stages.find((s) => s.name === 'check')).toMatchObject({ status: 'excluded', excludedReason: 'fuera de --only' });
    const moved = harness();
    moved.state.head = 'b'.repeat(40);
    await expect(runClosure(run(done), moved.deps)).rejects.toThrow('otro HEAD');
    const edited = harness();
    edited.state.fingerprint = 'f2';
    await expect(runClosure(run(done), edited.deps)).rejects.toThrow('contenido del checkout cambió');
    await expect(runClosure(run(null, { resume: true }), harness().deps)).rejects.toThrow('No hay closure.json');
    await expect(runClosure(run(done, { resume: false }), harness().deps)).rejects.toThrow('ya tiene closure.json');
    await expect(runClosure(run(done, { checkout: '/otro-clon' }), harness().deps)).rejects.toThrow('otro checkout');
  });

  it('un cambio de HEAD en la última etapa tampoco aprueba, aunque no quede otra etapa donde abortar', async () => {
    const h = harness();
    const execute = h.deps.execute.bind(h.deps);
    h.deps.execute = async (stage) => {
      const result = await execute(stage);
      h.state.head = 'b'.repeat(40);
      return result;
    };
    const record = await runClosure(run(null, { selection: selectStages(all, { only: ['lint'], skip: [], requested: [] }) }), h.deps);
    expect(record.result).toMatchObject({ passed: false, complete: false, headUnchanged: false, aborted: null });
  });

  it('árbol sucio: rechazado salvo --allow-dirty, que queda declarado', async () => {
    await expect(runClosure(run(null), harness({ dirty: [' M src/a.ts'] }).deps)).rejects.toThrow('--allow-dirty');
    const record = await runClosure(run(null, { allowDirty: true }), harness({ dirty: [' M src/a.ts'] }).deps);
    expect(record).toMatchObject({ treeCleanAtStart: false, dirtyAtStart: [' M src/a.ts'], allowDirty: true });
    expect(record.result.passed).toBe(true);
  });

  it('si HEAD o el contenido cambian a mitad, aborta antes de la etapa siguiente y no aprueba', async () => {
    const h = harness();
    const execute = h.deps.execute.bind(h.deps);
    h.deps.execute = async (stage) => {
      const r = await execute(stage);
      if (stage.name === 'lint') h.state.head = 'c'.repeat(40);
      return r;
    };
    const record = await runClosure(run(null), h.deps);
    expect(h.calls.map((c) => c.name)).toEqual(['prettier', 'docs-index', 'lint']);
    expect(record.result).toMatchObject({ passed: false, headUnchanged: false, aborted: 'el checkout cambió antes de typecheck' });
    expect(record.result.pending).toEqual(DEFAULT.slice(3));
  });

  it('código 0 fuera de presupuesto no aprueba y se repite al reanudar', async () => {
    const first = harness({ outcomes: { 'push-hook': [{ seconds: HOOK_BUDGET_SECONDS + 1 }] } });
    const record = await runClosure(run(null), first.deps);
    const hook = record.stages.find((s) => s.name === 'push-hook')!;
    expect(hook).toMatchObject({ status: 'over-budget', budgetSeconds: HOOK_BUDGET_SECONDS });
    expect(record.result).toMatchObject({ passed: false, failed: ['push-hook'] });
    expect(first.progress.find((l) => l.includes('push-hook'))).toContain(
      `código 0 fuera de presupuesto (${HOOK_BUDGET_SECONDS + 1} s > ${HOOK_BUDGET_SECONDS} s)`,
    );
    const second = harness();
    expect((await runClosure(run(record), second.deps)).result.passed).toBe(true);
    expect(second.calls.map((c) => c.name)).toEqual(['push-hook']);
    // Con carga al empezar por encima del techo de medida, el tiempo no vale para el presupuesto: queda declarado.
    const only = { selection: selectStages(all, { only: ['push-hook'], skip: [], requested: [] }), only: ['push-hook'] };
    const loaded = harness({ loads: [TIMING_MAX_LOAD + 4], outcomes: { 'push-hook': [{ seconds: HOOK_BUDGET_SECONDS + 60 }] } });
    const busy = await runClosure(run(null, only), loaded.deps);
    expect(busy.stages.find((s) => s.name === 'push-hook')!.current).toMatchObject({
      status: 'budget-unavailable',
      budgetEvaluated: false,
    });
    expect(busy.result).toMatchObject({ passed: false, complete: false, unevaluated: ['push-hook'] });
    const skipped = await runClosure(
      run(busy, { selection: selectStages(all, { only: ['lint'], skip: [], requested: [] }) }),
      harness().deps,
    );
    expect(skipped.result.passed).toBe(false);
    expect(loaded.progress[0]).toContain(
      `(presupuesto ${HOOK_BUDGET_SECONDS} s no evaluable: carga ${(TIMING_MAX_LOAD + 4).toFixed(2)} al empezar)`,
    );
    expect(record.stages.find((s) => s.name === 'push-hook')!.current!.budgetEvaluated).toBe(true);
  });

  it('espera de carga: la etapa no empieza hasta bajar del umbral; con tope, corre y lo anota', async () => {
    const only = { selection: selectStages(all, { only: ['lint'], skip: [], requested: [] }), only: ['lint'] };
    const h = harness({ loads: [20, 18, 9] });
    const record = await runClosure(run(null, { ...only, waitLoad: 15 }), h.deps);
    expect(h.waits).toEqual([30_000, 30_000]);
    expect(record.stages.find((s) => s.name === 'lint')!.current).toMatchObject({ waitedSeconds: 60, waitTimedOut: false });
    const capped = harness({ loads: [20, 20, 20, 20, 20] });
    const late = await runClosure(run(null, { ...only, waitLoad: 15, maxWaitMinutes: 1 }), capped.deps);
    expect(capped.waits).toEqual([30_000, 30_000]);
    expect(late.stages.find((s) => s.name === 'lint')!.current).toMatchObject({ waitedSeconds: 60, waitTimedOut: true, status: 'passed' });
  });

  it('un informe de capa con presupuesto no evaluable tampoco cuenta como aprobado', async () => {
    const first = harness({ outcomes: { 'tests-fast': [{ exitCode: BUDGET_UNAVAILABLE_EXIT_CODE }] } });
    const record = await runClosure(run(null), first.deps);
    expect(record.result).toMatchObject({ passed: false, complete: false, failed: [], unevaluated: ['tests-fast'] });
    expect(record.stages.find((s) => s.name === 'tests-fast')!.current).toMatchObject({
      status: 'budget-unavailable',
      budgetEvaluated: false,
    });
    const second = harness();
    expect((await runClosure(run(record), second.deps)).result.passed).toBe(true);
    expect(second.calls.map((s) => s.name)).toEqual(['tests-fast']);
  });

  it('--fail-fast se detiene; una interrupción siempre detiene; un error del ejecutor queda como fallo sin código', async () => {
    const fast = harness({ outcomes: { lint: [{ exitCode: 1 }] } });
    const stopped = await runClosure(run(null, { failFast: true }), fast.deps);
    expect(fast.calls.map((c) => c.name)).toEqual(['prettier', 'docs-index', 'lint']);
    expect(stopped.result.aborted).toBe('--fail-fast tras lint');
    const int = harness({ outcomes: { typecheck: [{ exitCode: null, signal: 'SIGINT' }] } });
    const interrupted = await runClosure(run(null), int.deps);
    expect(int.calls.at(-1)!.name).toBe('typecheck');
    expect(interrupted.stages.find((s) => s.name === 'typecheck')!.status).toBe('interrupted');
    expect(interrupted.result.aborted).toBe('interrumpida en typecheck');
    const err = harness({ outcomes: { build: [{ error: 'spawn nice ENOENT' }] } });
    const broken = await runClosure(run(null), err.deps);
    expect(broken.stages.find((s) => s.name === 'build')!.current).toMatchObject({
      status: 'failed',
      exitCode: null,
      error: 'spawn nice ENOENT',
    });
    expect(err.progress.find((l) => l.includes('Cierre build'))).toContain('código ninguno (spawn nice ENOENT)');
    expect(err.calls.at(-1)!.name).toBe('calibrate');
  });
});
