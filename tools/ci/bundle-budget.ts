// Presupuesto de tamaño del bundle (práctica de EchoTwin, hallazgo B4).
// Medido el 2026-09-21 tras añadir three.js: index ≈ 120 kB, chunk three ≈ 560 kB.
// Regla: un presupuesto solo se sube a propósito, en el mismo cambio que explica
// el crecimiento. Se ejecuta tras `vite build` y falla si algún activo lo supera.
// 2026-09-23: index 196 kB en main; la pasada A en cuatro etapas (decisión 54) y el
// moteado anclado y por tejido (55–56) añaden ~12 kB de GLSL, que viaja como texto en el
// chunk principal: index sube a 240 kB.
// 2026-09-24: la composición espacial (decisión 58) lleva index de 228,8 a 250,1 kB (+21 kB): el GLSL
// de las ramas dirigidas de A2, A y B y de la pasada K (texto en el chunk principal, ~8 kB), el anillo de
// miradas del renderer y los módulos de la geometría dirigida. index sube a 260 kB.
// 2026-09-25: la pleura parietal y la cortina (decisión 61) añaden ~15,4 kB (estimado con esbuild frente a la
// base, main 3cd8cb3): el GLSL de la pleura, la serie y el deslizamiento en los dos programas de B, A0 y A1
// (texto en el chunk principal) y su módulo. index sube a 270 kB.
// 2026-09-25 (bis): sobre main a9520b8 la rama de la decisión 61 medía 266,2 kB; el arreglo del JIT de
// SwiftShader (classifyWall, wallField) y la cortina en K (fracción de aire compartida) la llevan a 269,9 kB
// (vite build): 0,1 kB de margen. index sube a 280 kB.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const KB = 1024;
const BUDGETS: Array<[RegExp, number]> = [
  [/three.*\.js$/, 700 * KB],
  [/index-.*\.js$/, 280 * KB],
  [/\.css$/, 20 * KB],
  [/\.js$/, 120 * KB], // cualquier otro chunk
];
const TOTAL_JS_BUDGET = 1000 * KB;

const dir = join(process.cwd(), 'dist', 'assets');
let files: string[];
try {
  files = readdirSync(dir);
} catch {
  console.error('bundle-budget: no existe dist/assets — ejecuta `vite build` antes');
  process.exit(1);
}
let over = false;
let totalJs = 0;
const rows: string[][] = [];
for (const f of files) {
  if (f.endsWith('.map')) continue;
  const size = statSync(join(dir, f)).size;
  if (f.endsWith('.js')) totalJs += size;
  const budget = BUDGETS.find(([re]) => re.test(f));
  const max = budget ? budget[1] : Infinity;
  const ok = size <= max;
  if (!ok) over = true;
  rows.push([f, `${(size / KB).toFixed(1)} kB`, Number.isFinite(max) ? `${(max / KB).toFixed(0)} kB` : '—', ok ? 'ok' : 'OVER']);
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
