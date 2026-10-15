import type { Torso } from '../anatomy/primitives';
import { clamp, cross, dot, rotateAxis, type Vec3 } from '../core/vec3';
import { clampPose, probeFrame, type ProbeFrame, type ProbePose, type Transducer } from './probe';

/** Reexpresa una orientación rígida en el marco cutáneo del nuevo apoyo. No dirige el haz a un órgano. */
function orientationAt(position: ProbePose, target: ProbeFrame, torso: Torso, tr: Transducer): ProbePose {
  const base = probeFrame({ ...position, yaw: 0, rock: 0, tilt: 0 }, torso, tr);
  const sinRock = clamp(-dot(target.lateral, base.axial), -1, 1);
  const projected = target.lateral.map((v, i) => v + base.axial[i] * sinRock) as Vec3;
  const cosRock = Math.hypot(...projected);
  // At +/-90 degrees yaw and tilt share one degree of freedom. Retain the
  // previous yaw there, then recover tilt from the actual target axial vector.
  const yaw =
    cosRock < 1e-12 ? position.yaw : Math.atan2(dot(cross(base.lateral, projected), base.skinNormal), dot(base.lateral, projected));
  const lateralYaw = rotateAxis(base.lateral, base.skinNormal, yaw);
  const rock = Math.atan2(sinRock, cosRock);
  const axialRock = base.axial.map((v, i) => v * Math.cos(rock) + lateralYaw[i] * sinRock) as Vec3;
  const elevationYaw = cross(base.axial, lateralYaw);
  const tilt = Math.atan2(-dot(target.axial, elevationYaw), dot(target.axial, axialRock));
  const candidates = [
    { ...position, yaw, rock, tilt },
    { ...position, yaw: yaw + Math.PI, rock: (rock < 0 ? -Math.PI : Math.PI) - rock, tilt: tilt + Math.PI },
  ];
  const cost = (p: ProbePose) =>
    (['yaw', 'rock', 'tilt'] as const).reduce(
      (sum, key) => sum + Math.atan2(Math.sin(p[key] - position[key]), Math.cos(p[key] - position[key])) ** 2,
      0,
    );
  return clampPose(cost(candidates[0]) <= cost(candidates[1]) ? candidates[0] : candidates[1], torso);
}

/**
 * Deslizar traslada el apoyo y conserva todos los ejes acústicos en el paciente.
 * Los números yaw/rock/tilt cambian porque están definidos respecto de la piel.
 * Los ángulos son periódicos: cruzar un flanco o la espalda nunca detiene la
 * posición ni trunca la orientación. El contacto se calcula después, en la pose
 * real, y puede perderse si la cara deja de apuntar hacia la piel.
 */
export function translateProbe(pose: ProbePose, phi: number, z: number, torso: Torso, tr: Transducer): ProbePose {
  const target = probeFrame(pose, torso, tr);
  const destination = clampPose({ ...pose, phi, z }, torso);
  return orientationAt(destination, target, torso, tr);
}
