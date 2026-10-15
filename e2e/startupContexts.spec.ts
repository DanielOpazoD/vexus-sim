import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget, expectLoggedErrors, withinFrames } from './support';

declare global {
  interface Window {
    startupContexts: {
      contexts: Array<{ canvas: HTMLCanvasElement; readyAt: number }>;
      firstUltrasoundDraw: number | null;
      firstNavigatorDraw: number | null;
      navigatorDraws: number;
      overlappingFrames: number;
      lateFramebufferChecks: number;
      overlayPaints: number;
      frozenOverlay?: Uint8ClampedArray;
      ultrasoundDraws: number;
      reservationReady: boolean;
      releaseReservation?: () => void;
    };
  }
}

test('initializes both real WebGL contexts before acquisition and retains the 3D view on case change', async ({ page }, info) => {
  budget(90_000);
  await page.addInitScript(() => {
    const observed: Window['startupContexts'] = (window.startupContexts = {
      contexts: [],
      firstUltrasoundDraw: null,
      firstNavigatorDraw: null,
      navigatorDraws: 0,
      overlappingFrames: 0,
      lateFramebufferChecks: 0,
      overlayPaints: 0,
      ultrasoundDraws: 0,
      reservationReady: false,
    });
    const clearRect: unknown = Reflect.get(CanvasRenderingContext2D.prototype, 'clearRect');
    if (typeof clearRect !== 'function') throw new Error('Canvas.clearRect unavailable');
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (this.canvas.id === 'overlay') observed.overlayPaints++;
      Reflect.apply(clearRect, this, args);
    };
    const pending = new Set<WebGLSync>();
    let lastFrame = -2;
    const checkFramebufferStatus: unknown = Reflect.get(WebGL2RenderingContext.prototype, 'checkFramebufferStatus');
    if (typeof checkFramebufferStatus !== 'function') throw new Error('WebGL.checkFramebufferStatus unavailable');
    Reflect.set(WebGL2RenderingContext.prototype, 'checkFramebufferStatus', function (this: WebGL2RenderingContext, target: number) {
      if (this.canvas instanceof HTMLCanvasElement && this.canvas.id === 'gl' && observed.firstUltrasoundDraw !== null)
        observed.lateFramebufferChecks++;
      const result: unknown = Reflect.apply(checkFramebufferStatus, this, [target]);
      return result;
    });
    for (const name of ['fenceSync', 'deleteSync'] as const) {
      const original: unknown = Reflect.get(WebGL2RenderingContext.prototype, name);
      if (typeof original !== 'function') throw new Error(`WebGL.${name} unavailable`);
      Reflect.set(WebGL2RenderingContext.prototype, name, function (this: WebGL2RenderingContext, ...args: unknown[]) {
        const result: unknown = Reflect.apply(original, this, args);
        if (this.canvas instanceof HTMLCanvasElement && this.canvas.id === 'gl') {
          if (name === 'fenceSync' && result) pending.add(result);
          if (name === 'deleteSync') pending.delete(args[0] as WebGLSync);
        }
        return result;
      });
    }
    const getContext: unknown = Reflect.get(HTMLCanvasElement.prototype, 'getContext');
    if (typeof getContext !== 'function') throw new Error('Canvas.getContext unavailable');
    Reflect.set(HTMLCanvasElement.prototype, 'getContext', function (this: HTMLCanvasElement, kind: string, options?: unknown) {
      const context: unknown = Reflect.apply(getContext, this, [kind, options]);
      if (kind === 'webgl2' && context) observed.contexts.push({ canvas: this, readyAt: performance.now() });
      return context;
    });
    for (const name of ['drawArrays', 'drawElements'] as const) {
      const original: unknown = Reflect.get(WebGL2RenderingContext.prototype, name);
      if (typeof original !== 'function') throw new Error(`WebGL.${name} unavailable`);
      Reflect.set(WebGL2RenderingContext.prototype, name, function (this: WebGL2RenderingContext, ...args: number[]) {
        if (this.canvas instanceof HTMLCanvasElement) {
          if (this.canvas.id === 'gl') {
            observed.ultrasoundDraws++;
            observed.firstUltrasoundDraw ??= performance.now();
            const frame = window.__vexusTest?.framesRendered() ?? -1;
            if (frame !== lastFrame && pending.size) observed.overlappingFrames++;
            lastFrame = frame;
          }
          if (this.canvas.parentElement?.id === 'nav3d') {
            observed.firstNavigatorDraw ??= performance.now();
            observed.navigatorDraws++;
          }
        }
        Reflect.apply(original, this, args);
      });
    }
  });
  const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
  const initial = await page.evaluate(() => ({
    contexts: window.startupContexts.contexts.map(({ canvas, readyAt }) => ({ id: canvas.id, parent: canvas.parentElement?.id, readyAt })),
    firstUltrasoundDraw: window.startupContexts.firstUltrasoundDraw!,
    firstNavigatorDraw: window.startupContexts.firstNavigatorDraw!,
    navigatorDraws: window.startupContexts.navigatorDraws,
    overlappingFrames: window.startupContexts.overlappingFrames,
    lateFramebufferChecks: window.startupContexts.lateFramebufferChecks,
  }));
  expect(initial.contexts).toHaveLength(2);
  expect(initial.contexts.some((c) => c.id === 'gl')).toBe(true);
  expect(initial.contexts.some((c) => c.parent === 'nav3d')).toBe(true);
  // Evitar crear el contexto 3D con adquisiciones ya en vuelo. La relación de orden
  // se observa en WebGL real y no depende de un umbral de velocidad.
  for (const c of initial.contexts) expect(c.readyAt).toBeLessThanOrEqual(initial.firstUltrasoundDraw);
  expect(initial.navigatorDraws).toBeGreaterThan(0);
  expect(initial.firstNavigatorDraw).toBeLessThanOrEqual(initial.firstUltrasoundDraw);
  expect(initial.overlappingFrames).toBe(0);
  expect(initial.lateFramebufferChecks).toBe(0);
  await page.selectOption('#case-select', 'severe-congestion');
  await withinFrames(page, 45, 'el 3D sigue dibujando al cambiar de paciente', async () =>
    page.evaluate((n) => window.startupContexts.navigatorDraws > n || 'render 3D pendiente', initial.navigatorDraws),
  );
  // A real origin-scoped exclusive reservation represents another page's GPU
  // preparation. Do not fabricate a fence signal or a rendered frame.
  await page.evaluate(() => {
    void navigator.locks.request(
      'vexus-gpu-preparation',
      { mode: 'exclusive' },
      () =>
        new Promise<void>((release) => {
          window.startupContexts.reservationReady = true;
          window.startupContexts.releaseReservation = () => {
            window.startupContexts.reservationReady = false;
            release();
          };
        }),
    );
  });
  await withinFrames(page, 90, 'la preparación obtiene la GPU tras drenar las adquisiciones reales', async () =>
    page.evaluate(() => window.startupContexts.reservationReady || 'reserva pendiente'),
  );
  const held = await page.evaluate(() => ({
    n: window.__vexusTest!.sim().renderer.displayedFrame!.n,
    loops: window.__vexusTest!.framesRendered(),
    time: window.__vexusTest!.sim().physiology.clock.t,
    ultrasoundDraws: window.startupContexts.ultrasoundDraws,
    navigatorDraws: window.startupContexts.navigatorDraws,
  }));
  await page.getByRole('slider', { name: 'Rotación', exact: true }).press('ArrowRight');
  const requested = await page.evaluate(() => window.__vexusTest!.sim().pose);
  const during = await page.evaluate(async () => {
    for (let i = 0; i < 30; i++) await new Promise(requestAnimationFrame);
    return {
      n: window.__vexusTest!.sim().renderer.displayedFrame!.n,
      loops: window.__vexusTest!.framesRendered(),
      time: window.__vexusTest!.sim().physiology.clock.t,
      ultrasoundDraws: window.startupContexts.ultrasoundDraws,
      navigatorDraws: window.startupContexts.navigatorDraws,
    };
  });
  expect(during).toEqual(held);
  await page.evaluate(() => window.startupContexts.releaseReservation!());
  await withinFrames(page, 45, 'la adquisición responde al gesto manual al liberarse la preparación', async () =>
    page.evaluate(
      ({ n, pose }) => {
        const shown = window.__vexusTest!.sim().renderer.displayedFrame!;
        return (shown.n > n && JSON.stringify(shown.anatomy.pose) === JSON.stringify(pose)) || 'adquisición pendiente';
      },
      { n: held.n, pose: requested },
    ),
  );
  expect(
    await page.evaluate(
      () =>
        window
          .__vexusTest!.sim()
          .renderer.readDisplay()
          .gray.filter((v) => v > 0).length,
    ),
  ).toBeGreaterThan(1000);
  expect(await page.evaluate(() => window.startupContexts.navigatorDraws)).toBeGreaterThan(held.navigatorDraws);
  await info.attach('gpu-reservation.json', { body: JSON.stringify({ held, during, requested }), contentType: 'application/json' });
  await page.locator('#freeze').click();
  await page.locator('#nav3d canvas').screenshot({ path: info.outputPath('navigator-after-case-change.png') });
  await withinFrames(page, 90, 'el corte congelado ya corresponde al cuadro mostrado', async () =>
    page.evaluate(() =>
      Number(document.querySelector<HTMLElement>('#cutmap')!.dataset.acquiredFrame) === window.__vexusTest!.sim().renderer.displayedFrame!.n
        ? true
        : 'corte pendiente',
    ),
  );
  const frozen = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('#overlay')!;
    window.startupContexts.frozenOverlay = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    return {
      paints: window.startupContexts.overlayPaints,
      n: window.__vexusTest!.sim().renderer.displayedFrame!.n,
      f: window.__vexusTest!.framesRendered(),
    };
  });
  await withinFrames(page, 45, 'la imagen congelada conserva su bitmap sin repintados redundantes', async () =>
    page.evaluate((f) => window.__vexusTest!.framesRendered() >= f + 30 || 'pendiente', frozen.f),
  );
  const stable = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('#overlay')!;
    const ctx = c.getContext('2d')!;
    const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
    const before = window.startupContexts.frozenOverlay!;
    let changedChannels = 0;
    const examples: Array<{ i: number; before: number; after: number }> = [];
    for (let i = 0; i < pixels.length; i++)
      if (pixels[i] !== before[i]) {
        changedChannels++;
        if (examples.length < 8) examples.push({ i, before: before[i], after: pixels[i] });
      }
    return {
      result: {
        paints: window.startupContexts.overlayPaints,
        n: window.__vexusTest!.sim().renderer.displayedFrame!.n,
        samePixels: changedChannels === 0,
      },
      bitmap: { width: c.width, height: c.height, attributes: ctx.getContextAttributes(), changedChannels, examples },
    };
  });
  await info.attach('overlay-persistence.json', { body: JSON.stringify(stable), contentType: 'application/json' });
  expect(stable.result).toEqual({ paints: frozen.paints, n: frozen.n, samePixels: true });
  await info.attach('context-order.json', { body: JSON.stringify(initial), contentType: 'application/json' });
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => window.__vexusTest!.loggedErrors())).toEqual([]);
  expect(await page.evaluate(() => window.startupContexts.overlappingFrames)).toBe(0);
});

for (const stage of ['module', 'draw'] as const)
  test(`reports a failed 3D ${stage} and still starts the ultrasound loop`, async ({ page }) => {
    budget(90_000);
    if (stage === 'module')
      await page.route('**/navigator3d-*.js', (route) =>
        route.fulfill({ contentType: 'application/javascript', body: 'throw new Error("context-init-regression");' }),
      );
    else
      await page.addInitScript(() => {
        const original: unknown = Reflect.get(WebGL2RenderingContext.prototype, 'drawElements');
        if (typeof original !== 'function') throw new Error('WebGL.drawElements unavailable');
        Reflect.set(WebGL2RenderingContext.prototype, 'drawElements', function (this: WebGL2RenderingContext, ...args: number[]) {
          if (this.canvas instanceof HTMLCanvasElement && this.canvas.parentElement?.id === 'nav3d')
            throw new Error('context-init-regression');
          Reflect.apply(original, this, args);
        });
      });
    const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
    expectLoggedErrors(page, [/context-init-regression/]);
    const logged = await page.evaluate(() => window.__vexusTest!.loggedErrors());
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('context-init-regression');
    expect(await page.locator('#nav3d canvas').count()).toBe(0);
    expect(errors).toEqual([]);
  });
