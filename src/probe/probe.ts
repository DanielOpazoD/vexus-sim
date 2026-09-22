import { clamp, cross, dot, normalize, rotateAxis, scale, smoothstep, sub, type Vec3 } from '../core/vec3';
import type { Torso } from '../anatomy/primitives';
import { torsoNormal, torsoSkinPoint } from '../anatomy/primitives';

/**
 * Sonda virtual (guía §8): objeto rígido con seis grados de libertad apoyado
 * sobre la piel del tronco. La pose se describe con coordenadas de superficie
 * (φ alrededor del tronco, z craneocaudal), separación de la piel (lift) y
 * tres rotaciones respecto al marco local de la piel:
 *   yaw   — rotación alrededor de la normal cutánea (marcador craneal → axila);
 *   rock  — basculación dentro del plano de imagen (talón-punta);
 *   tilt  — inclinación fuera del plano (abanicar).
 * Cualquier dispositivo de entrada (ratón, táctil, IMU, seguimiento) produce
 * esta misma pose (base F.5).
 */
export interface ProbePose {
  phi: number;
  z: number;
  /** Separación de la piel en mm (0 = contacto; <0 = presión). */
  lift: number;
  yaw: number;
  rock: number;
  tilt: number;
}

export type TransducerType = 'convex' | 'phased';

export interface Transducer {
  type: TransducerType;
  /** Radio de curvatura de la superficie (mm); ∞ ≈ lineal. */
  curvatureRadius: number;
  /** Ancho de la huella a lo largo del plano (mm). */
  footprintMm: number;
  /** Espesor elevacional de la huella (mm). */
  elevationMm: number;
  /** Semiángulo del sector (rad). */
  halfSector: number;
  /** Número de líneas. */
  lines: number;
  /** Frecuencia central B (Hz) y Doppler (Hz). */
  f0B: number;
  f0Doppler: number;
  /** Profundidad del foco elevacional fijo de la lente (mm). */
  elevationFocusMm: number;
}

export const CONVEX_C35: Transducer = {
  type: 'convex',
  curvatureRadius: 60,
  footprintMm: 62,
  elevationMm: 13,
  halfSector: (34 * Math.PI) / 180,
  lines: 192,
  f0B: 3.5e6,
  f0Doppler: 2.5e6,
  elevationFocusMm: 80,
};

/** Marco ortonormal de la sonda en coordenadas del paciente (mm). */
export interface ProbeFrame {
  /** Centro de la superficie de contacto. */
  face: Vec3;
  /** Eje axial (hacia dentro del paciente). */
  axial: Vec3;
  /** Eje lateral en el plano de imagen (hacia el marcador). */
  lateral: Vec3;
  /** Normal al plano de imagen. */
  elevation: Vec3;
  /** Centro de curvatura (origen de las líneas radiales). */
  curvatureCenter: Vec3;
  /** Normal exterior de la piel bajo la sonda. */
  skinNormal: Vec3;
  /** Punto de la piel. */
  skinPoint: Vec3;
}

export function probeFrame(pose: ProbePose, torso: Torso, tr: Transducer): ProbeFrame {
  const skinPoint = torsoSkinPoint(pose.phi, pose.z, torso);
  const n = torsoNormal(skinPoint, torso);
  let axial = scale(n, -1);
  // lateral inicial: proyección de +z (craneal) sobre el plano tangente
  let lateral = normalize(sub([0, 0, 1], scale(n, dot([0, 0, 1], n))));
  let elevation = cross(axial, lateral);
  // yaw alrededor de la normal
  lateral = rotateAxis(lateral, n, pose.yaw);
  elevation = rotateAxis(elevation, n, pose.yaw);
  // rock alrededor del eje de elevación (dentro del plano)
  axial = rotateAxis(axial, elevation, pose.rock);
  lateral = rotateAxis(lateral, elevation, pose.rock);
  // tilt alrededor del eje lateral (fuera del plano)
  axial = rotateAxis(axial, lateral, pose.tilt);
  elevation = rotateAxis(elevation, lateral, pose.tilt);
  const face: Vec3 = [skinPoint[0] + n[0] * pose.lift, skinPoint[1] + n[1] * pose.lift, skinPoint[2] + n[2] * pose.lift];
  const curvatureCenter: Vec3 = [
    face[0] - axial[0] * tr.curvatureRadius,
    face[1] - axial[1] * tr.curvatureRadius,
    face[2] - axial[2] * tr.curvatureRadius,
  ];
  return { face, axial, lateral, elevation, curvatureCenter, skinNormal: n, skinPoint };
}

