// Run with Node 24 type stripping: tsx keepNames helpers cannot cross page.evaluate.
// Diagnostic only: readback serializes GPU work and is not an E2E or frame-rate benchmark.
import { chromium, devices, type BrowserServer } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { writeFileSync, appendFileSync } from 'node:fs';
const [url, prefix, scenario = 'portal'] = process.argv.slice(2);
if (!['portal', 'severe-contact'].includes(scenario)) throw Error('Unknown scenario');
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw Error('Local URL required');
mkdirSync(dirname(prefix), { recursive: true });
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const sourceDirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== '';
type DrawCost = { program: string; ms?: number; frame: number; diagnosticError?: string };
const report: {
  url: string;
  scenario: string;
  sourceSha: string;
  sourceDirty: boolean;
  startedUtc: string;
  ownedPid: number | undefined;
  instrumentedNotBenchmark: boolean;
  perDrawReadback: boolean;
  events: DrawCost[];
  errors: string[];
  startup: string[];
  initial?: { frame: number; depth: number; pw: boolean; programs: string[]; renderer: string };
  result?: unknown;
  status?: string;
  error?: string;
  endedUtc?: string;
} = {
  url,
  scenario,
  sourceSha,
  sourceDirty,
  startup: [],
  startedUtc: new Date().toISOString(),
  ownedPid: undefined,
  instrumentedNotBenchmark: true,
  perDrawReadback: true,
  events: [],
  errors: [],
};
let watchdog: ReturnType<typeof setTimeout> | undefined;
let server: BrowserServer | undefined;
try {
  server = await chromium.launchServer({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const browser = await chromium.connect(server.wsEndpoint());
  report.ownedPid = server.process().pid;
  const context = await browser.newContext(devices['Desktop Chrome']);
  const page = await context.newPage();
  // Match Playwright Test actionTimeout=0; keep the explicit boot/frame budgets and host watchdog.
  page.setDefaultTimeout(0);
  page.on('pageerror', (e) => report.errors.push(String(e)));
  page.on('console', (m) => {
    if (m.text().startsWith('[vexus:startup] ')) report.startup.push(m.text());
    if (!m.text().startsWith('[drawcost] ')) return;
    const e = JSON.parse(m.text().slice(11)) as DrawCost;
    report.events.push(e);
    appendFileSync(prefix + '.jsonl', JSON.stringify(e) + '\n');
  });
  const task = (async () => {
    await page.goto(url);
    await page.waitForFunction(() => (window.__vexusTest?.framesRendered() ?? 0) >= 3, undefined, { timeout: 180000 });
    if (scenario === 'severe-contact') {
      await page.selectOption('#case-select', 'severe-congestion');
      await page.locator('.win-card').nth(3).click();
    } else {
      await page.locator('.win-card').nth(5).click();
      await page.locator('.win-card').nth(6).click();
    }
    report.initial = await page.evaluate(() => {
      const h = window.__vexusTest!,
        s = h.sim(),
        r = s.renderer,
        gl = r.gl;
      const programs = new Map<WebGLProgram, string>();
      const collect = (value: unknown, depth = 0): void => {
        if (!value || typeof value !== 'object' || depth > 3) return;
        if ('program' in value && value.program instanceof WebGLProgram && 'name' in value && typeof value.name === 'string')
          programs.set(value.program, value.name);
        else for (const item of Object.values(value)) collect(item, depth + 1);
      };
      for (const key of [
        'pTransHits',
        'atlasHitStages',
        'pTransSeg',
        'pTransPre',
        'pTrans',
        'rawStages',
        'pRaw',
        'pAxial',
        'pLateral',
        'pCompound',
        'pColor',
        'pColorFilter',
        'pScan',
        'pPersist',
        'pBlit',
        'pMap',
        'pMLine',
        'pMStrip',
      ])
        collect((r as unknown as Record<string, unknown>)[key]);
      if (programs.size < 20) throw Error('Production programs not identified');
      const originalUse = gl.useProgram.bind(gl),
        originalDraw = gl.drawArrays.bind(gl);
      let current = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
      gl.useProgram = function (program) {
        current = program;
        return originalUse(program);
      };
      const readback = () => {
        const framebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
        const previous = gl.getParameter(gl.READ_BUFFER) as number;
        gl.readBuffer(framebuffer ? gl.COLOR_ATTACHMENT0 : gl.BACK);
        const format = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT) as number;
        const type = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE) as number;
        const Pixel =
          type === gl.FLOAT
            ? Float32Array
            : type === gl.UNSIGNED_BYTE
              ? Uint8Array
              : type === gl.HALF_FLOAT || type === gl.UNSIGNED_SHORT
                ? Uint16Array
                : Uint32Array;
        gl.readPixels(0, 0, 1, 1, format, type, new Pixel(4));
        gl.readBuffer(previous);
        const error = gl.getError();
        if (error) throw Error('Diagnostic readback GL error ' + error + ', format=' + format + ', type=' + type);
      };
      readback();
      gl.drawArrays = function (...args) {
        const start = performance.now();
        originalDraw(...args);
        try {
          readback();
          console.debug(
            '[drawcost] ' +
              JSON.stringify({
                program: (current ? programs.get(current) : undefined) ?? 'unknown',
                ms: performance.now() - start,
                frame: h.framesRendered(),
              }),
          );
        } catch (error) {
          gl.drawArrays = originalDraw;
          gl.useProgram = originalUse;
          console.debug(
            '[drawcost] ' +
              JSON.stringify({
                diagnosticError: String(error),
                program: (current ? programs.get(current) : undefined) ?? 'unknown',
                frame: h.framesRendered(),
              }),
          );
        }
      };
      const originalAdvance = s.advance.bind(s);
      s.advance = (dt) => {
        const start = performance.now();
        originalAdvance(dt);
        console.debug('[drawcost] ' + JSON.stringify({ program: 'cpu.advance', ms: performance.now() - start, frame: h.framesRendered() }));
      };
      const originalRender = s.render.bind(s);
      s.render = (options) => {
        const start = performance.now();
        originalRender(options);
        console.debug(
          '[drawcost] ' +
            JSON.stringify({ program: 'total.render.instrumented', ms: performance.now() - start, frame: h.framesRendered() }),
        );
      };
      const rendererInfo = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        frame: h.framesRendered(),
        depth: s.bmode.depthMm,
        pw: s.pw.enabled,
        programs: [...programs.values()],
        renderer: String(gl.getParameter(rendererInfo ? rendererInfo.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
      };
    });
    await page.waitForFunction((f) => window.__vexusTest!.framesRendered() > f + 12, report.initial.frame, { timeout: 120000 });
    return await page.evaluate(() => ({
      frame: window.__vexusTest!.framesRendered(),
      glError: window.__vexusTest!.sim().renderer.gl.getError(),
    }));
  })();
  report.result = await Promise.race([
    task,
    new Promise((_, reject) => (watchdog = setTimeout(() => reject(Error('Host watchdog360s')), 360000))),
  ]);
  report.status =
    report.events.some((e) => e.diagnosticError) || report.errors.length || !report.events.length ? 'instrument-error' : 'completed';
} catch (e) {
  report.status = 'failed';
  report.error = String(e);
} finally {
  clearTimeout(watchdog);
  report.endedUtc = new Date().toISOString();
  writeFileSync(prefix + '.json', JSON.stringify(report, null, 2));
  await server?.kill();
}
console.log(JSON.stringify({ status: report.status, error: report.error, events: report.events.length }));

if (report.status !== 'completed') process.exitCode = 1;
