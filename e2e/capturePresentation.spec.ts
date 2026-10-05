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
              // Coordenadas del camino realmente dibujado: texto/marcas pueden cubrir su color después del stroke.
              // Se compara con el camino de la nueva presentación, no con la señal ni su transform de producción.
              if (after.points.some(([ax, ay]) => Math.abs(ax - nx) <= 2 && Math.abs(ay - ny) <= 2)) found++;
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
        const ratio =
          result.checked >= 15 && result.bitmapChecked >= 30
            ? Math.min(result.found / result.checked, result.bitmapFound / result.bitmapChecked)
            : 0;
        return ratio;
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0.85);
}

test('captura congelada conserva alineación al invertir, desplazar baseline, redimensionar, retroceder cine y cambiar barrido', async ({
  page,
}) => {
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
  const cineTarget = await page.evaluate(() => {
    // Arranque/controles lentos: el reloj puede preceder la adquisición por varios segundos.
    window.__vexusTest!.advance(8);
    window.__vexusTest!.advance(3);
    window.__vexusTest!.sim().render(); // Cuadro intermedio real para recorrer el historial congelado.
    const t = window.__vexusTest!.sim().physiology.clock.t;
    window.__vexusTest!.advance(5);
    return t;
  });
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
  const beforeCine = await snapshot(page);
  // El arranque y los clicks también avanzan el reloj: 3 s absolutos pueden preceder al espectro capturado.
  const selectedT = await page.locator('#cine').evaluate((el, target) => {
    const r = window.__vexusTest!.sim().renderer;
    let closest = 0;
    for (let i = 1; i < r.cineCount; i++) if (Math.abs(r.cineFrame(i).t - target) < Math.abs(r.cineFrame(closest).t - target)) closest = i;
    const input = el as HTMLInputElement;
    input.value = String(closest);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return r.cineFrame(closest).t;
  }, cineTarget);
  await expect.poll(() => page.evaluate(() => window.__vexusTest!.sim().renderer.cineShownFrame?.t)).toBe(selectedT);
  await expectTransformed(page, beforeCine);
  const latestT = await page.locator('#cine').evaluate((el) => {
    const input = el as HTMLInputElement;
    input.value = input.max;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const r = window.__vexusTest!.sim().renderer;
    return r.cineFrame(r.cineCount - 1).t;
  });
  await expect.poll(() => page.evaluate(() => window.__vexusTest!.sim().renderer.cineShownFrame?.t)).toBe(latestT);
  await expectTransformed(page, beforeCine);
  await page.setViewportSize({ width: 1068, height: 800 });
  await expectTransformed(page, initial);
  // El resize se aplica en RAF: no tomar la referencia durante una transición de dimensiones.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const beforeSweep = await snapshot(page);
  await page.getByRole('group', { name: 'Barrido', exact: true }).getByRole('button', { name: '100', exact: true }).click();
  await expectTransformed(page, beforeSweep);
  // Changing the acquisition scale while frozen must not relabel old pixels
  // or the capture overlay. The source signal and physiological clock stay intact.
  const acquisition = () =>
    page.evaluate(() => {
      const s = window.__vexusTest!.sim();
      return {
        t: s.physiology.clock.t,
        frozen: s.frozen,
        columns: s.spectral.columns.map((c) => [c.t, c.prfHz, c.powerDb.reduce((a, b) => a + b, 0)]),
      };
    });
  const beforeScale = await acquisition();
  await page
    .getByRole('slider', { name: 'Escala', exact: true })
    .last()
    .evaluate((input) => {
      // Clear the recorder in the same event as the scale change: an old RAF
      // must not repopulate it between two browser calls.
      (window as unknown as { capturePath: [number, number][] }).capturePath = [];
      (input as HTMLInputElement).value = '60';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  await expect.poll(async () => (await snapshot(page)).bitmap.length).toBe(0);
  expect((await snapshot(page)).points).toHaveLength(0);
  expect(await acquisition()).toEqual(beforeScale);
  await page.locator('#spectrum').screenshot({ path: test.info().outputPath('pw-new-scale-frozen.png') });
  expect(errors).toEqual([]);
});
