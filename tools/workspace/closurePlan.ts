/**
 * Cierre serial de una ronda (decisión 322, punto 7): etapas nombradas y ordenadas, reanudación, espera y muestreo
 * de carga y un `closure.json` de esquema estable. Sustituye los scripts de cierre de cada ronda; no sustituye el
 * veredicto protegido de la CI. Este módulo no lanza procesos: ejecutor, muestreo, reloj y escritura se inyectan.
 */
import { BUDGET_UNAVAILABLE_EXIT_CODE, HOOK_BUDGET_SECONDS, TIMING_MAX_LOAD } from '../ci/testTiers';

export const CLOSURE_SCHEMA = 'vexus-closure/1';

export const STAGE_ORDER = [
  'prettier',
  'docs-index',
  'lint',
  'typecheck',
  'push-hook',
  'tests-fast',
  'tests-slow',
  'python-contracts',
  'build',
  'check',
  'calibrate',
  'e2e-swiftshader',
  'e2e-metal',
] as const;
export type StageName = (typeof STAGE_ORDER)[number];

export interface StageDefinition {
  name: StageName;
  /** Comandos en serie; la etapa termina en el primero que falla. `{dir}` es la carpeta propia de cada intento. */
  commands: string[][];
  /** Sólo corre si se pide con su bandera (E2E). */
  optional: boolean;
  /** Variables que cambian respecto al entorno serial común; `null` las quita. */
  env?: Record<string, string | null>;
  /** Sin `nice`: mide lo que vería un push real. */
  niceless?: boolean;
  /** Una etapa con código 0 que supera este tiempo de pared queda fuera de presupuesto (no aprobada). */
  budgetSeconds?: number;
  /** El presupuesto sólo se evalúa si la carga de 1 min al empezar no supera este valor; si no, se declara no evaluable. */
  budgetMaxLoad?: number;
  /** Archivos del checkout que se copian a `{dir}` al terminar, también si falla. */
  artifacts?: string[];
  /** Código reservado del informe de presupuesto cuando la carga impide evaluarlo. */
  unevaluatedExitCode?: number;
}

export interface ClosureConfig {
  python: string;
  pythonTests: string[];
  pythonExcluded: { files: string[]; reason: string | null };
  e2e: { swiftshader: string[] | null; metal: string[] | null };
  /** Comando del informe de capas; por omisión el del checkout. Para acreditar otro checkout, el de la herramienta con --root. */
  tierBudget?: string[];
}

/** Entorno común de todas las etapas: un trabajador, fases de validación en serie e hilos numéricos a uno. */
export const SERIAL_ENV: Readonly<Record<string, string>> = {
  VITEST_MAX_WORKERS: '1',
  VEXUS_VALIDATION_MODE: 'serial',
  OMP_NUM_THREADS: '1',
  OPENBLAS_NUM_THREADS: '1',
  MKL_NUM_THREADS: '1',
  VECLIB_MAXIMUM_THREADS: '1',
  NUMEXPR_NUM_THREADS: '1',
  PYTHONDONTWRITEBYTECODE: '1',
};

const TIER_BUDGET = ['node', '--import', 'tsx', 'tools/ci/tier-budget.ts'];
const tierRun = (script: string[], tier: 'fast' | 'slow', budget: string[]): string[][] => [
  [...script, '--', '--reporter=default', '--reporter=json', '--outputFile={dir}/vitest.json'],
  [...budget, tier, '{dir}/vitest.json', '--out', '{dir}/tier.json'],
];
const e2eRun = (backend: string, specs: string[]): string[][] => [
  ['npm', 'run', 'workspace:e2e', '--', '--backend', backend, '--out', '{dir}/e2e', ...(specs.length ? ['--', ...specs] : [])],
];