/** Ángulo de la línea i (rad) respecto al eje axial. */
export function lineAngle(i: number, tr: Transducer): number {
  const u = tr.lines > 1 ? i / (tr.lines - 1) : 0.5;
  return -tr.halfSector + 2 * tr.halfSector * u;
}

/** Dirección unitaria de la línea con ángulo θ. */
export function lineDirection(frame: ProbeFrame, theta: number): Vec3 {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return normalize([
    frame.axial[0] * c + frame.lateral[0] * s,
    frame.axial[1] * c + frame.lateral[1] * s,
    frame.axial[2] * c + frame.lateral[2] * s,
  ]);
}

/** Punto del mundo a distancia r (mm) de la cara a lo largo de la línea θ. */
export function pointOnLine(frame: ProbeFrame, tr: Transducer, theta: number, r: number): Vec3 {
  const d = lineDirection(frame, theta);
  const R = tr.curvatureRadius + r;
  return [frame.curvatureCenter[0] + d[0] * R, frame.curvatureCenter[1] + d[1] * R, frame.curvatureCenter[2] + d[2] * R];
}

/**
 * Acoplamiento acústico por línea (0–1) según el hueco entre la cara convexa y
 * la piel (aproximada como plano tangente): basculación, separación y
 * curvatura levantan los extremos; una película de gel de ~1 mm y la
 * deformación cutánea toleran huecos pequeños ([EXTRAPOLACIÓN PROPIA], C.5).
 */
/**
 * Blandura de la pared bajo la sonda (0–1): fracción del hueco por basculación e
 * inclinación que la pared absorbe al hundirse. Epigastrio y abdomen anterior sin
 * costillas (bajo el xifoides) ≈ 0,65: la sonda se «entierra» y se bascula hacia la
 * cabeza sin perder contacto; flanco bajo el reborde ≈ 0,35; sobre las costillas ≈ 0,15.
 */
export function skinSoftness(pose: ProbePose): number {
  const anterior = smoothstep(0.2 * Math.PI, 0.3 * Math.PI, pose.phi) * (1 - smoothstep(0.7 * Math.PI, 0.8 * Math.PI, pose.phi));
  const belowXiphoid = 1 - smoothstep(-5, 15, pose.z);
  const belowMargin = 1 - smoothstep(-70, -40, pose.z);
  return 0.15 + 0.5 * anterior * belowXiphoid + 0.2 * (1 - anterior) * belowMargin;
}

export function lineCoupling(pose: ProbePose, tr: Transducer, theta: number): number {
  const x = tr.curvatureRadius * Math.sin(theta); // posición lateral del elemento
  const faceHeight = tr.curvatureRadius - Math.sqrt(Math.max(0, tr.curvatureRadius ** 2 - x * x));
  // La piel se curva con el tronco (radio ~130 mm): compensa parte de la convexidad.
  const skinHeight = (x * x) / (2 * 130);
  const rigid = 1 - skinSoftness(pose);
  const gap =
    pose.lift + faceHeight - skinHeight + rigid * (x * Math.tan(pose.rock) + Math.abs(Math.tan(pose.tilt)) * tr.elevationMm * 0.5);
  // Gel + deformación cutánea toleran ~4 mm; presionar (lift < 0) amplía el área de contacto.
  const tolerance = 4.0 + 2.5 * smoothstep(0, -3, pose.lift);
  return smoothstep(tolerance + 2.5, tolerance, gap);
}

/** Vector de velocidad de la sonda estimado a partir de dos poses (mm/s). */
export function probeVelocity(prev: ProbeFrame, next: ProbeFrame, dtSeconds: number): Vec3 {
  if (dtSeconds <= 0) return [0, 0, 0];
  return scale(sub(next.face, prev.face), 1 / dtSeconds);
}

export function clampPose(p: ProbePose): ProbePose {
  return {
    // Hasta la línea axilar posterior derecha (ventana renal) en decúbito supino
    phi: clamp(p.phi, -Math.PI * 0.05, Math.PI * 1.2),
    z: clamp(p.z, -200, 200),
    lift: clamp(p.lift, -6, 25),
    yaw: ((((p.yaw + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI,
    rock: clamp(p.rock, -0.7, 0.7),
    tilt: clamp(p.tilt, -0.7, 0.7),
  };
}

/** Pose inicial: ventana intercostal lateral derecha, marcador hacia la axila. */
export function defaultPose(): ProbePose {
  // φ = π → lado derecho del paciente (−x); un poco anterior a la línea axilar media.
  return { phi: Math.PI * 0.92, z: 8, lift: 0, yaw: 0, rock: 0, tilt: 0 };
}
