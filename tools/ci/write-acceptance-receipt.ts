/** Publicación interna posterior a los dos verificadores. No vuelve a ejecutar sus comprobaciones. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { acceptanceReceipt } from './acceptanceReceipt';

const root = process.cwd(),
  e2eRoot = resolve(process.argv[2] ?? 'e2e-evidence');
if (
  process.env.GITHUB_ACTIONS !== 'true' ||
  process.env.GITHUB_JOB !== 'veredicto' ||
  process.env.VERIFIED_VALIDATION !== 'success' ||
  process.env.VERIFIED_EXECUTION !== 'success'
)
  throw new Error('Solo publica el veredicto CI después de ambos verificadores aprobados');
const out = join(root, '.validation/acceptance-receipt.json');
mkdirSync(join(root, '.validation'), { recursive: true });
if (existsSync(out)) throw new Error('Ya existe un recibo; no se sobrescribe evidencia');
const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const sourceSha = git('rev-parse', 'HEAD'),
  treeSha = git('rev-parse', 'HEAD^{tree}');
if (process.env.GITHUB_SHA !== sourceSha) throw new Error('El checkout no es GITHUB_SHA');
if (git('status', '--porcelain', '--untracked-files=no'))
  throw new Error('El recibo protegido requiere el veredicto y un checkout intacto');
const ci = {
  repository: process.env.GITHUB_REPOSITORY ?? '',
  runId: Number(process.env.GITHUB_RUN_ID),
  attempt: Number(process.env.GITHUB_RUN_ATTEMPT),
};
if (!ci.repository || !Number.isSafeInteger(ci.runId) || ci.runId < 1 || !Number.isSafeInteger(ci.attempt) || ci.attempt < 1)
  throw new Error('Falta identidad CI');
const receipt = acceptanceReceipt(root, e2eRoot, { sourceSha, treeSha, scope: 'protected-ci', ci });
const temp = out + '.' + process.pid + '.tmp';
writeFileSync(temp, JSON.stringify(receipt, null, 2) + '\n');
renameSync(temp, out);
console.log(`Recibo ${receipt.scope}: ${receipt.e2e.tests} E2E, ${receipt.e2e.shards} grupos, cero reintentos. ${out}`);
