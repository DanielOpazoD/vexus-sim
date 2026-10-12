import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget, withinFrames } from './support';
import type { CutMapView } from '../src/ui/cutMapView';
declare global {
  interface Window {
    __resizeMap?: { view: CutMapView; canvas: HTMLCanvasElement };
  }
}
test('el mapa adquirido se repinta al redimensionar con una petición real aún en vuelo', async ({ page }, info) => {
  budget(120_000);
  const errors = await bootWithoutErrors(page, '?e2e=app');
  await page.locator('#freeze').click();
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType('resource')
      .map((x) => x.name)
      .find((x) => /\/assets\/cutMapView-/.test(x));
    if (!url) throw new Error('módulo real de la guía no cargado');
    const mod: Record<string, unknown> = await import(url);
    const Constructor = Object.values(mod).find((x) => {
      const prototype = (x as { prototype?: object }).prototype;
      return typeof x === 'function' && !!prototype && 'draw' in prototype && 'lastMap' in prototype;
    }) as new (canvas: HTMLCanvasElement) => CutMapView;
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 180;
    canvas.style.cssText = 'position:fixed;left:0;top:0;width:300px;height:180px;z-index:10000';
    document.body.append(canvas);
    window.__resizeMap = { view: new Constructor(canvas), canvas };
  });
  await withinFrames(page, 30, 'mapa común adquirido para el control de tamaño', async () =>
    page.evaluate(() => {
      const x = window.__resizeMap!;
      x.view.draw(window.__vexusTest!.sim(), performance.now());
      return !!x.view.lastMap || 'worker pendiente';
    }),
  );
  const result = await page.evaluate(() => {
    const { view, canvas } = window.__resizeMap!,
      s = window.__vexusTest!.sim();
    const pixels = () => Array.from(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data);
    const now = performance.now();
    view.draw(s, now);
    const before = pixels(),
      map = view.lastMap!.map;
    // Petición real vencida por cadencia. Su respuesta no puede entrar dentro
    // de esta tarea JS: se comprueba la copia adquirida, sin simular la anatomía.
    view.draw(s, now + 1000);
    canvas.width = 280;
    view.draw(s, now + 1001);
    const after = pixels();
    const sameMap = view.lastMap!.map === map;
    view.dispose();
    canvas.remove();
    delete window.__resizeMap;
    return { beforeNonzero: before.some((x) => x !== 0), afterNonzero: after.some((x) => x !== 0), sameMap };
  });
  await info.attach('resize-proof', { body: JSON.stringify(result), contentType: 'application/json' });
  expect(result.beforeNonzero).toBe(true);
  expect(result.sameMap).toBe(true);
  expect(result.afterNonzero).toBe(true);
  expect(errors).toEqual([]);
});
