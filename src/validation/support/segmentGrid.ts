/**
 * Rejillas de segmentos (salidas de A0 y A1 en TS) sobre escenas 2D sintéticas y la transmisión de cada
 * mirada con los gemelos de producción (`prefixDb`, `steeredPrefixDb`, `apertureTransmission`,
 * `steeredApertureTransmission`). Lo usan `aperture.test.ts` y `transmission.test.ts` (decisión 58). La
 * escena se clasifica en el plano de imagen con x lateral y z = profundidad bajo el centro de la cara
 * (z = ρ·cos α − R), como los diseños de la decisión 58 (`design-thi/psf-diversity/shadow.ts`).
 */
import { TISSUES, Tissue, attenuationDbPerCm } from '../../anatomy/tissues';
import { type ApertureGeometry } from '../../ultrasound/aperture';
import { GAS_DB_PER_CM, MIRROR_DB, type SegmentGrid, lumenExcessPerMm } from '../../ultrasound/transmission';
import { lineHits, refractionGain, steeredApertureTransmission, steeredPrefixDb } from '../../ultrasound/transmissionTwin';

/** Geometría de la pasada A: la de la aplicación por defecto (192 líneas, 160 filas en 18 cm). */
export interface GridGeometry {
  lines: number;
  rows: number;
  depthMm: number;
  curvatureRadius: number;
  halfSector: number;
}

export const GRID_GEOMETRY: GridGeometry = { lines: 192, rows: 160, depthMm: 180, curvatureRadius: 60, halfSector: (34 * Math.PI) / 180 };

/** Ángulo de la línea l (centro del texel, como la GPU). */
export const gridLineAngle = (l: number, g: GridGeometry = GRID_GEOMETRY): number =>
  -g.halfSector + ((l + 0.5) * 2 * g.halfSector) / g.lines;

/** Rejilla vacía (todo a 0, sin espejos). */
export function emptyGrid(g: GridGeometry = GRID_GEOMETRY): SegmentGrid {
  const n = g.lines * g.rows;
  return {
    lines: g.lines,
    rows: g.rows,
    stepMm: g.depthMm / g.rows,
    db: new Float64Array(n),
    air: new Uint8Array(n),
    excess: new Float64Array(n),
    bone: new Uint8Array(n),
    gas: new Uint8Array(n),
    mirrorSeg: new Int32Array(g.lines).fill(-1),
    mirrorR: new Float64Array(g.lines).fill(-1),
  };
}

/**
 * A1 sobre una escena sin espejo: cada segmento radial se clasifica en su centro con las reglas de
 * `FRAG_TRANS_SEGMENTS` (gas 60 dB/cm, resto 2·α(f)·paso) y sus marcas (aire, hueso, tipo de gas).
 */
export function segmentGridFromScene(
  classify: (x: number, z: number) => Tissue,
  fMHz: number,
  g: GridGeometry = GRID_GEOMETRY,
): SegmentGrid {
  const grid = emptyGrid(g);
  const step = grid.stepMm;
  for (let l = 0; l < g.lines; l++) {
    const a = gridLineAngle(l, g);
    for (let s = 0; s < g.rows; s++) {
      const rho = g.curvatureRadius + (s + 0.5) * step;
      const t = classify(rho * Math.sin(a), rho * Math.cos(a) - g.curvatureRadius);
      const p = TISSUES[t];
      const i = l * g.rows + s;
      grid.db[i] = p.gas ? GAS_DB_PER_CM * (step / 10) : 2 * attenuationDbPerCm(t, fMHz) * (step / 10);
      grid.air[i] = t === Tissue.Air ? 1 : 0;
      grid.excess[i] = lumenExcessPerMm(t) * step;
      grid.bone[i] = p.bone ? 1 : 0;
      grid.gas[i] = t === Tissue.Lung ? 1 : p.gas ? 2 : 0;
    }
  }
  return grid;
}

/** Marca el espejo de la línea l en el segmento m con su cruce exacto r (pulmón en A1, MIRROR_DB). */
export function setMirror(grid: SegmentGrid, l: number, m: number, r: number): void {
  const i = l * grid.rows + m;
  grid.mirrorSeg[l] = m;
  grid.mirrorR[l] = r;
  grid.db[i] = MIRROR_DB;
  grid.air[i] = 0;
  grid.bone[i] = 0;
  grid.gas[i] = 1;
}

/**
 * Transmisión de amplitud ida y vuelta con apertura de la mirada θ en la fila k de todas las líneas: el
 * prefijo dirigido de cada línea (A2) y el cono de la pasada A sobre los caminos dirigidos vecinos, con el
 * obstáculo a lo largo del camino. Con θ = 0 es la de la decisión 54: el obstáculo sale de los impactos de
 * A0 de toda la línea, en el centro de su segmento (`APERTURE_GLSL` con uHits0).
 */
export function lookTransmission(grid: SegmentGrid, ap: ApertureGeometry, theta: number, k: number): Float64Array {
  const pre = Array.from({ length: grid.lines }, (_, l) => steeredPrefixDb(grid, ap, theta, l, k));
  const oneWay = (l: number) => Math.pow(10, -pre[l].db / 40);
  const first = (a: number, b: number) => (a >= 0 ? (b >= 0 ? Math.min(a, b) : a) : b);
  const obstacle = (l: number) => {
    if (theta === 0) {
      const h = lineHits(grid, l);
      const seg = first(h.gasSeg, h.boneSeg);
      return seg >= 0 ? (seg + 0.5) * grid.stepMm : Infinity;
    }
    const o = first(pre[l].sGas, pre[l].sBone);
    return o >= 0 ? o : Infinity;
  };
  const r = (k + 0.5) * grid.stepMm;
  // con la refracción en las luces del camino de cada mirada (decisión 86), como la pasada A; la pendiente de Ψ̃, la del
  // camino (en la mirada 0, igual a la de las filas k y k − 1 de la GPU salvo el redondeo)
  return Float64Array.from(
    { length: grid.lines },
    (_, l) => steeredApertureTransmission(ap, theta, l, r, oneWay, obstacle) * refractionGain(ap, grid.stepMm, l, k, (m) => pre[m]),
  );
}
