/** Reproduce coordinate round-trip errors, not image or clinical accuracy. */
import { readFileSync } from 'node:fs';
import { AnatomyScene } from '../../src/anatomy/scene';
import { RespiratoryDeformation, RESPIRATORY_INVERSE_STEPS } from '../../src/anatomy/deformation';
import { setReferenceBody } from '../../src/anatomy/referenceBody';
import { NORMAL_ADULT } from '../../src/cases';
import type { Vec3 } from '../../src/core/vec3';
import type { RespiratorySample } from '../../src/physiology/respiratory';
const bytes = readFileSync('src/anatomy/reference-body.bin');
const profile = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const rows = [];
for (const reference of [false, true]) {
  setReferenceBody(reference ? profile : undefined);
  const scene = new AnatomyScene(NORMAL_ADULT),
    deformation = new RespiratoryDeformation(scene);
  for (const mm of [10, 30]) {
    const sample: RespiratorySample = {
      cycling: true,
      phase: 0.4,
      volume: 1,
      volumeRate: 0,
      pleuralMmHg: 0,
      abdominalMmHg: 0,
      diaphragmCaudalMm: mm,
      diaphragmVelocityMmS: 0,
    };
    let samples = 0,
      oldMax = 0,
      newMax = 0,
      oldOver01 = 0,
      oldOver1 = 0,
      newOver002 = 0;
    let worst: object | null = null;
    for (let x = -140; x <= 140; x += 5)
      for (let y = -90; y <= 100; y += 5)
        for (let z = -150; z <= 90; z += 5) {
          const m: Vec3 = [x, y, z];
          if (scene.insideWallMm(m) < 0) continue;
          const p = deformation.toWorld(m, sample);
          let old: Vec3 = p;
          for (let i = 0; i < 2; i++) {
            const d = deformation.displacement(old, sample);
            old = p.map((v, j) => v - d[j]) as Vec3;
          }
          const corrected = deformation.toMaterial(p, sample),
            a = Math.hypot(...old.map((v, j) => v - m[j])),
            b = Math.hypot(...corrected.map((v, j) => v - m[j]));
          samples++;
          if (a > 0.1) oldOver01++;
          if (a > 1) oldOver1++;
          if (b > 0.002) newOver002++;
          if (a > oldMax) {
            oldMax = a;
            worst = { material: m, world: p, old, corrected, oldErrorMm: a, correctedErrorMm: b };
          }
          newMax = Math.max(newMax, b);
        }
    rows.push({
      reference,
      excursionMm: mm,
      samples,
      oldMaxErrorMm: oldMax,
      newMaxErrorMm: newMax,
      oldOver01Mm: oldOver01,
      oldOver1Mm: oldOver1,
      newOver002Mm: newOver002,
      bracketWidthMm: mm / 2 ** RESPIRATORY_INVERSE_STEPS,
      worst,
    });
  }
}
setReferenceBody();
console.log(
  JSON.stringify(
    {
      algorithm: `normalized-bisection-${RESPIRATORY_INVERSE_STEPS}-interpolated`,
      baseline: 'Two fixed-point iterations, as in parent 8358fcd41750e89d66c64d54fe7b7fb382e3d2d6',
      compression: false,
      clinicalValidation: false,
      globalInjectivityProved: false,
      grid: { min: [-140, -90, -150], max: [140, 100, 90], stepMm: 5, filter: 'insideWallMm >= 0' },
      rows,
    },
    null,
    2,
  ),
);