export function closureStages(config: ClosureConfig): StageDefinition[] {
  return [
    { name: 'prettier', commands: [['npm', 'run', 'format:check']], optional: false },
    { name: 'docs-index', commands: [['node', '--import', 'tsx', 'tools/docs/decisions-index.ts', '--check']], optional: false },
    { name: 'lint', commands: [['npm', 'run', 'lint']], optional: false },
    { name: 'typecheck', commands: [['npm', 'run', 'typecheck']], optional: false },
    // El gancho real, con los trabajadores y la prioridad de un push: mide su presupuesto (decisión 322).
    {
      name: 'push-hook',
      commands: [['sh', '.githooks/pre-push']],
      optional: false,
      env: { VITEST_MAX_WORKERS: null, VEXUS_VALIDATION_MODE: null },
      niceless: true,
      budgetSeconds: HOOK_BUDGET_SECONDS,
      budgetMaxLoad: TIMING_MAX_LOAD,
    },
    {
      name: 'tests-fast',
      commands: tierRun(['npm', 'test'], 'fast', config.tierBudget ?? TIER_BUDGET),
      optional: false,
      unevaluatedExitCode: BUDGET_UNAVAILABLE_EXIT_CODE,
    },
    { name: 'tests-slow', commands: tierRun(['npm', 'run', 'test:slow'], 'slow', config.tierBudget ?? TIER_BUDGET), optional: false },
    {
      name: 'python-contracts',
      commands: [[config.python, '-B', '-I', 'tools/anatomy/run-tests.py', ...config.pythonTests]],
      optional: false,
    },
    { name: 'build', commands: [['npm', 'run', 'build']], optional: false },
    {
      name: 'check',
      commands: [['npm', 'run', 'check']],
      optional: false,
      artifacts: ['core.json', 'core.source.json', 'matrix.json', 'matrix.source.json', 'local-schedule.json', 'coverage-summary.json'].map(
        (f) => `.validation/${f}`,
      ),
    },
    { name: 'calibrate', commands: [['npm', 'run', 'calibrate']], optional: false },
    { name: 'e2e-swiftshader', commands: e2eRun('swiftshader', config.e2e.swiftshader ?? []), optional: true },
    { name: 'e2e-metal', commands: e2eRun('metal', config.e2e.metal ?? []), optional: true },
  ];
}

export interface Selection {
  selected: StageDefinition[];
  excluded: Array<{ name: StageName; reason: string; optional: boolean }>;
}

/** Orden canónico; `--only` y `--skip` filtran, las E2E exigen su bandera. Un nombre desconocido es un error. */
export function selectStages(all: StageDefinition[], opts: { only: string[]; skip: string[]; requested: StageName[] }): Selection {
  const known = new Set<string>(all.map((s) => s.name));
  for (const name of [...opts.only, ...opts.skip]) if (!known.has(name)) throw new Error(`Etapa desconocida: ${name}`);
  for (const name of opts.only) {
    const def = all.find((s) => s.name === name)!;
    if (def.optional && !opts.requested.includes(def.name)) throw new Error(`La etapa ${name} se pide con --${name}`);
  }
  const out: Selection = { selected: [], excluded: [] };
  for (const def of all) {
    const reason =
      def.optional && !opts.requested.includes(def.name)
        ? 'opcional, sin su bandera'
        : opts.only.length && !opts.only.includes(def.name)
          ? 'fuera de --only'
          : opts.skip.includes(def.name)
            ? '--skip'
            : null;
    if (reason) out.excluded.push({ name: def.name, reason, optional: def.optional });
    else out.selected.push(def);
  }
  if (!out.selected.length) throw new Error('Ninguna etapa seleccionada');
  return out;
}

/** Identidad de una etapa para reanudar: mismos comandos, entorno, prioridad y presupuesto. */
export function stageKey(def: StageDefinition): string {
  return JSON.stringify([
    def.commands,
    def.env ?? {},
    def.niceless ?? false,
    def.budgetSeconds ?? null,
    def.budgetMaxLoad ?? null,
    def.unevaluatedExitCode ?? null,
    def.artifacts ?? [],
  ]);
}

export interface LoadSample {
  utc: string;
  /** Media de carga a 1, 5 y 15 min (`vm.loadavg`, la de `uptime`). */
  load: [number, number, number];
  /** `pmset -g`: modo de bajo consumo; `null` si no se pudo leer. */
  lowPowerMode: boolean | null;
}

export interface StageAttempt {
  attempt: number;
  key: string;
  status: 'passed' | 'failed' | 'over-budget' | 'budget-unavailable' | 'interrupted';
  exitCode: number | null;
  signal: string | null;
  error: string | null;
  seconds: number;
  startedUtc: string;
  endedUtc: string;
  waitedSeconds: number;
  waitTimedOut: boolean;
  /** null sin presupuesto; false si la carga al empezar no permitía medirlo. */
  budgetEvaluated: boolean | null;
  log: string;
  dir: string;
  argv: string[][];
  load: { before: LoadSample; after: LoadSample; during: { samples: number; max: number | null; mean: number | null } };
}

export interface StageRecord {
  name: StageName;
  optional: boolean;
  budgetSeconds: number | null;
  status: StageAttempt['status'] | 'pending' | 'excluded';
  excludedReason: string | null;
  /** Último intento (el que decide el estado). */
  current: StageAttempt | null;
  previousAttempts: StageAttempt[];
}

