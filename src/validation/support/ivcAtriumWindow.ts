import type { Vec3 } from '../../core/vec3';
import type { AnatomyScene, VesselCaliber } from '../../anatomy/scene';
import { domeFloor } from '../../anatomy/organs/heart';
import { heartChamber } from '../../anatomy/organs/heartChamber';
import { Tissue, TISSUES } from '../../anatomy/tissues';
import { uncompress } from '../../anatomy/compression';
import { probeContact, contactCoupling } from '../../probe/contact';
import { CONVEX_C35, pointOnLine, type ProbePose } from '../../probe/probe';

/** Contrato fijado antes del candidato 315. Rejilla de la auditoría: 97 rayos, 0,5 mm.
 * Cinco líneas vecinas y 20 mm de anchura rechazan un único voxel/franja marginal.
 * 8 mm de cuerda auricular y 10 mm hepáticos evitan contar tangencias; margen 5°
 * evita una AD pegada al borde del sector. Criterios instrumentales, no normas clínicas.
 */
export function atriumWindow(scene: AnatomyScene, caliber: VesselCaliber, pose: ProbePose) {
  const contact = probeContact(pose, CONVEX_C35, scene.torso);
  const rays: {
    line: number;
    clear: boolean;
    liverMm: number;
    atriumMm: number;
    barrier: boolean;
    blocker: Tissue | null;
    lateral: number[];
  }[] = [];
  for (let line = 0; line < 97; line++) {
    const theta = -CONVEX_C35.halfSector + (2 * CONVEX_C35.halfSector * line) / 96;
    let liverMm = 0,
      atriumMm = 0,
      barrier = false,
      blocker: Tissue | null = null;
    const lateral: number[] = [];
    for (let r = 0; r <= 170; r += 0.5) {
      const world = pointOnLine(contact.frame, CONVEX_C35, theta, r);
      const m: Vec3 = uncompress(world, contact);
      const q = scene.classify(m, caliber);
      if (atriumMm === 0 && q.tissue === Tissue.Liver) liverMm += 0.5;
      if (atriumMm === 0 && liverMm >= 10 && (q.tissue === Tissue.Diaphragm || q.tissue === Tissue.Mediastinum)) barrier = true;
      if (q.tissue === Tissue.Blood && heartChamber(m, domeFloor(m, scene.diaphragm, scene.torso)) === 'ra') {
        atriumMm += 0.5;
        if (!blocker) lateral.push(world.reduce((sum, x, k) => sum + (x - contact.frame.face[k]) * contact.frame.lateral[k], 0));
      } else if (!blocker && q.tissue !== Tissue.Air && (TISSUES[q.tissue].gas || TISSUES[q.tissue].bone)) blocker = q.tissue;
    }
    rays.push({
      line,
      liverMm,
      atriumMm,
      barrier,
      blocker,
      lateral,
      clear:
        contactCoupling(contact, theta) > 0.5 &&
        Math.abs(theta) < CONVEX_C35.halfSector - (5 * Math.PI) / 180 &&
        liverMm >= 10 &&
        barrier &&
        atriumMm >= 8 &&
        lateral.length >= 16,
    });
  }
  return summarizeAtriumRays(rays);
}

export function summarizeAtriumRays<T extends { line: number; clear: boolean; lateral: number[] }>(rays: T[]) {
  let run = 0,
    longestRun = 0;
  const lateral: number[] = [];
  for (const ray of rays) {
    run = ray.clear ? run + 1 : 0;
    longestRun = Math.max(longestRun, run);
    if (ray.clear) lateral.push(...ray.lateral);
  }
  const widthMm = lateral.length ? Math.max(...lateral) - Math.min(...lateral) : 0;
  return { longestRun, widthMm, accepted: longestRun >= 5 && widthMm >= 20, rays };
}
