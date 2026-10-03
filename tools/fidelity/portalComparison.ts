/** Ventanas predeterminadas antes/después en el mismo runner. Solo QA; no es una calibración clínica. */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import { captureBMode } from './captureBMode';

const root = process.cwd(),
  sha = process.env.BASE_SHA;
if (!sha || !/^[a-f0-9]{40}$/.test(sha)) throw new Error('BASE_SHA debe ser un commit exacto de 40 caracteres');
const selectedProfile = process.env.COMPARISON_PROFILE ?? 'both';
if (!['both', 'legacy', 'reference'].includes(selectedProfile)) throw new Error('COMPARISON_PROFILE debe ser both, legacy o reference');
const inspiration = process.env.COMPARISON_RESPIRATION === 'inspiration';
if (process.env.COMPARISON_RESPIRATION && !inspiration) throw new Error('Unsupported comparison respiration');
const references = selectedProfile === 'both' ? [false, true] : [selectedProfile === 'reference'];
const out = resolve(process.env.PORTAL_OUT ?? join(tmpdir(), 'vexus-portal-evidence'));
mkdirSync(out, { recursive: true });
const base = join(mkdtempSync(join(tmpdir(), 'vexus-portal-base-')), 'repo');
execFileSync('git', ['fetch', '--no-tags', 'origin', sha], { cwd: root, stdio: 'inherit' });
execFileSync('git', ['worktree', 'add', '--detach', base, sha], { cwd: root, stdio: 'inherit' });
// El minificador verifica rutas reales: compartir node_modules con un symlink invalida su mapa.
execFileSync('npm', ['ci', '--prefer-offline'], { cwd: base, stdio: 'inherit' });
const viteOf = (cwd: string) => join(cwd, 'node_modules/vite/bin/vite.js');
execFileSync(process.execPath, [viteOf(base), 'build'], { cwd: base, env: { ...process.env, GITHUB_SHA: sha }, stdio: 'inherit' });
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const results: Array<{
  version: string;
  sha: string;
  mode: string;
  settings: unknown;
}> = [];
try {
  for (const [version, cwd, port, commit] of [
    ['after', root, 6612, process.env.HEAD_SHA ?? 'working-tree'],
    ['before', base, 6611, sha],
  ] as const) {
    const server = spawn(process.execPath, [viteOf(cwd), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
      cwd,
      stdio: 'inherit',
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    try {
      let ready = false;
      for (let i = 0; i < 100; i++) {
        try {
          ready = (await fetch(`http://127.0.0.1:${port}`)).ok;
        } catch (e) {
          if (i === 99) throw e;
        }
        if (ready) break;
        await delay(200);
      }
      if (!ready) throw new Error('Servidor de comparación no responde');
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => {
        errors.push(e.message);
        console.error(version, e.message);
      });
      page.on('console', (m) => {
        if (m.type() === 'error') {
          errors.push(m.text());
          console.error(version, m.text());
        }
      });
      for (const reference of references) {
        const profile = reference ? 'reference' : 'legacy';
        for (const id of inspiration
          ? (['portal', 'subcostal'] as const)
          : (['portal', 'intercostal', 'subcostal', 'subxiphoid'] as const)) {
          await page.goto(`http://127.0.0.1:${port}/?e2e=app${reference ? '&reference=1' : ''}`);
          await page.waitForFunction(() => (window.__vexusTest?.framesRendered() ?? 0) >= 2, undefined, { timeout: 180_000 });
          if ((await page.evaluate(() => !!window.__vexusTest!.sim().scene.torso.profile)) !== reference)
            throw new Error('El perfil corporal cargado no coincide con el solicitado');
          if (inspiration) {
            await page.getByRole('button', { name: 'Apnea inspiratoria', exact: true }).click();
            await page.waitForFunction(() => Math.abs(window.__vexusTest!.sim().sample.resp.diaphragmCaudalMm - 30) < 1e-6, undefined, {
              timeout: 180_000,
            });
          }
          const settings = await page.evaluate((id) => {
            const t = window.__vexusTest!;
            if (t.circulation().caseId !== 'normal-adult') throw new Error('Caso no normal');
            t.goToStartPoint(id);
            const frameMs = t.frameCostMs(6);
            const sim = t.sim();
            return {
              frameMs,
              pose: sim.pose,
              bmode: sim.bmode,
              respiration: sim.patient.respiratoryPattern,
              displacementMm: sim.sample.resp.diaphragmCaudalMm,
              reference: !!sim.scene.torso.profile,
            };
          }, id);
          if (Math.abs(settings.displacementMm - (inspiration ? 30 : 0)) > 1e-6) throw new Error('Unexpected respiratory displacement');
          await page.locator('#freeze').evaluate((button: HTMLButtonElement) => button.click());
          await captureBMode(page, join(out, `${version}-${profile}-${id}.png`));
          results.push({ version, sha: commit, mode: `${profile}-${id}`, settings });
          writeFileSync(join(out, 'partial.json'), JSON.stringify({ results }, null, 2));
          console.log(JSON.stringify({ version, id, settings }));
        }
      }
      if (errors.length) throw new Error(errors.join('\n'));
    } finally {
      await context.close();
      server.kill('SIGTERM');
    }
  }
  writeFileSync(
    join(out, 'comparison.json'),
    JSON.stringify(
      {
        results,
        inspiration,
        notes:
          'PNG original del framebuffer, sin HUD ni retoques. Mismo runner, ventanas y ajustes predeterminados; seis cuadros de asentamiento. Orden después/antes. Comparación de ingeniería, no validación clínica.',
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
  execFileSync('git', ['worktree', 'remove', '--force', base], { cwd: root, stdio: 'inherit' });
}
