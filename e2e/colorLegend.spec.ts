import { expect, test, type Page } from '@playwright/test';
import { nyquistVelocityCms } from '../src/core/units';
import { colorMapRgb } from '../src/ultrasound/colorMap';
import { bootWithoutErrors, budget, checkAfterEach, withinFrames, withinSimSeconds } from './support';

checkAfterEach();

declare global {
  interface Window {
    legendDraw: { rows: number[][]; text: { value: string; x: number; y: number; font: string }[] };
  }
}

/** Observa el dibujo real; no reemplaza la paleta ni fuerza adquisiciones. */
async function observe(page: Page) {
  await page.evaluate(() => {
    const ctx = document.querySelector<HTMLCanvasElement>('#overlay')!.getContext('2d')!;
    const clear = ctx.clearRect.bind(ctx),
      fill = ctx.fillRect.bind(ctx),
      text = ctx.fillText.bind(ctx);
    window.legendDraw = { rows: [], text: [] };
    ctx.clearRect = (...args) => {
      window.legendDraw = { rows: [], text: [] };
      clear(...args);
    };
    ctx.fillRect = (x, y, w, h) => {
      if (h === 1) window.legendDraw.rows.push([x, y, w, h]);
      fill(x, y, w, h);
    };
    ctx.fillText = (...args) => {
      if (window.legendDraw.rows.length) window.legendDraw.text.push({ value: args[0], x: args[1], y: args[2], font: ctx.font });
      text(...args);
    };
  });
}

async function layoutReady(page: Page) {
  await withinFrames(page, 3, 'leyenda del tamaño actual del sector', () =>
    page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>('#overlay')!;
      const dpr = Math.min(2, devicePixelRatio);
      return (
        (c.width === Math.max(320, Math.floor(c.clientWidth * dpr)) &&
          c.height === Math.max(240, Math.floor(c.clientHeight * dpr)) &&
          window.legendDraw.rows.length > 0) ||
        'pendiente'
      );
    }),
  );
}

async function legend(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#overlay')!;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d')!;
    const rows = window.legendDraw.rows;
    const samples = rows.map(([x, y, w]) => Array.from(ctx.getImageData(Math.floor(x + w / 2), y, 1, 1).data).slice(0, 3));
    const s = window.__vexusTest!.sim();
    const tr = s.renderer.displayedFrame!.anatomy.transducer;
    return {
      rows,
      samples,
      text: window.legendDraw.text,
      css: { x: canvas.width / rect.width, y: canvas.height / rect.height, width: rect.width, height: rect.height },
      acquired: { prfHz: s.displayed.color.prfHz, invert: s.displayed.color.invert, f0: tr.f0Doppler, n: s.renderer.displayedFrame!.n },
    };
  });
}

async function verifyLegend(page: Page) {
  const result = await legend(page);
  const { rows, samples, text, css, acquired } = result;
  expect(rows.length).toBeGreaterThan(80);
  // Misión 6: texto >=12 px CSS, barra perceptible y fuera de la cabecera.
  for (const label of text.filter((t) => ['cm/s', '0'].includes(t.value) || /^[+−]\d+$/.test(t.value))) {
    expect(parseFloat(label.font) / css.y).toBeGreaterThanOrEqual(11.99);
    expect(label.x / css.x).toBeGreaterThanOrEqual(8);
    expect(label.y / css.y).toBeLessThan(css.height - 8);
  }
  expect(rows[0][2] / css.x).toBeGreaterThanOrEqual(11.9);
  expect((rows.length - 1) / css.y).toBeGreaterThanOrEqual(111.9);
  expect(rows[0][1] / css.y).toBeGreaterThanOrEqual(63.9);
  const nyq = Math.round(nyquistVelocityCms(acquired.prfHz, acquired.f0));
  expect(text.map((t) => t.value)).toEqual(expect.arrayContaining([`+${nyq}`, `−${nyq}`, '0', 'cm/s']));
  for (let i = 0; i < rows.length; i++) {
    const v = 1 - (2 * i) / (rows.length - 1);
    expect(samples[i], `fila ${i}: paleta compartida con la imagen`).toEqual(colorMapRgb(v >= 0 !== acquired.invert, Math.abs(v)));
  }
  expect(samples[(samples.length - 1) / 2], 'cero negro común, no salto entre colores saturados').toEqual([0, 0, 0]);
  return result;
}

for (const viewport of [
  { width: 1280, height: 720, dpr: 1 },
  { width: 390, height: 844, dpr: 2 },
]) {
  test.describe(`leyenda Color a ${viewport.width}px, DPR ${viewport.dpr}`, () => {
    test.use({ viewport, deviceScaleFactor: viewport.dpr });
    test('degradado legible en Color y tríplex, invertido y congelado corresponde a la adquisición', async ({ page }, info) => {
      budget(120_000);
      const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
      await observe(page);
      await page.locator('#mode-color').click();
      await withinSimSeconds(page, 1, 'primera escala Color adquirida', async () =>
        page.evaluate(() => window.legendDraw.rows.length > 0 || 'pendiente'),
      );
      await verifyLegend(page);
      await page.locator('#mode-pw').click();
      await layoutReady(page);
      await verifyLegend(page);
      await page.getByRole('button', { name: 'Invertir mapa', exact: true }).click();
      await withinSimSeconds(page, 1, 'mapa invertido adquirido', async () =>
        page.evaluate(() => window.__vexusTest!.sim().displayed.color.invert || 'pendiente'),
      );
      await page.locator('#freeze').click();
      const frozen = await verifyLegend(page);
      const path = info.outputPath('color-triplex.png');
      await page.screenshot({ path, fullPage: true });
      await info.attach('color-triplex', { path, contentType: 'image/png' });
      // El equipo vivo cambia; la leyenda congelada conserva la PRF/paleta del píxel mostrado.
      await page.getByRole('button', { name: 'Invertir mapa', exact: true }).click();
      const scale = page.locator('[id^="ctl-seccion-doppler-color-"]').getByRole('slider', { name: 'Escala', exact: true });
      await scale.focus();
      await scale.press('ArrowRight');
      const live = await page.evaluate(() => window.__vexusTest!.sim().color);
      expect(live.prfHz).not.toBe(frozen.acquired.prfHz);
      expect(live.invert).not.toBe(frozen.acquired.invert);
      await page.setViewportSize({ width: viewport.width === 390 ? 320 : 1600, height: viewport.height });
      await layoutReady(page);
      const resized = await verifyLegend(page);
      expect(resized.acquired).toEqual(frozen.acquired);
      await page.locator('#mode-b').click();
      await layoutReady(page);
      expect((await verifyLegend(page)).acquired).toEqual(frozen.acquired);
      await page.locator('#freeze').click();
      await withinSimSeconds(page, 1, '2D sin leyenda Color', async () =>
        page.evaluate(() => window.legendDraw.rows.length === 0 || 'pendiente'),
      );
      expect(errors).toEqual([]);
      await info.attach('legend', { body: JSON.stringify({ frozen, resized }), contentType: 'application/json' });
    });
  });
}
