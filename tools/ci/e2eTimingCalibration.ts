import { verifyShardPlans } from './e2eShardPlan';
import { verifyExecutedReport } from './e2eWeightedPlan';

interface TimedSuite {
  suites?: TimedSuite[];
  specs?: Array<{
    id: string;
    ok: boolean;
    tests: Array<{
      projectId: string;
      expectedStatus: string;
      status: string;
      results: Array<{ status: string; retry: number; duration: number }>;
    }>;
  }>;
}
export interface TimingRun {
  runId: number;
  sourceSha: string;
  shards: Array<{
    execution: { index: number; total: number; sourceSha: string; plan: { all: string[]; shards: string[][] } };
    report: { errors: unknown[]; suites: TimedSuite[] };
  }>;
}

/** Scheduling hints from complete executions, never permission to omit current tests.
 * Source authenticity is established when retrieving official workflow artifacts; this verifies their structure.
 */
export function calibrateE2ETimings(runs: readonly TimingRun[], currentIds: readonly string[]) {
  if (runs.length !== 3 || new Set(runs.map((r) => r.runId)).size !== 3 || !currentIds.length)
    throw new Error('Three distinct complete runs and a current test collection are required');
  const durations = new Map(currentIds.map((id) => [id, [] as number[]]));
  const ordered = [...runs].sort((a, b) => a.runId - b.runId);
  for (const run of ordered) {
    if (!Number.isSafeInteger(run.runId) || run.runId <= 0 || !/^[a-f0-9]{40}$/.test(run.sourceSha))
      throw new Error('Invalid run identity');
    const shards = [...run.shards].sort((a, b) => a.execution.index - b.execution.index);
    const first = shards[0]?.execution;
    if (
      !first ||
      !Number.isInteger(first.total) ||
      first.total < 1 ||
      shards.length !== first.total ||
      first.plan.shards.length !== first.total
    )
      throw new Error('Incomplete shard evidence');
    verifyShardPlans(currentIds, [first.plan.all]);
    verifyShardPlans(currentIds, first.plan.shards);
    const actual: string[][] = [];
    for (const [offset, shard] of shards.entries()) {
      const m = shard.execution;
      if (
        m.index !== offset + 1 ||
        m.total !== first.total ||
        m.sourceSha !== run.sourceSha ||
        JSON.stringify(m.plan.all) !== JSON.stringify(first.plan.all) ||
        JSON.stringify(m.plan.shards) !== JSON.stringify(first.plan.shards)
      )
        throw new Error('Execution identity or partition changed within a run');
      actual.push(verifyExecutedReport(shard.report, first.plan.shards[offset]));
      const visit = (suite: TimedSuite): void => {
        for (const spec of suite.specs ?? [])
          for (const test of spec.tests) {
            const duration = test.results[0].duration;
            if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid measured duration');
            durations.get(`${spec.id}/${test.projectId}`)!.push(duration);
          }
        for (const child of suite.suites ?? []) visit(child);
      };
      for (const suite of shard.report.suites) visit(suite);
    }
    verifyShardPlans(currentIds, actual);
  }
  return {
    method: 'Median duration in milliseconds from three verified no-retry full-suite runs; scheduling hints only, never test selection',
    sources: ordered.map((r) => ({ runId: r.runId, headSha: r.sourceSha })),
    durationMs: Object.fromEntries(
      [...durations.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([id, values]) => {
          if (values.length !== 3) throw new Error('Incomplete duration history');
          return [id, [...values].sort((a, b) => a - b)[1]];
        }),
    ),
  };
}
