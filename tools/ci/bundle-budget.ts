// Presupuesto de tamaño del bundle: aplica los techos de `bundleBudgets.ts` (allí su historia) a `dist`
// tras `vite build` y falla si algún activo o el JS total los supera.
import { readFileSync } from 'node:fs';
import { bundleAssets } from './bundleAssets';
import { BUDGETS, KB, TEST_ONLY, TOTAL_JS_BUDGET } from './bundleBudgets';
import { basename, join } from 'node:path';

const dir = join(process.cwd(), 'dist');
let files: Array<{ file: string; size: number }>;
try {
  files = bundleAssets(dir);
} catch {
  console.error('bundle-budget: no existe dist — ejecuta `vite build` antes');
  process.exit(1);
}
const referenceFiles = files.filter(({ file }) => /reference-body-.*\.bin$/.test(file));
if (
  referenceFiles.length !== 1 ||
  !readFileSync(join(dir, referenceFiles[0].file)).equals(readFileSync('src/anatomy/reference-body.bin'))
) {
  throw new Error('Perfil corporal externo ausente, duplicado o modificado');
}
let over = false;
let totalJs = 0;
const rows: string[][] = [];
for (const { file, size } of files) {
  const f = basename(file);
  if (f.endsWith('.js')) totalJs += size;
  const budget = BUDGETS.find(([re]) => re.test(f));
  const max = budget ? budget[1] : Infinity;
  const ok = size <= max;
  if (!ok) over = true;
  rows.push([
    TEST_ONLY.test(f) ? `${file} (solo pruebas)` : file,
    `${(size / KB).toFixed(1)} kB`,
    Number.isFinite(max) ? `${(max / KB).toFixed(0)} kB` : '—',
    ok ? 'ok' : 'OVER',
  ]);
}
const w = rows.reduce((m, r) => Math.max(m, r[0].length), 10);
for (const r of rows) console.log(`${r[0].padEnd(w)}  ${r[1].padStart(10)}  ${r[2].padStart(8)}  ${r[3]}`);
console.log(
  `${'total js'.padEnd(w)}  ${(totalJs / KB).toFixed(1).padStart(7)} kB  ${(TOTAL_JS_BUDGET / KB).toFixed(0).padStart(5)} kB  ${totalJs <= TOTAL_JS_BUDGET ? 'ok' : 'OVER'}`,
);
if (over || totalJs > TOTAL_JS_BUDGET) {
  console.error('bundle-budget: presupuesto superado');
  process.exit(1);
}
