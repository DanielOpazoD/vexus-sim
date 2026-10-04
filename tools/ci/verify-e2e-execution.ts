/** Protected verdict: reconcile actual browser reports with the complete current collection. */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { writePlan } from './e2ePlanIO';
import { verifyShardPlans } from './e2eShardPlan';
import { verifyExecutedReport, type ExecutedReport } from './e2eWeightedPlan';
const root = process.argv[2] ?? 'e2e-evidence';
const plan = writePlan();
const expectedSha = process.env.GITHUB_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const folders = readdirSync(root).filter((n) => n.startsWith('e2e-tiempos-'));
if (folders.length !== plan.count) throw new Error('Missing or extra execution artifacts');
const actual: string[][] = [];
for (let index = 1; index <= plan.count; index++) {
  const dir = join(root, `e2e-tiempos-${index}`);
  const metadata = JSON.parse(readFileSync(join(dir, '.validation/e2e-execution.json'), 'utf8')) as {
    index: number;
    total: number;
    sourceSha: string;
    plan: { all: string[]; shards: string[][] };
  };
  if (
    metadata.index !== index ||
    metadata.total !== plan.count ||
    metadata.sourceSha !== expectedSha ||
    JSON.stringify(metadata.plan.all) !== JSON.stringify(plan.all) ||
    JSON.stringify(metadata.plan.shards) !== JSON.stringify(plan.shards)
  )
    throw new Error(`Execution identity differs for shard ${index}`);
  actual.push(
    verifyExecutedReport(JSON.parse(readFileSync(join(dir, 'e2e-results.json'), 'utf8')) as ExecutedReport, plan.shards[index - 1]),
  );
}
verifyShardPlans(plan.all, actual);
console.log(
  `Verified actual browser execution: ${plan.total} unique tests passed exactly once, zero retries, all ${plan.count} reports match source ${expectedSha}`,
);
