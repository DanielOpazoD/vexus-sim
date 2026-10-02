import type { ProbeCompression } from '../anatomy/compression';
import type { AnatomyQuery } from '../anatomy/query';
import type { Vec3 } from '../core/vec3';
import type { GateGeometry } from '../doppler/sampleVolume';
import type { PhysiologySample } from '../physiology/engine';
import type { VesselId } from '../physiology/vessels';
import { lineDirection, pointOnLine, type ProbeFrame } from '../probe/probe';
import { apertureAngleSigmaRad, lateralSigmaMm } from '../ultrasound/beamModel';
import type { TransducerProfile } from '../ultrasound/transducerProfile';
import { gateTransmission } from './gateTransmission';

/** Lo que la UI sabe de la puerta: dónde está, cuánto llega y en qué vaso cae su centro. */
export interface PwGateInfo {
  world: Vec3;
  transmission: number;
  beamAngleToFlowDeg: number | null;
  vessel: VesselId | null;
}

/** Cursor PW del equipo que define la puerta (subconjunto de `PwSettings`). */
export interface PwCursor {
  theta: number;
  depthMm: number;
  gateMm: number;
}

/**
 * Geometría de la puerta PW desde el cursor del equipo y el marco de la sonda: la ÚNICA fuente, la usan el simulador
 * en cada actualización de la puerta y la cadena del alumno de las pruebas (decisión 94: la prueba usaba una copia con
 * la transmisión fija en 0,3). Volumen de muestra con la anchura de la PSF de dos vías (mismo modelo que la imagen),
 * la elevación del perfil y la transmisión real hasta la puerta (con el acoplamiento del contacto).
 */
export function pwGate(
  anatomy: AnatomyQuery,
  frame: ProbeFrame,
  contact: ProbeCompression,
  profile: TransducerProfile,
  focusMm: number,
  pw: PwCursor,
  s: PhysiologySample,
): { gate: GateGeometry; info: PwGateInfo } {
  const tr = profile.geometry;
  const dir = lineDirection(frame, pw.theta);
  const center = pointOnLine(frame, tr, pw.theta, pw.depthMm);
  const c = Math.cos(pw.theta);
  const sn = Math.sin(pw.theta);
  const lateral: Vec3 = [
    frame.lateral[0] * c - frame.axial[0] * sn,
    frame.lateral[1] * c - frame.axial[1] * sn,
    frame.lateral[2] * c - frame.axial[2] * sn,
  ];
  const r = pw.depthMm;
  const latSigma = lateralSigmaMm(r, focusMm, profile.beam) * 1.2;
  const elevSigma = 1.6 * Math.sqrt(1 + ((r - tr.elevationFocusMm) / 45) ** 2);
  const transmission = gateTransmission(anatomy, frame, tr, contact, pw.theta, r, s, profile.dopplerEffectiveMHz);
  const gate: GateGeometry = {
    center,
    beamDir: dir,
    lateral,
    elevation: frame.elevation,
    lengthMm: pw.gateMm,
    lateralSigmaMm: latSigma,
    elevationSigmaMm: elevSigma,
    pulseSigmaMm: 0.5,
    apertureAngleSigmaRad: apertureAngleSigmaRad(r, profile.beam),
    transmission,
  };
  const q = anatomy.classifyWorld(center, s);
  let angle: number | null = null;
  if (q.vesselHit) {
    const t = q.vesselHit.tangent;
    const cosA = Math.abs(t[0] * dir[0] + t[1] * dir[1] + t[2] * dir[2]);
    angle = (Math.acos(Math.min(1, cosA)) * 180) / Math.PI;
  }
  return { gate, info: { world: center, transmission, beamAngleToFlowDeg: angle, vessel: q.vessel } };
}
