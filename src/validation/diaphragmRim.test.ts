import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { diaphragmRim } from '../anatomy/diaphragmRim';
import { diaphragmHeight, sdDiaphragm, torsoDepth } from '../anatomy/primitives';
import { setReferenceBody } from '../anatomy/referenceBody';
import { AnatomyScene } from '../anatomy/scene';
import { NORMAL_ADULT, SEVERE_CONGESTION, AF_MODERATE_CONGESTION } from '../cases';
import { cross, sub } from '../core/vec3';
import type { Vec3 } from '../core/vec3';

const bytes = readFileSync('src/anatomy/reference-body.bin');
const profile = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
afterEach(() => setReferenceBody());

describe('borde 3D del mismo campo diafragmático y corporal', () => {
  for (const reference of [false, true])
    it(`termina en la pared interna sin cruzarla, en los tres casos (${reference ? 'referencia' : 'legacy'})`, () => {
      for (const patient of [NORMAL_ADULT, SEVERE_CONGESTION, AF_MODERATE_CONGESTION]) {
        setReferenceBody(reference ? profile : undefined);
        const scene = new AnatomyScene(patient);
        const wall = scene.wallThickness();
        for (let i = 0; i < 96; i++) {
          const rim = diaphragmRim((i / 96) * Math.PI * 2, scene.diaphragm, scene.torso, wall);
          expect(Math.abs(torsoDepth(rim, scene.torso) + wall)).toBeLessThan(0.0001);
          expect(Math.abs(sdDiaphragm(rim, scene.diaphragm, scene.torso))).toBeLessThan(1e-8);
          for (const rho of [0, 0.25, 0.5, 0.75]) {
            const cy = scene.torso.y0 ?? 0;
            const x = rim[0] * rho,
              y = cy + (rim[1] - cy) * rho;
            const p: Vec3 = [x, y, diaphragmHeight(x, y, scene.diaphragm, scene.torso)];
            expect(-torsoDepth(p, scene.torso)).toBeGreaterThanOrEqual(wall - 0.0001);
          }
        }
      }
    });

  it('mantiene el winding del lado abdominal en los triángulos del muestreo', () => {
    setReferenceBody(profile);
    const scene = new AnatomyScene(NORMAL_ADULT),
      cy = scene.torso.y0 ?? 0;
    const at = (rho: number, phi: number): Vec3 => {
      const rim = diaphragmRim(phi, scene.diaphragm, scene.torso, scene.wallThickness());
      const x = rim[0] * rho,
        y = cy + (rim[1] - cy) * rho;
      return [x, y, diaphragmHeight(x, y, scene.diaphragm, scene.torso)];
    };
    for (let i = 0; i < 48; i++)
      for (const rho of [0.25, 0.5, 0.75]) {
        const phi = (i / 48) * Math.PI * 2;
        const a = at(rho, phi),
          b = at(rho, phi + (Math.PI * 2) / 48),
          c = at(rho + 1 / 20, phi);
        expect(cross(sub(b, a), sub(c, a))[2]).toBeLessThan(0);
      }
  });
});
