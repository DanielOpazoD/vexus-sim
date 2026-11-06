/**
 * Informe de una capa de pruebas y presupuesto por archivo de la capa rápida (decisión 322, punto 7).
 * Uso: node --import tsx tools/ci/tier-budget.ts <fast|slow> <informe-vitest.json> [--out capa.json] [--root checkout]
 * El informe debe ser de la capa completa. El presupuesto por archivo sólo se evalúa con un trabajador y con la carga
 * media de 5 min al terminar ≤ TIMING_MAX_LOAD; con más carga queda declarado no evaluable.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  BUDGET_UNAVAILABLE_EXIT_CODE,
  FAST_FILE_BUDGET_MS,
  HOOK_BUDGET_SECONDS,
  testTierFiles,
  tierBudgetViolations,
  tierTimings,
  TIMING_MAX_LOAD,
  type VitestJsonReport,
} from './testTiers';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string' }, root: { type: 'string' } } });
// Las capas y las rutas del informe son las del checkout medido (por omisión, éste).
const root = resolve(values.root ?? resolve(import.meta.dirname, '../..'));
const [tier, reportPath] = positionals;
if ((tier !== 'fast' && tier !== 'slow') || !reportPath) {
  console.error('Uso: node --import tsx tools/ci/tier-budget.ts <fast|slow> <informe-vitest.json> [--out capa.json]');
  process.exit(2);
}
const timings = tierTimings(JSON.parse(readFileSync(reportPath, 'utf8')) as VitestJsonReport, root);
const expected = testTierFiles(join(root, 'src'))[tier].map((f) => relative(root, f).replaceAll('\\', '/'));
// La media de 5 min al terminar cubre la mayor parte de una capa rápida serial (3–9 min).
const load5 = Math.round(loadavg()[1] * 100) / 100;
const evaluated = tier === 'fast' && load5 <= TIMING_MAX_LOAD;
const violations = tierBudgetViolations(timings, expected, evaluated ? FAST_FILE_BUDGET_MS : null);
const s = (ms: number) => Math.round(ms / 100) / 10;
const summary = {
  tier,
  report: resolve(reportPath),
  files: timings.files.length,
  tests: timings.tests,
  totalSeconds: s(timings.totalMs),
  wallSeconds: s(timings.wallMs),
  serial: timings.serial,
  load5AtEnd: load5,
  budget:
    tier === 'fast' ? { fileSeconds: s(FAST_FILE_BUDGET_MS), hookSeconds: HOOK_BUDGET_SECONDS, maxLoad: TIMING_MAX_LOAD, evaluated } : null,
  slowest: timings.files
    .slice(0, 15)
    .map((f) => ({ file: f.file, seconds: s(f.ms), tests: f.tests, slowestTestSeconds: s(f.slowestTestMs) })),
  violations,
};
if (values.out) writeFileSync(values.out, JSON.stringify(summary, null, 2) + '\n');
console.log(
  `Capa ${tier}: ${summary.files} archivos, ${summary.tests} pruebas, suma ${summary.totalSeconds} s, pared ${summary.wallSeconds} s` +
    `${timings.serial ? ' (un trabajador)' : ' (paralelo)'}. Los 15 más lentos:`,
);
for (const f of summary.slowest)
  console.log(`  ${String(f.seconds).padStart(7)} s  ${f.tests} pruebas (máx. ${f.slowestTestSeconds} s)  ${f.file}`);
if (tier === 'fast' && !evaluated)
  console.log(
    `Presupuesto por archivo no evaluable: carga media de 5 min ${load5} > ${TIMING_MAX_LOAD} (sólo se comprueba la capa completa).`,
  );
for (const v of violations) console.error(`Presupuesto de capa: ${v}`);
process.exit(violations.length ? 1 : tier === 'fast' && !evaluated ? BUDGET_UNAVAILABLE_EXIT_CODE : 0);
