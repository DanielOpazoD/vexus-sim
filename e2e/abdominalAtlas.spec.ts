import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { ABDOMINAL_ATLAS, ABDOMINAL_FIELDS } from '../src/anatomy/abdominalAtlasData';
import { bootWithoutErrors, budget } from './support';

const raw = gunzipSync(readFileSync('src/anatomy/abdominal-atlas.gzip.bin'));
const half = new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
const [width, height] = ABDOMINAL_ATLAS.textureDimensions;
const decode = (bits: number) => {
  const exponent = (bits >>> 10) & 31;
  return (bits & 0x8000 ? -1 : 1) * (exponent === 0 ? (bits & 1023) * 2 ** -24 : (1 + (bits & 1023) / 1024) * 2 ** (exponent - 15));
};
const points: Array<{ field: number; p: [number, number, number] }> = [];
for (const [field, f] of ABDOMINAL_FIELDS.entries()) {
  let found = 0;
  for (let z = 0; z < f.dimensions[2] && found < 100; z += 3)
    for (let y = 0; y < f.dimensions[1] && found < 100; y += 3)
      for (let x = 0; x < f.dimensions[0] && found < 100; x += 3) {
        const index = 2 * ((z + f.offset[2]) * width * height + (y + f.offset[1]) * width + x + f.offset[0]);
        if (decode(half[index]) < -1.5) {
          points.push({ field, p: f.originMm.map((v, i) => v + [x, y, z][i] * 1.5) as [number, number, number] });
          found++;
        }
      }
}
for (const caseId of ['normal-adult', 'severe-congestion'])
  test(`abdomen de producción: todos los campos y velocidades CPU/GPU (${caseId})`, async ({ page }, info) => {
    budget(180_000);
    const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
    if (caseId !== 'normal-adult') await page.selectOption('#case-select', caseId);
    await page.locator('#freeze').click();
    const result = await page.evaluate((points) => {
      const s = window.__vexusTest!.sim(),
        flat = new Float32Array(points.flatMap((p) => p.p)),
        gpu = s.gpuQuery(flat, s.frame, true, { normals: true });
      let interior = 0,
        matches = 0,
        blood = 0,
        velocityWorst = 0;
      const fields = new Set<number>();
      const mismatches = [];
      for (let i = 0; i < points.length; i++) {
        const c = s.anatomy.classifyWorld(points[i].p, s.sample);
        if (c.boundaryDistance < 1) continue;
        interior++;
        fields.add(points[i].field);
        if (Number(c.tissue) === gpu.tissue[i]) matches++;
        else mismatches.push({ field: points[i].field, p: points[i].p, cpu: c.tissue, gpu: gpu.tissue[i] });
        if (c.bloodVelocity) {
          blood++;
          const v = c.bloodVelocity;
          velocityWorst = Math.max(velocityWorst, Math.hypot(...v.map((value, k) => value - gpu.velocity[3 * i + k])));
        }
      }
      // Held-out internal segment crack reported in the hepatic image. The old
      // source classified this node as exterior; both live classifiers must now
      // see parenchyma, without manufacturing an internal capsule reflection.
      const seamWorld = s.anatomy.deformation.toWorld([-67.5, -7.5, -34.5], s.sample.resp),
        seamCpu = s.anatomy.classifyWorld(seamWorld, s.sample),
        seamGpu = s.gpuQuery(new Float32Array(seamWorld), s.frame, true);
      const seam = {
        cpuTissue: seamCpu.tissue,
        gpuTissue: seamGpu.tissue[0],
        cpuInterfaceDistance: seamCpu.interfaceDistance,
        gpuInterfaceDistance: seamGpu.ifd[0],
      };
      return { atlas: s.scene.hasAbdominalAtlas, interior, matches, fields: [...fields], blood, velocityWorst, mismatches, seam };
    }, points);
    expect(result.atlas).toBe(true);
    expect(result.interior).toBeGreaterThan(500);
    expect(result.matches, JSON.stringify(result.mismatches)).toBe(result.interior);
    expect(result.fields.length).toBe(11);
    expect(result.velocityWorst).toBeLessThan(0.1);
    expect(result.seam.cpuTissue).toBe(4);
    expect(result.seam.gpuTissue).toBe(4);
    expect(result.seam.cpuInterfaceDistance).toBeGreaterThan(5);
    expect(result.seam.gpuInterfaceDistance).toBeGreaterThan(5);
    await page.screenshot({ path: info.outputPath('abdomen.png') });
    expect(errors).toEqual([]);
  });

