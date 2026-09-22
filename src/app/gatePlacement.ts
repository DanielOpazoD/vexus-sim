import type { AnatomyQuery } from '../anatomy/query';
import type { PhysiologySample } from '../physiology/engine';
import type { VesselId } from '../physiology/vessels';
import { lineDirection, pointOnLine, type ProbeFrame, type Transducer } from '../probe/probe';

/**
 * Técnica del operador para colocar la puerta PW (Fase 0): dentro de la luz del vaso
 * (lejos de su pared) y con el mejor ángulo de insonación posible. Puntuación
 * |cos α|·min(bd, 3 mm) sobre una rejilla del sector. La usan la prueba de la cadena del
 * alumno y el gancho de la e2e; no la UI (en la app la puerta la pone el alumno).
 */
export interface GatePlacement {
  theta: number;
  r: number;
  /** Distancia a la pared (mm) y |cos α| entre haz y flujo en ese punto. */
  bd: number;
  cosAngle: number;
  vessel: VesselId;
}

export function bestGateOnVessel(
  anatomy: AnatomyQuery,
  frame: ProbeFrame,
  tr: Transducer,
  sample: PhysiologySample,
  vessels: readonly VesselId[],
  maxDepthMm: number,
  minWallMm = 1.2,
): GatePlacement | null {
  let best: (GatePlacement & { score: number }) | null = null;
  for (let th = -tr.halfSector; th <= tr.halfSector; th += 0.015)
    for (let r = 15; r <= maxDepthMm; r += 1.5) {
      const q = anatomy.classifyWorld(pointOnLine(frame, tr, th, r), sample);
      if (!q.vessel || !vessels.includes(q.vessel) || !q.vesselHit || q.boundaryDistance < minWallMm) continue;
      const d = lineDirection(frame, th);
      const tg = q.vesselHit.tangent;
      const cosAngle = Math.abs(d[0] * tg[0] + d[1] * tg[1] + d[2] * tg[2]);
      const score = cosAngle * Math.min(q.boundaryDistance, 3);
      if (!best || score > best.score) best = { theta: th, r, bd: q.boundaryDistance, cosAngle, vessel: q.vessel, score };
    }
  if (!best) return null;
  const { score: _score, ...placement } = best;
  return placement;
}
