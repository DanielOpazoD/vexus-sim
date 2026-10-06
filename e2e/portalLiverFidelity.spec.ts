import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { bootWithoutErrors, budget } from './support';

for (const reference of [false, true]) {
  test(`porta hepática: correlación compleja GPU y señal, reference=${reference}`, async ({ page }, info) => {
    budget(180_000);
    const errors = await bootWithoutErrors(page, `?e2e=app${reference ? '&reference=1' : ''}`);
    const report = await page.evaluate(() => {
      const T = window.__vexusTest!,
        s = T.sim();
      const freeze = document.querySelector<HTMLButtonElement>('#freeze')!;
      freeze.click();
      s.patient.respiratoryPattern = 'apnea-expiratory';
      freeze.click();
      T.goToStartPoint('portal');
      s.advance(s.physiology.clock.dt);
      while (s.physiology.clock.t < 30) s.physiology.step();
      document.querySelector<HTMLButtonElement>('#mode-color')!.click();
      const found = T.colorOnVessel(['pvRight']);
      // Fixture de equipo dentro de sus límites: ±35 cm/s, como una escala útil para flujo portal normal.
      s.equipment = { ...s.equipment, color: { ...s.color, prfHz: (4 * s.transducer.f0Doppler * 350) / 1_540_000, gainDb: 8 } };
      s.render({ forceColor: true });
      const raw = s.renderer.readColorField('raw'),
        filtered = s.renderer.readColorField();
      const W = raw.width,
        H = raw.height,
        prf = s.color.prfHz;
      const nLines = Math.max(4, Math.ceil((s.color.theta1 - s.color.theta0) / s.profile.colorLineSpacingRad));
      // Oráculo numérico independiente: reconstruye fasores y calcula interpolación bilineal + kernel,
      // sin importar el shader ni su función CPU de producción.
      function phasor(x: number, y: number): [number, number] {
        const k = 4 * (Math.max(0, Math.min(H - 1, y)) * W + Math.max(0, Math.min(W - 1, x)));
        const phase = (raw.data[k] * 2 * Math.PI) / prf;
        return [raw.data[k + 1] * Math.cos(phase), raw.data[k + 1] * Math.sin(phase)];
      }
      function interpolate(x: number, y: number): [number, number] {
        const ix = Math.floor(x),
          iy = Math.floor(y),
          a = x - ix,
          b = y - iy;
        const out: [number, number] = [0, 0];
        for (let dy = 0; dy < 2; dy++)
          for (let dx = 0; dx < 2; dx++) {
            const p = phasor(ix + dx, iy + dy),
              w = (dx ? a : 1 - a) * (dy ? b : 1 - b);
            out[0] += w * p[0];
            out[1] += w * p[1];
          }
        return out;
      }
      let errorMax = 0,
        fractionErrorMax = 0,
        sampled = 0;
      for (let y = 0; y < H; y += 3)
        for (let x = 0; x < W; x += 3) {
          let re = 0,
            im = 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const p = interpolate(x + (dx * W) / nLines, y + (dy * H) / (s.color.r1 - s.color.r0));
              const w = ((dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1)) / 16;
              re += w * p[0];
              im += w * p[1];
            }
          const k = 4 * (y * W + x),
            angle = (filtered.data[k] * 2 * Math.PI) / prf;
          errorMax = Math.max(
            errorMax,
            Math.hypot(re - filtered.data[k + 1] * Math.cos(angle), im - filtered.data[k + 1] * Math.sin(angle)),
          );
          fractionErrorMax = Math.max(fractionErrorMax, Math.abs(raw.data[k + 2] - filtered.data[k + 2]));
          sampled++;
        }
      // ROI de evaluación: rama derecha real en el centro de cada celda; la caja puede incluir otras venas.
      // Esta selección solo mide el resultado; no interviene en el shader ni pinta el vaso.
      const portal = new Uint8Array(W * H);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const theta = s.color.theta0 + ((x + 0.5) / W) * (s.color.theta1 - s.color.theta0);
          const r = s.color.r0 + ((y + 0.5) / H) * (s.color.r1 - s.color.r0);
          const frame = s.frame;
          const dir = frame.axial.map((v, i) => v * Math.cos(theta) + frame.lateral[i] * Math.sin(theta));
          const p = frame.curvatureCenter.map((v, i) => v + (s.transducer.curvatureRadius + r) * dir[i]);
          portal[y * W + x] = Number(s.anatomy.classifyWorld(p as [number, number, number], s.sample).vessel === 'pvRight');
        }
      const counts = (data: Float32Array) => {
        let blood = 0,
          filled = 0,
          positive = 0,
          negative = 0;
        for (let k = 0; k < data.length; k += 4)
          if (portal[k / 4] && data[k + 2] >= 0.8) {
            blood++;
            if (data[k + 1] > 0.0035) {
              filled++;
              if (data[k] > 0) positive++;
              else negative++;
            }
          }
        return { blood, filled, positive, negative };
      };
      const signal = { raw: counts(raw.data), filtered: counts(filtered.data) };
      const present = (invert: boolean) => {
        s.renderer.render({
          sample: s.sample,
          frame: s.frame,
          pose: s.pose,
          compression: s.contact,
          transducer: s.transducer,
          caliber: s.anatomy.caliberFor(s.sample),
          probeVelocity: [0, 0, 0],
          bmode: { ...s.bmode, persistence: 0 },
          color: { ...s.color, invert },
          updateColor: false,
          seed: s.patient.seed,
        });
        const gl = s.renderer.gl,
          canvas = s.renderer.canvas;
        const rgba = new Uint8Array(canvas.width * canvas.height * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
        let red = 0,
          blue = 0;
        for (let k = 0; k < rgba.length; k += 4) {
          if (rgba[k] > 50 && rgba[k] > rgba[k + 2] + 40) red++;
          if (rgba[k + 2] > 50 && rgba[k + 2] > rgba[k] + 40) blue++;
        }
        return { red, blue };
      };
      const displayed = { direct: present(false), inverted: present(true) };
      const afterInvert = s.renderer.readColorField();
      let inversionFieldError = 0;
      for (let k = 0; k < filtered.data.length; k++)
        inversionFieldError = Math.max(inversionFieldError, Math.abs(filtered.data[k] - afterInvert.data[k]));
      present(false);
      const healthyColor = { ...s.color };
      s.equipment = { ...s.equipment, color: { ...healthyColor, prfHz: 700 } };
      s.render({ forceColor: true });
      const lowScale = counts(s.renderer.readColorField().data);
      s.equipment = { ...s.equipment, color: { ...healthyColor, wallFilterHz: 600 } };
      s.render({ forceColor: true });
      const highFilter = counts(s.renderer.readColorField().data);
      s.equipment = { ...s.equipment, color: healthyColor };
      s.render({ forceColor: true });
      freeze.click();
      return {
        found,
        settings: s.color,
        t: s.sample.t,
        errorMax,
        fractionErrorMax,
        sampled,
        signal,
        displayed,
        inversionFieldError,
        lowScale,
        highFilter,
      };
    });
    const reportPath = info.outputPath('portal-color-oracle.json');
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    await info.attach('portal-color-oracle.json', { path: reportPath, contentType: 'application/json' });
    const tag = JSON.stringify(report);
    expect(report.found, tag).not.toBeNull();
    expect(report.sampled).toBeGreaterThan(1000);
    expect(report.errorMax, tag).toBeLessThan(0.00001);
    expect(report.fractionErrorMax, tag).toBe(0);
    expect(report.signal.filtered.blood, tag).toBeGreaterThan(100);
    expect(report.signal.filtered.filled / report.signal.filtered.blood, tag).toBeGreaterThan(0.5);
    expect(report.signal.filtered.positive, tag).toBeGreaterThan(report.signal.filtered.negative);
    expect(report.displayed.direct.red, tag).toBeGreaterThan(100);
    expect(report.displayed.inverted.blue, tag).toBeGreaterThan(report.displayed.direct.blue);
    expect(report.displayed.inverted.red, tag).toBeLessThan(report.displayed.direct.red);
    expect(report.inversionFieldError, tag).toBe(0);
    expect(report.lowScale.negative, tag).toBeGreaterThan(report.signal.filtered.negative);
    expect(report.highFilter.filled, tag).toBeLessThan(report.signal.filtered.filled / 2);
    await page.screenshot({ path: info.outputPath('portal-35cms.png') });
    expect(errors).toEqual([]);
  });
}
