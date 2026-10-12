import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { setReferenceBody } from '../anatomy/referenceBody';
import { startPointsFor } from '../app/startPoints';
import { NORMAL_ADULT } from '../cases';
import { clampPose, CONVEX_C35, probeFrame, type ProbePose } from '../probe/probe';

const bytes = readFileSync('src/anatomy/reference-body.bin');
const profile = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

describe('acceso axilar posterior bilateral sobre la piel real del modelo', () => {
  for (const reference of [false, true])
    it(`la posición contralateral de la ventana renal conserva contacto y haz solicitados (${reference})`, () => {
      setReferenceBody(reference ? profile : undefined);
      try {
        const scene = new AnatomyScene(NORMAL_ADULT);
        const renal = startPointsFor(scene.torso).find((p) => p.id === 'renal')!;
        // No afirma que un riñón sea espejo del otro ni certifica esta ventana
        // izquierda. La superficie real de referencia sigue siendo asimétrica.
        const requested: ProbePose = {
          phi: Math.PI - renal.phi,
          z: renal.z,
          lift: 0,
          yaw: -renal.yaw,
          rock: renal.rock ?? 0,
          tilt: -(renal.tilt ?? 0),
        };
        for (const phi of [requested.phi, Math.PI - Math.PI * 1.2]) {
          const pose = { ...requested, phi };
          const intended = probeFrame(pose, scene.torso, CONVEX_C35);
          const obtained = probeFrame(clampPose(pose), scene.torso, CONVEX_C35);
          // Tolerancia sólo numérica; antes se desplazaba 46mm / 7,7mm.
          for (const key of ['skinPoint', 'face', 'axial', 'lateral', 'elevation'] as const)
            for (let i = 0; i < 3; i++) expect(obtained[key][i]).toBeCloseTo(intended[key][i], 10);
        }
        // Las nueve posiciones de partida derechas/anterior siguen alcanzables.
        for (const p of startPointsFor(scene.torso)) {
          const pose: ProbePose = { phi: p.phi, z: p.z, lift: 0, yaw: p.yaw, rock: p.rock ?? 0, tilt: p.tilt ?? 0 };
          expect(clampPose(pose).phi).toBe(pose.phi);
        }
      } finally {
        setReferenceBody();
      }
    });
});
