import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export interface AcceptanceReceipt {
  schemaVersion: 1;
  scope: 'protected-ci' | 'local-reconciliation';
  sourceSha: string;
  treeSha: string;
  ci: { repository: string; runId: number; attempt: number } | null;
  validation: Array<{ phase: string; files: number }>;
  e2e: { tests: number; shards: number; retries: 0; collectionSha256: string };
  evidence: Array<{ artifact: string; path: string; sha256: string }>;
  cost: {
    testMilliseconds: number;
    longestShardMilliseconds: number;
    shortestShardMilliseconds: number;
    longestTests: Array<{ file: string; title: string; milliseconds: number }>;
  };
}
interface TimingSuite {
  specs?: Array<{ file: string; title: string; tests: Array<{ results: Array<{ duration: number }> }> }>;
  suites?: TimingSuite[];
}

/** Solo se llama después de los dos verificadores completos. Los tiempos son observaciones, no umbrales. */
export function acceptanceReceipt(
  root: string,
  e2eRoot: string,
  context: Pick<AcceptanceReceipt, 'scope' | 'sourceSha' | 'treeSha' | 'ci'>,
): AcceptanceReceipt {
  const evidence: AcceptanceReceipt['evidence'] = [];
  const read = (file: string, artifact: string, path: string): string => {
    const bytes = readFileSync(file);
    evidence.push({ artifact, path, sha256: sha256(bytes) });
    return bytes.toString('utf8');
  };
  const validation = ['core', 'matrix'].map((phase) => {
    const report = JSON.parse(read(join(root, '.validation', phase + '.json'), 'validation-' + phase, phase + '.json')) as {
      testResults: unknown[];
    };
    read(join(root, '.validation', phase + '.source.json'), 'validation-' + phase, phase + '.source.json');
    return { phase, files: report.testResults.length };
  });
  const plan = JSON.parse(readFileSync(join(root, '.validation/e2e-shards.json'), 'utf8')) as {
    total: number;
    count: number;
    all: string[];
  };
  const timings: AcceptanceReceipt['cost']['longestTests'] = [],
    shardTimes: number[] = [];
  const walk = (suite: TimingSuite): void => {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests) {
        const milliseconds = test.results[0].duration;
        if (Number.isFinite(milliseconds)) timings.push({ file: spec.file, title: spec.title, milliseconds });
      }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (let i = 1; i <= plan.count; i++) {
    const artifact = `e2e-tiempos-${i}`,
      directory = join(e2eRoot, artifact);
    const report = JSON.parse(read(join(directory, 'e2e-results.json'), artifact, 'e2e-results.json')) as {
      suites: TimingSuite[];
      stats?: { duration: number };
    };
    read(join(directory, '.validation/e2e-execution.json'), artifact, '.validation/e2e-execution.json');
    if (report.stats && Number.isFinite(report.stats.duration)) shardTimes.push(report.stats.duration);
    for (const suite of report.suites) walk(suite);
  }
  return {
    schemaVersion: 1,
    ...context,
    validation,
    e2e: { tests: plan.total, shards: plan.count, retries: 0, collectionSha256: sha256(JSON.stringify(plan.all)) },
    evidence,
    cost: {
      testMilliseconds: timings.reduce((s, t) => s + t.milliseconds, 0),
      longestShardMilliseconds: Math.max(0, ...shardTimes),
      shortestShardMilliseconds: shardTimes.length ? Math.min(...shardTimes) : 0,
      longestTests: timings.sort((a, b) => b.milliseconds - a.milliseconds).slice(0, 5),
    },
  };
}

export interface ReceiptRun {
  id: number;
  run_attempt: number;
  head_sha: string;
  event: string;
  path: string;
  status: string;
  conclusion: string | null;
  repository: { full_name: string };
}
export interface ReceiptCommit {
  sha: string;
  tree: { sha: string };
  parents: Array<{ sha: string }>;
}

/** Autenticidad del proveedor y relación fuente/run; no acepta otro head ni un recibo local como CI. */
export function verifyCiReceipt(
  receipt: AcceptanceReceipt,
  run: ReceiptRun,
  commit: ReceiptCommit,
  repository: string,
  head: string,
): void {
  const hash = /^[a-f0-9]{40}$/;
  if (
    run.status !== 'completed' ||
    run.conclusion !== 'success' ||
    run.path !== '.github/workflows/ci.yml' ||
    run.head_sha !== head ||
    run.repository.full_name.toLowerCase() !== repository.toLowerCase()
  )
    throw new Error('El run no es la CI completa aprobada del head solicitado');
  if (
    receipt.schemaVersion !== 1 ||
    receipt.scope !== 'protected-ci' ||
    !receipt.ci ||
    receipt.ci.repository.toLowerCase() !== repository.toLowerCase() ||
    receipt.ci.runId !== run.id ||
    receipt.ci.attempt !== run.run_attempt
  )
    throw new Error('El recibo no pertenece a este run/intento/repositorio');
  if (
    !hash.test(receipt.sourceSha) ||
    !hash.test(receipt.treeSha) ||
    commit.sha !== receipt.sourceSha ||
    commit.tree.sha !== receipt.treeSha
  )
    throw new Error('Árbol o commit de procedencia inválido');
  if (
    run.event === 'push'
      ? receipt.sourceSha !== head
      : run.event !== 'pull_request' || commit.parents.length !== 2 || !commit.parents.some((p) => p.sha === head)
  )
    throw new Error('La fuente probada no integra el head solicitado');
  if (
    !Number.isInteger(receipt.e2e.tests) ||
    receipt.e2e.tests < 1 ||
    !Number.isInteger(receipt.e2e.shards) ||
    receipt.e2e.shards < 1 ||
    receipt.e2e.retries !== 0 ||
    !/^[a-f0-9]{64}$/.test(receipt.e2e.collectionSha256)
  )
    throw new Error('Inventario E2E inválido');
  if (
    receipt.validation.length !== 2 ||
    !['core', 'matrix'].every(
      (phase) => receipt.validation.filter((p) => p.phase === phase && Number.isInteger(p.files) && p.files > 0).length === 1,
    )
  )
    throw new Error('Falta una fase íntegra');
  const expected = ['core', 'matrix'].flatMap((phase) => [`validation-${phase}/${phase}.json`, `validation-${phase}/${phase}.source.json`]);
  for (let i = 1; i <= receipt.e2e.shards; i++)
    expected.push(`e2e-tiempos-${i}/e2e-results.json`, `e2e-tiempos-${i}/.validation/e2e-execution.json`);
  const actual = receipt.evidence.map((e) => e.artifact + '/' + e.path).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected.sort()) || receipt.evidence.some((e) => !/^[a-f0-9]{64}$/.test(e.sha256)))
    throw new Error('Faltan hashes de los informes originales');
}
