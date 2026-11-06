/**
 * Cierre serial de una ronda (decisión 322, punto 7). Uso: `npm run closure -- --evidence <carpeta> [opciones]`.
 * Etapas en serie con `nice`, un trabajador y fases de validación seriales; carga y modo de energía antes, durante y
 * después de cada etapa; logs por etapa e intento; `closure.json` y líneas «Cierre <etapa>: código N; HEAD …».
 * No sustituye el veredicto protegido de la CI.
 */
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  realpathSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { closureSignals, copyAttemptArtifacts, spawnLogged, waitForLoad } from './closureRuntime';
import { feedbackFingerprint, feedbackGitEnvironment } from './feedbackPlan';
import {
  closureStages,
  NICE_LEVEL,
  runClosure,
  selectStages,
  SERIAL_ENV,
  stageKey,
  STAGE_ORDER,
  type ClosureRecord,
  type ExecutionResult,
  type LoadSample,
  type PreparedStage,
  type StageName,
} from './closurePlan';

const HELP = `npm run closure -- --evidence <carpeta> [opciones]

  --resume                    reanuda: conserva las etapas aprobadas del mismo HEAD y definición
  --only a,b / --skip a,b     subconjunto de etapas (${STAGE_ORDER.join(', ')})
  --wait-load N               antes de cada etapa espera a que la carga de 1 min baje de N
  --max-wait-min M            tras M minutos de espera corre igualmente y lo anota
  --fail-fast                 se detiene en la primera etapa no aprobada (por omisión sigue)
  --allow-dirty               permite un árbol con cambios (queda declarado en closure.json)
  --python BIN                intérprete de los contratos de tools/anatomy (VEXUS_PYTHON o python3)
  --python-exclude a,b        contratos excluidos (nombres *_test.py), con --python-exclude-reason
  --e2e-swiftshader specs|all, --e2e-metal specs|all   etapas E2E opcionales (workspace:e2e)
  --progress archivo          dónde añadir las líneas «Cierre …» (por omisión <evidencia>/progress.md)
  --checkout carpeta          acredita otro checkout con esta herramienta (por omisión, éste)
  --dry-run                   muestra el plan sin ejecutar nada`;

const toolRoot = resolve(import.meta.dirname, '../..');
const { values } = parseArgs({
  options: {
    evidence: { type: 'string' },
    checkout: { type: 'string' },
    resume: { type: 'boolean' },
    only: { type: 'string' },
    skip: { type: 'string' },
    'wait-load': { type: 'string' },
    'max-wait-min': { type: 'string' },
    'fail-fast': { type: 'boolean' },
    'allow-dirty': { type: 'boolean' },
    python: { type: 'string' },
    'python-exclude': { type: 'string' },
    'python-exclude-reason': { type: 'string' },
    'e2e-swiftshader': { type: 'string' },
    'e2e-metal': { type: 'string' },
    progress: { type: 'string' },
    'dry-run': { type: 'boolean' },
    help: { type: 'boolean' },
  },
});
// El checkout que se acredita; por omisión, el de esta herramienta. Con otro, sus etapas son las suyas (scripts, gancho,
// contratos) y sólo el informe de capas sale de esta herramienta, que se lo pide con --root.
const root = realpathSync(resolve(values.checkout ?? toolRoot));

const list = (v: string | undefined) =>
  v
    ? v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
const positive = (v: string | undefined, name: string): number | null => {
  if (v === undefined) return null;
  const n = Number(v);
  if (!(n > 0)) throw new Error(`${name} debe ser un número positivo`);
  return n;
};
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env: feedbackGitEnvironment() });

function specs(v: string | undefined): string[] | null {
  if (v === undefined) return null;
  if (v === 'all') return [];
  const out = list(v);
  for (const s of out) if (!existsSync(resolve(root, s))) throw new Error(`Spec E2E inexistente: ${s}`);
  return out;
}

function lowPowerMode(): boolean | null {
  if (process.platform !== 'darwin') return null;
  try {
    const m = /lowpowermode\s+(\d)/.exec(execFileSync('pmset', ['-g'], { encoding: 'utf8' }));
    return m ? m[1] === '1' : null;
  } catch {
    return null;
  }
}

