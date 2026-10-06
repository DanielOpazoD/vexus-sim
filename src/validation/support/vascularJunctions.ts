import { vesselApScale } from '../../anatomy/scene';
import type { Vec3 } from '../../core/vec3';
import { VESSEL_META, type VesselId } from '../../physiology/vessels';
import { tubeQuery, type Tube } from '../../anatomy/primitives';
import type { VesselDef } from '../../anatomy/vesselTree';
import type { VesselCaliber } from '../../anatomy/scene';

/** Conexiones esperadas de los troncos modelados; no se deducen de la proximidad que se quiere comprobar. */
export const HEPATIC_JUNCTIONS = [
  ['ivcInfra', 'ivcSupra', -1],
  ['hvRight', 'ivcSupra', -1],
  ['hvRightAnterior', 'hvRight', -1],
  ['hvRightPosterior', 'hvRight', -1],
  ['hvMiddle', 'hvCommonTrunk', -1],
  ['hvMiddleTributary', 'hvMiddle', -1],
  ['hvLeft', 'hvCommonTrunk', -1],
  ['hvLeftTributary', 'hvLeft', -1],
  ['hvCommonTrunk', 'ivcSupra', -1],
  ['pvRight', 'pvTrunk', 0],
  ['pvRightAnterior', 'pvRight', 0],
  ['pvRightPosterior', 'pvRight', 0],
  ['pvLeft', 'pvTrunk', 0],
  ['pvLeftLateral', 'pvLeft', 0],
  ['pvLeftMedial', 'pvLeft', 0],
] as const satisfies readonly (readonly [VesselId, VesselId, 0 | -1])[];

export type Junction = (typeof HEPATIC_JUNCTIONS)[number];

/** Usa la misma ley de calibre y sección de la escena, incluidas forma orgánica y elipse de la cava. */
function effectiveTube(v: VesselDef, caliber: VesselCaliber): Tube {
  return VESSEL_META[v.id].system === 'ivc' ? { ...v.tube, apScale: vesselApScale(v.id, v.tube.apScale, caliber) } : v.tube;
}

/**
 * Busca un testigo interior a ambas luces entre el extremo esperado y el eje receptor más cercano.
 * Un margen positivo demuestra solapamiento local de volumen; no mide el área del ostium ni valida
 * toda la topología. La ausencia de testigo en esta línea es un diagnóstico, no una prueba exhaustiva
 * de disjunción 3D. `fieldMargin` está en unidades del campo: no es distancia euclídea en una elipse.
 */
export function junctionWitness(vessels: ReadonlyMap<VesselId, VesselDef>, caliber: VesselCaliber, edge: Junction, stepMm = 0.1) {
  if (!Number.isFinite(stepMm) || stepMm <= 0) throw new Error('Paso de muestreo inválido');
  const [childId, parentId, endpoint] = edge;
  const child = vessels.get(childId);
  const parent = vessels.get(parentId);
  if (!child || !parent) throw new Error(`Vaso ausente en unión ${childId} → ${parentId}`);
  const a = effectiveTube(child, caliber);
  const b = effectiveTube(parent, caliber);
  const ar = caliber.radiusScale(childId);
  const br = caliber.radiusScale(parentId);
  const origin = a.nodes.at(endpoint)!.p;
  const h = tubeQuery(origin, b, br);
  const b0 = b.nodes[h.segment].p;
  const b1 = b.nodes[h.segment + 1].p;
  const target: Vec3 = [0, 1, 2].map((j) => b0[j] + (b1[j] - b0[j]) * h.s) as Vec3;
  const steps = Math.max(1, Math.ceil(Math.hypot(...origin.map((v, j) => target[j] - v)) / stepMm));
  const path: Vec3[] = [];
  let fieldMargin = -Infinity;
  let point = origin;
  for (let k = 0; k <= steps; k++) {
    const q: Vec3 = [0, 1, 2].map((j) => origin[j] + (target[j] - origin[j]) * (k / steps)) as Vec3;
    path.push(q);
    const margin = Math.min(-tubeQuery(q, a, ar).d, -tubeQuery(q, b, br).d);
    if (margin > fieldMargin) {
      fieldMargin = margin;
      point = q;
    }
  }
  return { fieldMargin, point, path };
}
