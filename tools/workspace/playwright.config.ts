import { defineConfig } from '@playwright/test';
import { resolve, join } from 'node:path';
import base from '../../playwright.config';

const root = resolve(import.meta.dirname, '../..');
const out = process.env.VEXUS_RUN_DIR;
const backend = process.env.VEXUS_GPU;
if (!out || !['metal', 'swiftshader'].includes(backend ?? '') || process.env.CI !== 'true')
  throw new Error('Usa npm run workspace:e2e -- --help; este perfil requiere el runner y sus metadatos');
export default defineConfig({
  ...base,
  testDir: join(root, 'e2e'),
  workers: 1,
  retries: 0,
  failOnFlakyTests: true,
  outputDir: join(out, 'test-results'),
  reporter: [['list'], ['json', { outputFile: join(out, 'report.json') }]],
  use: {
    ...base.use,
    baseURL: process.env.VEXUS_PREVIEW_URL,
    launchOptions:
      backend === 'metal' ? { args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'] } : base.use?.launchOptions,
  },
  webServer:
    process.env.VEXUS_EXTERNAL_PREVIEW === 'true'
      ? undefined
      : {
          ...base.webServer,
          cwd: root,
          command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 6609 --strictPort',
          url: 'http://127.0.0.1:6609',
          reuseExistingServer: false,
        },
});
