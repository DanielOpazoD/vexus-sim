/** Capturas y coste antes/después en el mismo runner. Solo QA; no es una calibración clínica. */
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
const references = selectedProfile === 'both' ? [false, true] : [selectedProfile === 'reference'];
const out = resolve(process.env.SPINE_OUT ?? join(tmpdir(), 'vexus-spine-evidence'));
mkdirSync(out, { recursive: true });
const base = join(mkdtempSync(join(tmpdir(), 'vexus-spine-base-')), 'repo');
execFileSync('git', ['fetch', '--no-tags', 'origin', sha], { cwd: root, stdio: 'inherit' });
execFileSync('git', ['worktree', 'add', '--detach', base, sha], { cwd: root, stdio: 'inherit' });
// El minificador verifica rutas reales: compartir node_modules con un symlink invalida su mapa.
execFileSync('npm', ['ci', '--prefer-offline'], { cwd: base, stdio: 'inherit' });
const viteOf = (cwd: string) => join(cwd, 'node_modules/vite/bin/vite.js');
execFileSync(process.execPath, [viteOf(base), 'build'], { cwd: base, env: { ...process.env, GITHUB_SHA: sha }, stdio: 'inherit' });
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const results: Array<{ version: string; sha: string; mode: string; frameMs: number[] }> = [];
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
        await page.goto(`http://127.0.0.1:${port}/?e2e=1&abdomen=legacy${reference ? '&reference=1' : ''}`);
        await page.waitForFunction(() => (window.__vexusTest?.framesRendered() ?? 0) >= 2, undefined, { timeout: 180_000 });
        if ((await page.evaluate(() => !!window.__vexusTest!.sim().scene.torso.profile)) !== reference)
          throw new Error('El perfil corporal cargado no coincide con el solicitado');
        for (const [mode, yaw, lift] of [
          ['transverse', Math.PI / 2, 0],
          ['longitudinal', 0, 0],
          ['transverse-pressed', Math.PI / 2, -6],
        ] as const) {
          await page.evaluate(
            ({ yaw, lift }) => {
              const t = window.__vexusTest!;
              t.setCompound(false);
              t.setPose({ phi: Math.PI / 2, z: -20, lift, yaw, rock: 0, tilt: 0 });
            },
            { yaw, lift },
          );
          const frameMs: number[] = [];
          for (let i = 0; i < 3; i++) frameMs.push(await page.evaluate(() => window.__vexusTest!.frameCostMs(3)));
          // Congelar mediante el control real tras medir; evita esperar estabilidad de un canvas que sigue dibujando.
          await page.locator('#freeze').evaluate((button: HTMLButtonElement) => button.click());
          if ((await page.locator('#freeze').getAttribute('aria-pressed')) !== 'true') throw new Error('No se congeló la imagen');
          // Framebuffer realmente congelado, igual que los otros comparadores: el compositor
          // de Chromium puede agotar 30 s aun con las fuentes listas y el render completado.
          await captureBMode(page, join(out, `${version}-${profile}-${mode}.png`));
          await page.locator('#freeze').evaluate((button: HTMLButtonElement) => button.click());
          results.push({ version, sha: commit, mode: `${profile}-${mode}`, frameMs });
          writeFileSync(join(out, 'partial.json'), JSON.stringify({ results }, null, 2));
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
        notes:
          'Mismo runner, tres lotes de tres cuadros por plano. Orden después/antes; variabilidad temporal sin intervalo de confianza. No prueba rendimiento Metal ni fidelidad clínica.',
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
