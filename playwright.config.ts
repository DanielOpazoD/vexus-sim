import { defineConfig, devices } from '@playwright/test';

/**
 * Pruebas de extremo a extremo sobre el build de producción (`vite preview`):
 * arranque, render WebGL2, cambio de caso, modos y captura de una medición.
 * En CI no hay GPU: Chromium usa SwiftShader (WebGL2 por software), más lento
 * pero suficiente para comprobar que la cadena funciona.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // en CI la e2e se reparte en fragmentos (`--shard`, ci.yml): por prueba y no por archivo, que son dos y muy
  // desiguales (la equivalencia, una prueba; el humo, el resto). Con un trabajador por fragmento el orden no
  // importa (cada prueba abre su página). En local, por archivo como siempre.
  fullyParallel: !!process.env.CI,
  // Un trabajador por corredor: SwiftShader reparte cada cuadro entre todos los núcleos, y con dos trabajadores (el
  // valor por omisión en los 4 vCPU del corredor) las dos páginas se los disputaban: los mismos cuadros tardaban el
  // doble y variaban tanto que las pruebas agotaban sus plazos a días alternos. El paralelismo lo dan los fragmentos.
  workers: process.env.CI ? 1 : undefined,
  // Un reintento para diagnosticar (¿falla siempre o a veces?), pero una prueba que solo pasa al reintentarla hace
  // fallar la ejecución: la CI decide la fusión y una prueba inestable no es verde (docs/MISION.md, objetivo 8).
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI,
  // en CI: anotaciones de GitHub + lista con la duración de cada prueba (para ver qué encarece la e2e)
  // y el JSON con las anotaciones de cada prueba (arranque y ritmo del bucle, e2e/support.ts), que ci.yml guarda siempre
  reporter: process.env.CI ? [['github'], ['list'], ['json', { outputFile: 'e2e-results.json' }]] : 'list',
  use: {
    baseURL: 'http://localhost:6609',
    trace: 'retain-on-failure',
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
    viewport: { width: 1280, height: 800 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // node + vite.js en vez de npx: en algunos entornos npx no llega a arrancar el servidor
    command: 'node node_modules/vite/bin/vite.js preview --port 6609 --strictPort',
    url: 'http://localhost:6609',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
