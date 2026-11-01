import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget } from './support';
import { Tissue } from '../src/anatomy/tissues';

/**
 * La misma envolvente presentada en los tres niveles (decisión 313): la envolvente no cambia, el grano se alarga a lo largo de la línea y no a lo ancho del pulso,
 * y el tono, las luces y las líneas brillantes se conservan. Con Color no actúa.
 */
test('la reducción de moteado cambia solo la presentación del modo B', async ({ page }, info) => {
  budget(180000);
  const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
  await page.getByRole('button', { name: 'Apnea espiratoria', exact: true }).click();
  await page.locator('[data-window="intercostal"]').click();
  await page.waitForFunction(() => (window.__vexusTest?.framesRendered() ?? 0) > 3);
  const result = await page.evaluate(
    ({ blood, liver }) => {
      const s = window.__vexusTest!.sim();
      s.advance(0.1);
      s.render();
      const r = s.renderer;
      const internals = r as unknown as {
        speckleReduction(b: unknown, c: unknown, t: unknown): void;
        scanConvert(b: unknown, c: unknown, cf: unknown, t: unknown): void;
        present(target: unknown): void;
        tScan: unknown;
      };
      const a = r.displayedAnatomy!;
      const showLevel = (level: number, colorOn = false) => {
        const b = { ...s.bmode, persistence: 0, speckleReduction: level };
        const c = { ...s.color, enabled: colorOn };
        internals.speckleReduction(b, c, s.transducer);
        internals.scanConvert(b, c, null, s.transducer);
        internals.present(internals.tScan);
        return r.readDisplay();
      };
      const envBefore = r.readEnvelope({ source: 'compound' }).data.slice();
      const frames = [0, 1, 2].map((level) => showLevel(level));
      const envAfter = r.readEnvelope({ source: 'compound' }).data;
      const { width: W, height: H } = frames[0];
      // Máscaras de la anatomía del cuadro, no del brillo
      const classes = new Int16Array(W * H).fill(-1);
      const inner = new Uint8Array(W * H);
      for (let y = 0; y < H; y += 2)
        for (let x = 0; x < W; x += 2) {
          const q = r.pixelToBeam(x, y, s.transducer, s.bmode.depthMm);
          if (!q) continue;
          const p = a.frame.curvatureCenter.map(
            (v, i) =>
              v + (s.transducer.curvatureRadius + q.r) * (a.frame.axial[i] * Math.cos(q.theta) + a.frame.lateral[i] * Math.sin(q.theta)),
          ) as [number, number, number];
          const c = s.anatomy.classifyWorld(p, a.sample);
          classes[y * W + x] = Number(c.tissue);
          inner[y * W + x] = c.boundaryDistance > 2 ? 1 : 0;
        }
      const median = (v: number[]) => [...v].sort((p, q) => p - q)[v.length >> 1];
      const sample = (gray: Uint8Array, tissue: number) => {
        const out: number[] = [];
        for (let i = 0; i < gray.length; i++) if (classes[i] === tissue && inner[i]) out.push(gray[i]);
        return out;
      };
      const stats = frames.map((f) => ({ liver: median(sample(f.gray, liver)), blood: median(sample(f.gray, blood)), peak: 0 }));
      // Autocorrelación del grano en el hígado, en una ventana cuadrada alrededor del centro de la imagen de líneas casi verticales
      const acf = (gray: Uint8Array, dx: number, dy: number) => {
        let sxx = 0;
        let sxy = 0;
        let n = 0;
        let m = 0;
        const x0 = Math.round(W * 0.42),
          x1 = Math.round(W * 0.58),
          y0 = Math.round(H * 0.2),
          y1 = Math.round(H * 0.45);
        for (let y = y0; y < y1; y++)
          for (let x = x0; x < x1; x++) {
            m += gray[y * W + x];
            n++;
          }
        m /= n;
        for (let y = y0; y < y1; y++)
          for (let x = x0; x < x1; x++) {
            const u = gray[y * W + x] - m;
            const v = gray[(y + dy) * W + x + dx] - m;
            sxx += u * u;
            sxy += u * v;
          }
        return sxy / sxx;
      };
      const color = [showLevel(0, true), showLevel(2, true)];
      return {
        envIdentical: envBefore.length === envAfter.length && envBefore.every((v, i) => v === envAfter[i]),
        tissues: stats,
        lateral: frames.map((f) => acf(f.gray, 6, 0)),
        axial: frames.map((f) => acf(f.gray, 0, 3)),
        changed: frames.map((f) => f.gray.reduce((n, v, i) => n + (v !== frames[0].gray[i] ? 1 : 0), 0)),
        colorIgnores: color[0].gray.every((v, i) => v === color[1].gray[i]),
        glError: r.gl.getError(),
      };
    },
    { blood: Tissue.Blood, liver: Tissue.Liver },
  );
  await info.attach('speckle-reduction.json', { body: JSON.stringify(result), contentType: 'application/json' });
  expect(result.envIdentical).toBe(true);
  expect(result.colorIgnores).toBe(true);
  expect(result.changed[0]).toBe(0);
  expect(result.changed[1]).toBeGreaterThan(1000);
  expect(result.changed[2]).toBeGreaterThan(result.changed[1]);
  // El tono no se mueve y las luces siguen oscuras
  for (let level = 1; level <= 2; level++) {
    expect(Math.abs(result.tissues[level].liver - result.tissues[0].liver)).toBeLessThanOrEqual(3);
    expect(Math.abs(result.tissues[level].blood - result.tissues[0].blood)).toBeLessThanOrEqual(6);
  }
  // Correlación mayor a lo largo de la línea; a lo largo del haz, casi igual
  expect(result.lateral[1]).toBeGreaterThan(result.lateral[0] + 0.02);
  expect(result.lateral[2]).toBeGreaterThan(result.lateral[1] + 0.02);
  expect(Math.abs(result.axial[1] - result.axial[0])).toBeLessThan(0.05);
  expect(result.glError).toBe(0);
  expect(errors).toEqual([]);
});

test('cambiar de nivel arranca la persistencia con el cuadro nuevo, sin mezclar niveles', async ({ page }) => {
  budget(120000);
  const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
  await page.getByRole('button', { name: 'Apnea espiratoria', exact: true }).click();
  await page.locator('[data-window="intercostal"]').click();
  await page.waitForFunction(() => (window.__vexusTest?.framesRendered() ?? 0) > 3);
  const result = await page.evaluate(() => {
    const s = window.__vexusTest!.sim();
    const r = s.renderer;
    const internals = r as unknown as { present(target: unknown): void; tScan: unknown };
    const frame = (level: 0 | 1 | 2) => {
      s.equipment = { ...s.equipment, bmode: { ...s.bmode, persistence: 0.8, speckleReduction: level } };
      s.advance(0.05);
      s.render();
      const shown = r.readDisplay().gray.slice();
      internals.present(internals.tScan);
      const current = r.readDisplay().gray;
      return shown.reduce((n, v, i) => n + (v !== current[i] ? 1 : 0), 0);
    };
    frame(0);
    const sameLevel = frame(0);
    const changed = frame(2);
    const nextSameLevel = frame(2);
    return { sameLevel, changed, nextSameLevel, glError: r.gl.getError() };
  });
  // Control: con el mismo nivel la historia sí se mezcla, así que la prueba distingue los dos casos
  expect(result.sameLevel).toBeGreaterThan(1000);
  expect(result.nextSameLevel).toBeGreaterThan(1000);
  expect(result.changed).toBe(0);
  expect(result.glError).toBe(0);
  expect(errors).toEqual([]);
});
