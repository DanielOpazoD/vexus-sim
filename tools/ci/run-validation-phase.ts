/** Separate CI runners may execute phases; the protected verdict reconciles their exact reports and source. */
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { assertValidationPhase, validationArgs, validationEvidence } from './validationEvidence';
const phase = process.argv[2];
assertValidationPhase(phase);
const head = () => execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const sourceSha = head();
mkdirSync('.validation', { recursive: true });
const reportPath = `.validation/${phase}.json`,
  evidencePath = `.validation/${phase}.source.json`;
rmSync(reportPath, { force: true });
rmSync(evidencePath, { force: true });
const result = spawnSync(process.execPath, validationArgs(phase), {
  stdio: 'inherit',
  env: { ...process.env, VITEST_TIER: 'all', VITEST_COVERAGE_PARTITION: phase },
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
if (head() !== sourceSha) throw new Error('Source commit changed during validation');
if (phase === 'core') copyFileSync('coverage/coverage-summary.json', '.validation/coverage-summary.json');
const evidence = validationEvidence(phase, sourceSha, readFileSync(reportPath, 'utf8'));
writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
console.log(`${phase}: report bound to source ${sourceSha}, SHA256 ${evidence.reportSha256}`);
