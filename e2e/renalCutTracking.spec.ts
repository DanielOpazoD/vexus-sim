import { expect, test, type Page } from '@playwright/test';
import type { CutMapInit, CutMapRequest, CutMapResponse } from '../src/ui/cutMapWorker';
import { bootWithoutErrors, budget, windowAcquired, withinFrames } from './support';

interface AcquiredCut {
  request: CutMapRequest;
  n: number;
  at: number;
  response?: CutMapResponse;
}
declare global {
  interface Window {
    renalTracking: { requests: AcquiredCut[] };
  }
}

async function observe(page: Page) {
  await page.addInitScript(() => {
    window.renalTracking = { requests: [] };
    const original: unknown = Reflect.get(Worker.prototype, 'postMessage');
    if (typeof original !== 'function') throw new Error('Worker.postMessage unavailable');
    Worker.prototype.postMessage = function (message: unknown, transfer: Transferable[] | StructuredSerializeOptions = []) {
      const request = message as CutMapInit | CutMapRequest;
      if (request.type === 'init' && 'patient' in request)
        this.addEventListener('message', (event: MessageEvent<CutMapResponse>) => {
          if (event.data.type !== 'map') return;
          const q = window.renalTracking.requests.find((q) => q.request.id === event.data.id);
          if (q) q.response = event.data;
        });
      if (request.type === 'map')
        window.renalTracking.requests.push({
          request,
          n: window.__vexusTest!.sim().renderer.displayedFrame!.n,
          at: performance.now(),
        });
      Reflect.apply(original, this, [message, transfer]);
    };
  });
}

async function currentCut(page: Page) {
  await withinFrames(page, 90, 'corte pintado de la adquisición actual', async () =>
    page.evaluate(() => {
      const s = window.__vexusTest!.sim();
      return Number(document.querySelector<HTMLElement>('#cutmap')!.dataset.acquiredFrame) === s.renderer.displayedFrame!.n || 'pendiente';
    }),
  );
}

