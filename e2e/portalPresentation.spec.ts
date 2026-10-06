import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { bootWithoutErrors, budget } from './support';

for (const reference of [false, true, 'atlas'] as const)
  for (const severe of [false, true]) {
    test(`porta: tarjeta real, rojo y sensibilidad, reference=${reference}, severe=${severe}`, async ({ page }, info) => {
      // 33 full production renders plus UI/boot: the reference body took >6 min
      // on SwiftShader. Preserve every frame/assertion; allow 6 min work + BOOT.
      budget(360_000);
      const errors = await bootWithoutErrors(
        page,
        `?e2e=app&abdomen=${reference === 'atlas' ? 'atlas' : 'legacy'}${reference === true ? '&reference=1' : ''}`,
      );
      if (severe) await page.selectOption('#case-select', 'severe-congestion');
      await page.locator('.win-card').filter({ hasText: 'Porta · intrahepática' }).click();
      await page.waitForFunction(
        () => {
          const p = window.__vexusTest!.sim().pose;
          return (
            Math.abs(p.phi - (window.__vexusTest!.sim().scene.hasAbdominalAtlas ? 3.25 : 3.5)) < 0.0001 &&
            Math.abs(
              p.z - (window.__vexusTest!.sim().scene.hasAbdominalAtlas ? -65 : window.__vexusTest!.sim().scene.torso.profile ? -60 : -90),
            ) < 0.01
          );
        },
        undefined,
        { timeout: 90_000 },
      );
      const bmode = await page.evaluate(() => {
        const s = window.__vexusTest!.sim();
        s.advance(s.physiology.clock.dt);
        s.advance(s.physiology.clock.dt);
        while (s.physiology.clock.t < 30) s.physiology.step();
        for (let i = 0; i < 6; i++) s.render();
        document.querySelector<HTMLButtonElement>('#freeze')!.click();
        return s.bmode;
      });
      await page.screenshot({ path: info.outputPath('portal-bmode.png') });
      await page.locator('#freeze').click();
      await page.locator('#mode-color').click();
      const report = await page.evaluate(() => {
        const s = window.__vexusTest!.sim(),
          saved = { ...s.color };
        const point = (theta: number, r: number): [number, number, number] => {
          const dir = s.frame.axial.map((v, i) => v * Math.cos(theta) + s.frame.lateral[i] * Math.sin(theta));
          return s.frame.curvatureCenter.map((v, i) => v + (s.transducer.curvatureRadius + r) * dir[i]) as [number, number, number];
        };
        const mask = new Uint8Array(96 * 160);
        for (let y = 0; y < 160; y++)
          for (let x = 0; x < 96; x++) {
            const theta = s.color.theta0 + ((x + 0.5) / 96) * (s.color.theta1 - s.color.theta0),
              r = s.color.r0 + ((y + 0.5) / 160) * (s.color.r1 - s.color.r0);
            mask[y * 96 + x] = Number(s.anatomy.classifyWorld(point(theta, r), s.sample).vessel === 'pvRight');
          }
        const counts = () => {
          const f = s.renderer.readColorField();
          let blood = 0,
            filled = 0,
            positive = 0,
            negative = 0;
          for (let k = 0; k < f.data.length; k += 4)
            if (mask[k / 4] && f.data[k + 2] >= 0.8) {
              blood++;
              if (f.data[k + 1] > 0.0035) {
                filled++;
                if (f.data[k] > 0) positive++;
                else negative++;
              }
            }
          return { blood, filled, positive, negative };
        };
        const series = (gainDb: number) => {
          s.equipment = { ...s.equipment, color: { ...saved, gainDb } };
          const frames = [];
          for (let i = 0; i < 8; i++) {
            s.render({ forceColor: true });
            frames.push(counts());
          }
          return frames;
        };
        const before = series(0),
          after = series(saved.gainDb);
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
            color: { ...saved, invert },
            updateColor: false,
            seed: s.patient.seed,
          });
          const gl = s.renderer.gl,
            c = s.renderer.canvas,
            rgba = new Uint8Array(c.width * c.height * 4);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
          let red = 0,
            blue = 0,
            yellow = 0;
          for (let k = 0; k < rgba.length; k += 4) {
            if (rgba[k] > 80 && rgba[k] > 3 * rgba[k + 1] && rgba[k] > 3 * rgba[k + 2]) red++;
            if (rgba[k + 2] > 80 && rgba[k + 2] > 3 * rgba[k] && rgba[k + 2] > 3 * rgba[k + 1]) blue++;
            if (rgba[k] > 80 && rgba[k + 1] > 0.6 * rgba[k] && rgba[k + 2] < 0.5 * rgba[k]) yellow++;
          }
          return { red, blue, yellow };
        };
        const direct = present(false),
          field = s.renderer.readColorField().data,
          inverted = present(true);
        const field2 = s.renderer.readColorField().data;
        let inversionError = 0;
        for (let k = 0; k < field.length; k++) inversionError = Math.max(inversionError, Math.abs(field[k] - field2[k]));
        s.equipment = { ...s.equipment, color: { ...saved, theta0: -0.25, theta1: -0.12, r0: 35, r1: 50 } };
        let emptyBlood = 0,
          emptyAbove = 0;
        for (let i = 0; i < 4; i++) {
          s.render({ forceColor: true });
          const f = s.renderer.readColorField().data;
          for (let k = 0; k < f.length; k += 4) {
            if (f[k + 2] > 0) emptyBlood++;
            if (f[k + 1] > 0.0035) emptyAbove++;
          }
        }
        s.equipment = { ...s.equipment, color: { ...saved, wallFilterHz: 600 } };
        s.render({ forceColor: true });
        const highFilter = counts();
        s.equipment = { ...s.equipment, color: saved };
        for (let i = 0; i < 6; i++) s.render({ forceColor: true });
        document.querySelector<HTMLButtonElement>('#freeze')!.click();
        return {
          settings: saved,
          caseId: s.patient.id,
          time: s.sample.t,
          before,
          after,
          direct,
          inverted,
          inversionError,
          emptyBlood,
          emptyAbove,
          highFilter,
        };
      });
      const tag = JSON.stringify(report);
      expect(bmode.depthMm).toBe(reference === 'atlas' ? 130 : 150);
      expect(report.settings.gainDb).toBe(12);
      expect(
        report.after.every((f) => f.blood > 100),
        tag,
      ).toBe(true);
      const mean = (frames: typeof report.after) => frames.reduce((sum, f) => sum + f.filled / f.blood, 0) / frames.length;
      expect(mean(report.after), tag).toBeGreaterThan(mean(report.before));
      if (!severe) expect(mean(report.after), tag).toBeGreaterThan(0.75);
      expect(report.direct.red, tag).toBeGreaterThan(100);
      expect(report.direct.yellow, tag).toBe(0);
      expect(report.inverted.blue, tag).toBeGreaterThan(report.direct.blue);
      expect(report.inversionError, tag).toBe(0);
      expect(report.emptyBlood, tag).toBe(0);
      expect(report.emptyAbove, tag).toBe(0);
      expect(report.highFilter.filled, tag).toBeLessThan(report.after[0].filled);
      writeFileSync(info.outputPath('portal-presentation.json'), JSON.stringify({ bmode, ...report }, null, 2) + '\n');
      await page.screenshot({ path: info.outputPath('portal-color.png') });
      expect(errors).toEqual([]);
    });
  }
