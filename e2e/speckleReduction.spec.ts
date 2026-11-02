import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget } from './support';
import { Tissue } from '../src/anatomy/tissues';
import { detailMetrics, detailWitnesses, type SpeckleInternals } from './speckleProbe';
import { GREY_CURVE } from '../src/ultrasound/greyMap';

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

test('conserva bordes, luces de 3 mm y líneas pos-PSF en las tres fases nativas por G', async ({ page }, info) => {
  budget(180000);
  await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
  await page.locator('#freeze').click();
  const result = await page.evaluate(detailWitnesses);
  const metrics = detailMetrics(result);
  await info.attach('detail-witnesses.json', { body: JSON.stringify({ ...result, metrics }), contentType: 'application/json' });
  expect(result.size).toEqual([192, 1024]);
  expect(result.greyCurve).toBe(GREY_CURVE);
  const grays = result.rows.flatMap((f) => f.levels.flatMap((l) => l.profile.map((q) => q.gray)));
  expect(Math.min(...grays)).toBeGreaterThan(0);
  expect(Math.max(...grays)).toBeLessThan(255);
  expect(result.glError).toBe(0);
  // Guardas del banco, por nivel (decisión 313): el propietario aprobó perder este detalle a cambio de un filtro visible; no puede empeorar sin que se note.
  const guards = { 1: { edge: 0.22, contrast: 0.95, peak: 0.88 }, 2: { edge: 0.41, contrast: 0.9, peak: 0.79 } } as const;
  for (const m of metrics) {
    const g = guards[m.level as 1 | 2];
    expect.soft(m.edgeDeltaMaxMm, `nivel ${m.level}: ancho 10–90 en dB`).toBeLessThanOrEqual(g.edge);
    expect.soft(m.contrastMin, `nivel ${m.level}: contraste vaso`).toBeGreaterThanOrEqual(g.contrast);
    expect.soft(m.peakMin, `nivel ${m.level}: exceso de pico sobre fondo`).toBeGreaterThanOrEqual(g.peak);
  }
});

test('el mando suspendido no reinicia Color, y activar o suspender R sí descarta la historia incompatible', async ({ page }, info) => {
  budget(180000);
  await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
  await page.locator('#freeze').click();
  const result = await page.evaluate(() => {
    const s = window.__vexusTest!.sim(),
      r = s.renderer;
    const p = r as unknown as SpeckleInternals;
    const gl = r.gl;
    const rgba = () => {
      const t = p.tPersist[p.persistIndex],
        a = new Uint8Array(t.width * t.height * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.readPixels(0, 0, t.width, t.height, gl.RGBA, gl.UNSIGNED_BYTE, a);
      return a;
    };
    const changed = (a: ArrayLike<number>, b: ArrayLike<number>) => Array.from(a).reduce((n, v, i) => n + Number(v !== b[i]), 0);
    const env = r.readEnvelope({ source: 'compound' }).data.slice();
    const color = new Float32Array(p.tColor.width * p.tColor.height * 4);
    const upload = (sign: number) => {
      for (let i = 0; i < color.length; i += 4) {
        color[i] = 1e4;
        color[i + 1] = sign * 2e4;
      }
      gl.bindTexture(gl.TEXTURE_2D, p.tColor.textures[0]);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, p.tColor.width, p.tColor.height, gl.RGBA, gl.FLOAT, color);
    };
    const cf = {
      box: [-s.transducer.halfSector, s.transducer.halfSector, 0, s.bmode.depthMm] as [number, number, number, number],
      prf: s.color.prfHz,
    };
    const colorB = { ...s.bmode, persistence: 0.8, speckleReduction: 1 as const },
      colorC = { ...s.color, enabled: true };
    const histories: Uint8Array[] = [];
    for (const level of [1, 2] as const) {
      upload(1);
      p.scanConvert(colorB, colorC, cf, s.transducer);
      p.persistSpeckle = -1;
      p.passPersistence({ bmode: colorB, color: colorC });
      upload(-1);
      const b = { ...colorB, speckleReduction: level };
      p.scanConvert(b, colorC, cf, s.transducer);
      p.passPersistence({ bmode: b, color: colorC });
      histories.push(rgba());
    }
    const coloredPixels = Array.from({ length: histories[0].length / 4 }, (_, i) => i * 4).filter(
      (i) => histories[0][i] !== histories[0][i + 1] || histories[0][i + 1] !== histories[0][i + 2],
    ).length;
    const show = (enabled: boolean) => {
      const b = { ...s.bmode, persistence: 0.8, speckleReduction: 2 as const },
        c = { ...s.color, enabled };
      p.speckleReduction(b, c, s.transducer);
      p.scanConvert(b, c, enabled ? cf : null, s.transducer);
      p.present(p.tScan);
      const current = r.readDisplay().gray.slice();
      p.passPersistence({ bmode: b, color: c });
      p.present(p.tPersist[p.persistIndex]);
      return changed(current, r.readDisplay().gray);
    };
    p.persistSpeckle = -1;
    show(false);
    const colorOn = show(true),
      colorOff = show(false);
    return {
      inactiveColorLevelChangeBytes: changed(histories[0], histories[1]),
      coloredPixels,
      colorOn,
      colorOff,
      envelopeChanges: changed(env, r.readEnvelope({ source: 'compound' }).data),
      glError: gl.getError(),
    };
  });
  await info.attach('color-history.json', { body: JSON.stringify(result), contentType: 'application/json' });
  // Control positivo: Color no vacío, misma pareja anterior/actual y envolvente fija que en la reproducción de 527.661 bytes.
  expect(result.coloredPixels).toBeGreaterThan(1000);
  expect.soft(result.inactiveColorLevelChangeBytes).toBe(0);
  expect.soft(result.colorOn).toBe(0);
  expect.soft(result.colorOff).toBe(0);
  expect(result.envelopeChanges).toBe(0);
  expect(result.glError).toBe(0);
});

