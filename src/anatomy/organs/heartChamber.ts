import { HEART_WALLS, heartChambers } from './heart';

/** Cámaras del corazón (decisión 85), en el orden de `heartChambers`. */
export type HeartChamber = 'lv' | 'rv' | 'ra' | 'la';
export const HEART_CHAMBER_IDS: readonly HeartChamber[] = ['lv', 'rv', 'ra', 'la'];

const W = HEART_WALLS;
const WALL4 = [W.lv, W.rv, W.ra, W.la] as const;

/**
 * Cámara cuya cavidad (recortada por la cúpula, como en `thorax`) contiene un punto MATERIAL, o null: la de menor distancia
 * donde dos se solapan (los orificios). Solo TS, fuera del módulo de órgano para no viajar en el chunk principal: pruebas y
 * corte ecográfico (la GPU no la necesita: la sangre de una cavidad no tiene vaso).
 */
export function heartChamber(m: readonly [number, number, number], dDome: number): HeartChamber | null {
  const c = heartChambers([m[0], m[1], m[2]]);
  let best = -1;
  let bestD = 0;
  for (let i = 0; i < 4; i++) {
    const d = Math.max(c[i], dDome + W.pericardium + WALL4[i]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best < 0 ? null : HEART_CHAMBER_IDS[best];
}
