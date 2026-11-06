// Aplica los techos centrales por activo y las dos clausuras por persona a todo el JS de dist.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { bundleAssets } from './bundleAssets';
import { BUDGETS, KB, TEST_ONLY } from './bundleBudgets';
import { measurePersonBundles, type PersonBundleGraph } from './personBundles';

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
const graph = JSON.parse(readFileSync(join(dir, 'person-bundle-graph.json'), 'utf8')) as PersonBundleGraph;
const emittedJs = files
  .filter((f) => f.file.endsWith('.js'))
  .map((f) => f.file)
  .sort();
if (JSON.stringify(emittedJs) !== JSON.stringify(graph.chunks.map((c) => c.file).sort())) throw new Error('JS sin procedencia en dist');
for (const chunk of graph.chunks) {
  const bytes = readFileSync(join(dir, chunk.file));
  if (bytes.length !== chunk.bytes || createHash('sha256').update(bytes).digest('hex') !== chunk.sha256)
    throw new Error(`JS alterado: ${chunk.file}`);
}
const report = measurePersonBundles(graph);
for (const person of ['default', 's0028'] as const)
  console.log(`${person}: ${report[person].bytes} B / ${report[person].ceiling} B; margen ${report[person].margin} B`);
console.log(`Unión de todo dist: ${totalJs} B; compartido: ${report.sharedBytes} B`);
if (over) {
  console.error('bundle-budget: presupuesto por archivo superado');
  process.exit(1);
}
