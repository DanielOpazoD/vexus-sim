import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { browserShardCount, listedTestIds, verifyShardPlans, type ListedReport } from './e2eShardPlan';
import { balanceTests, selectorsOf } from './e2eWeightedPlan';

export function collectTests(listFile?: string): ListedReport {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        'node_modules/@playwright/test/cli.js',
        'test',
        '--forbid-only',
        '--list',
        '--reporter=json',
        ...(listFile ? ['--test-list', listFile] : []),
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, CI: '1' },
        maxBuffer: 10 * 1024 * 1024,
        timeout: 60000,
      },
    ),
  ) as ListedReport;
}

export function writePlan(verifyIndex?: number) {
  const scripts = (JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }).scripts;
  if (scripts.e2e !== 'playwright test') throw new Error('Unverified E2E command');
  const count = browserShardCount(readFileSync('.github/workflows/ci.yml', 'utf8'));
  if (verifyIndex !== undefined && (!Number.isInteger(verifyIndex) || verifyIndex < 1 || verifyIndex > count))
    throw new Error('Invalid execution shard');
  const started = Date.now(),
    report = collectTests(),
    all = listedTestIds(report);
  const history = JSON.parse(readFileSync('tools/ci/e2eTimingWeights.json', 'utf8')) as { durationMs: Record<string, number> };
  const balanced = balanceTests(selectorsOf(report), history.durationMs, count);
  mkdirSync('.validation', { recursive: true });
  const shards = balanced.shards.map((s, i) => {
    const path = `.validation/e2e-shard-${i + 1}.txt`;
    writeFileSync(path, s.tests.map((t) => t.selector).join('\n') + '\n');
    const expected = s.tests.map((t) => t.id);
    if (verifyIndex === undefined || verifyIndex === i + 1) verifyShardPlans(expected, [listedTestIds(collectTests(path))]);
    return expected;
  });
  verifyShardPlans(all, shards);
  const plan = {
    collectionOnly: true,
    elapsedMs: Date.now() - started,
    total: all.length,
    count,
    all,
    shards,
    estimatedMs: balanced.shards.map((s) => s.estimatedMs),
    fallbackMs: balanced.fallbackMs,
  };
  writeFileSync('.validation/e2e-shards.json', JSON.stringify(plan, null, 2) + '\n');
  console.log(
    `E2E: ${all.length} tests, ${count} disjoint cost-balanced lists; no omissions. Estimated seconds: ${plan.estimatedMs.map((n) => Math.round(n / 1000)).join(', ')}`,
  );
  return plan;
}
