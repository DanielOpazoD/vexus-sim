/**
 * Banco de fidelidad del modo B (decisión 52): mide la textura de la envolvente, la imagen mostrada
 * y los cuadros por segundo en 2 casos × 4 puntos de partida, con GPU real, y escribe la línea base.
 *
 *   npm run fidelity                       # contra el servidor de desarrollo (puerto 6600)
 *   npm run fidelity -- --url http://localhost:6609 --out /tmp/fidelity.json
 *   npm run fidelity -- --sweep            # + banco de interfaces con 4 poses más por vista
 *
 * Con `--sweep`, cada vista se mide también con la sonda basculada (±6°) e inclinada (±6°) y los
 * registros de las cinco poses se agregan con `summarizeFaces` (`sweep` en el JSON). Eso llena la VCI
 * y la cápsula a 0–20° (salvo la VCI subxifoidea con congestión y la cápsula en la ventana renal), pero
 * no las suprahepáticas a 0–20° (0–9 registros por escena) ni el diafragma a 0–20° (0 en todas), y la
 * porta a 0–20° no da rosario. Cada escena escribe en `escasos` los tramos vigilados por el PR 5b que no
 * llegan a 10 registros o no tienen rosario (`thinGatedBins`): esas puertas no se pueden evaluar
 * (docs/fidelity/README.md, «Qué llena el barrido»).
 *
 * No corre en CI (necesita GPU: con SwiftShader los cps no significan nada). Las métricas y sus
 * referencias se explican en docs/fidelity/README.md.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from '@playwright/test';
import { summarizeFaces, thinGatedBins, type FaceSummary, type FidelityStats, type WallBin } from '../../src/app/fidelity';

// --clave valor, o --bandera sola
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i].replace(/^--/, '');
  const next = process.argv[i + 1];
  if (next === undefined || next.startsWith('--')) args.set(key, 'true');
  else args.set(key, process.argv[++i]);
}
const URL = args.get('url') ?? 'http://localhost:6600';
const OUT = args.get('out') ?? 'docs/fidelity/baseline.json';
const SWEEP = args.get('sweep') === 'true';
/** Poses del barrido de interfaces sobre cada vista (`--sweep`). */
const SWEEP_POSES = [{ rockDeg: 6 }, { rockDeg: -6 }, { tiltDeg: 6 }, { tiltDeg: -6 }];
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
const results: Record<
  string,
  {
    fps: number | null;
    msPerFrame: number;
    stats: Omit<FidelityStats, 'faceSamples'>;
    sweep?: FaceSummary;
    /** Tramos vigilados por el PR 5b sin 10 registros o sin rosario (del barrido, o de la pose de partida). */
    escasos: string[];
    errors: string[];
  }
> = {};
/** «0–20° 1,26 (12) huecos 0,10 rosario 0,20» de cada tramo de incidencia con paredes. */
const binText = (bins: WallBin[]): string =>
  bins
    .filter((b) => b.walls > 0)
    .map(
      (b) =>
        `${b.fromDeg}–${b.toDeg}° ${b.ratio.toFixed(2)} (${b.walls}) huecos ${b.gapFraction.toFixed(2)} rosario ${b.beading.toFixed(2)}`,
    )
    .join(', ') || '—';
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
      const { faceSamples, ...stats } = await page.evaluate((samples) => window.__vexusTest!.fidelity({ display: true, samples }), SWEEP);
      const msPerFrame = await page.evaluate(() => window.__vexusTest!.frameCostMs(20));
      let sweep: FaceSummary | undefined;
      if (SWEEP) {
        const poses = [faceSamples ?? []];
        for (const pose of SWEEP_POSES) {
          const s = await page.evaluate(
            ([id, p]) => window.__vexusTest!.fidelity({ startPoint: id, display: true, pose: p, samples: true }),
            [view, pose] as const,
          );
          poses.push(s.faceSamples ?? []);
        }
        sweep = summarizeFaces(poses);
      }
      const faces = sweep ?? stats.display;
      const escasos = faces ? thinGatedBins(faces) : [];
      results[`${cs}/${view}`] = {
        fps: Number.isFinite(fps) ? fps : null,
        msPerFrame,
        stats,
        ...(sweep ? { sweep } : {}),
        escasos,
        errors,
      };
      await page.close();
      const e = stats.envelope;
      const d = stats.display;
      console.log(
        `${cs}/${view}`.padEnd(32),
        `cps ${fps} · ${msPerFrame.toFixed(1)} ms`.padEnd(18),
        `SNR ${e.snr.toFixed(2)} · grano ${e.fwhmAxialMm.toFixed(2)}×${e.fwhmLateralMm.toFixed(2)} mm · oscuros ${e.darkFraction.toFixed(3)} · grietas ${e.crackIndex.toFixed(3)}`,
        d
          ? `· hígado ${d.liver.p50} (${d.liver.sd.toFixed(1)}) · sombra ${Number.isFinite(d.shadow.coreDbBelowLiver) ? d.shadow.coreDbBelowLiver.toFixed(0) : '—'} dB [${d.shadow.edgeProfileDb.map((x) => (Number.isFinite(x) ? x.toFixed(0) : '·')).join(' ')}] · luz ${d.lumen.p50} · diafragma ${Number.isFinite(d.diaphragmSaturated) ? (100 * d.diaphragmSaturated).toFixed(1) : '—'} % · ${d.profile.slopeDbPerCm.toFixed(2)} dB/cm · pared ${d.walls
              .map((b) => `${b.fromDeg}–${b.toDeg}° ${Number.isFinite(b.ratio) ? b.ratio.toFixed(2) : '—'} (${b.walls})`)
              .join(', ')}`
          : '',
      );
      if (d && faces) {
        console.log(
          ''.padEnd(32),
          `${sweep ? 'barrido' : 'interfaces'}: VCI ${binText(faces.wallSystems.ivc)} · VSH ${binText(faces.wallSystems.hepaticVein)} · porta ${binText(faces.wallSystems.portal)}`,
          `· cápsula ${binText(faces.capsule)} · diafragma ${binText(faces.diaphragm)} · Morison ${binText(faces.renalCapsule)}`,
          `· saturado junto a la cara ${JSON.stringify(d.faceSaturated)}`,
        );
        if (escasos.length) console.log(''.padEnd(32), `tramos vigilados sin evaluar: ${escasos.join(' · ')}`);
      }
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
