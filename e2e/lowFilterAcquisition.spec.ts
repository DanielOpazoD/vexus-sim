import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget, windowAcquired } from './support';

test.use({ trace: { mode: 'retain-on-failure', screenshots: false, snapshots: true, sources: true } });
for (const caseId of ['normal-adult', 'severe-congestion'])
  test(`Color de filtro bajo conserva respuesta al corte en fases idénticas, ${caseId}`, async ({ page }, info) => {
    budget(180_000);
    const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
    if (caseId !== 'normal-adult') await page.selectOption('#case-select', caseId);
    for (const id of ['renal', 'portal'] as const) {
      await page.evaluate((id) => {
        const h = window.__vexusTest!;
        h.sim().frozen = false;
        h.goToStartPoint(id);
      }, id);
      await windowAcquired(page, id);
      const observations = await page.evaluate(() => {
        const s = window.__vexusTest!.sim();
        s.frozen = false;
        s.patient.respiratoryPattern = 'quiet';
        s.equipment = { ...s.equipment, bmode: { ...s.bmode, persistence: 0 }, color: { ...s.color, enabled: true } };
        const rows = [];
        for (let phase = 0; phase < 3; phase++) {
          s.advance(0.6);
          const t = s.sample.t;
          // Control experimental: mismo campo aleatorio para aislar el filtro.
          // Sólo en el ensayo; no cambia reloj, flujo ni ganancia del producto.
          const counter = s.renderer as unknown as { frameCount: number };
          const seedFrame = counter.frameCount;
          const velocity = s.sample.resp.diaphragmVelocityMmS;
          for (const cutoff of [20, 50, 100, 200]) {
            s.equipment = { ...s.equipment, color: { ...s.color, wallFilterHz: cutoff } };
            counter.frameCount = seedFrame;
            s.render({ forceColor: true });
            s.renderer.finishForTiming();
            const { data } = s.renderer.readColorField('raw');
            let tissue = 0,
              blood = 0,
              nt = 0,
              nb = 0,
              nonfinite = 0;
            for (let i = 0; i < data.length; i += 4) {
              if (!Number.isFinite(data[i]) || !Number.isFinite(data[i + 1])) nonfinite++;
              if (data[i + 2] === 0) {
                tissue += data[i + 1];
                nt++;
              }
              if (data[i + 2] > 0.99) {
                blood += data[i + 1];
                nb++;
              }
            }
            rows.push({
              phase,
              cutoff,
              t,
              velocity,
              actualT: s.sample.t,
              tissuePower: tissue / nt,
              bloodPower: blood / Math.max(1, nb),
              nt,
              nb,
              nonfinite,
              image:
                cutoff === 20 || cutoff === 200
                  ? s.renderer.gl.canvas instanceof HTMLCanvasElement
                    ? s.renderer.gl.canvas.toDataURL('image/png')
                    : ''
                  : '',
            });
          }
        }
        s.frozen = true;
        return rows;
      });
      for (const r of observations) {
        if (r.image)
          await info.attach(`${id}-phase${r.phase}-wf${r.cutoff}.png`, {
            body: Buffer.from(r.image.split(',')[1], 'base64'),
            contentType: 'image/png',
          });
        expect(r.actualT).toBe(r.t);
        expect(r.nonfinite).toBe(0);
        expect(r.nt).toBeGreaterThan(100);
        expect(r.nb).toBeGreaterThan(0);
      }
      await info.attach(`${id}-paired-filter.json`, {
        body: JSON.stringify(observations.map(({ image: _image, ...r }) => r)),
        contentType: 'application/json',
      });
      // Contrato causal: misma pose/fase, sólo cambia el corte. El campo aleatorio
      // está fijado por fase; las medias no pretenden calibración clínica.
      const moving = observations.filter((r) => r.cutoff === 20 && Math.abs(r.velocity) > 1 && r.tissuePower > 1e-3);
      expect(moving.length).toBeGreaterThan(0);
      for (const low of moving) {
        const high = observations.find((r) => r.phase === low.phase && r.cutoff === 200)!;
        expect(high.tissuePower).toBeLessThan(low.tissuePower / 2);
        expect(low.bloodPower).toBeGreaterThan(0);
      }
    }
    expect(errors).toEqual([]);
  });
