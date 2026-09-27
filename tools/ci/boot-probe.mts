// Arranque repetido en el mismo navegador (contextos nuevos, como Playwright entre pruebas) con y sin caché grande de programas
import { chromium } from '@playwright/test';
import { preview } from 'vite';
const root = process.argv[2];
// SONDA TEMPORAL (se retira antes de fusionar): arranque repetido con y sin caché de programas grande
const extra = (process.argv[3] ?? '').split(' ').filter(Boolean);
const rounds = Number(process.argv[4] ?? 3);
const server = await preview({ root, logLevel: 'error', preview: { port: 6810, strictPort: true, host: '127.0.0.1' } });
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', ...extra],
});
try {
  for (let r = 0; r < rounds; r++) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const t0 = Date.now();
    await page.goto(`http://127.0.0.1:6810/?e2e=1`);
    await page.waitForFunction(() => /\d+ fps/.test(document.querySelector('#status')?.textContent ?? ''), null, { timeout: 300_000 });
    const tFps = (Date.now() - t0) / 1000;
    await page.waitForFunction(() => typeof window.__vexusTest === 'object', null, { timeout: 300_000 });
    const tHooks = (Date.now() - t0) / 1000;
    console.log(`ronda ${r}: fps ${tFps.toFixed(1)} s · ganchos ${tHooks.toFixed(1)} s`);
    await ctx.close();
  }
} finally {
  await browser.close();
  await new Promise<void>((r) => server.httpServer.close(() => r()));
}
