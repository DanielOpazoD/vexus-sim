/** Collection only: proves the actual CLI shard plans partition the full suite without launching browsers. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { browserShardCount, listedTestIds, verifyShardPlans, type ListedReport } from './e2eShardPlan';

const scripts = (JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }).scripts;
if (scripts.e2e !== 'playwright test') throw new Error('E2E script differs from the verified collection command');
const count = browserShardCount(readFileSync('.github/workflows/ci.yml', 'utf8'));
const list = (shard?: string): string[] => {
  const output = execFileSync(
    process.execPath,
    ['node_modules/@playwright/test/cli.js', 'test', '--forbid-only', '--list', '--reporter=json', ...(shard ? [`--shard=${shard}`] : [])],
    {
      encoding: 'utf8',
      env: { ...process.env, CI: '1' },
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60_000,
    },
  );
  return listedTestIds(JSON.parse(output) as ListedReport);
};
const started = Date.now();
const all = list(),
  shards = Array.from({ length: count }, (_, i) => list(`${i + 1}/${count}`));
verifyShardPlans(all, shards);
mkdirSync('.validation', { recursive: true });
writeFileSync(
  '.validation/e2e-shards.json',
  JSON.stringify({ collectionOnly: true, elapsedMs: Date.now() - started, total: all.length, count, all, shards }, null, 2) + '\n',
);
console.log(`E2E collection: ${all.length} tests, ${count} disjoint shards (${shards.map((s) => s.length).join('+')}), no omissions`);
