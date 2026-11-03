import type { CutMapInit, CutMapRequest, CutMapResponse } from '../src/ui/cutMapWorker';
import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { bootWithoutErrors, budget } from './support';
import { startPointsFor } from '../src/app/startPoints';

for (const caseId of ['normal-adult', 'severe-congestion'])
  test(`${caseId}: B adquirido y paridad aórtica en diástole y sístole`, async ({ page }, info) => {
    budget(120_000);
    const errors = await bootWithoutErrors(page, '?e2e=app');
    if (caseId !== 'normal-adult') await page.selectOption('#case-select', caseId);
    await expect.poll(() => page.evaluate(() => window.__vexusTest!.sim().patient.id)).toBe(caseId);
    // Banco offline de lecturas GPU síncronas: cerrar el corte interactivo evita
    // disputar CPU con su Worker. Su integración se valida en renalCutTracking.
    if ((await page.locator('#torso-toggle').getAttribute('aria-pressed')) === 'true') await page.locator('#torso-toggle').click();
    await page.evaluate(() => {
      const s = window.__vexusTest!.sim();
      s.physiology.clock.pause();
      s.patient.respiratoryPattern = 'apnea-expiratory';
      while (s.sample.t < 12) s.physiology.step();
    });
    const poses = await page.evaluate(() => {
      const s = window.__vexusTest!.sim();
      return { torso: s.scene.torso, pose: s.pose };
    });
    const transverse = startPointsFor(poses.torso, { person: 'current' }).find((p) => p.id === 'epigastric')!;
    // Las láminas de imagen y el cine son evidencia en Metal, fuera de CI: en SwiftShader superan los 5 min por caso (decisión 314)
    for (const view of ['transverse'] as const) {
      await page.evaluate(
        ({ transverse }) => {
          const s = window.__vexusTest!.sim();
          s.frozen = false;
          s.setPose({
            ...s.pose,
            phi: transverse.phi,
            z: transverse.z,
            yaw: transverse.yaw,
            rock: transverse.rock ?? 0,
            tilt: transverse.tilt ?? 0,
            lift: 0,
          });
        },
        { transverse },
      );
      const samples = [];
      for (const phase of ['diastole', 'systole'] as const) {
        const measured = await page.evaluate((phase) => {
          const s = window.__vexusTest!.sim();
          s.frozen = false;
          const e = s.physiology;
          // Extremos de un latido completo real; elegir instante NO cambia su amplitud.
          const beats = e.rhythm.beatsBetween(s.sample.t + 0.1, s.sample.t + 3);
          const beat = beats[0];
          const dt = e.clock.dt;
          let targetTime = beat.tR;
          let best = phase === 'systole' ? -Infinity : Infinity;
          for (let t = beat.tR; t < beat.tR + beat.rr; t += dt) {
            let pulse = -0.3;
            for (const b of e.rhythm.beatsAround(t)) {
              const stretch = Math.sqrt(b.rr / 0.8);
              const gauss = (center: number, sigma: number) => Math.exp(-0.5 * ((t - b.tR - center * stretch) / (sigma * stretch)) ** 2);
              pulse += gauss(0.12, 0.06) + 0.4 * gauss(0.3, 0.09);
            }
            if (phase === 'systole' ? pulse > best : pulse < best) {
              best = pulse;
              targetTime = t;
            }
          }
          while (s.sample.t + dt / 2 < targetTime) e.step();
          const target = s.sample;
          const points: number[] = [];
          const aorta = s.scene.vesselById.get('aorta')!;
          for (const [j, n0] of aorta.tube.nodes.slice(0, -1).entries())
            for (let k = 0; k < 24; k++)
              for (const relative of [0.5, 0.98, 1.02, 1.16]) {
                const next = aorta.tube.nodes[j + 1];
                const n = { p: n0.p.map((v, k) => (v + next.p[k]) / 2), r: (n0.r + next.r) / 2 };
                const angle = (2 * Math.PI * k) / 24;
                const m: [number, number, number] = [
                  n.p[0] + Math.cos(angle) * n.r * target.aortaRadiusScale * relative,
                  n.p[1] + Math.sin(angle) * n.r * target.aortaRadiusScale * relative,
                  n.p[2],
                ];
                points.push(...s.anatomy.deformation.toWorld(m, target.resp));
              }
          const packed = new Float32Array(points);
          const gpu = s.gpuQuery(packed, s.frame, true);
          let mismatches = 0,
            compared = 0,
            velocityMaxRel = 0;
          for (let i = 0; i < packed.length / 3; i++) {
            const q = s.anatomy.classifyWorld([packed[3 * i], packed[3 * i + 1], packed[3 * i + 2]], target);
            // Exactitud de identidad; no excluir una discrepancia por estar cerca de la pared.
            const id = gpu.vessel[i] >= 0 ? s.scene.vessels[gpu.vessel[i]].id : null;
            if (Number(q.tissue) !== gpu.tissue[i] || q.vessel !== id) mismatches++;
            if (q.bloodVelocity) {
              compared++;
              const err = Math.hypot(...q.bloodVelocity.map((v, k) => v - gpu.velocity[3 * i + k]));
              velocityMaxRel = Math.max(velocityMaxRel, err / Math.max(1, Math.hypot(...q.bloodVelocity)));
            }
          }
          s.render();
          s.frozen = true;
          s.renderer.cineSeal();
          const f = s.renderer.displayedFrame!;
          const gl = s.renderer.gl;
          const ext = gl.getExtension('WEBGL_debug_renderer_info');
          return {
            phase,
            t: target.t,
            scale: target.aortaRadiusScale,
            ivc: target.ivc,
            pose: s.pose,
            frame: f.anatomy.frame,
            layout: s.renderer.display,
            mismatches,
            compared,
            velocityMaxRel,
            renderer: ext ? (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string) : (gl.getParameter(gl.RENDERER) as string),
          };
        }, phase);
        samples.push(measured);
        writeFileSync(info.outputPath(`${view}-${phase}-parity.json`), JSON.stringify(measured, null, 2));
        expect(measured.mismatches).toBe(0);
        expect(measured.compared).toBeGreaterThan(100);
        expect(measured.velocityMaxRel).toBeLessThan(1e-3);
      }
      writeFileSync(info.outputPath(`${view}-measurements.json`), JSON.stringify(samples, null, 2));
      expect(samples[1].scale - samples[0].scale).toBeGreaterThan(0.079);
      expect(samples[0].pose).toEqual(samples[1].pose);
    }
    expect(errors).toEqual([]);
  });

