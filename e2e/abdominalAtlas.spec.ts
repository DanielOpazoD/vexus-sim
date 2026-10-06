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
        if (c.tissue === gpu.tissue[i]) matches++;
        else mismatches.push({ field: points[i].field, p: points[i].p, cpu: c.tissue, gpu: gpu.tissue[i] });
        if (c.bloodVelocity) {
          blood++;
          const v = c.bloodVelocity;
          velocityWorst = Math.max(velocityWorst, Math.hypot(...v.map((value, k) => value - gpu.velocity[3 * i + k])));
        }
      }
      return { atlas: s.scene.hasAbdominalAtlas, interior, matches, fields: [...fields], blood, velocityWorst, mismatches };
    }, points);
    expect(result.atlas).toBe(true);
    expect(result.interior).toBeGreaterThan(500);
    expect(result.matches, JSON.stringify(result.mismatches)).toBe(result.interior);
    expect(result.fields.length).toBe(11);
    expect(result.velocityWorst).toBeLessThan(0.1);
    await page.screenshot({ path: info.outputPath('abdomen.png') });
    expect(errors).toEqual([]);
  });
