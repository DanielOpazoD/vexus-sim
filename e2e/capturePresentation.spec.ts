import { expect, test, type Page } from '@playwright/test';
import { bootWithoutErrors } from './support';

async function snapshot(page: Page) {
  return page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('#spectrum')!;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const s = window.__vexusTest!.sim();
    const seconds = document.querySelector<HTMLElement>('#ecg')!.clientWidth / (s.pw.sweepMmS * 3.2);
    // Puntos del camino realmente pintado: los glifos de Vmáx/Vmín no siguen la transformación de la onda.
    const points = (window as unknown as { capturePath: [number, number][] }).capturePath.filter(
      ([x, y]) => x >= 80 && x < c.width - 80 && y >= 35 && y < c.height - 25,
    );
    const bitmap: [number, number, number][] = [];
    for (let x = 80; x < c.width - 80; x += 2)
      for (let y = 35; y < c.height - 25; y += 2) {
        const i = (y * c.width + x) * 4;
        const r = d[i];
        if (r >= 60 && r < 200 && Math.abs(d[i + 1] - 0.95 * r) < 2 && Math.abs(d[i + 2] - 0.75 * r) < 2) bitmap.push([x, y, r]);
      }
    const cursor = s.frozen ? s.renderer.cineShownFrame?.t : undefined;
    const t = cursor === undefined ? s.physiology.clock.t : Math.min(s.physiology.clock.t, cursor + 0.9 * seconds);
    return { points, bitmap, w: c.width, h: c.height, seconds, t, baseline: s.pw.baselineShift, invert: s.pw.invert };
  });
}

// Referencia independiente obtenida de píxeles ya dibujados: no usa verdad fisiológica ni la función de producción.
async function expectTransformed(page: Page, before: Awaited<ReturnType<typeof snapshot>>) {
  await expect
    .poll(
      async () => {
        const after = await snapshot(page);
        const result = await page.evaluate(
          ({ before, after }) => {
            const c = document.querySelector<HTMLCanvasElement>('#spectrum')!;
            const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
            let checked = 0,
              found = 0;
            for (const [x, y] of before.points) {
              const t = before.t - before.seconds + (x / before.w) * before.seconds;
              const nx = ((t - after.t + after.seconds) / after.seconds) * after.w;
              const frequency = (before.invert ? y / before.h : 1 - y / before.h) - 0.5 + before.baseline;
              let fraction = frequency + 0.5 - after.baseline;
              fraction -= Math.floor(fraction);
              const ny = (after.invert ? fraction : 1 - fraction) * after.h;
              if (nx < 80 || nx > after.w - 80 || ny < 35 || ny > after.h - 25) continue;
              checked++;
              let amber = false;
              for (let dx = -2; dx <= 2; dx++)
                for (let dy = -2; dy <= 2; dy++) {
                  const i = (Math.round(ny + dy) * after.w + Math.round(nx + dx)) * 4;
                  if (d[i] > 225 && d[i + 1] > 180 && d[i + 1] < 235 && d[i + 2] < 150) amber = true;
                }
              if (amber) found++;
            }
            let bitmapChecked = 0,
              bitmapFound = 0;
            for (const [x, y, r] of before.bitmap) {
              const t = before.t - before.seconds + (x / before.w) * before.seconds;
              const nx = ((t - after.t + after.seconds) / after.seconds) * after.w;
              const frequency = (before.invert ? y / before.h : 1 - y / before.h) - 0.5 + before.baseline;
              let fraction = frequency + 0.5 - after.baseline;
              fraction -= Math.floor(fraction);
              const ny = (after.invert ? fraction : 1 - fraction) * after.h;
              if (nx < 80 || nx > after.w - 80 || ny < 35 || ny > after.h - 25) continue;
              bitmapChecked++;
              let same = false;
              for (let dx = -2; dx <= 2; dx++)
                for (let dy = -2; dy <= 2; dy++) {
                  const i = (Math.round(ny + dy) * after.w + Math.round(nx + dx)) * 4;
                  if (Math.abs(d[i] - r) <= 3 && Math.abs(d[i + 1] - 0.95 * d[i]) < 2 && Math.abs(d[i + 2] - 0.75 * d[i]) < 2) same = true;
                }
              if (same) bitmapFound++;
            }
            return { checked, found, bitmapChecked, bitmapFound };
          },
          { before, after },
        );
        return result.checked >= 15 && result.bitmapChecked >= 30
          ? Math.min(result.found / result.checked, result.bitmapFound / result.bitmapChecked)
          : 0;
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0.85);
}

test('captura congelada conserva alineación al invertir, desplazar baseline, redimensionar y cambiar barrido', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await bootWithoutErrors(page, '?e2e=1');
  await page
    .locator('button', { hasText: /Apnea\s*esp/ })
    .first()
    .click();
  await page.keyboard.press('p');
  expect(
    await page.evaluate(() => {
      window.__vexusTest!.goToStartPoint('portal');
      return window.__vexusTest!.placeGate(['pvTrunk']);
    }),
  ).toBe(true);
  await page.evaluate(() => window.__vexusTest!.advance(8));
  await page.locator('#freeze').click();
  await expect(page.locator('#freeze')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.__vexusTest!.sim().frozen)).toBe(true);
  await page.getByRole('tab', { name: 'Doppler' }).click();
  await page.getByRole('button', { name: 'Invertir espectro', exact: true }).click();
  await page.evaluate(() => {
    const ctx = document.querySelector<HTMLCanvasElement>('#spectrum')!.getContext('2d')!;
    const begin = ctx.beginPath.bind(ctx),
      move = ctx.moveTo.bind(ctx),
      line = ctx.lineTo.bind(ctx),
      stroke = ctx.stroke.bind(ctx);
    let path: [number, number][] = [];
    ctx.beginPath = () => {
      path = [];
      begin();
    };
    ctx.moveTo = (x, y) => {
      path.push([x, y]);
      move(x, y);
    };
    ctx.lineTo = (x, y) => {
      path.push([x, y]);
      line(x, y);
    };
    ctx.stroke = () => {
      if (ctx.strokeStyle === '#ffd166' && ctx.lineWidth === 1.5)
        (window as unknown as { capturePath: [number, number][] }).capturePath = path.slice();
      stroke();
    };
  });
  await page.getByRole('tab', { name: 'Medir' }).click();
  await page.getByRole('button', { name: 'Porta PF', exact: true }).click();
  await page.getByRole('button', { name: 'Capturar' }).click();
  await expect(page.locator('.result')).toContainText(/Porta: \d+\.\d\/\d+\.\d cm\/s/);
  const initial = await snapshot(page);
  expect(initial.points.length).toBeGreaterThan(30);
  await page.getByRole('tab', { name: 'Doppler' }).click();
  await page.getByRole('button', { name: 'Invertir espectro', exact: true }).click();
  expect(await page.evaluate(() => window.__vexusTest!.sim().frozen)).toBe(true);
  await expectTransformed(page, initial);
  await page.getByRole('button', { name: 'Avanzado', exact: true }).click();
  await page.getByRole('slider', { name: 'Línea de base', exact: true }).evaluate((input) => {
    (input as HTMLInputElement).value = '0.25';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expectTransformed(page, initial);
  await page.setViewportSize({ width: 1068, height: 800 });
  await expectTransformed(page, initial);
  const beforeSweep = await snapshot(page);
  await page.getByRole('group', { name: 'Barrido', exact: true }).getByRole('button', { name: '100', exact: true }).click();
  await expectTransformed(page, beforeSweep);
  expect(errors).toEqual([]);
});
