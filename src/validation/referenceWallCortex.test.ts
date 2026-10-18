import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Interface } from '../anatomy/interfaces';
import { setReferenceBody } from '../anatomy/referenceBody';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';

beforeAll(() => {
  const b = readFileSync('src/anatomy/reference-body.bin');
  setReferenceBody(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
});
afterAll(() => setReferenceBody());

it('conserva las diez caras costales registradas aunque crucen la pared estimada', () => {
  const scene = new AnatomyScene(NORMAL_ADULT);
  // Mismas bandas fuente de referenceAdult.spec.ts: costillas 6–10, a 0,1 mm de la cortical.
  const angles = [2.443460952792061, 2.356194490192345, 2.5132741228718345, 2.600540585471551, 2.6354471705114375];
  for (const [i, phi] of angles.entries()) {
    const rib = scene.ribs[i + 1];
    const [a, b, y, c] = rib.shape!;
    const x = a * Math.cos(phi),
      dy = b * Math.sin(phi);
    const ratio = 1 + (rib.halfThickness + 0.1) / Math.hypot(x, dy);
    const z = rib.zAnterior + rib.tilt * (0.5 - 0.5 * Math.sin(phi)) + c * Math.cos(phi);
    for (const side of [-1, 1]) {
      const p: Vec3 = [side * Math.abs(x * ratio), y + dy * ratio, z];
      expect(scene.classify(p, BASELINE_CALIBER).interface, `costilla ${i + 6}, lado ${side}`).toBe(Interface.RibCortex);
    }
  }
});
