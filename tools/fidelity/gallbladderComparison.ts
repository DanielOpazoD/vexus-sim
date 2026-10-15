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
const out = resolve(process.env.GALLBLADDER_OUT ?? join(tmpdir(), 'vexus-gallbladder-evidence'));
mkdirSync(out, { recursive: true });
const base = join(mkdtempSync(join(tmpdir(), 'vexus-gallbladder-base-')), 'repo');
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
  frameMs: number[];
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
      for (const reference of [false, true]) {
        const mode = reference ? 'reference' : 'legacy';
        const pose = reference
          ? { phi: 2.4, z: -80, yaw: 0.3, tilt: 0.2, rock: 0, lift: 0 }
          : { phi: 2.4, z: -100, yaw: -0.3, tilt: 0.4, rock: 0.3, lift: 0 };
        await page.goto(`http://127.0.0.1:${port}/?e2e=1&abdomen=legacy${reference ? '&reference=1' : ''}`);
        await page.waitForFunction(() => (window.__vexusTest?.framesRendered() ?? 0) >= 2, undefined, { timeout: 180_000 });
        if ((await page.evaluate(() => !!window.__vexusTest!.sim().scene.torso.profile)) !== reference)
          throw new Error('El perfil corporal cargado no coincide con el solicitado');
        await page.evaluate((pose) => {
          const t = window.__vexusTest!;
          if (t.circulation().caseId !== 'normal-adult') throw new Error('Caso no normal');
          t.setCompound(true);
          t.setHarmonic(true);
          t.setPose(pose);
        }, pose);
        // Dos vueltas del anillo asientan la composición antes de medir.
        await page.evaluate(() => window.__vexusTest!.frameCostMs(6));
        const frameMs: number[] = [];
        for (let i = 0; i < 2; i++) frameMs.push(await page.evaluate(() => window.__vexusTest!.frameCostMs(3)));
        await page.locator('#freeze').evaluate((button: HTMLButtonElement) => button.click());
        if ((await page.locator('#freeze').getAttribute('aria-pressed')) !== 'true') throw new Error('No se congeló la imagen');
        const path = join(out, `${version}-${mode}.png`);
        // PNG original del framebuffer mostrado, sin HUD; evita el timeout del compositor tras las fuentes.
        await captureBMode(page, path);
        results.push({ version, sha: commit, mode, frameMs });
        writeFileSync(join(out, 'partial.json'), JSON.stringify({ results, harmonic: true, compound: true, depthMm: 180 }, null, 2));
        console.log(JSON.stringify({ version, mode, frameMs }));
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
          'PNG del framebuffer presentado, sin HUD ni retoques. Mismo runner, compuesto y armónica por defecto, dos lotes de tres cuadros tras dos vueltas del anillo. Orden después/antes. Ventanas vesiculares elegidas por geometría, sin retoques de imagen. Gradiente exacto de la misma forma; no validación clínica ni promesa de mejora visual perceptible.',
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
