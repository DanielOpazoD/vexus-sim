/** Reproducible nine-window evidence; captures actual UI/framebuffer, never generated illustrations. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { chromium } from '@playwright/test';
import { START_POINTS, startPointsFor, type StartPoint } from '../../src/app/startPoints';
import { acquisitionSnapshot, validateAcquisition } from './acquisitionSnapshot';
import { comparisonState } from './comparisonState';
import { captureBMode } from './captureBMode';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  if (!process.argv[i].startsWith('--') || !process.argv[i + 1] || process.argv[i + 1].startsWith('--'))
    throw new Error('Expected --key value');
  args.set(process.argv[i].slice(2), process.argv[i + 1]);
}
const out = resolve(args.get('out') ?? '/tmp/vexus-fidelity-audit');
const anatomy = args.get('anatomy');
const protocol = args.get('protocol') ?? 'ui';
if (!['atlas', 'legacy'].includes(anatomy ?? '') || !['ui', 'static'].includes(protocol))
  throw new Error('Declare --anatomy atlas|legacy and --protocol ui|static');
if (out === process.cwd() || out.startsWith(process.cwd() + '/')) throw new Error('Evidence must be outside the checkout');
const baseUrl = new URL(args.get('url') ?? 'http://127.0.0.1:6600');
if (!['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname)) throw new Error('Audit requires a local server');
baseUrl.searchParams.set('e2e', 'app');
baseUrl.searchParams.set('abdomen', anatomy!);
const views = (args.get('views')?.split(',') ?? START_POINTS.map((p) => p.id)) as StartPoint['id'][];
if (!views.length || new Set(views).size !== views.length || views.some((v) => !START_POINTS.some((p) => p.id === v)))
  throw new Error('Unknown/repeated window');
const cases = args.get('cases')?.split(',') ?? ['normal-adult', 'severe-congestion'];
const time = Number(args.get('time') ?? 30);
if (!Number.isFinite(time) || time < 1) throw new Error('Comparison time must allow at least one second to prepare');
const hash = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const git = (...argv: string[]) => execFileSync('git', argv, { encoding: 'utf8' }).trim();
const sha = git('rev-parse', 'HEAD');
const files = [
  'src/anatomy/abdominal-atlas.gzip.bin',
  'src/anatomy/abdominal-body.bin',
  'src/anatomy/thoracic-atlas.gzip.bin',
  'src/anatomy/reference-body.bin',
];
const sourceHashes = () => Object.fromEntries(files.filter(existsSync).map((f) => [f, hash(readFileSync(f))]));
const geometry = sourceHashes();
const dirty = git('status', '--porcelain');
const sourceDiffHash = hash(execFileSync('git', ['diff', '--binary', 'HEAD']));
const treeHash = () =>
  hash(
    git('ls-files', '-co', '--exclude-standard')
      .split('\n')
      .sort()
      .filter((f) => /\.(ts|json|bin)$/.test(f) && existsSync(f))
      .map((f) => `${f}:${hash(readFileSync(f))}`)
      .join('\n'),
  );
const sourceTreeHash = treeHash();
mkdirSync(out, { recursive: true });
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const runOut = join(out, runId);
mkdirSync(runOut);
const provenance = {
  sha,
  dirty: !!dirty,
  sourceDiffHash,
  sourceTreeHash,
  geometry,
  protocol,
  historyPolicy: protocol === 'static' ? 'explicit reset via comparisonState' : 'preserved during UI movement',
  anatomy,
  url: baseUrl.toString(),
  browserPath: 'Browser plugin not available; repository Playwright',
};
const rows: unknown[] = [];
const failures: unknown[] = [];
const writeManifest = () =>
  writeFileSync(
    join(runOut, 'manifest.json'),
    JSON.stringify({ schemaVersion: 1, runId, provenance, scope: { views, cases }, rows, failures }, null, 2) + '\n',
  );
const browser = await chromium.launch({
  args: process.platform === 'darwin' ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : ['--enable-gpu', '--ignore-gpu-blocklist'],
});
try {
  for (const caseId of cases)
    for (const view of views) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (e) => {
        if (e.type() === 'error') errors.push(e.text());
      });
      const stem = `${caseId}-${view}`;
      try {
        const response = await page.goto(baseUrl.toString());
        if (response?.status() !== 200) throw new Error('Application HTTP response is not 200');
        await page.waitForFunction(() => (window.__vexusTest?.framesRendered() ?? 0) > 3, undefined, { timeout: 180_000 });
        const build = await page.locator('#build-info').innerText();
        if (!build.includes(sha.slice(0, 7))) throw new Error('Server is running a different revision');
        await page.selectOption('#case-select', caseId);
        await page.getByRole('button', { name: 'Apnea espiratoria', exact: true }).click();
        if (protocol === 'static') {
          // Fresh page, explicit clock/history protocol. These hooks do not prove UI movement.
          await page.evaluate(comparisonState, { phase: 'prepare' as const, targetSeconds: time - 1 });
          await page.evaluate(comparisonState, { phase: 'capture' as const, targetSeconds: time, view, frames: 6 });
        } else {
          const torso = await page.evaluate(() => {
            const t = window.__vexusTest!.sim().scene.torso;
            return { a: t.a, b: t.b, profile: t.profile };
          });
          const target = startPointsFor(torso).find((p) => p.id === view)!;
          await page
            .locator('.win-card')
            .nth(START_POINTS.findIndex((p) => p.id === view))
            .click();
          await page.waitForFunction(
            (p) => {
              const actual = window.__vexusTest!.sim().pose;
              return ['phi', 'z', 'yaw', 'rock', 'tilt'].every(
                (k) => Math.abs(actual[k as keyof typeof actual] - (p[k as keyof typeof p] ?? 0)) < 1e-8,
              );
            },
            { phi: target.phi, z: target.z, yaw: target.yaw, rock: target.rock ?? 0, tilt: target.tilt ?? 0 },
            { timeout: 180_000 },
          );
          const frame = await page.evaluate(() => window.__vexusTest!.framesRendered());
          await page.waitForFunction((f) => window.__vexusTest!.framesRendered() >= f + 12, frame, { timeout: 180_000 });
          await page.locator('#freeze').click();
        }
        const snapshot = await page.evaluate(acquisitionSnapshot, view);
        validateAcquisition(snapshot, { anatomy: anatomy!, caseId, ...(protocol === 'static' ? { time } : {}) });
        if (errors.length) throw new Error(errors.join('\n'));
        const gpu = await page.evaluate(() => {
          const gl = document.querySelector<HTMLCanvasElement>('#gl')!.getContext('webgl2')!;
          const ext = gl.getExtension('WEBGL_debug_renderer_info');
          return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unavailable';
        });
        const bmodePath = join(runOut, `${stem}-bmode.png`),
          uiPath = join(runOut, `${stem}-ui.png`);
        await captureBMode(page, bmodePath);
        await page.screenshot({ path: uiPath });
        const artifacts = Object.fromEntries([bmodePath, uiPath].map((p) => [p, hash(readFileSync(p))]));
        const item = {
          ...snapshot,
          provenance: { ...provenance, gpu, browser: browser.version(), build },
          artifacts,
          integrity: 'verified',
          clinicalAcceptance: 'pending',
        };
        rows.push(item);
        writeFileSync(join(runOut, `${stem}.json`), JSON.stringify(item, null, 2) + '\n');
        console.log(`${caseId}/${view}: captured ${snapshot.presentedFrame} at ${snapshot.acquiredTimeSeconds}s; clinical review pending`);
      } catch (error) {
        await page.screenshot({ path: join(runOut, `${stem}-failed.png`) }).catch(() => undefined);
        failures.push({ caseId, view, error: String(error), browserErrors: errors });
        console.error(`${caseId}/${view}: ${String(error)}`);
      } finally {
        writeManifest();
        await page.close();
      }
    }
  if (JSON.stringify(sourceHashes()) !== JSON.stringify(geometry) || git('rev-parse', 'HEAD') !== sha || treeHash() !== sourceTreeHash)
    throw new Error('Source changed during acquisition');
  if (failures.length) throw new Error(`${failures.length} rejected acquisitions; retained in ${runOut}`);
  console.log(runOut);
} catch (error) {
  failures.push({ runFailure: String(error) });
  throw error;
} finally {
  writeManifest();
  await browser.close();
}
