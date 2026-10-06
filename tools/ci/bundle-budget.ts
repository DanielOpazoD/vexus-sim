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
// 2026-09-26: el corazón y el mediastino (decisión 85) llevan index de 317,1 a 320,8 kB (vite build sobre main e37f5d2): el
// módulo de órgano con su gemelo GLSL (~2 kB de texto en todas las pasadas que clasifican), las filas de los dos tejidos y de
// la cara del pericardio, la VCI que entra en la aurícula y el suelo del corazón en `classify`. Ya descuenta la documentación
// de los uniforms de la escena, que viajaba en el bundle solo para acabar como comentario del GLSL (−2,1 kB, ahora
// comentarios del TS), y los motivos largos de la fila del pericardio y de su gemelo solo GPU. index sube a 325 kB.
// 2026-09-27: los vasos orgánicos (decisión 90) llevan index de 324,9 a 329,2 kB (vite build sobre main 281945d): la forma de
// las venas del hígado en la GLSL de la anatomía (el ruido del radio con su hash, la métrica de la sección y la cara del tubo
// que gana, `tubeFace`: ~1,6 kB de GLSL minificado) y ~2,5 kB de su gemelo TS, de la VCI y del quinto téxel de las cabeceras
// de los tubos. index sube a 330 kB.
// 2026-09-27: las costillas opacas y la pared con relieve (decisión 88) llevan index de 329,2 a 333,7 kB (vite build
// sobre main c2133e1, tras los vasos orgánicos de la 90): el relieve fino y lento de las caras de la pared (nueve
// funciones GLSL generadas de sus tablas, en todas las pasadas que clasifican), el gradiente de la capa con su pendiente,
// la interpolación de la transmisión que no cruza la entrada en un hueso en B y D, la ventana de la difusa de la cortical
// y sus gemelos TS. index sube a 335 kB.
import { readFileSync } from 'node:fs';
import { bundleAssets } from './bundleAssets';
import { basename, join } from 'node:path';

const KB = 1024;
const BUDGETS: Array<[RegExp, number]> = [
  // El perfil corporal conserva sus 2080 bytes; carga solo al activar referencia, sin base64 en JS.
  [/reference-body-.*\.bin$/, 2080],
  [/three.*\.js$/, 700 * KB],
  [/^(index|bootstrap)-.*\.js$/, 335 * KB],
  [/\.css$/, 20 * KB],
  [/\.js$/, 120 * KB], // cualquier otro chunk
];
// 30-09-2026: +4 KiB aprobados para corregir captura/presentación PW y añadir controles respiratorios.
// Coste acotado (~0,4 %); todos los chunks de producción y Workers siguen incluidos.
// 01-10-2026: +12 KiB aprobados para el campo corporal/registro compartido de referencia.
// Asset binario contado separadamente; límites por chunk conservados. El saneamiento cloud cuenta también testHooks en el total.
// 02-10-2026: +8 KiB autorizados para asas, pared y contenido intestinales (decisión 101).
// El total ahora recorre todo dist, incluido el worklet raíz que antes se omitía.
// 06-10-2026: +4 KiB para doce pares costales y campo esternal compartido CPU/GPU (decisión 166).
// Medición inicial 1026,9 KiB; conserva todos los chunks, Workers y ganchos dentro del cómputo.
// 06-10-2026: +1 KiB para filtro color periódico/finito (decisión 173); sin excluir chunks.
const TOTAL_JS_BUDGET = 1031 * KB;
/** Identifica los ganchos para el informe; todos los chunks y Workers cuentan en el total. */
const TEST_ONLY = /^testHooks-.*\.js$/;

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
