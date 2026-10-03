/** The supported CI matrix has one literal, consecutive shard axis; no custom scheduler. */
export function browserShardCount(workflow: string): number {
  const job = workflow.split('\n  e2e:\n')[1]?.split(/\n {2}[\w-]+:\n/)[0];
  const literal = job?.match(/matrix:\s*\n\s+shard:\s*(\[[^\n]+\])\s*\n\s+steps:/)?.[1];
  if (!literal) throw new Error('Expected one literal E2E shard axis');
  const shards: unknown = JSON.parse(literal);
  if (!Array.isArray(shards) || !shards.length || shards.some((n: unknown, i: number) => n !== i + 1))
    throw new Error('E2E shards must be consecutive, unique and one-based');
  if (
    !job
      ?.split('\n')
      .some((line) => line.trim() === '- run: npm run e2e -- --forbid-only --shard=${{ matrix.shard }}/${{ strategy.job-total }}')
  )
    throw new Error('E2E command must use the matrix total');
  return shards.length;
}

interface ListedSuite {
  suites?: ListedSuite[];
  specs?: Array<{ id: string; tests: Array<{ projectId: string; expectedStatus: string }> }>;
}
export interface ListedReport {
  suites: ListedSuite[];
  errors: unknown[];
}

/** Playwright's own stable spec/project IDs, including nested and parameterized suites. */
export function listedTestIds(report: ListedReport): string[] {
  if (!Array.isArray(report.suites) || !Array.isArray(report.errors) || report.errors.length) throw new Error('Invalid Playwright listing');
  const ids: string[] = [];
  const visit = (suite: ListedSuite): void => {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests) {
        if (!spec.id || !test.projectId || test.expectedStatus !== 'passed') throw new Error('Skipped or invalid E2E test');
        ids.push(`${spec.id}/${test.projectId}`);
      }
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of report.suites) visit(suite);
  return ids;
}

export function verifyShardPlans(all: readonly string[], shards: readonly (readonly string[])[]): void {
  if (!all.length || new Set(all).size !== all.length || !shards.length || shards.some((s) => !s.length))
    throw new Error('Empty or duplicate E2E plan');
  const actual = shards.flat();
  if (new Set(actual).size !== actual.length || JSON.stringify([...actual].sort()) !== JSON.stringify([...all].sort()))
    throw new Error('E2E shard union must contain every test exactly once');
}
