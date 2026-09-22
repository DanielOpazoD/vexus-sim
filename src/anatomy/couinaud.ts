import { cross, normalize, sub, type Vec3 } from '../core/vec3';
import type { AnatomyScene } from './scene';

/**
 * Segmentación de Couinaud (decisión 42) derivada de la MISMA anatomía que corta el
 * haz: los planos son los de las suprahepáticas (derecha: V/VIII vs VI/VII; media o
 * línea de Cantlie: lóbulo derecho vs IV; izquierda: II vs III), la fisura umbilical
 * (IV vs II–III) y el plano portal (superior vs inferior). El caudado (I) es lo que
 * queda entre la cava y la fisura del ligamento venoso, detrás de la bifurcación
 * portal. Etiqueta de metadatos: no cambia el modelo acústico.
 */
export type CouinaudSegment = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

interface Plane {
  point: Vec3;
  normal: Vec3;
}

function planeThrough(a: Vec3, b: Vec3, alongZ = true): Plane {
  // Plano que contiene la recta a→b y la dirección craneocaudal (eje de la cava)
  const dir = normalize(sub(b, a));
  const axis: Vec3 = alongZ ? [0, 0, 1] : [1, 0, 0];
  return { point: a, normal: normalize(cross(dir, axis)) };
}

function side(p: Vec3, pl: Plane): number {
  return (p[0] - pl.point[0]) * pl.normal[0] + (p[1] - pl.point[1]) * pl.normal[1] + (p[2] - pl.point[2]) * pl.normal[2];
}

export interface CouinaudPlanes {
  rightHv: Plane;
  middleHv: Plane;
  leftHv: Plane;
  umbilicalX: number;
  portalZ: number;
  /** Fisura del ligamento venoso: cara anterior del caudado. */
  venosum: Plane;
}

/** Planos de partición a partir de los vasos de la escena (primer y último nodo de cada tronco). */
export function couinaudPlanes(a: AnatomyScene): CouinaudPlanes {
  const tube = (id: string): { first: Vec3; last: Vec3 } => {
    const v = a.vessels.find((x) => x.id === id && x.flowFactor === undefined);
    if (!v) throw new Error(`vaso ${id} ausente`);
    return { first: v.tube.nodes[0].p, last: v.tube.nodes[v.tube.nodes.length - 1].p };
  };
  const r = tube('hvRight');
  const m = tube('hvMiddle');
  const l = tube('hvLeft');
  const rightHv = planeThrough(r.first, r.last);
  const middleHv = planeThrough(m.first, m.last);
  const leftHv = planeThrough(l.first, l.last);
  // orientar normales: derecha → +y es anterior; media → +x es izquierda; izquierda → +y anterior
  const orient = (pl: Plane, towards: Vec3): Plane =>
    side([pl.point[0] + towards[0], pl.point[1] + towards[1], pl.point[2] + towards[2]], pl) >= 0
      ? pl
      : { point: pl.point, normal: [-pl.normal[0], -pl.normal[1], -pl.normal[2]] };
  return {
    rightHv: orient(rightHv, [0, 1, 0]),
    middleHv: orient(middleHv, [1, 0, 0]),
    leftHv: orient(leftHv, [0, 1, 0]),
    umbilicalX: a.umbilicalFissure.x,
    portalZ: -36,
    venosum: orient(a.ligamentumVenosumPlane(), [0, 1, 0]),
  };
}

/** Segmento de Couinaud de un punto del parénquima (mm, marco anatómico). */
export function couinaudSegment(p: Vec3, pl: CouinaudPlanes): CouinaudSegment {
  const superior = p[2] > pl.portalZ;
  // Caudado: entre la cava (x > −40) y la fisura del ligamento venoso (detrás de ella),
  // a la derecha de la fisura umbilical y por encima del hilio.
  if (p[0] > -40 && p[0] < pl.umbilicalX && side(p, pl.venosum) < 0 && p[2] > -46 && p[2] < 36) return 1;
  if (side(p, pl.middleHv) >= 0) {
    // lóbulo izquierdo funcional: IV (medial a la fisura umbilical) o II/III
    if (p[0] < pl.umbilicalX) return 4;
    return side(p, pl.leftHv) >= 0 ? 3 : 2;
  }
  const anterior = side(p, pl.rightHv) >= 0;
  if (anterior) return superior ? 8 : 5;
  return superior ? 7 : 6;
}

export const COUINAUD_LABEL: Record<CouinaudSegment, string> = {
  1: 'I caudado',
  2: 'II',
  3: 'III',
  4: 'IV',
  5: 'V',
  6: 'VI',
  7: 'VII',
  8: 'VIII',
};
