import type { AnatomyQuery } from '../anatomy/query';
import type { PhysiologySample } from '../physiology/engine';
import { VESSEL_META, type VesselId } from '../physiology/vessels';
import { lineDirection, pointOnLine, type ProbeFrame, type Transducer } from '../probe/probe';

/**
 * Técnica del operador para colocar la puerta PW: dentro de la luz del vaso (lejos de su pared),
 * a ≥ OTHER_VESSEL_MM de la VCI si el vaso desemboca en ella (el protocolo VExUS muestrea la
 * suprahepática a 1–2 cm de la confluencia: en la desembocadura, la VCI dilatada del caso grave
 * engullía la puerta y su sangre, casi perpendicular al haz, no daba señal; los vecinos naturales,
 * como la arteria de la tríada portal o la interlobar, no cuentan) y con el mejor ángulo posible.
 * Puntuación |cos α|·min(bd, 3 mm) sobre una rejilla del sector, multiplicada por el peso opcional
 * del candidato (`acousticWindowWeight`: la transmisión hasta el punto). Sin peso no mira la
 * transmisión y desde algunos puntos de partida la mejor puerta cae en una sombra (limitación
 * `gate-placement-ignores-shadows`). La usan las pruebas de la cadena del alumno y los ganchos de
 * la e2e y las ventanas virtuales del visor; en la exploración manual la puerta la pone el alumno.
 */
export interface GatePlacement {
  theta: number;
  r: number;
  /** Distancia a la pared (mm) y |cos α| entre haz y flujo en ese punto. */
  bd: number;
  cosAngle: number;
  vessel: VesselId;
}

/** Distancia mínima a la VCI (mm) para las venas que desembocan en ella. */
const OTHER_VESSEL_MM = 10;

export function bestGateOnVessel(
  anatomy: AnatomyQuery,
  frame: ProbeFrame,
  tr: Transducer,
  sample: PhysiologySample,
  vessels: readonly VesselId[],
  maxDepthMm: number,
  minWallMm = 1.2,
  /**
   * Peso opcional del candidato (p. ej. la transmisión hasta la puerta): el operador busca una
   * ventana sin sombras. Sin él la colocación ignora las sombras (`gate-placement-ignores-shadows`).
   */
  weight?: (theta: number, r: number) => number,
  /** Optional acquisition constraint, checked in score order; no acceptable candidate returns null. */
  accept?: (candidate: GatePlacement) => boolean,
): GatePlacement | null {
  const classify = (th: number, r: number) => anatomy.classifyWorld(pointOnLine(frame, tr, th, r), sample);
  // ¿hay VCI a menos de OTHER_VESSEL_MM en el plano (8 direcciones)? (solo si el objetivo no es la VCI)
  const nearCava = (th: number, r: number, own: VesselId): boolean => {
    // solo las venas que desembocan en la VCI tienen confluencia que evitar
    const sys = VESSEL_META[own].system;
    if (sys !== 'hepaticVein' && sys !== 'renalVein') return false;
    const rMid = tr.curvatureRadius + r;
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const q = classify(th + (OTHER_VESSEL_MM * Math.sin(a)) / rMid, r + OTHER_VESSEL_MM * Math.cos(a));
      if (q.vessel && VESSEL_META[q.vessel].system === 'ivc') return true;
    }
    return false;
  };
  // puntuar todos los candidatos y comprobar la confluencia solo de mejor a peor (8 consultas
  // por candidato: hacerlo en todos triplicaba el coste de la cadena del alumno)
  const candidates: Array<GatePlacement & { score: number }> = [];
  for (let th = -tr.halfSector; th <= tr.halfSector; th += 0.015)
    for (let r = 15; r <= maxDepthMm; r += 1.5) {
      const q = classify(th, r);
      if (!q.vessel || !vessels.includes(q.vessel) || !q.vesselHit || q.boundaryDistance < minWallMm) continue;
      const d = lineDirection(frame, th);
      const tg = q.vesselHit.tangent;
      const cosAngle = Math.abs(d[0] * tg[0] + d[1] * tg[1] + d[2] * tg[2]);
      candidates.push({
        theta: th,
        r,
        bd: q.boundaryDistance,
        cosAngle,
        vessel: q.vessel,
        score: cosAngle * Math.min(q.boundaryDistance, 3) * (weight ? weight(th, r) : 1),
      });
    }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates.find((c) => (!accept || accept(c)) && !nearCava(c.theta, c.r, c.vessel)) ?? null;
  if (!best) return null;
  const { score: _score, ...placement } = best;
  return placement;
}