test('renal and hepatorenal sweeps retain acquisition geometry with two views and stop duplicate frozen work', async ({
  page,
  context,
}, info) => {
  budget(180_000, 2);
  const other = await context.newPage();
  const pages = [page, other];
  const errors: string[][] = [];
  const reports: unknown[] = [];
  try {
    for (const p of pages) {
      await observe(p);
      errors.push(await bootWithoutErrors(p, '?e2e=app&abdomen=atlas'));
    }
    for (const windowId of ['renal', 'hepatorenal'] as const) {
      for (const p of pages) await p.evaluate((id) => window.__vexusTest!.goToStartPoint(id), windowId);
      for (const p of pages) {
        // A fast cut can match an intermediate animation frame. Require the
        // requested physical destination before capturing the angle baseline.
        await windowAcquired(p, windowId);
        await withinFrames(p, 90, 'plano inicial de la ventana antes de medir el barrido', async () =>
          p.evaluate(() => {
            const s = window.__vexusTest!.sim();
            const n = Number(document.querySelector<HTMLElement>('#cutmap')!.dataset.acquiredFrame);
            const cut = window.renalTracking.requests.find((r) => r.n === n && r.response);
            return (!!cut && JSON.stringify(cut.request.frame) === JSON.stringify(s.frame)) || 'pendiente';
          }),
        );
        for (const [name, key] of [
          ['Rotación', 'yaw'],
          ['Inclinación', 'tilt'],
          ['Basculación', 'rock'],
        ] as const) {
          const degrees = await p.evaluate((key) => (window.__vexusTest!.sim().pose[key] * 180) / Math.PI, key);
          await expect
            .poll(async () => Math.abs(Number(await p.getByRole('slider', { name, exact: true }).inputValue()) - degrees))
            .toBeLessThanOrEqual(0.51);
        }
      }
      const sweeps = await Promise.all(
        pages.map(async (p) => {
          const measurements = [];
          for (const name of ['Rotación', 'Inclinación', 'Basculación']) {
            measurements.push(
              await p.getByRole('slider', { name, exact: true }).evaluate(async (element) => {
                const slider = element as HTMLInputElement;
                const base = Number(slider.value);
                const samples = [];
                for (let step = 0; step < 24; step++) {
                  // Same physical +/- 6 degree triangular sweep, through real UI inputs.
                  const offset = step < 6 ? step + 1 : step < 18 ? 11 - step : step - 23;
                  slider.value = String(base + offset);
                  slider.dispatchEvent(new Event('input', { bubbles: true }));
                  for (let f = 0; f < 3; f++) await new Promise(requestAnimationFrame);
                  const s = window.__vexusTest!.sim(),
                    shown = s.renderer.displayedFrame!;
                  const n = Number(document.querySelector<HTMLElement>('#cutmap')!.dataset.acquiredFrame);
                  const cut = window.renalTracking.requests
                    .slice()
                    .reverse()
                    .find((r) => r.n === n && r.response);
                  if (!cut?.response) continue;
                  const point = (frame: CutMapRequest['frame'], theta: number) =>
                    frame.curvatureCenter.map(
                      (x, i) =>
                        x + (s.transducer.curvatureRadius + 90) * (frame.axial[i] * Math.cos(theta) + frame.lateral[i] * Math.sin(theta)),
                    );
                  let mm = 0;
                  for (const theta of [-0.3, 0, 0.3]) {
                    const a = point(shown.anatomy.frame, theta),
                      b = point(cut.request.frame, theta);
                    mm = Math.max(mm, Math.hypot(...a.map((x, i) => x - b[i])));
                  }
                  samples.push({ mm, ageMs: performance.now() - cut.at, lagFrames: shown.n - n });
                }
                return { name: slider.getAttribute('id'), samples };
              }),
            );
          }
          return measurements;
        }),
      );
      for (const p of pages) await p.locator('#freeze').click();
      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        await currentCut(p);
        // Check the actual frozen map against the acquired scene, never a newer live pose.
        const parity = await p.evaluate(() => {
          const s = window.__vexusTest!.sim(),
            shown = s.renderer.displayedFrame!;
          const cut = window.renalTracking.requests
            .slice()
            .reverse()
            .find((r) => r.n === shown.n && r.response)!;
          const req = cut.request,
            map = cut.response!;
          const points: number[] = [],
            expected: number[] = [];
          for (let v = 0; v < map.height; v += 8)
            for (let u = 0; u < map.width; u += 6) {
              const theta = -req.transducer.halfSector + (2 * req.transducer.halfSector * (u + 0.5)) / map.width;
              const r = req.transducer.curvatureRadius + (req.depthMm * (v + 0.5)) / map.height;
              points.push(
                ...req.frame.curvatureCenter.map(
                  (x, i) => x + r * (req.frame.axial[i] * Math.cos(theta) + req.frame.lateral[i] * Math.sin(theta)),
                ),
              );
              expected.push(map.tissue[v * map.width + u]);
            }
          const actual = s.renderer.queryPoints(
            new Float32Array(points),
            {
              ...shown.anatomy,
              caliber: s.anatomy.caliberFor(shown.anatomy.sample),
              probeVelocity: [0, 0, 0],
              bmode: shown.bmode,
              color: s.color,
              updateColor: false,
            },
            true,
          ).tissue;
          const image = s.renderer.readDisplay();
          return {
            mismatches: expected.filter((x, i) => x !== actual[i]).length,
            mismatchDetails: expected.flatMap((value, i) => {
              if (value === actual[i]) return [];
              const point: [number, number, number] = [points[3 * i], points[3 * i + 1], points[3 * i + 2]];
              const cpu = s.anatomy.classifyWorld(point, shown.anatomy.sample);
              return [
                {
                  point,
                  expected: value,
                  gpu: actual[i],
                  cpu: { tissue: cpu.tissue, material: cpu.material, boundaryDistance: cpu.boundaryDistance, interface: cpu.interface },
                },
              ];
            }),
            points: expected.length,
            nonzeroPixels: image.gray.filter((x) => x > 0).length,
            errors: window.__vexusTest!.loggedErrors(),
          };
        });
        reports.push({ windowId, view: i, sweeps: sweeps[i], parity });
        await info.attach(`${windowId}-view-${i}-parity`, { body: JSON.stringify(parity, null, 2), contentType: 'application/json' });
        expect(parity.nonzeroPixels).toBeGreaterThan(1000);
        expect(parity.mismatches).toBe(0);
        expect(parity.errors).toEqual([]);
        for (const sweep of sweeps[i]) expect(sweep.samples).toHaveLength(24);
        await p.screenshot({ path: info.outputPath(`${windowId}-view-${i}.png`) });
      }
      for (const p of pages) await p.locator('#freeze').click();
    }
    for (const p of pages) await p.locator('#freeze').click();
    for (const p of pages) {
      await currentCut(p);
      const before = await p.evaluate(() => ({ count: window.renalTracking.requests.length, f: window.__vexusTest!.framesRendered() }));
      await withinFrames(p, 45, 'vista congelada sin nuevas adquisiciones', async () =>
        p.evaluate((f) => window.__vexusTest!.framesRendered() >= f + 30 || 'pendiente', before.f),
      );
      expect(await p.evaluate(() => window.renalTracking.requests.length)).toBe(before.count);
    }
    for (const e of errors) expect(e).toEqual([]);
  } finally {
    await info.attach('tracking.json', { body: JSON.stringify(reports), contentType: 'application/json' });
    await other.close();
  }
});
