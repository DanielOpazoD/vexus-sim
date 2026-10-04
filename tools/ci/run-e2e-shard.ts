import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { writePlan } from './e2ePlanIO';
const index = Number(process.argv[2]),
  total = Number(process.argv[3]);
const plan = writePlan(index);
if (total !== plan.count) throw new Error('Runner count differs from verified matrix');
writeFileSync(
  '.validation/e2e-execution.json',
  JSON.stringify({ index, total, sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), plan }, null, 2) +
    '\n',
);
execFileSync(
  process.execPath,
  ['node_modules/@playwright/test/cli.js', 'test', '--forbid-only', '--test-list', `.validation/e2e-shard-${index}.txt`],
  { stdio: 'inherit', env: { ...process.env, CI: '1' } },
);
