import { listedTestIds, verifyShardPlans, type ListedReport } from './e2eShardPlan';

export interface PlannedTest {
  id: string;
  selector: string;
}
interface Suite {
  title?: string;
  suites?: Suite[];
  specs?: Array<{
    id: string;
    file: string;
    title: string;
    tests: Array<{ projectId: string; projectName?: string; expectedStatus: string }>;
  }>;
}

/** Fully qualified native Playwright selectors, later re-collected to prove exact ID equality. */
export function selectorsOf(report: ListedReport): PlannedTest[] {
  const ids = listedTestIds(report);
  const out: PlannedTest[] = [];
  const visit = (suite: Suite, parents: string[]): void => {
    for (const spec of suite.specs ?? []) {
      if (!spec.file || !spec.title) throw new Error('Missing test selector metadata');
      for (const test of spec.tests)
        out.push({
          id: `${spec.id}/${test.projectId}`,
          selector: `[${test.projectName ?? test.projectId}] › ${spec.file} › ${[...parents, spec.title].join(' › ')}`,
        });
    }
    for (const child of suite.suites ?? []) visit(child, child.title ? [...parents, child.title] : parents);
  };
  for (const suite of report.suites as Suite[]) visit(suite, []);
  if (JSON.stringify(ids) !== JSON.stringify(out.map((t) => t.id))) throw new Error('Selector identity mismatch');
  return out;
}

/** Historical durations influence assignment only. Every currently collected test enters the plan. */
export function balanceTests(tests: readonly PlannedTest[], weights: Readonly<Record<string, number>>, count: number) {
  if (!Number.isInteger(count) || count < 1 || tests.length < count) throw new Error('Invalid shard count');
  const values = Object.values(weights).sort((a, b) => a - b);
  if (values.some((n) => !Number.isFinite(n) || n <= 0)) throw new Error('Invalid historical duration');
  const fallback = values.length ? values[Math.floor(values.length / 2)] : 120000;
  const cost = (test: PlannedTest) => (Object.hasOwn(weights, test.id) ? weights[test.id] : fallback);
  const shards = Array.from({ length: count }, () => ({ tests: [] as PlannedTest[], estimatedMs: 0 }));
  for (const test of [...tests].sort((a, b) => cost(b) - cost(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    let slot = 0;
    for (let i = 1; i < count; i++) if (shards[i].estimatedMs < shards[slot].estimatedMs) slot = i;
    shards[slot].tests.push(test);
    shards[slot].estimatedMs += cost(test);
  }
  verifyShardPlans(
    tests.map((t) => t.id),
    shards.map((s) => s.tests.map((t) => t.id)),
  );
  return { shards, fallbackMs: fallback };
}

interface ExecutedTest {
  expectedStatus: string;
  projectId: string;
  status: string;
  results: Array<{ status: string; retry: number }>;
}
interface ExecutedSuite {
  suites?: ExecutedSuite[];
  specs?: Array<{ id: string; ok: boolean; tests: ExecutedTest[] }>;
}
export interface ExecutedReport {
  errors: unknown[];
  suites: ExecutedSuite[];
}

/** Passing job status alone is insufficient: demand one successful execution of each expected ID. */
export function verifyExecutedReport(report: ExecutedReport, expected: readonly string[]): string[] {
  if (!Array.isArray(report.errors) || report.errors.length || !Array.isArray(report.suites)) throw new Error('Invalid execution report');
  const actual: string[] = [];
  const visit = (s: ExecutedSuite): void => {
    for (const spec of s.specs ?? [])
      for (const test of spec.tests) {
        if (
          !spec.ok ||
          test.expectedStatus !== 'passed' ||
          test.status !== 'expected' ||
          test.results.length !== 1 ||
          test.results[0].status !== 'passed' ||
          test.results[0].retry !== 0
        )
          throw new Error('Skipped, flaky or failed E2E execution');
        actual.push(`${spec.id}/${test.projectId}`);
      }
    for (const child of s.suites ?? []) visit(child);
  };
  for (const suite of report.suites) visit(suite);
  verifyShardPlans(expected, [actual]);
  return actual;
}
