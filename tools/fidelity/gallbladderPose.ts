/** Búsqueda geométrica de ventana vesicular: no utiliza brillo ni imagen. Solo QA. */
import { readFileSync } from 'node:fs';
import { AnatomyScene } from '../../src/anatomy/scene';
import { AnatomyQuery } from '../../src/anatomy/query';
import { setReferenceBody } from '../../src/anatomy/referenceBody';
import { NORMAL_ADULT } from '../../src/cases';
import { clonePatient } from '../../src/physiology/patientState';
import { PhysiologyEngine } from '../../src/physiology/engine';
import { probeContact, contactCoupling } from '../../src/probe/contact';
import { CONVEX_C35, type ProbePose } from '../../src/probe/probe';
export function gallbladderPose(reference: boolean): ProbePose {
  const b = reference ? readFileSync('src/anatomy/reference-body.bin') : null;
  setReferenceBody(b ? new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) : undefined);
  const patient = { ...clonePatient(NORMAL_ADULT), respiratoryPattern: 'apnea-expiratory' as const };
  const scene = new AnatomyScene(patient),
    anatomy = new AnatomyQuery(scene),
    engine = new PhysiologyEngine(patient, scene.vesselAreas());
  setReferenceBody();
  engine.step();
  let best = Infinity,
    result: ProbePose | undefined;
  for (const phi of [1.8, 2, 2.2, 2.4, 2.6])
    for (const z of [-40, -60, -80, -100])
      for (const yaw of [-0.6, -0.3, 0, 0.3, 0.6])
        for (const tilt of [-0.4, -0.2, 0, 0.2, 0.4])
          for (const rock of [-0.3, 0, 0.3]) {
            const pose = { phi, z, yaw, tilt, rock, lift: 0 },
              k = probeContact(pose, CONVEX_C35, scene.torso);
            anatomy.setProbeCompression(k);
            let score = 0;
            for (const node of scene.gallbladder.nodes) {
              const p = anatomy.deformation.toWorld(node.p, engine.sample.resp);
              const d = p.map((x, i) => x - k.frame.curvatureCenter[i]);
              const lat = d.reduce((s, x, i) => s + x * k.frame.lateral[i], 0),
                ax = d.reduce((s, x, i) => s + x * k.frame.axial[i], 0);
              const el = d.reduce((s, x, i) => s + x * k.frame.elevation[i], 0),
                theta = Math.atan2(lat, ax),
                depth = Math.hypot(lat, ax) - CONVEX_C35.curvatureRadius;
              score +=
                el * el +
                1000 * Math.max(0, Math.abs(theta) - 0.42) +
                1000 * (1 - contactCoupling(k, theta)) +
                (depth < 20 || depth > 150 ? 10000 : 0);
            }
            if (score < best) {
              best = score;
              result = pose;
            }
          }
  if (!result) throw Error('Sin pose vesicular');
  return result;
}
