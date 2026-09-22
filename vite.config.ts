import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Niveles de prueba (práctica de EchoTwin): un archivo cuya PRIMERA línea es
 * `// @tier slow` queda fuera de `npm test` y entra en `test:slow` / `test:all`.
 * Así una prueba pesada no se cuela en la suite rápida por omisión.
 */
function testFilesWithMarker(marker: string, dir = 'src'): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...testFilesWithMarker(marker, p));
    else if (/\.test\.ts$/.test(f) && readFileSync(p, 'utf8').split('\n')[0].trim() === marker) out.push(p);
  }
  return out;
}
const SLOW = testFilesWithMarker('// @tier slow');
const tier = process.env['VITEST_TIER'] ?? 'fast';

export default defineConfig({
  server: { port: 6600, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: true,
    // three.js en su propio chunk: el presupuesto (tools/ci/bundle-budget.mjs) lo mide aparte
    rollupOptions: { output: { manualChunks: { three: ['three', 'three/examples/jsm/objects/MarchingCubes.js'] } } },
  },
  test: {
    include: tier === 'slow' ? SLOW : ['src/**/*.test.ts'],
    exclude: tier === 'fast' ? ['node_modules/**', ...SLOW] : ['node_modules/**'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
