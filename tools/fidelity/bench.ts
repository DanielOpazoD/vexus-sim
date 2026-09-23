/**
 * Banco de fidelidad del modo B (decisión 52): mide la textura de la envolvente, la imagen mostrada
 * y los cuadros por segundo en 2 casos × 4 puntos de partida, con GPU real, y escribe la línea base.
 *
 *   npm run fidelity                       # contra el servidor de desarrollo (puerto 6600)
 *   npm run fidelity -- --url http://localhost:6609 --out /tmp/fidelity.json
 *
 * No corre en CI (necesita GPU: con SwiftShader los cps no significan nada). Las métricas y sus
 * referencias se explican en docs/fidelity/README.md.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from '@playwright/test';
import type { FidelityStats } from '../../src/app/fidelity';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1] ?? '');
const URL = args.get('url') ?? 'http://localhost:6600';
const OUT = args.get('out') ?? 'docs/fidelity/baseline.json';
const CASES = ['normal-adult', 'severe-congestion'] as const;
const VIEWS = ['subxiphoid', 'intercostal', 'flank', 'renal'] as const;
/** Segundos de cuadros en tiempo real tras colocar la sonda (persistencia y lectura de cps). */
const SETTLE_S = 3;

const round = (x: number, d = 3): number | null => (Number.isFinite(x) ? Number(x.toFixed(d)) : null);
const roundDeep = (v: unknown): unknown => {
  if (typeof v === 'number') return round(v);
  if (Array.isArray(v)) return v.map(roundDeep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, roundDeep(x)]));
  return v;
};

const gpuArgs =
  process.platform === 'darwin'
    ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
    : ['--enable-gpu', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ headless: true, args: gpuArgs });
const results: Record<string, { fps: number | null; stats: FidelityStats; errors: string[] }> = {};
let gpu = 'desconocida';
try {
  for (const cs of CASES) {
    for (const view of VIEWS) {
      // densidad 2, como un Mac Retina: el lienzo y la conversión de barrido pagan 4× los píxeles
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${URL}/?e2e=1&docente=1`);
      await page.waitForFunction(
        () => /\d+ fps/.test(document.querySelector('#status')?.textContent ?? '') && typeof window.__vexusTest === 'object',
        null,
        {
          timeout: 60_000,
        },
      );
      gpu = await page.evaluate((): string => {
        const gl = document.createElement('canvas').getContext('webgl2');
        const ext = gl?.getExtension('WEBGL_debug_renderer_info');
        return ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'desconocida';
      });
      await page.selectOption('#case-select', cs);
      await page.waitForTimeout(1500);
      await page
        .locator('button', { hasText: /Apnea\s*esp/ })
        .first()
        .click();
      await page.evaluate((id) => window.__vexusTest!.goToStartPoint(id), view);
      await page.waitForTimeout(SETTLE_S * 1000);
      const fps = await page.evaluate(() =>
        Number(/(\d+) fps/.exec(document.querySelector('#status')?.textContent ?? '')?.[1] ?? Number.NaN),
      );
      const stats = await page.evaluate(() => window.__vexusTest!.fidelity({ display: true }));
      results[`${cs}/${view}`] = { fps: Number.isFinite(fps) ? fps : null, stats, errors };
      await page.close();
      const e = stats.envelope;
      const d = stats.display;
      console.log(
        `${cs}/${view}`.padEnd(32),
        `cps ${fps}`.padEnd(8),
        `SNR ${e.snr.toFixed(2)} · grano ${e.fwhmAxialMm.toFixed(2)}×${e.fwhmLateralMm.toFixed(2)} mm · oscuros ${e.darkFraction.toFixed(3)} · grietas ${e.crackIndex.toFixed(3)}`,
        d
          ? `· hígado ${d.liver.p50} (${d.liver.sd.toFixed(1)}) · ${d.profile.slopeDbPerCm.toFixed(2)} dB/cm · pared ${d.walls
              .map((b) => `${b.fromDeg}–${b.toDeg}° ${Number.isFinite(b.ratio) ? b.ratio.toFixed(2) : '—'} (${b.walls})`)
              .join(', ')}`
          : '',
      );
    }
  }
} finally {
  await browser.close();
}

const git = (...a: string[]): string | null => {
  try {
    return execFileSync('git', a).toString().trim();
  } catch {
    return null;
  }
};
// El árbol de src/ identifica el código medido y sobrevive al squash-merge (el hash del commit de la
// rama, no); `srcSinCommit` avisa de cambios locales en src/ al medir.
const provenance = {
  commit: git('rev-parse', '--short', 'HEAD') ?? 'desconocido',
  arbolSrc: git('rev-parse', 'HEAD:src') ?? 'desconocido',
  srcSinCommit: (git('status', '--porcelain', '--', 'src') ?? '') !== '',
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  `${JSON.stringify({ ...provenance, fecha: new Date().toISOString().slice(0, 10), gpu, url: URL, escenas: roundDeep(results) }, null, 1)}\n`,
);
console.log(`línea base → ${OUT}`);
