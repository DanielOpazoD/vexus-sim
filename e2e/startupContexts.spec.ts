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
    });
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
  await page.locator('#freeze').click();
  await page.locator('#nav3d canvas').screenshot({ path: info.outputPath('navigator-after-case-change.png') });
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
