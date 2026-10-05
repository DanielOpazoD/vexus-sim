/** Offline artifact verification and atomic timing-hint output. Does not execute browsers or change acceptance gates. */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { collectTests } from './e2ePlanIO';
import { listedTestIds } from './e2eShardPlan';
import { calibrateE2ETimings, type TimingRun } from './e2eTimingCalibration';

const [manifestPath, outputPath] = process.argv.slice(2);
if (!manifestPath || !outputPath) throw new Error('Usage: node --import tsx tools/ci/recalibrate-e2e.ts manifest.json output.json');
const inputs = JSON.parse(readFileSync(manifestPath, 'utf8')) as Array<{ runId: number; sourceSha: string; directory: string }>;
const evidence = new Map<number, { shard: number; executionSha256: string; reportSha256: string }[]>();
const runs: TimingRun[] = inputs.map((input) => ({
  ...input,
  shards: readdirSync(input.directory)
    .filter((name) => /^e2e-tiempos-\d+$/.test(name))
    .map((name) => {
      const directory = join(input.directory, name);
      const executionText = readFileSync(join(directory, '.validation/e2e-execution.json'), 'utf8');
      const reportText = readFileSync(join(directory, 'e2e-results.json'), 'utf8');
      const execution = JSON.parse(executionText) as TimingRun['shards'][number]['execution'];
      const report = JSON.parse(reportText) as TimingRun['shards'][number]['report'];
      const hash = (text: string) => createHash('sha256').update(text).digest('hex');
      const rows = evidence.get(input.runId) ?? [];
      rows.push({ shard: execution.index, executionSha256: hash(executionText), reportSha256: hash(reportText) });
      evidence.set(input.runId, rows);
      return { execution, report };
    }),
}));
const weights = calibrateE2ETimings(runs, listedTestIds(collectTests()));
const output = {
  ...weights,
  sources: weights.sources.map((source) => ({ ...source, evidence: evidence.get(source.runId)!.sort((a, b) => a.shard - b.shard) })),
};
const temporary = `${outputPath}.tmp-${process.pid}`;
writeFileSync(temporary, JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
renameSync(temporary, outputPath);
console.log(
  `Verified ${Object.keys(output.durationMs).length} current tests across three complete runs; wrote scheduling hints to ${outputPath}`,
);
