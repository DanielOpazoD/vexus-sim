import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { RespiratoryDeformation } from '../anatomy/deformation';
import { setReferenceBody } from '../anatomy/referenceBody';
import { NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';
import type { RespiratorySample } from '../physiology/respiratory';
const bytes = readFileSync('src/anatomy/reference-body.bin');
const profile = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const sample = (mm: number): RespiratorySample => ({
  cycling: true,
  phase: 0.4,
  volume: 1,
  volumeRate: 0,
  pleuralMmHg: 0,
  abdominalMmHg: 0,
  diaphragmCaudalMm: mm,
  diaphragmVelocityMmS: 0,
});
afterEach(() => setReferenceBody());

describe('inversa respiratoria acotada, sin compresión', () => {
  for (const reference of [false, true])
    for (const mm of [10, 30])
      it(`recupera el testigo material en ${reference ? 'referencia' : 'legacy'}, ${mm} mm`, () => {
        setReferenceBody(reference ? profile : undefined);
        const scene = new AnatomyScene(NORMAL_ADULT),
          deformation = new RespiratoryDeformation(scene);
        const m: Vec3 = reference ? [80, 35, -85] : [-60, 55, -60];
        const p = deformation.toWorld(m, sample(mm)),
          back = deformation.toMaterial(p, sample(mm));
        expect(Math.hypot(...back.map((x, i) => x - m[i]))).toBeLessThan(0.002);
      });
  for (const reference of [false, true])
    it(`cierra ida/vuelta en una rejilla independiente (${reference ? 'referencia' : 'legacy'})`, () => {
      setReferenceBody(reference ? profile : undefined);
      const scene = new AnatomyScene(NORMAL_ADULT),
        deformation = new RespiratoryDeformation(scene);
      let count = 0,
        max = 0;
      for (let x = -130; x <= 130; x += 10)
        for (let y = -80; y <= 90; y += 10)
          for (let z = -140; z <= 80; z += 10) {
            const m: Vec3 = [x, y, z];
            if (scene.insideWallMm(m) < 0) continue;
            for (const mm of [10, 30]) {
              const p = deformation.toWorld(m, sample(mm)),
                back = deformation.toMaterial(p, sample(mm));
              max = Math.max(max, Math.hypot(...back.map((x, i) => x - m[i])));
              count++;
            }
          }
      expect(count).toBeGreaterThan(10000);
      expect(max).toBeLessThan(0.002);
    });
  it('OFF no consulta el peso ni devuelve un alias mutable del punto', () => {
    const scene = new AnatomyScene(NORMAL_ADULT),
      deformation = new RespiratoryDeformation(scene),
      p: Vec3 = [3, 4, 5];
    scene.respiratoryWeight = () => {
      throw new Error('OFF no debe consultar el peso');
    };
    const m = deformation.toMaterial(p, sample(0));
    expect(m).toEqual(p);
    expect(m).not.toBe(p);
  });
  it('conserva exactamente los extremos de peso cero y uno', () => {
    const scene = new AnatomyScene(NORMAL_ADULT),
      deformation = new RespiratoryDeformation(scene),
      p: Vec3 = [3, 4, 5];
    for (const w of [0, 1]) {
      scene.respiratoryWeight = () => w;
      expect(deformation.toMaterial(p, sample(30))).toEqual(p.map((x, i) => x - 30 * w * RespiratoryDeformation.direction[i]));
    }
  });
});