test('el cine conserva el reinicio 0→2→0 dentro de 20 ms al congelar y redimensionar', async ({ page }, info) => {
  budget(180000);
  await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
  await page.locator('[data-window="intercostal"]').click();
  await page.locator('#freeze').click();
  const result = await page.evaluate(() => {
    const s = window.__vexusTest!.sim(),
      r = s.renderer;
    const p = r as unknown as SpeckleInternals;
    const delta = (a: Uint8Array, b: Uint8Array) => {
      let sum = 0,
        max = 0,
        changed = 0;
      for (let i = 0; i < a.length; i++) {
        const d = Math.abs(a[i] - b[i]);
        sum += d * d;
        max = Math.max(max, d);
        changed += Number(d !== 0);
      }
      return { changed, rms: Math.sqrt(sum / a.length), max };
    };
    s.equipment = {
      ...s.equipment,
      bmode: { ...s.bmode, persistence: 0.8, compound: false, speckleReduction: 0 },
      color: { ...s.color, enabled: false },
    };
    s.frozen = false;
    r.setScene(s.scene);
    s.render();
    r.cineSeal();
    for (const level of [2, 0] as const) {
      s.equipment = { ...s.equipment, bmode: { ...s.bmode, speckleReduction: level } };
      s.advance(0.01);
      s.render();
    }
    r.cineSeal();
    s.frozen = true;
    const frames = Array.from({ length: r.cineCount }, (_, i) => ({
      level: r.cineFrame(i).bmode.speckleReduction,
      n: r.cineFrame(i).n,
      t: r.cineFrame(i).t,
    }));
    const last = r.cineFrame(r.cineCount - 1),
      live = r.readDisplay().gray.slice();
    p.scanConvert(last.bmode, last.color, last.colorFrame, s.transducer);
    p.present(p.tScan);
    const liveVsCurrent = delta(live, r.readDisplay().gray);
    r.canvas.width += 1;
    r.showCine(r.cineCount - 1);
    const replay = r.readDisplay().gray.slice();
    p.scanConvert(last.bmode, last.color, last.colorFrame, s.transducer);
    p.present(p.tScan);
    return { frames, liveVsCurrent, replayVsCurrent: delta(replay, r.readDisplay().gray), glError: r.gl.getError() };
  });
  await info.attach('cine-reset.json', { body: JSON.stringify(result), contentType: 'application/json' });
  expect(result.frames.map((f) => f.level)).toEqual([0, 0]);
  expect(result.frames[1].n - result.frames[0].n).toBe(2);
  expect(result.frames[1].t - result.frames[0].t).toBeCloseTo(0.02, 8);
  expect(result.liveVsCurrent.max).toBe(0);
  // La copia R16F del cine admite un gris de cuantización, no historia previa al reinicio.
  expect(result.replayVsCurrent.max).toBeLessThanOrEqual(1);
  expect(result.glError).toBe(0);
});

test('RM identifica la imagen adquirida en vivo, congelada y en cine con el control real', async ({ page }) => {
  budget(180000);
  await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
  const setLevel = async (level: number) =>
    page.getByLabel('Reducción de moteado', { exact: true }).evaluate((el, value) => {
      if (!(el instanceof HTMLInputElement)) throw new Error('control de moteado no es input');
      el.value = String(value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, level);
  const hud = page.locator('#hud-tr');
  await expect(hud).toContainText('RM 1');
  await page.locator('#freeze').click();
  await setLevel(2);
  expect(await page.evaluate(() => window.__vexusTest!.sim().displayed.bmode.speckleReduction)).toBe(1);
  await expect(hud).toContainText('RM 1');
  await page.locator('#freeze').click();
  await page.waitForFunction(() => window.__vexusTest!.sim().displayed.bmode.speckleReduction === 2);
  await expect(hud).toContainText('RM 2');
  await page.locator('#freeze').click();
  await setLevel(0);
  await expect(hud).toContainText('RM 2');
  await page.locator('#cine').evaluate((el) => {
    if (!(el instanceof HTMLInputElement)) throw new Error('cine no es input');
    el.value = '0';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(hud).toContainText('RM 1');
  await page.locator('#cine').press('End');
  await expect(hud).toContainText('RM 2');
  await page.locator('#freeze').click();
  await page.waitForFunction(() => window.__vexusTest!.sim().displayed.bmode.speckleReduction === 0);
  await expect(hud).not.toContainText('RM ');
});
