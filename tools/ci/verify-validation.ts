/** Check the two successful runs cover every discovered suite, without duplicates or omissions. */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { coverageFiles, verifyReportedFiles, type ValidationReport } from './coveragePartition';

const root = process.cwd();
const files = readdirSync(join(root, 'src'), { recursive: true, encoding: 'utf8' })
  .filter((p) => p.endsWith('.test.ts'))
  .map((p) => join(root, 'src', p));
for (const partition of ['core', 'matrix'] as const) {
  const report = JSON.parse(readFileSync(join(root, '.validation', partition + '.json'), 'utf8')) as ValidationReport;
  const expected = coverageFiles(files, partition, 'all');
  verifyReportedFiles(expected, report);
  console.log(`${partition}: ${expected.length} files verified, no omissions or duplicates`);
}
