/** Consume el recibo del veredicto protegido; los informes completos siguen en sus artefactos originales. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { sha256, verifyCiReceipt, type AcceptanceReceipt, type ReceiptCommit, type ReceiptRun } from '../ci/acceptanceReceipt';

const root = resolve(import.meta.dirname, '../..');
const { values } = parseArgs({
  options: { run: { type: 'string' }, head: { type: 'string' }, out: { type: 'string' }, help: { type: 'boolean' } },
});
if (values.help)
  console.log(
    'npm run workspace:ci -- --run <id completo> [--head <sha>] [--out carpeta-nueva]. Verifica proveedor, SHA, árbol y recibo; no vuelve a ejecutar tests ni autoriza merge por sí solo.',
  );
else {
  const runId = Number(values.run);
  if (!Number.isSafeInteger(runId) || runId < 1) throw new Error('--run debe identificar una ejecución de CI');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const head = values.head ?? git('rev-parse', 'HEAD');
  if (!/^[a-f0-9]{40}$/.test(head)) throw new Error('--head requiere un SHA completo');
  const remote = git('remote', 'get-url', 'origin');
  const repository = remote.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?$/)?.[1];
  if (!repository) throw new Error('Se requiere el origin GitHub del proyecto');
  const out = resolve(root, values.out ?? `.cache/ci/${runId}-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`);
  mkdirSync(dirname(out), { recursive: true });
  mkdirSync(out);
  const started = performance.now();
  const api = (path: string) => execFileSync('gh', ['api', `repos/${repository}/${path}`], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
  const json = <T>(path: string): T => JSON.parse(api(path).toString('utf8')) as T;
  const save = (name: string, value: unknown) => writeFileSync(resolve(out, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  try {
    const run = json<ReceiptRun>(`actions/runs/${runId}`);
    save('provider-run.json', run);
    if (run.status !== 'completed' || run.conclusion !== 'success') throw new Error(`CI aún no aprobada: ${run.status}/${run.conclusion}`);
    const jobs = json<{ total_count: number; jobs: Array<{ name: string; status: string; conclusion: string }> }>(
      `actions/runs/${runId}/jobs?per_page=100`,
    );
    save('provider-jobs.json', jobs);
    if (
      jobs.total_count !== jobs.jobs.length ||
      jobs.jobs.filter((j) => j.name === 'CI verde (check + e2e)' && j.status === 'completed' && j.conclusion === 'success').length !== 1 ||
      jobs.jobs.some((j) => j.status !== 'completed' || j.conclusion !== 'success')
    )
      throw new Error('El veredicto y todos sus trabajos deben estar aprobados');
    const artifacts = json<{
      total_count: number;
      artifacts: Array<{ id: number; name: string; expired: boolean; digest: string; workflow_run: { id: number } }>;
    }>(`actions/runs/${runId}/artifacts?per_page=100`);
    save('provider-artifacts.json', artifacts);
    const matches = artifacts.artifacts.filter((a) => a.name === 'acceptance-receipt');
    if (
      artifacts.total_count !== artifacts.artifacts.length ||
      matches.length !== 1 ||
      matches[0].expired ||
      matches[0].workflow_run.id !== runId
    )
      throw new Error('Falta un único recibo original vigente; usar los informes completos de runs anteriores');
    const artifact = matches[0],
      bytes = api(`actions/artifacts/${artifact.id}/zip`),
      digest = sha256(bytes);
    const zip = resolve(out, 'acceptance-receipt.zip');
    writeFileSync(zip, bytes, { flag: 'wx' });
    if (artifact.digest !== 'sha256:' + digest) throw new Error('El ZIP no coincide con el digest de GitHub');
    // Leer una sola entrada, sin extraer rutas del ZIP al sistema de archivos.
    const entries = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).trim().split('\n');
    if (entries.length !== 1 || entries[0] !== 'acceptance-receipt.json') throw new Error('Contenido inesperado del ZIP');
    const raw = execFileSync('unzip', ['-p', zip, 'acceptance-receipt.json'], { maxBuffer: 2 * 1024 * 1024 });
    const receipt = JSON.parse(raw.toString('utf8')) as AcceptanceReceipt;
    writeFileSync(resolve(out, 'acceptance-receipt.json'), raw, { flag: 'wx' });
    if (!/^[a-f0-9]{40}$/.test(receipt.sourceSha)) throw new Error('SHA de procedencia inválido');
    const commit = json<ReceiptCommit>(`git/commits/${receipt.sourceSha}`);
    save('provider-source-commit.json', commit);
    verifyCiReceipt(receipt, run, commit, repository, head);
    const result = {
      state: 'verified-ci-receipt',
      repository,
      head,
      sourceSha: receipt.sourceSha,
      treeSha: receipt.treeSha,
      runId,
      attempt: run.run_attempt,
      tests: receipt.e2e.tests,
      shards: receipt.e2e.shards,
      retries: 0,
      originalZipSha256: digest,
      downloadedZipBytes: bytes.length,
      milliseconds: Math.round(performance.now() - started),
      scope:
        'Verified protected CI of this head; no clinical approval, no assessment that earlier failures are repaired; supplementary workflows reviewed separately',
    };
    save('verification.json', result);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    save('rejected.json', { state: 'not-verified', runId, head, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
