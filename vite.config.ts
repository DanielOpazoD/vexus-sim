import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Niveles de prueba (práctica de EchoTwin): un archivo cuya PRIMERA línea es
 * `// @tier slow` queda fuera de `npm test` y entra en `test:slow` / `test:all`.
 * Así una prueba pesada no se cuela en la suite rápida por omisión.
 */
// Relativo a este archivo, no al cwd: el servidor puede arrancar desde otro directorio
const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), 'src');
function testFilesWithMarker(marker: string, dir = SRC_DIR): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...testFilesWithMarker(marker, p));
    else if (/\.test\.ts$/.test(f) && readFileSync(p, 'utf8').split('\n')[0].trim() === marker) out.push(p);
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

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(PKG.version),
    __GIT_COMMIT__: JSON.stringify(process.env['GITHUB_SHA']?.slice(0, 7) ?? gitCommit()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: { port: 6600, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: true,
    // three.js en su propio chunk: el presupuesto (tools/ci/bundle-budget.ts) lo mide aparte
    rollupOptions: { output: { manualChunks: { three: ['three', 'three/examples/jsm/objects/MarchingCubes.js'] } } },
  },
  test: {
    include: tier === 'slow' ? SLOW : ['src/**/*.test.ts'],
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
      // Umbrales: solo pueden subir (Fase 0). Medidos con todos los niveles.
      thresholds: { statements: 86, branches: 80, functions: 82, lines: 87 },
    },
  },
});
