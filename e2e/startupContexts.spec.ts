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
    partialGpuTurn: {
      fault: boolean;
      nulls: number;
      unfencedFrames: Set<number>;
      reservationReady: boolean;
      reservationError?: string;
      grant?: {
        nulls: number;
        frame: number;
        loops: number;
        unfencedFrames: number[];
        contexts: Array<{ canvas: string; fences: number; pending: number }>;
      };
      restoreFence: () => void;
      abortReservation?: () => void;
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

test('a partial GPU submission drains before releasing its page turn and recovers the requested pose', async ({ page }, info) => {
  budget(90_000); // Un solo arranque, con el mismo presupuesto de trabajo que los otros casos de contexto.
  const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
  expect(await page.evaluate(() => window.__vexusTest!.loggedErrors())).toEqual([]);
  try {
    await page.evaluate(() => {
      const prototype = WebGL2RenderingContext.prototype;
      const fence: unknown = Reflect.get(prototype, 'fenceSync');
      if (typeof fence !== 'function') throw new Error('WebGL.fenceSync unavailable');
      const control: Window['partialGpuTurn'] = (window.partialGpuTurn = {
        fault: true,
        nulls: 0,
        unfencedFrames: new Set<number>(),
        reservationReady: false,
        restoreFence: () => {
          Reflect.set(prototype, 'fenceSync', fence);
        },
      });
      const failedFrames = new Set<number>();
      Reflect.set(prototype, 'fenceSync', function (this: WebGL2RenderingContext, ...args: unknown[]) {
        const frame =
          this.canvas instanceof HTMLCanvasElement && this.canvas.parentElement?.id === 'nav3d'
            ? window.__vexusTest!.sim().renderer.displayedFrame!.n
            : null;
        // Cada adquisición falla una vez. Solo el reintento nativo sobre ese
        // mismo cuadro puede cercar su trabajo; otro cuadro no salda la deuda.
        if (control.fault && frame !== null && !failedFrames.has(frame)) {
          failedFrames.add(frame);
          control.unfencedFrames.add(frame);
          control.nulls++;
          return null;
        }
        const result: unknown = Reflect.apply(fence, this, args);
        if (frame !== null && result) control.unfencedFrames.delete(frame);
        return result;
      });
    });
    const before = await page.evaluate(() => window.__vexusTest!.sim().pose);
    await page.getByRole('slider', { name: 'Rotación', exact: true }).press('ArrowRight');
    const requested = await page.evaluate(() => window.__vexusTest!.sim().pose);
    expect(requested).not.toEqual(before);
    await withinFrames(page, 45, 'el gesto envía un cuadro con fallo de valla solo en 3D', async () =>
      page.evaluate(() => window.partialGpuTurn.nulls > 0 || 'falta el envío parcial'),
    );
    // Cada cuadro nuevo sigue fallando hasta conceder la reserva; ready() puede
    // reparar la valla del mismo cuadro sin una adquisición posterior exitosa
    // que oculte la omisión de submitted().
    // Las consultas y señales de las vallas válidas siguen siendo nativas.
    await page.evaluate(() => {
      const control = window.partialGpuTurn;
      const abort = new AbortController();
      control.abortReservation = () => abort.abort();
      void navigator.locks
        .request('vexus-gpu-preparation', { mode: 'exclusive', signal: abort.signal }, () => {
          control.grant = {
            nulls: control.nulls,
            frame: window.__vexusTest!.sim().renderer.displayedFrame!.n,
            loops: window.__vexusTest!.framesRendered(),
            unfencedFrames: [...control.unfencedFrames],
            contexts: (window.gpuProgress ?? []).map((row) => ({
              canvas: row.canvas,
              fences: row.fences,
              pending: row.fences - row.deletes,
            })),
          };
          control.fault = false;
          control.reservationReady = true;
          return new Promise<void>((release) => {
            control.releaseReservation = () => {
              control.reservationReady = false;
              release();
            };
          });
        })
        .catch((error: unknown) => {
          if (!abort.signal.aborted) control.reservationError = String(error);
        });
    });
    await withinFrames(page, 90, 'la reserva entra después de drenar el envío parcial', async () =>
      page.evaluate(() => window.partialGpuTurn.reservationReady || window.partialGpuTurn.reservationError || 'reserva pendiente'),
    );
    const grant = await page.evaluate(() => window.partialGpuTurn.grant!);
    expect(grant.nulls).toBeGreaterThan(0);
    expect(grant.unfencedFrames, 'todo trabajo 3D debe obtener una valla nativa antes de ceder la reserva').toEqual([]);
    expect(grant.contexts.map((row) => row.canvas).sort()).toEqual(['gl', 'nav3d']);
    for (const context of grant.contexts) {
      expect(context.fences, context.canvas).toBeGreaterThan(0);
      expect(context.pending, `${context.canvas}: vallas válidas drenadas al conceder la reserva`).toBe(0);
    }
    await page.evaluate(() => window.partialGpuTurn.releaseReservation!());
    await withinFrames(page, 45, 'la adquisición normal recupera la pose y la valla 3D', async () =>
      page.evaluate(
        ({ grant, requested }) => {
          const shown = window.__vexusTest!.sim().renderer.displayedFrame!;
          const navFences = window.gpuProgress?.find((row) => row.canvas === 'nav3d')?.fences ?? 0;
          const beforeNavFences = grant.contexts.find((row) => row.canvas === 'nav3d')!.fences;
          return (
            (shown.n > grant.frame &&
              window.__vexusTest!.framesRendered() > grant.loops &&
              JSON.stringify(shown.anatomy.pose) === JSON.stringify(requested) &&
              navFences > beforeNavFences) ||
            'adquisición o valla 3D pendiente'
          );
        },
        { grant, requested },
      ),
    );
    expect(await page.evaluate(() => window.partialGpuTurn.nulls)).toBe(grant.nulls);
    expect(await page.evaluate(() => [...window.partialGpuTurn.unfencedFrames])).toEqual([]);
    expect(await page.evaluate(() => window.partialGpuTurn.reservationError)).toBeUndefined();
    expectLoggedErrors(page, [/^bucle: No se pudo crear la valla del cuadro GPU$/]);
    expect(await page.evaluate(() => window.__vexusTest!.loggedErrors())).toEqual(['bucle: No se pudo crear la valla del cuadro GPU']);
    expect(errors).toEqual([]);
  } finally {
    const receipt = await page.evaluate(() => {
      const control = window.partialGpuTurn;
      if (control) {
        control.fault = false;
        control.restoreFence();
        control.abortReservation?.();
        control.releaseReservation?.();
      }
      return {
        nulls: control?.nulls,
        unfencedFrames: control ? [...control.unfencedFrames] : [],
        grant: control?.grant,
        reservationError: control?.reservationError,
        frames: window.__vexusTest!.framesRendered(),
        acquiredFrame: window.__vexusTest!.sim().renderer.displayedFrame?.n,
        gpu: window.gpuProgress,
        logged: window.__vexusTest!.loggedErrors(),
      };
    });
    await info.attach('partial-gpu-turn.json', { body: JSON.stringify({ ...receipt, errors }), contentType: 'application/json' });
  }
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
