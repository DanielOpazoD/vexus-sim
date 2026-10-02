/** Capturas originales de las ventanas predeterminadas solicitadas por el usuario. Solo QA. */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import { captureBMode } from './captureBMode';
const out = resolve(process.env.PRESET_OUT ?? '/tmp/vexus-presets');
mkdirSync(out, { recursive: true });
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '6613', '--strictPort'],
  { stdio: 'inherit' },
);
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      ready = (await fetch('http://127.0.0.1:6613')).ok;
    } catch {
      // El servidor aún está arrancando; se vuelve a comprobar dentro del plazo acotado.
    }
    if (ready) break;
    await delay(200);
  }
  if (!ready) throw Error('Servidor no disponible');
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:6613/?e2e=app');
  await page.waitForFunction(() => (window.__vexusTest?.framesRendered() ?? 0) >= 2, undefined, { timeout: 180000 });
  const records = [];
  for (const [id, label, file] of [
    ['portal', 'Porta · lateral', '01-porta-lateral.png'],
    ['intercostal', 'Intercostal dcho · venas suprahepáticas', '02-suprahepaticas-intercostal.png'],
    ['subcostal', 'Subcostal · VSH', '03-suprahepaticas-subcostal.png'],
  ] as const) {
    const settings = await page.evaluate((id) => {
      const t = window.__vexusTest!,
        sim = t.sim();
      if (sim.frozen) throw Error('La siguiente captura requiere descongelar');
      t.goToStartPoint(id);
      t.frameCostMs(6);
      return {
        pose: sim.pose,
        bmode: sim.bmode,
        caseId: t.circulation().caseId,
        respiration: sim.patient.respiratoryPattern,
        reference: !!sim.scene.torso.profile,
      };
    }, id);
    await page.locator('#freeze').evaluate((b: HTMLButtonElement) => b.click());
    await captureBMode(page, resolve(out, file));
    records.push({ id, label, file, settings });
    writeFileSync(
      resolve(out, 'presets.json'),
      JSON.stringify(
        {
          sha: process.env.GITHUB_SHA,
          records,
          method: 'Framebuffer presentado sin HUD, sin retoques; poses y ajustes predeterminados del usuario',
        },
        null,
        2,
      ),
    );
    await page.locator('#freeze').evaluate((b: HTMLButtonElement) => b.click());
  }
  if (errors.length) throw Error(errors.join('\n'));
} finally {
  await browser.close();
  server.kill('SIGTERM');
}