export interface ClosureRecord {
  schema: typeof CLOSURE_SCHEMA;
  head: string;
  branch: string;
  checkout: string;
  treeCleanAtStart: boolean;
  dirtyAtStart: string[];
  allowDirty: boolean;
  fingerprint: string;
  startedUtc: string;
  resumedUtc: string[];
  endedUtc: string | null;
  options: {
    waitLoad: number | null;
    maxWaitMinutes: number | null;
    failFast: boolean;
    only: string[];
    skip: string[];
    nice: number;
  };
  environment: Record<string, string | number | null>;
  exclusions: {
    python: { files: string[]; reason: string | null };
    stages: Array<{ name: StageName; reason: string; optional: boolean }>;
  };
  includedPython: string[];
  stages: StageRecord[];
  result: {
    /** Todas las etapas seleccionadas aprobadas, HEAD sin cambios y árbol igual que al empezar. */
    passed: boolean;
    /** Además, todas las etapas no opcionales aprobadas (un cierre parcial no es completo). */
    complete: boolean;
    headUnchanged: boolean | null;
    treeCleanAtEnd: boolean | null;
    fingerprintUnchanged: boolean | null;
    aborted: string | null;
    failed: StageName[];
    pending: StageName[];
    unevaluated: StageName[];
  };
}

export interface CheckoutState {
  head: string;
  dirty: string[];
  fingerprint: string;
}

export interface PreparedStage {
  name: StageName;
  attempt: number;
  commands: string[][];
  env: Record<string, string | null>;
  nice: boolean;
  /** Relativos a la carpeta de evidencia. */
  log: string;
  dir: string;
  artifacts: string[];
  startedUtc: string;
}

export interface ExecutionResult {
  exitCode: number | null;
  signal: string | null;
  error: string | null;
  seconds: number;
  loadDuring: number[];
}

export interface ClosureDeps {
  signal?: AbortSignal;
  state(): CheckoutState;
  sample(): LoadSample;
  execute(stage: PreparedStage): Promise<ExecutionResult>;
  wait(ms: number): Promise<void>;
  now(): Date;
  save(record: ClosureRecord): void;
  progress(line: string): void;
  log(line: string): void;
}

export interface ClosureRun {
  /** Carpeta de evidencia absoluta: `{dir}` se sustituye por `<evidencia>/runs/<etapa>-<intento>`. */
  evidence: string;
  selection: Selection;
  previous: ClosureRecord | null;
  resume: boolean;
  allowDirty: boolean;
  waitLoad: number | null;
  maxWaitMinutes: number | null;
  failFast: boolean;
  only: string[];
  skip: string[];
  branch: string;
  checkout: string;
  environment: Record<string, string | number | null>;
  pythonExcluded: { files: string[]; reason: string | null };
  includedPython: string[];
  /** Intervalo de la espera de carga. */
  pollMs?: number;
}

export const NICE_LEVEL = 10;
const fmtLoad = (s: LoadSample) => s.load.map((l) => l.toFixed(2)).join(' ');

export function progressLine(head: string, stage: StageRecord): string {
  const a = stage.current!;
  const code = a.exitCode === null ? `ninguno (${a.signal ?? a.error ?? 'interrumpida'})` : String(a.exitCode);
  const over =
    a.status === 'over-budget'
      ? ` fuera de presupuesto (${a.seconds} s > ${stage.budgetSeconds} s)`
      : a.budgetEvaluated === false
        ? stage.budgetSeconds === null
          ? ` (presupuesto por archivo no evaluable; véase ${a.dir}/tier.json)`
          : ` (presupuesto ${stage.budgetSeconds} s no evaluable: carga ${a.load.before.load[0].toFixed(2)} al empezar)`
        : '';
  const max = a.load.during.max === null ? '' : `, máx. durante ${a.load.during.max.toFixed(2)}`;
  const power = a.load.before.lowPowerMode === null ? '' : `; bajo consumo ${a.load.before.lowPowerMode ? 'sí' : 'no'}`;
  return (
    `- Cierre ${stage.name}: código ${code}${over}; HEAD ${head.slice(0, 7)}; ${a.seconds} s; intento ${a.attempt}; ` +
    `carga antes «${fmtLoad(a.load.before)}», después «${fmtLoad(a.load.after)}»${max}${power}; log ${a.log}.`
  );
}

