/** Exploración geométrica offline: cortes transhepáticos con corteza y parénquima a igual profundidad. */
import { readFileSync, writeFileSync } from 'node:fs';
import { AnatomyScene } from '../../src/anatomy/scene';
import { AnatomyQuery } from '../../src/anatomy/query';
import { setReferenceBody } from '../../src/anatomy/referenceBody';
import { NORMAL_ADULT } from '../../src/cases';
import { clonePatient } from '../../src/physiology/patientState';
import { PhysiologyEngine } from '../../src/physiology/engine';
import { Tissue } from '../../src/anatomy/tissues';
import { probeContact } from '../../src/probe/contact';
import { CONVEX_C35, pointOnLine, type ProbePose } from '../../src/probe/probe';
const results = [];
for (const reference of [false, true]) {
  if (reference) {
    const b = readFileSync('src/anatomy/reference-body.bin');
    setReferenceBody(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
  }
  const patient = { ...clonePatient(NORMAL_ADULT), respiratoryPattern: 'apnea-expiratory' as const };
  const scene = new AnatomyScene(patient),
    anatomy = new AnatomyQuery(scene),
    engine = new PhysiologyEngine(patient, scene.vesselAreas(), { historySeconds: 4 });
  for (let i = 0; i < 240; i++) engine.step();
  const sample = engine.sample;
  const ranked = [];
  for (const phi of [2.8, 3, 3.2, 3.4])
    for (const z of [-40, -60, -80])
      for (const yaw of [-0.2, 0, 0.2])
        for (const tilt of [-0.6, -0.4, -0.2, 0])
          for (const rock of [-0.2, 0, 0.2]) {
            const pose: ProbePose = { phi, z, yaw, tilt, rock, lift: 0 };
            const k = probeContact(pose, CONVEX_C35, scene.torso);
            anatomy.setProbeCompression(k);
            const liver = new Array<number>(36).fill(0),
              cortex = new Array<number>(36).fill(0);
            let transhepatic = 0;
            for (let j = 0; j < 20; j++) {
              let seenLiver = false,
                blocked = false;
              for (let r = 4; r < 180; r += 4) {
                const p = pointOnLine(k.frame, CONVEX_C35, (j / 19 - 0.5) * 1.0, r),
                  c = anatomy.classifyWorld(p, sample);
                if ([Tissue.Bone, Tissue.Vertebra, Tissue.Lung, Tissue.BowelGas].includes(c.tissue)) blocked = true;
                if (blocked) continue;
                if (c.tissue === Tissue.Liver) {
                  seenLiver = true;
                  if (c.boundaryDistance > 2) liver[Math.floor(r / 5)]++;
                }
                if (c.tissue === Tissue.RenalCortex && c.boundaryDistance > 2) {
                  cortex[Math.floor(r / 5)]++;
                  if (seenLiver) transhepatic++;
                }
              }
            }
            const matched = liver.reduce((n, x, i) => n + Math.min(x, cortex[i]), 0);
            ranked.push({
              pose,
              matched,
              transhepatic,
              liver: liver.reduce((a, b) => a + b, 0),
              cortex: cortex.reduce((a, b) => a + b, 0),
              score: matched + transhepatic * 0.5,
            });
          }
  ranked.sort((a, b) => b.score - a.score);
  results.push({ reference, top: ranked.slice(0, 12) });
  console.log(JSON.stringify(results.at(-1), null, 2));
  setReferenceBody();
}
writeFileSync('/tmp/hepatorenal-poses.json', JSON.stringify(results, null, 2));
