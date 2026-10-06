import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import base from '../../playwright.config';

/** Comprobación local en la GPU Metal del Mac; la configuración CI conserva SwiftShader. */
export default defineConfig({
  ...base,
  testDir: '../../e2e',
  workers: 1,
  use: {
    ...base.use,
    baseURL: 'http://localhost:6618',
    launchOptions: { args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'] },
  },
  webServer: {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    command: 'node node_modules/vite/bin/vite.js preview --host localhost --port 6618 --strictPort',
    url: 'http://localhost:6618',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
