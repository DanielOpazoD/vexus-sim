import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { startPointsFor } from '../app/startPoints';
import { AnatomyQuery } from '../anatomy/query';
import { setReferenceBody } from '../anatomy/referenceBody';
import { AnatomyScene } from '../anatomy/scene';
import { Tissue } from '../anatomy/tissues';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import { PhysiologyEngine } from '../physiology/engine';
import { clonePatient } from '../physiology/patientState';
import { contactCoupling, probeContact } from '../probe/contact';
import { CONVEX_C35, pointOnLine, type ProbePose } from '../probe/probe';

const bytes = readFileSync(new URL('../anatomy/reference-body.bin', import.meta.url));
const body = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
afterEach(() => setReferenceBody());

/** Poses archivadas en d7f214f, independientes del preset nuevo. */
const previous: ProbePose[] = [
  { phi: 3.466, z: -66, yaw: 0.08, rock: -0.3, tilt: -0.2, lift: 0 },
  { phi: 3.3, z: -55, yaw: 0.107927, rock: -0.309003, tilt: 0.133669, lift: 0 },
];

/** Muestreo del plano visible, no longitud/volumen ni valoración clínica de la imagen. */
function portalSlice(scene: AnatomyScene, query: AnatomyQuery, engine: PhysiologyEngine, pose: ProbePose) {
  const contact = probeContact(pose, CONVEX_C35, scene.torso);
  query.setProbeCompression(contact);
  let trunk = 0,
    right = 0,
    hepatic = 0,
    ivc = 0,
    blockedPortal = 0;
  for (let line = 0; line < 61; line++) {
    const theta = -CONVEX_C35.halfSector + (2 * CONVEX_C35.halfSector * line) / 60;
    let blocked = contactCoupling(contact, theta) < 0.5;
    for (let r = 2; r < 175; r += 2) {
      const q = query.classifyWorld(pointOnLine(contact.frame, CONVEX_C35, theta, r), engine.sample);
      if ([Tissue.Bone, Tissue.Vertebra, Tissue.Lung, Tissue.BowelGas].includes(q.tissue)) blocked = true;
      const portal = q.vessel === 'pvTrunk' || q.vessel === 'pvRight';
      if (blocked) {
        if (q.vessel === 'pvRight') blockedPortal++;
        continue;
      }
      if (q.vessel === 'pvTrunk') trunk++;
      if (q.vessel === 'pvRight') right++;
      // Campo del órgano separado de la prioridad de clasificación: comprueba parénquima alrededor de la luz.
      // Margen >3 mm identifica muestras interiores; no demuestra contención de toda la pared vascular.
      if (portal && scene.liverInteriorMargin(q.material) > 3) hepatic++;
      if (q.vessel?.startsWith('ivc')) ivc++;
    }
  }
  return { trunk, right, hepatic, ivc, blockedPortal, hepaticFraction: hepatic / (trunk + right) };
}

describe('porta lateral: parénquima y plano anatómico, sin máscara de cava (168)', () => {
  for (const reference of [false, true])
    for (const base of [NORMAL_ADULT, SEVERE_CONGESTION]) {
      it(`${base.id}, reference=${reference}: aumenta la porción hepática y prioriza la rama dentro del hígado`, () => {
        setReferenceBody(reference ? body : undefined);
        const patient = { ...clonePatient(base), respiratoryPattern: 'apnea-expiratory' as const };
        const scene = new AnatomyScene(patient),
          query = new AnatomyQuery(scene);
        const engine = new PhysiologyEngine(patient, scene.vesselAreas(), { historySeconds: 2 });
        for (let i = 0; i < Math.round(30 / engine.clock.dt); i++) engine.step();
        const sp = startPointsFor(scene.torso).find((s) => s.id === 'portal')!;
        const before = portalSlice(scene, query, engine, previous[reference ? 1 : 0]);
        const after = portalSlice(scene, query, engine, { ...sp, lift: 0, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 });
        const tag = JSON.stringify({ before, after });
        expect(after.hepaticFraction, tag).toBeGreaterThan(before.hepaticFraction);
        expect(after.right, tag).toBeGreaterThan(before.right);
        expect(after.hepaticFraction, tag).toBeGreaterThan(0.85);
        expect(after.trunk, tag).toBeLessThan(after.right / 2);
        expect(after.right, tag).toBeGreaterThan(20);
        expect(after.blockedPortal, tag).toBe(0);
        // La cava sigue siendo visible en el plano posterior original del cuerpo procedural.
        if (!reference) {
          expect(before.ivc, tag).toBeGreaterThan(20);
          expect(after.ivc, tag).toBeLessThan(before.ivc);
        }
      });
    }
});
