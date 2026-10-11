import type { Torso } from '../anatomy/primitives';
import { clamp, cross, dot, normalize, type Vec3 } from '../core/vec3';
import { clampPose, probeFrame, type ProbeFrame, type ProbePose, type Transducer } from './probe';

/** Reexpresa una orientación rígida en el marco cutáneo del nuevo apoyo. No dirige el haz a un órgano. */
function orientationAt(position: ProbePose, target: ProbeFrame, torso: Torso, tr: Transducer): ProbePose {
  const base = probeFrame({ ...position, yaw: 0, rock: 0, tilt: 0 }, torso, tr);
  const sinRock = clamp(-dot(target.lateral, base.axial), -1, 1);
  const lateralYaw = normalize(target.lateral.map((v, i) => v + base.axial[i] * sinRock) as Vec3);
  const yaw = Math.atan2(dot(cross(base.lateral, lateralYaw), base.skinNormal), dot(base.lateral, lateralYaw));
  const rock = Math.asin(sinRock);
  const axialRock = base.axial.map((v, i) => v * Math.cos(rock) + lateralYaw[i] * sinRock) as Vec3;
  const elevationYaw = cross(base.axial, lateralYaw);
  const tilt = Math.atan2(-dot(target.axial, elevationYaw), dot(target.axial, axialRock));
  return { ...position, yaw, rock, tilt };
}

/**
 * Deslizar traslada el apoyo y conserva todos los ejes acústicos en el paciente.
 * Los números yaw/rock/tilt cambian porque están definidos respecto de la piel.
 * Si el apoyo exigiría superar los límites existentes, se detiene en el último
 * punto representable del trayecto: nunca truncar los ángulos y girar el haz.
 */
export function translateProbe(pose: ProbePose, phi: number, z: number, torso: Torso, tr: Transducer): ProbePose {
  const target = probeFrame(pose, torso, tr);
  const destination = clampPose({ ...pose, phi, z });
  let dphi = destination.phi - pose.phi;
  if (dphi > Math.PI) dphi -= 2 * Math.PI;
  if (dphi < -Math.PI) dphi += 2 * Math.PI;
  const at = (fraction: number): ProbePose =>
    orientationAt(
      clampPose({ ...pose, phi: pose.phi + dphi * fraction, z: pose.z + (destination.z - pose.z) * fraction }),
      target,
      torso,
      tr,
    );
  const fits = (p: ProbePose) => {
    const limited = clampPose(p);
    return Math.abs(limited.rock - p.rock) < 1e-12 && Math.abs(limited.tilt - p.tilt) < 1e-12;
  };
  const end = at(1);
  if (fits(end)) return end;
  let lo = 0,
    hi = 1,
    result = pose;
  // Resolución de posición inferior a una celda cutánea, sin relajar límites.
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2,
      candidate = at(mid);
    if (fits(candidate)) {
      lo = mid;
      result = candidate;
    } else hi = mid;
  }
  return result;
}