// El banco GPU de arriba cierra el corte para medir sin competir por CPU.
// Este recorrido conserva el Worker real y comprueba su muestra y máscara aórtica.
declare global {
  interface Window {
    aortaCuts: Array<{ request: CutMapRequest; response?: CutMapResponse }>;
  }
}
for (const caseId of ['normal-adult', 'severe-congestion'])
  test(`${caseId}: el Worker conserva el calibre de la adquisición en ambos extremos`, async ({ page }, info) => {
    budget(90_000);
    await page.addInitScript(() => {
      window.aortaCuts = [];
      const original: unknown = Reflect.get(Worker.prototype, 'postMessage');
      if (typeof original !== 'function') throw new Error('Worker.postMessage ausente');
      Worker.prototype.postMessage = function (message: unknown, transfer: Transferable[] | StructuredSerializeOptions = []) {
        const request = message as CutMapInit | CutMapRequest;
        if (request.type === 'init')
          this.addEventListener('message', (event: MessageEvent<CutMapResponse>) => {
            if (event.data.type !== 'map') return;
            const row = window.aortaCuts.find((r) => r.request.id === event.data.id);
            if (row) row.response = event.data;
          });
        if (request.type === 'map') window.aortaCuts.push({ request: structuredClone(request) });
        Reflect.apply(original, this, [message, transfer]);
      };
    });
    const errors = await bootWithoutErrors(page, '?e2e=app');
    if (caseId !== 'normal-adult') await page.selectOption('#case-select', caseId);
    await expect.poll(() => page.evaluate(() => window.__vexusTest!.sim().patient.id)).toBe(caseId);
    const torso = await page.evaluate(() => window.__vexusTest!.sim().scene.torso);
    const pose = startPointsFor(torso, { person: 'current' }).find((p) => p.id === 'epigastric')!;
    const results = [];
    for (const systole of [false, true]) {
      const frame = await page.evaluate(
        ({ pose, systole }) => {
          const s = window.__vexusTest!.sim();
          s.physiology.clock.pause();
          s.patient.respiratoryPattern = 'apnea-expiratory';
          while (s.sample.t < 12) s.physiology.step();
          s.setPose({ ...s.pose, phi: pose.phi, z: pose.z, yaw: pose.yaw, rock: pose.rock ?? 0, tilt: pose.tilt ?? 0, lift: 0 });
          const b = s.physiology.rhythm.beatsBetween(s.sample.t + 0.3, s.sample.t + 3)[0];
          const at = systole ? b.tR + 0.1247 * Math.sqrt(b.rr / 0.8) : b.tR - 0.25;
          while (s.sample.t < at) s.physiology.step();
          s.frozen = false;
          s.render();
          s.frozen = true;
          return s.renderer.displayedFrame!.n;
        },
        { pose, systole },
      );
      await expect.poll(() => page.locator('#cutmap').getAttribute('data-acquired-frame')).toBe(String(frame));
      const result = await page.evaluate(() => {
        const s = window.__vexusTest!.sim();
        const sample = s.renderer.displayedFrame!.anatomy.sample;
        const row = window.aortaCuts
          .slice()
          .reverse()
          .find((r) => r.response && r.request.sample.aortaRadiusScale === sample.aortaRadiusScale);
        if (!row?.response) throw new Error('Worker sin muestra adquirida');
        const { request: q, response: r } = row;
        let mismatches = 0,
          aortaCells = 0;
        const ai = s.scene.vessels.findIndex((v) => v.id === 'aorta');
        for (let i = 0; i < q.width * q.height; i += 3) {
          const x = i % q.width,
            y = Math.floor(i / q.width);
          const theta = -q.transducer.halfSector + (2 * q.transducer.halfSector * (x + 0.5)) / q.width;
          const range = q.transducer.curvatureRadius + (q.depthMm * (y + 0.5)) / q.height;
          const direction = q.frame.axial.map((v, k) => v * Math.cos(theta) + q.frame.lateral[k] * Math.sin(theta));
          const inverseLength = 1 / Math.hypot(...direction);
          const p = q.frame.curvatureCenter.map((v, k) => v + direction[k] * inverseLength * range) as [number, number, number];
          const expected = s.anatomy.classifyWorld(p, sample).vessel === 'aorta';
          const actual = r.vessel[i] === ai;
          if (expected !== actual) mismatches++;
          if (actual) aortaCells++;
        }
        return { t: sample.t, scale: sample.aortaRadiusScale, workerScale: q.sample.aortaRadiusScale, mismatches, aortaCells };
      });
      expect(result.workerScale).toBe(result.scale);
      expect(result.mismatches).toBe(0);
      expect(result.aortaCells).toBeGreaterThan(10);
      results.push(result);
    }
    expect(results[1].aortaCells).toBeGreaterThan(results[0].aortaCells);
    writeFileSync(info.outputPath('worker-aorta.json'), JSON.stringify(results, null, 2));
    expect(errors).toEqual([]);
  });