/** `os.loadavg()` lee en macOS el mismo `vm.loadavg` que `uptime` y `sysctl`. */
const load1 = () => Math.round(loadavg()[0] * 100) / 100;
const sample = (): LoadSample => ({
  utc: new Date().toISOString(),
  load: loadavg().map((l) => Math.round(l * 100) / 100) as [number, number, number],
  lowPowerMode: lowPowerMode(),
});

function sysctl(name: string): number | null {
  if (process.platform !== 'darwin') return null;
  try {
    return Number(execFileSync('sysctl', ['-n', name], { encoding: 'utf8' }).trim());
  } catch {
    return null;
  }
}

async function main(): Promise<number> {
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  if (!values.evidence) throw new Error('Falta --evidence <carpeta>');
  const evidence = resolve(values.evidence);
  if (evidence === root || evidence.startsWith(root + '/')) {
    // Dentro del checkout sólo en una ruta ignorada: los logs no deben ensuciar el árbol que se acredita.
    try {
      execFileSync('git', ['check-ignore', '-q', relative(root, evidence) + '/x'], { cwd: root, env: feedbackGitEnvironment() });
    } catch {
      throw new Error('La evidencia dentro del checkout debe estar en una ruta ignorada (p. ej. .cache/closure/…)');
    }
  }
  const pythonDir = join(root, 'tools/anatomy');
  const allPython = readdirSync(pythonDir)
    .filter((f) => f.endsWith('_test.py'))
    .sort();
  const pythonExcluded = list(values['python-exclude']);
  for (const f of pythonExcluded) if (!allPython.includes(f)) throw new Error(`Contrato Python inexistente: ${f}`);
  const reason = values['python-exclude-reason'] ?? null;
  if (pythonExcluded.length && !reason) throw new Error('Una exclusión Python exige --python-exclude-reason');
  const pythonTests = allPython.filter((f) => !pythonExcluded.includes(f)).map((f) => `tools/anatomy/${f}`);
  const python = values.python ?? process.env['VEXUS_PYTHON'] ?? 'python3';
  const e2e = { swiftshader: specs(values['e2e-swiftshader']), metal: specs(values['e2e-metal']) };
  const tierBudget = root === toolRoot ? undefined : ['node', '--import', 'tsx', join(toolRoot, 'tools/ci/tier-budget.ts'), '--root', root];
  const all = closureStages({ python, pythonTests, pythonExcluded: { files: pythonExcluded, reason }, e2e, tierBudget });
  const requested: StageName[] = [];
  if (e2e.swiftshader) requested.push('e2e-swiftshader');
  if (e2e.metal) requested.push('e2e-metal');
  const selection = selectStages(all, { only: list(values.only), skip: list(values.skip), requested });
  const recordPath = join(evidence, 'closure.json');
  const previous = existsSync(recordPath) ? (JSON.parse(readFileSync(recordPath, 'utf8')) as ClosureRecord) : null;

  if (values['dry-run']) {
    const prev = new Map((previous?.stages ?? []).map((s) => [s.name, s]));
    for (const name of STAGE_ORDER) {
      const def = selection.selected.find((d) => d.name === name);
      const ex = selection.excluded.find((e) => e.name === name);
      const reuse = def && values.resume && prev.get(name)?.status === 'passed' && prev.get(name)?.current?.key === stageKey(def);
      console.log(`${name}: ${def ? (reuse ? 'reutiliza (aprobada)' : 'corre') : `excluida (${ex?.reason})`}`);
      if (def && !reuse) for (const c of def.commands) console.log(`    ${def.niceless ? '' : `nice -n ${NICE_LEVEL} `}${c.join(' ')}`);
    }
    return 0;
  }

  for (const d of ['logs', 'runs', 'tmp/mpl']) mkdirSync(join(evidence, d), { recursive: true });
  const progressPath = resolve(values.progress ?? join(evidence, 'progress.md'));
  const inherited = feedbackGitEnvironment(process.env);
  const baseEnv: NodeJS.ProcessEnv = {
    ...inherited,
    ...SERIAL_ENV,
    // El mismo Node que ejecuta el cierre para npm, node y los scripts del paquete.
    PATH: `${dirname(process.execPath)}:${inherited['PATH'] ?? ''}`,
    TMPDIR: join(evidence, 'tmp'),
    MPLCONFIGDIR: join(evidence, 'tmp/mpl'),
  };
  const head = () => git('rev-parse', 'HEAD').trim();

  const signals = closureSignals();
  try {
    const execute = async (stage: PreparedStage): Promise<ExecutionResult> => {
      const dir = join(evidence, stage.dir);
      // Sólo las etapas que escriben en su carpeta (informes, E2E, artefactos) la crean.
      if (stage.artifacts.length || stage.commands.some((c) => c.some((a) => a.includes(dir)))) mkdirSync(dir, { recursive: true });
      const fd = openSync(join(evidence, stage.log), 'a');
      const env: NodeJS.ProcessEnv = { ...baseEnv };
      for (const [k, v] of Object.entries(stage.env)) {
        if (v === null) delete env[k];
        else env[k] = v;
      }
      const during: number[] = [];
      const timer = setInterval(() => during.push(load1()), 30_000);
      const t0 = performance.now();
      const seconds = () => (performance.now() - t0) / 1000;
      try {
        for (const argv of stage.commands) {
          const full = stage.nice ? ['nice', '-n', String(NICE_LEVEL), ...argv] : argv;
          writeSync(fd, `\n$ ${full.join(' ')}\n# ${new Date().toISOString()} · HEAD ${head()}\n`);
          const r = await spawnLogged(full, root, env, fd, signals.signal);
          if (r.code !== 0 || r.signal) return { exitCode: r.code, signal: r.signal, error: null, seconds: seconds(), loadDuring: during };
        }
        return { exitCode: 0, signal: null, error: null, seconds: seconds(), loadDuring: during };
      } finally {
        clearInterval(timer);
        copyAttemptArtifacts(root, dir, stage.artifacts, stage.startedUtc);
        closeSync(fd);
      }
    };

    const record = await runClosure(
      {
        evidence,
        selection,
        previous,
        resume: Boolean(values.resume),
        allowDirty: Boolean(values['allow-dirty']),
        waitLoad: positive(values['wait-load'], '--wait-load'),
        maxWaitMinutes: positive(values['max-wait-min'], '--max-wait-min'),
        failFast: Boolean(values['fail-fast']),
        only: list(values.only),
        skip: list(values.skip),
        branch: git('rev-parse', '--abbrev-ref', 'HEAD').trim(),
        checkout: root,
        environment: {
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          cpus: availableParallelism(),
          performanceCores: sysctl('hw.perflevel0.physicalcpu'),
          efficiencyCores: sysctl('hw.perflevel1.physicalcpu'),
          python,
          tool: toolRoot,
          toolHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: toolRoot, encoding: 'utf8', env: feedbackGitEnvironment() }).trim(),
          ...SERIAL_ENV,
        },
        pythonExcluded: { files: pythonExcluded, reason },
        includedPython: pythonTests,
      },
      {
        signal: signals.signal,
        state: () => ({
          head: head(),
          dirty: git('status', '--porcelain=v1', '--untracked-files=all').split('\n').filter(Boolean),
          fingerprint: feedbackFingerprint(root, evidence),
        }),
        sample,
        execute,
        wait: (ms) => waitForLoad(ms, signals.signal),
        now: () => new Date(),
        save: (r) => {
          writeFileSync(recordPath + '.tmp', JSON.stringify(r, null, 2) + '\n');
          renameSync(recordPath + '.tmp', recordPath);
        },
        progress: (line) => {
          appendFileSync(progressPath, line + '\n');
          console.log(line);
        },
        log: (line) => console.log(`[cierre ${new Date().toISOString()}] ${line}`),
      },
    );
    const r = record.result;
    console.log(
      `Cierre ${r.passed ? 'aprobado' : 'NO aprobado'}${r.complete ? ' y completo' : ''}: HEAD ${record.head.slice(0, 7)}, ` +
        `fallidas [${r.failed.join(', ')}], pendientes [${r.pending.join(', ')}], no evaluadas [${r.unevaluated.join(', ')}]${r.aborted ? `, ${r.aborted}` : ''}. ${recordPath}`,
    );
    return r.passed ? 0 : 1;
  } finally {
    signals.dispose();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  },
);
