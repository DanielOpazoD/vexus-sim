import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { verifyCiReceipt, type AcceptanceReceipt, type ReceiptCommit, type ReceiptRun } from '../../tools/ci/acceptanceReceipt';

const head = 'a'.repeat(40),
  source = 'b'.repeat(40),
  tree = 'c'.repeat(40),
  hash = 'd'.repeat(64);
const repository = 'Owner/simulator';
function fixture() {
  const run: ReceiptRun = {
    id: 42,
    run_attempt: 1,
    head_sha: head,
    event: 'pull_request',
    path: '.github/workflows/ci.yml',
    status: 'completed',
    conclusion: 'success',
    repository: { full_name: repository },
  };
  const commit: ReceiptCommit = { sha: source, tree: { sha: tree }, parents: [{ sha: head }, { sha: 'e'.repeat(40) }] };
  const receipt: AcceptanceReceipt = {
    schemaVersion: 1,
    scope: 'protected-ci',
    sourceSha: source,
    treeSha: tree,
    ci: { repository, runId: 42, attempt: 1 },
    validation: [
      { phase: 'core', files: 225 },
      { phase: 'matrix', files: 4 },
    ],
    e2e: { tests: 152, shards: 1, retries: 0, collectionSha256: hash },
    evidence: [
      { artifact: 'validation-core', path: 'core.json', sha256: hash },
      { artifact: 'validation-core', path: 'core.source.json', sha256: hash },
      { artifact: 'validation-matrix', path: 'matrix.json', sha256: hash },
      { artifact: 'validation-matrix', path: 'matrix.source.json', sha256: hash },
      { artifact: 'e2e-tiempos-1', path: 'e2e-results.json', sha256: hash },
      { artifact: 'e2e-tiempos-1', path: '.validation/e2e-execution.json', sha256: hash },
    ],
    cost: { testMilliseconds: 1, longestShardMilliseconds: 1, shortestShardMilliseconds: 1, longestTests: [] },
  };
  return { run, commit, receipt };
}
describe('Recibo compacto con la procedencia del proveedor', () => {
  it('no publica ni sobrescribe evidencia fuera del veredicto CI y conserva los dos gates originales', () => {
    const root = resolve(import.meta.dirname, '../..');
    const temporary = mkdtempSync(join(tmpdir(), 'vexus-receipt-'));
    mkdirSync(join(temporary, '.validation'));
    const existing = join(temporary, '.validation/acceptance-receipt.json');
    writeFileSync(existing, 'previous evidence');
    try {
      const result = spawnSync(
        process.execPath,
        ['--import', join(root, 'node_modules/tsx/dist/loader.mjs'), join(root, 'tools/ci/write-acceptance-receipt.ts')],
        { cwd: temporary, encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'false' } },
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Solo publica el veredicto CI');
      expect(readFileSync(existing, 'utf8')).toBe('previous evidence');
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
    const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
    expect(workflow).toContain('id: validation\n        run: npm run test:coverage:verify');
    expect(workflow).toContain('id: execution\n        run: node --import tsx tools/ci/verify-e2e-execution.ts e2e-evidence');
    expect(workflow).toContain('VERIFIED_VALIDATION: ${{ steps.validation.outcome }}');
    expect(workflow).toContain('VERIFIED_EXECUTION: ${{ steps.execution.outcome }}');
    const upload = workflow.split('name: acceptance-receipt')[1];
    expect(upload).toContain('include-hidden-files: true');
    expect(upload).toContain('if-no-files-found: error');
  });
  it('reconoce el merge probado y exige identidad directa en push', () => {
    const { receipt, run, commit } = fixture();
    expect(() => verifyCiReceipt(receipt, run, commit, repository, head)).not.toThrow();
    run.event = 'push';
    expect(() => verifyCiReceipt(receipt, run, commit, repository, head)).toThrow();
    receipt.sourceSha = head;
    commit.sha = head;
    expect(() => verifyCiReceipt(receipt, run, commit, repository, head)).not.toThrow();
  });
  it.each([
    'wrong head',
    'failed run',
    'local receipt',
    'other attempt',
    'other repo',
    'wrong tree',
    'not parent',
    'missing phase',
    'missing hash',
    'duplicate evidence',
    'retry',
  ])('rechaza %s aunque el JSON parezca aprobado', (scenario) => {
    const { receipt, run, commit } = fixture();
    if (scenario === 'wrong head') run.head_sha = source;
    if (scenario === 'failed run') run.conclusion = 'failure';
    if (scenario === 'local receipt') receipt.scope = 'local-reconciliation';
    if (scenario === 'other attempt') run.run_attempt = 2;
    if (scenario === 'other repo') run.repository.full_name = 'Other/simulator';
    if (scenario === 'wrong tree') commit.tree.sha = head;
    if (scenario === 'not parent') commit.parents = [{ sha: source }];
    if (scenario === 'missing phase') receipt.validation.pop();
    if (scenario === 'missing hash') receipt.evidence.pop();
    if (scenario === 'duplicate evidence') receipt.evidence.push(receipt.evidence[0]);
    if (scenario === 'retry') Object.assign(receipt.e2e, { retries: 1 });
    expect(() => verifyCiReceipt(receipt, run, commit, repository, head)).toThrow();
  });
});
