import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { glslMinify } from './tools/build/glslMinify';
import { threeGlslCompact } from './tools/build/threeGlslCompact';
import { glslUniformNames } from './tools/build/glslUniformNames';
import { glslPacking } from './tools/build/glslPacking';
import { marchingTable } from './tools/build/marchingTable';
import { sharedCutMapWorker } from './tools/build/sharedCutMapWorker';
import { coverageFiles } from './tools/ci/coveragePartition';

/**
 * Niveles de prueba (práctica de EchoTwin): un archivo cuya PRIMERA línea es
 * `// @tier slow` queda fuera de `npm test` y entra en `test:slow` / `test:all`.
 * Así una prueba pesada no se cuela en la suite rápida por omisión.
 */
// Relativo a este archivo, no al cwd: el servidor puede arrancar desde otro directorio
const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), 'src');
function testFilesWithMarker(marker: string | null, dir = SRC_DIR): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...testFilesWithMarker(marker, p));
    else if (/\.test\.ts$/.test(f) && (marker === null || readFileSync(p, 'utf8').split('\n')[0].trim() === marker)) out.push(p);
  }
  return out;
}
const SLOW = testFilesWithMarker('// @tier slow');

/** Versión y commit del build, visibles en la app y en el diagnóstico exportable. */
const ROOT = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
function gitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'desconocido';
  }
}
const tier = process.env['VITEST_TIER'] ?? 'fast';
const partition = process.env['VITEST_COVERAGE_PARTITION'] ?? 'all';
// The default keeps glob discovery for watch mode; split coverage fails closed on invalid/missing files.
const selected = partition === 'all' ? null : coverageFiles(testFilesWithMarker(null), partition, tier);

export default defineConfig({
  // Source modules expose tagged GLSL to the token-preserving compactor; no vendor fork.
  resolve: { alias: [{ find: /^three$/, replacement: join(ROOT, 'node_modules/three/src/Three.js') }] },
  // el texto de los shaders sin comentarios, sangría, nombres largos ni espacios de más en el build (tools/build/glslMinify.ts)
  plugins: [glslMinify(), glslUniformNames(), threeGlslCompact(), marchingTable(), glslPacking(), sharedCutMapWorker()],
  define: {
    __APP_VERSION__: JSON.stringify(PKG.version),
    __GIT_COMMIT__: JSON.stringify(process.env['GITHUB_SHA']?.slice(0, 7) ?? gitCommit()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: { port: 6600, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: true,
    // three.js en su propio chunk: el presupuesto (tools/ci/bundle-budget.ts) lo mide aparte.
    // Rolldown (Vite 8) no admite la forma objeto de manualChunks: grupo por ruta del módulo.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]/ },
            // Análisis PW y ventanas compartidas con Docente: una descarga, sin duplicar wrappers/imports.
            // Sigue dentro del total JS. Docente carga también este grupo al mostrar la verdad fisiológica.
            {
              name: 'pwMeasurements',
              includeDependenciesRecursively: false,
              test: /src[\\/](?:doppler[\\/](?:capture|spectralMeasure|measureQuality|qualityMessages)|vexus[\\/]measurements)\.ts$/,
            },
          ],
        },
      },
    },
  },
  test: {
    include: selected ?? (tier === 'slow' ? SLOW : ['src/**/*.test.ts']),
    exclude: tier === 'fast' ? ['node_modules/**', ...SLOW] : ['node_modules/**'],
    environment: 'node',
    testTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Solo se excluye lo que necesita DOM, WebGL o Web Audio (lo cubre la e2e); los módulos
      // puros de ultrasound/ (haz, cadencia del color, sector, transmisión) sí cuentan.
      exclude: [
        'src/**/*.test.ts',
        'src/main.ts',
        'src/bootstrap.ts', // misma raíz de composición trasladada desde main; cubierta por E2E
        'src/ui/**',
        'src/ultrasound/renderer.ts',
        'src/ultrasound/gl.ts',
        'src/ultrasound/shaders/**',
        'src/audio/dopplerAudio.ts',
        'src/app/devtools.ts',
        'src/app/testHooks.ts', // ganchos de la e2e (la ejecuta Playwright)
        'src/app/session.ts', // construye el Simulator sobre un canvas WebGL: lo cubre la e2e
      ],
      reporter: ['text-summary', 'html', 'json-summary'],
      // Umbrales: solo pueden subir (Fase 0). Todas las fuentes siguen incluidas; las matrices IQ
      // se ejecutan aparte sin instrumentación. test:coverage:full conserva la referencia íntegra.
      thresholds: { statements: 88, branches: 83, functions: 84, lines: 89 },
    },
  },
});
