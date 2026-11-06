import { TISSUES } from '../../anatomy/tissues';
import { torsoNormal } from '../../anatomy/primitives';
import { warpAt, warpNormal } from '../../anatomy/compression';
import { dot, normalize, type Vec3 } from '../../core/vec3';
import { lineDirection, pointOnLine } from '../../probe/probe';
import { lateralSigmaMm } from '../../ultrasound/beamModel';
import { bmodeBeam } from '../../ultrasound/transducerProfile';
import { curtainAirFractionAt } from '../../ultrasound/pleura';
import { COARSE_DEPTH } from '../../ultrasound/renderer';
import { pleuraCrossingLine } from '../../ultrasound/transmission';
import type { Simulator } from '../simulator';
import { GRID_STEP_MM } from './grid';

// ——— Pleura parietal y cortina pulmonar (decisión 61) ———

/**
 * La pleura parietal de una línea del plano actual: el gemelo de A0 h2 (`pleuraCrossingLine`: el cruce
 * exacto de la cara interna de la pared y la distancia al borde de la cortina) y de la fracción de aire de la
 * pasada B (`curtainAirFractionAt`, con el haz del equipo).
 * @twin transmision-a0
 */
export interface CurtainLine {
  u: number;
  /** Distancia de la línea a la pleura (mm), al borde de la cortina (mm, + hacia el pulmón) y fracción de aire. */
  D: number;
  dz: number;
  fAir: number;
  sigmaMm: number;
  /** Incidencia sobre la cara interna de la pared (°), z material del cruce y el cruce en el mundo. */
  incidenceDeg: number;
  z: number;
  point: Vec3;
  /** Hay hueso (una costilla) en la línea antes de la pleura: su línea pleural y su neblina están en sombra. */
  shadowed: boolean;
}

/** `CurtainLine` de cada una de las `lines` líneas del plano (null si A0 no registra pleura en ella). */
export function curtainLines(sim: Simulator, lines: number): (CurtainLine | null)[] {
  const tr = sim.transducer;
  const depth = sim.bmode.depthMm;
  const a = sim.anatomy;
  const resp = sim.sample.resp;
  const mat = (p: Vec3): Vec3 => a.deformation.toMaterial(p, resp);
  const dTheta = (2 * tr.halfSector) / lines;
  const out: (CurtainLine | null)[] = [];
  for (let u = 0; u < lines; u++) {
    const theta = -tr.halfSector + dTheta * (u + 0.5);
    const origin = pointOnLine(sim.frame, tr, theta, 0);
    const dir = lineDirection(sim.frame, theta);
    const c = pleuraCrossingLine(
      (p) => a.scene.insideWallMm(mat(p)),
      (p) => a.scene.lungEdgeMm(mat(p), a.caliberFor(sim.sample)),
      origin,
      dir,
      depth,
      COARSE_DEPTH,
    );
    if (!c) {
      out.push(null);
      continue;
    }
    const point: Vec3 = [origin[0] + dir[0] * c.D, origin[1] + dir[1] * c.D, origin[2] + dir[2] * c.D];
    const m = mat(point);
    // la normal de la pleura en el mundo (la compresión de la sonda la pone de cara a la línea, decisión 63)
    const nW = normalize(warpNormal(warpAt(point, a.probeCompression), torsoNormal(m, a.scene.torso)));
    const { fAir, sigmaMm } = curtainAirFractionAt(
      c.dz,
      c.D,
      dir,
      sim.frame.elevation,
      tr.elevationFocusMm,
      (r) => lateralSigmaMm(r, sim.bmode.focusMm, bmodeBeam(sim.profile, sim.bmode)),
      sim.bmode.harmonic,
    );
    const cos = Math.abs(dot(nW, dir));
    let shadowed = false;
    for (let r = 0.25; r < c.D && !shadowed; r += GRID_STEP_MM)
      shadowed = TISSUES[a.classifyWorld(pointOnLine(sim.frame, tr, theta, r), sim.sample).tissue].bone;
    out.push({ u, D: c.D, dz: c.dz, fAir, sigmaMm, incidenceDeg: (Math.acos(Math.min(1, cos)) * 180) / Math.PI, z: m[2], point, shadowed });
  }
  return out;
}
