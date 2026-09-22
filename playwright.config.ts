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
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  // en CI: anotaciones de GitHub + lista con la duración de cada prueba (para ver qué encarece la e2e)
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
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
