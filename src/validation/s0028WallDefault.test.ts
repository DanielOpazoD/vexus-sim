import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { installDefaultCpu } from '../anatomy/people/default/cpu';
import { NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';
import baseline from './fixtures/s0028-wall-default.json';
import { AnatomyScene, BASELINE_CALIBER } from './support/legacyPerson/scene';

it('el default conserva la clasificación semántica fijada en 82.251 puntos', () => {
  const raw = (name: string) => new Uint8Array(gunzipSync(readFileSync(`src/anatomy/${name}-atlas.gzip.bin`))).buffer;
  const person = installDefaultCpu({
    abdominal: new Uint16Array(raw('abdominal')),
    thoracic: new Uint16Array(raw('thoracic')),
    body: new Float32Array(new Uint8Array(readFileSync('src/anatomy/abdominal-body.bin')).buffer),
  });
  const scene = new AnatomyScene(NORMAL_ADULT, undefined, person),
    hash = createHash('sha256');
  let samples = 0;
  for (let z = -210; z <= 60; z += 7.5)
    for (let y = -130; y <= 160; y += 7.5)
      for (let x = -210; x <= 210; x += 7.5) {
        const p: Vec3 = [x, y, z];
        const c = scene.classify(p, BASELINE_CALIBER);
        // El recibo externo compara además todos los valores Float64 y diez marcos exactamente.
        // La regresión portable fija categorías/topología, sin hashear redondeos de libm entre CPU.
        hash.update(JSON.stringify([p, c.tissue, c.interface, c.vessel, c.vesselHit?.segment ?? null, c.flowFactor]));
        samples++;
      }
  expect(samples).toBe(baseline.samples);
  expect(hash.digest('hex')).toBe(baseline.semanticSha256);
});