// Offline acquisition poses, not hidden runtime steering. These slices exercise the new
// organs in the displayed image, in addition to the fixed whole-body parity bank above.
const organSlices = [
  {
    name: 'pancreas',
    tissue: 33,
    minimum: 80,
    pose: { phi: 1.57, z: -115, yaw: -1.5623784237291105, rock: 0.11865969197238625, tilt: -0.10030899383127126 },
  },
  {
    name: 'bladder',
    tissue: 38,
    minimum: 40,
    pose: { phi: 1.57, z: -354, yaw: -1.5769413305756639, rock: -0.018567853452892264, tilt: -0.313584243124829 },
  },
  {
    name: 'spleen',
    tissue: 34,
    minimum: 200,
    pose: { phi: -0.2, z: -80, yaw: -0.011254326337428964, rock: -0.1632081147344193, tilt: 0.1363193396656802 },
  },
];
for (const slice of organSlices)
  test(`abdomen displayed acquisition: ${slice.name}`, async ({ page }, info) => {
    budget(120_000);
    const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
    const frame = await page.evaluate((pose) => {
      const t = window.__vexusTest!;
      t.setPose({ ...pose, lift: 0 });
      return t.framesRendered();
    }, slice.pose);
    await page.waitForFunction((frame) => window.__vexusTest!.framesRendered() >= frame + 4, frame, { timeout: 120_000 });
    await page.locator('#freeze').click();
    const result = await page.evaluate((target) => {
      const s = window.__vexusTest!.sim(),
        flat: number[] = [],
        tissues: Record<number, number> = {};
      for (let y = 0; y < 96; y++)
        for (let x = 0; x < 64; x++) {
          const theta = (((x + 0.5) / 64) * 2 - 1) * s.transducer.halfSector;
          const r = ((y + 0.5) / 96) * s.bmode.depthMm;
          const d = s.frame.axial.map((v, i) => v * Math.cos(theta) + s.frame.lateral[i] * Math.sin(theta));
          flat.push(...s.frame.curvatureCenter.map((v, i) => v + (s.transducer.curvatureRadius + r) * d[i]));
        }
      const gpu = s.gpuQuery(new Float32Array(flat), s.frame, true);
      let matches = 0,
        tested = 0,
        hollowFlow = 0;
      for (let i = 0; i < gpu.tissue.length; i++) {
        tissues[gpu.tissue[i]] = (tissues[gpu.tissue[i]] ?? 0) + 1;
        const p = flat.slice(3 * i, 3 * i + 3) as [number, number, number];
        const c = s.anatomy.classifyWorld(p, s.sample);
        if (c.boundaryDistance >= 1) {
          tested++;
          matches += Number(Number(c.tissue) === gpu.tissue[i]);
        }
        if ([13, 14, 35, 36, 37, 38].includes(c.tissue)) hollowFlow += Number(c.bloodVelocity !== null);
      }
      return { pose: s.pose, face: s.frame.face, target: tissues[target] ?? 0, tissues, tested, matches, hollowFlow };
    }, slice.tissue);
    expect(result.target, JSON.stringify(result)).toBeGreaterThan(slice.minimum);
    expect(result.tested).toBeGreaterThan(1000);
    expect(result.matches).toBe(result.tested);
    expect(result.hollowFlow).toBe(0);
    if (slice.name === 'bladder') expect(result.tissues[14]).toBeGreaterThan(200);
    await page.screenshot({ path: info.outputPath(`${slice.name}.png`) });
    expect(errors).toEqual([]);
  });
