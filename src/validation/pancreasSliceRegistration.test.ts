import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { setAbdominalAtlas } from '../anatomy/abdominalAtlas';
import { setAbdominalBody } from '../anatomy/referenceBody';
import { AnatomyScene } from '../anatomy/scene';
import { setThoracicAtlas } from '../anatomy/thoracicAtlas';
import { NORMAL_ADULT } from '../cases';
import { probeContact } from '../probe/contact';
import { CONVEX_C35 } from '../probe/probe';
import { PANCREAS_SLICE_POSE } from './fixtures/pancreasSlice';

beforeAll(() => {
  for (const [setter, name] of [
    [setAbdominalAtlas, 'abdominal'],
    [setThoracicAtlas, 'thoracic'],
  ] as const) {
    const b = gunzipSync(readFileSync(`src/anatomy/${name}-atlas.gzip.bin`));
    setter(new Uint16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
  }
  const b = readFileSync('src/anatomy/abdominal-body.bin');
  setAbdominalBody(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
});
afterAll(() => {
  setAbdominalAtlas();
  setAbdominalBody();
  setThoracicAtlas();
});

it('conserva el plano mundo, ejes y apoyo de la adquisición pancreática de la E2E', () => {
  const scene = new AnatomyScene(NORMAL_ADULT),
    k = probeContact(PANCREAS_SLICE_POSE, CONVEX_C35, scene.torso);
  // Referencias independientes del dato de pose: mismo plano anterior a 282
  // y ejes medidos en 2e4b06b. No se elige otro corte por visibilidad.
  const normal = [0.003375168013160991, 0.0516098992427323, -0.9986616176368434];
  const origin = [-2.6362464160982, 88.56854928339096, -116.21269058511825];
  expect(k.frame.elevation.reduce((sum, v, i) => sum + v * normal[i], 0)).toBeCloseTo(1, 5);
  expect(Math.abs(k.frame.face.reduce((sum, v, i) => sum + (v - origin[i]) * normal[i], 0))).toBeLessThan(0.01);
  const axial = [-0.11663158038063384, -0.9918312554214559, -0.05165109124708206];
  const lateral = [-0.993169513577012, 0.11664981384148754, 0.002671746984213463];
  // Norma 1e-6: registro numérico de los ejes, no tolerancia clínica.
  expect(Math.hypot(...k.frame.axial.map((v, i) => v - axial[i]))).toBeLessThan(1e-6);
  expect(Math.hypot(...k.frame.lateral.map((v, i) => v - lateral[i]))).toBeLessThan(1e-6);
  expect(k.contact.reduce((sum, v) => sum + v, 0) / k.contact.length).toBeGreaterThan(0.5);
});