function summarize(record: ClosureRecord, selected: Set<StageName>): ClosureRecord['result'] {
  const failed = record.stages.filter((s) => ['failed', 'over-budget', 'interrupted'].includes(s.status)).map((s) => s.name);
  const pending = record.stages.filter((s) => s.status === 'pending').map((s) => s.name);
  const unevaluated = record.stages.filter((s) => s.status === 'budget-unavailable').map((s) => s.name);
  const r = record.result;
  const clean = r.headUnchanged === true && r.fingerprintUnchanged === true && (!record.treeCleanAtStart || r.treeCleanAtEnd === true);
  const passed =
    r.aborted === null &&
    clean &&
    !failed.length &&
    !pending.length &&
    !unevaluated.length &&
    record.stages.filter((s) => selected.has(s.name)).every((s) => s.status === 'passed');
  return {
    ...r,
    failed,
    pending,
    unevaluated,
    passed,
    complete: passed && record.stages.filter((s) => !s.optional).every((s) => s.status === 'passed'),
  };
}

const substitute = (commands: string[][], dir: string) => commands.map((c) => c.map((a) => a.replaceAll('{dir}', dir)));

/** Ejecuta las etapas pendientes en orden canónico; con `resume`, las aprobadas del mismo HEAD y definición se conservan. */
export async function runClosure(run: ClosureRun, deps: ClosureDeps): Promise<ClosureRecord> {
  const start = deps.state();
  if (start.dirty.length && !run.allowDirty)
    throw new Error(`Árbol con cambios (${start.dirty.length}); usa --allow-dirty para un cierre declarado sucio`);
  if (run.resume && !run.previous) throw new Error('No hay closure.json que reanudar en esa carpeta');
  if (!run.resume && run.previous) throw new Error('La carpeta ya tiene closure.json: usa --resume o una carpeta nueva');
  if (run.previous) {
    if (run.previous.schema !== CLOSURE_SCHEMA) throw new Error(`Esquema distinto: ${String(run.previous.schema)}`);
    if (run.previous.head !== start.head) throw new Error(`closure.json es de otro HEAD (${run.previous.head.slice(0, 7)})`);
    if (run.previous.checkout !== run.checkout) throw new Error(`closure.json es de otro checkout (${run.previous.checkout})`);
    if (run.previous.fingerprint !== start.fingerprint) throw new Error('El contenido del checkout cambió desde el intento anterior');
  }
  const now = () => deps.now().toISOString();
  const byName = new Map(run.selection.selected.map((d) => [d.name, d]));
  const excluded = new Map(run.selection.excluded.map((e) => [e.name, e]));
  const previousStages = new Map((run.previous?.stages ?? []).map((s) => [s.name, s]));
  const record: ClosureRecord = {
    schema: CLOSURE_SCHEMA,
    head: start.head,
    branch: run.branch,
    checkout: run.checkout,
    treeCleanAtStart: run.previous?.treeCleanAtStart ?? start.dirty.length === 0,
    dirtyAtStart: run.previous?.dirtyAtStart ?? start.dirty,
    allowDirty: run.allowDirty,
    fingerprint: start.fingerprint,
    startedUtc: run.previous?.startedUtc ?? now(),
    resumedUtc: run.previous ? [...run.previous.resumedUtc, now()] : [],
    endedUtc: null,
    options: {
      waitLoad: run.waitLoad,
      maxWaitMinutes: run.maxWaitMinutes,
      failFast: run.failFast,
      only: run.only,
      skip: run.skip,
      nice: NICE_LEVEL,
    },
    environment: run.environment,
    exclusions: { python: run.pythonExcluded, stages: run.selection.excluded },
    includedPython: run.includedPython,
    stages: STAGE_ORDER.filter((name) => byName.has(name) || excluded.has(name)).map((name) => {
      const prev = previousStages.get(name);
      const def = byName.get(name);
      const reusable = def && prev?.status === 'passed' && prev.current?.key === stageKey(def);
      if (reusable || (!def && prev)) return { ...prev, excludedReason: def ? null : excluded.get(name)!.reason };
      const history = prev ? [...prev.previousAttempts, ...(prev.current ? [prev.current] : [])] : [];
      return {
        name,
        optional: def?.optional ?? excluded.get(name)!.optional,
        budgetSeconds: def?.budgetSeconds ?? null,
        status: def ? 'pending' : 'excluded',
        excludedReason: def ? null : excluded.get(name)!.reason,
        current: null,
        previousAttempts: history,
      };
    }),
    result: {
      passed: false,
      complete: false,
      headUnchanged: null,
      treeCleanAtEnd: null,
      fingerprintUnchanged: null,
      aborted: null,
      failed: [],
      pending: [],
      unevaluated: [],
    },
  };
  const selected = new Set(run.selection.selected.map((d) => d.name));
  record.result = summarize(record, selected);
  deps.save(record);

  try {
    for (const stage of record.stages) {
      if (deps.signal?.aborted) {
        record.result.aborted = `${String(deps.signal.reason)} antes de ${stage.name}`;
        break;
      }
      const def = byName.get(stage.name);
      if (!def || stage.status !== 'pending') continue;
      const now0 = deps.state();
      if (now0.head !== start.head || now0.fingerprint !== start.fingerprint) {
        record.result.aborted = `el checkout cambió antes de ${stage.name}`;
        break;
      }
      let waited = 0,
        timedOut = false;
      const poll = run.pollMs ?? 30_000;
      if (run.waitLoad !== null)
        while (!deps.signal?.aborted && deps.sample().load[0] >= run.waitLoad) {
          if (run.maxWaitMinutes !== null && waited >= run.maxWaitMinutes * 60_000) {
            timedOut = true;
            break;
          }
          if (waited % (10 * 60_000) === 0) deps.log(`${stage.name}: espera carga < ${run.waitLoad}`);
          await deps.wait(poll);
          waited += poll;
        }
      if (deps.signal?.aborted) {
        record.result.aborted = `${String(deps.signal.reason)} durante la espera de ${stage.name}`;
        break;
      }
      const attempt = stage.previousAttempts.length + 1;
      const startedUtc = now();
      const prepared: PreparedStage = {
        name: stage.name,
        attempt,
        commands: substitute(def.commands, `${run.evidence}/runs/${stage.name}-${attempt}`),
        env: def.env ?? {},
        nice: !def.niceless,
        log: `logs/${stage.name}-${attempt}.log`,
        dir: `runs/${stage.name}-${attempt}`,
        artifacts: def.artifacts ?? [],
        startedUtc,
      };
      const before = deps.sample();
      deps.log(`START ${stage.name} (intento ${attempt})`);
      let result: ExecutionResult;
      try {
        result = await deps.execute(prepared);
      } catch (error) {
        result = {
          exitCode: null,
          signal: deps.signal?.aborted ? String(deps.signal.reason) : null,
          error: error instanceof Error ? error.message : String(error),
          seconds: 0,
          loadDuring: [],
        };
      }
      const after = deps.sample();
      const during = result.loadDuring;
      const unevaluatedReport = result.exitCode === def.unevaluatedExitCode;
      const budgetEvaluated = unevaluatedReport
        ? false
        : def.budgetSeconds === undefined
          ? null
          : def.budgetMaxLoad === undefined || before.load[0] <= def.budgetMaxLoad;
      const status: StageAttempt['status'] =
        result.signal !== null
          ? 'interrupted'
          : result.exitCode !== 0 && !unevaluatedReport
            ? 'failed'
            : budgetEvaluated === false
              ? 'budget-unavailable'
              : budgetEvaluated && result.seconds > def.budgetSeconds!
                ? 'over-budget'
                : 'passed';
      stage.current = {
        attempt,
        key: stageKey(def),
        status,
        exitCode: result.exitCode,
        signal: result.signal,
        error: result.error,
        seconds: Math.round(result.seconds * 10) / 10,
        startedUtc,
        endedUtc: now(),
        waitedSeconds: Math.round(waited / 1000),
        waitTimedOut: timedOut,
        budgetEvaluated,
        log: prepared.log,
        dir: prepared.dir,
        argv: prepared.commands,
        load: {
          before,
          after,
          during: {
            samples: during.length,
            max: during.length ? Math.max(...during) : null,
            mean: during.length ? Math.round((during.reduce((a, b) => a + b, 0) / during.length) * 100) / 100 : null,
          },
        },
      };
      stage.status = status;
      record.result = summarize(record, selected);
      deps.save(record);
      deps.progress(progressLine(record.head, stage));
      deps.log(`END ${stage.name}: ${status}`);
      if (status === 'interrupted') {
        record.result.aborted = `interrumpida en ${stage.name}`;
        break;
      }
      if (run.failFast && status !== 'passed') {
        record.result.aborted = `--fail-fast tras ${stage.name}`;
        break;
      }
    }
  } catch (error) {
    record.result.aborted = `error del cierre: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    try {
      const end = deps.state();
      record.result.headUnchanged = end.head === start.head;
      record.result.fingerprintUnchanged = end.fingerprint === start.fingerprint;
      record.result.treeCleanAtEnd = end.dirty.length === 0;
    } catch (error) {
      record.result.aborted ??= `no se pudo comprobar el checkout: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (deps.signal?.aborted) record.result.aborted ??= String(deps.signal.reason);
    record.endedUtc = now();
    record.result = summarize(record, selected);
    deps.save(record);
  }
  return record;
}
