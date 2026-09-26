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
// 2026-09-25 (ter): la pared realista (decisión 62) lleva index de 269,9 a 295,4 kB (vite build sobre main
// 3c2cec6): el GLSL del módulo de la pared en la anatomía (~7 kB, que viaja en todas las pasadas que
// clasifican), el de su textura y del eco de cara plana en la pasada B (~6 kB), sus gemelos TS, el banco de la
// pared y las filas de las caras nuevas. index sube a 305 kB.
// 2026-09-25 (quater): la compresión de la sonda (decisión 63) lleva index de 296,6 a 310,3 kB (vite build sobre
// main f0d98d3): el GLSL del campo y de su jacobiana en la anatomía (~4,5 kB de texto), su uso en la pasada B, el
// módulo del campo y el del contacto (tabla por nodo) con sus comentarios en el GLSL. index sube a 320 kB.
// 2026-09-25 (quinquies): el build quita los comentarios y la sangría del texto GLSL (`tools/build/glslMinify.ts`):
// index baja de 312,7 a 284,3 kB y el JS total de 987,8 a 959,4 kB (vite build sobre main 007204e). Los límites no
// cambian: el margen es para las decisiones 67–74, que suman ~18 kB de GLSL y módulos.
// 2026-09-26: el build renombra además los identificadores declarados en el texto GLSL (`tools/build/glslMangle.ts`,
// segunda etapa de `glslMinify.ts`): index baja de 314,9 a 300,2 kB y el JS total de 997,9 a 983,2 kB (vite build
// sobre main 8bec4d7). Los límites no cambian.
// 2026-09-26: la pestaña Docente (verdad, intervenciones y diagnóstico) pasa a su propio chunk, que solo se carga en
// modo docente: index baja de 326,2 a 319,3 kB con la aurícula de lazo cerrado (decisión 79, vite build sobre
// 22c8547). El JS total cuenta lo que puede descargar un usuario: los ganchos de prueba (`testHooks`, solo con `?e2e`
// o en desarrollo, 56 kB) salen del total y conservan su límite por chunk. Los límites no cambian.
// 2026-09-26: el build quita además los espacios y los saltos de línea que no separan nada del texto GLSL
// (`tools/build/glslCompact.ts`, tercera etapa de `glslMinify.ts`): index baja de 318,0 a 304,6 kB y el JS total de 953,1
// a 939,6 kB (vite build sobre main 8e83d9a). Los límites no cambian: el margen es para el retroperitoneo y los casos
// trampa.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const KB = 1024;
const BUDGETS: Array<[RegExp, number]> = [
  [/three.*\.js$/, 700 * KB],
  [/index-.*\.js$/, 320 * KB],
  [/\.css$/, 20 * KB],
  [/\.js$/, 120 * KB], // cualquier otro chunk
];
const TOTAL_JS_BUDGET = 1000 * KB;
/** Chunks que un usuario nunca descarga (solo `?e2e` o desarrollo): fuera del total, con su límite por chunk. */
const TEST_ONLY = /^testHooks-.*\.js$/;

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
  if (f.endsWith('.js') && !TEST_ONLY.test(f)) totalJs += size;
  const budget = BUDGETS.find(([re]) => re.test(f));
  const max = budget ? budget[1] : Infinity;
  const ok = size <= max;
  if (!ok) over = true;
  rows.push([
    TEST_ONLY.test(f) ? `${f} (solo pruebas)` : f,
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
