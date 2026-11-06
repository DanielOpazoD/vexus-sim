import {
  BEADING_HALF_LINES,
  BEADING_MIN_LINES,
  GAP_DB,
  WALL_INCIDENCE_BINS_DEG,
  type FaceKind,
  type FaceSample,
  type KeyedSample,
} from './faces';
import { medianOf, percentileOf, sdOf } from './statistics';

// ——— Contorno de las caras de órgano (PR 0 de las decisiones 60 y 64): métricas solo informadas ———

/** σ_L: vecinas a cada lado de la mediana corta (7 líneas) y de la larga (41), y registros mínimos. */
export const SIGMA_L_SHORT_HALF = 3;
export const SIGMA_L_LONG_HALF = 20;
export const SIGMA_L_MIN_LINES = 10;
/** Desviaciones mínimas del CVc: con menos, su DE no dice nada (con una sola sería 0, un CVc 0 falso). */
export const CVC_MIN_LINES = 10;
/** Extremo brusco de la cápsula: la mediana de 3 líneas cae ≥ 10 dB en ≤ 1 mm de pared desde ≥ +6 dB. */
export const CAPSULE_END_DROP_DB = 10;
export const CAPSULE_END_SPAN_MM = 1;

/** Un tramo de incidencia de una cara, en el dominio del gris y de la envolvente. */
export interface ContourBin {
  fromDeg: number;
  toDeg: number;
  walls: number;
  /** Mediana de (gris de la cresta − gris mediano del hígado de referencia) de cada línea. */
  contrastGrey: number;
  /**
   * CVc: DE de (cresta − mediana de las crestas a ±3 líneas de la misma pared, ≥ 5 con ella) / `contrastGrey`.
   * Casi no depende de la pendiente gris/dB del equipo (numerador y denominador escalan igual): la métrica
   * con que se comparan las referencias reales, cuya curva de grises no se conoce. Sin techo: premiaría
   * suavizar la línea (antipatrón §23 de la guía). NaN con < `CVC_MIN_LINES` desviaciones.
   */
  cvc: number;
  /** Desviaciones de las que sale el CVc (líneas con ≥ 5 vecinas a ±3 en su pared). */
  cvcLines: number;
  /**
   * σ_L (dB): DE de [mediana del pico de envolvente en 7 líneas − mediana en 41] a lo largo de la pared, en
   * las líneas con sus 41 vecinas en el tramo: la variación a escala de centímetros («línea dibujada»); la
   * mediana corta quita buena parte del rosario de línea a línea y la larga, la tendencia del lóbulo y de la
   * profundidad. NaN con < 10 líneas. Frágil entre realizaciones (la cápsula del gemelo a 0–20° va de 0,90
   * a 1,54 dB según la semilla): se promedia sobre ≥ 8.
   * @twin gemelo-interfaz
   */
  sigmaLDb: number;
}

/** Contorno de la cápsula hepática y de Morison en uno o más planos (`contourStats`). */
export interface ContourStats {
  capsule: ContourBin[];
  renalCapsule: ContourBin[];
  /**
   * Extremos bruscos de la cápsula: veces que la mediana de 3 líneas vecinas de una pared cae ≥ 10 dB (nivel
   * mostrado sobre el hígado) en ≤ 1 mm de pared (paso lateral entre líneas) desde ≥ +6 dB, en cualquiera de
   * los dos sentidos. Una caída que arranca a ≤ 1 mm de donde aterrizó la anterior es el mismo corte (la
   * PSF lo reparte en una escalera de varias líneas). Cuenta también los cortes por cambio de dueño (la cara
   * pasa a ser del diafragma o de la grasa perirrenal y la cápsula deja de dibujarla), que en la imagen son
   * el mismo corte. NaN si no se evaluó ninguna mediana de 3 (`capsuleEndLines` 0): una vista sin
   * registros de la cápsula no aprueba en silencio una puerta de 0.
   */
  capsuleEnds: number;
  /** Líneas (medianas de 3, en tramos de ≥ 3 líneas seguidas de una pared) en las que se buscaron extremos. */
  capsuleEndLines: number;
  /** p99 del salto de incidencia (°) entre líneas contiguas de una misma pared de la cápsula. */
  incidenceJumpP99Deg: number;
  /**
   * El mayor de esos saltos (°), la puerta de la decisión 60. Con más de 100 pares el p99 ya no ve una arista
   * sola: la subxifoidea de la congestión da p99 2,5° con un salto de 29°, y la del sano, con dos aristas en
   * 115 pares, da de p99 la segunda.
   */
  incidenceJumpMaxDeg: number;
  /** Pares de líneas contiguas de las que sale el salto. */
  incidencePairs: number;
}

/** Registros de cada pared (misma clave), ordenados por línea. */
function byWall(sel: readonly KeyedSample[]): KeyedSample[][] {
  const m = new Map<string, KeyedSample[]>();
  for (const s of sel) m.set(s.key, [...(m.get(s.key) ?? []), s]);
  return [...m.values()].map((list) => [...list].sort((a, b) => a.u - b.u));
}

/** Tramos de líneas consecutivas (sin saltos de línea) de una pared ordenada. */
function consecutiveRuns(list: readonly KeyedSample[]): KeyedSample[][] {
  const runs: KeyedSample[][] = [];
  for (const s of list) {
    const last = runs[runs.length - 1];
    if (last && s.u === last[last.length - 1].u + 1) last.push(s);
    else runs.push([s]);
  }
  return runs;
}

/** Mediana de `f` en las líneas u − h … u + h de la pared, o null si falta alguna. */
function windowMedian(byU: ReadonlyMap<number, KeyedSample>, u: number, h: number, f: (s: KeyedSample) => number): number | null {
  const v: number[] = [];
  for (let du = -h; du <= h; du++) {
    const x = byU.get(u + du);
    if (!x) return null;
    v.push(f(x));
  }
  return medianOf(v);
}

function contourBin(sel: readonly KeyedSample[], fromDeg: number, toDeg: number): ContourBin {
  const contrastGrey = medianOf(sel.map((s) => s.crestGray - s.refGray));
  const dev: number[] = [];
  const longScale: number[] = [];
  for (const list of byWall(sel)) {
    const byU = new Map(list.map((s) => [s.u, s]));
    for (const s of list) {
      const nb: number[] = [];
      for (let du = -BEADING_HALF_LINES; du <= BEADING_HALF_LINES; du++) {
        const x = byU.get(s.u + du);
        if (x) nb.push(x.crestGray);
      }
      if (nb.length >= BEADING_MIN_LINES) dev.push(s.crestGray - medianOf(nb));
      const short = windowMedian(byU, s.u, SIGMA_L_SHORT_HALF, (x) => x.peakDb);
      const long = windowMedian(byU, s.u, SIGMA_L_LONG_HALF, (x) => x.peakDb);
      if (short !== null && long !== null) longScale.push(short - long);
    }
  }
  return {
    fromDeg,
    toDeg,
    walls: sel.length,
    contrastGrey,
    cvc: dev.length >= CVC_MIN_LINES && contrastGrey > 0 ? sdOf(dev) / contrastGrey : Number.NaN,
    cvcLines: dev.length,
    sigmaLDb: longScale.length >= SIGMA_L_MIN_LINES ? sdOf(longScale) : Number.NaN,
  };
}

/**
 * Caídas bruscas de `level` (mediana de 3 líneas) recorriendo un tramo en un sentido: desde ≥ `GAP_DB`, a
 * ≤ nivel − `CAPSULE_END_DROP_DB` antes de `CAPSULE_END_SPAN_MM` de pared. Cada corte se cuenta una vez:
 * la caída que arranca a ≤ `CAPSULE_END_SPAN_MM` de donde aterrizó la anterior lo continúa (la PSF reparte
 * un corte en una escalera de 3–4 líneas: 30 → 19 → 8 → −3 dB es un corte, no tres), y la siguiente exige
 * volver a ≥ `GAP_DB`.
 */
function abruptDrops(level: readonly number[], pos: readonly number[]): number {
  const span = CAPSULE_END_SPAN_MM + 1e-9;
  let events = 0;
  let landed = -1;
  let i = 0;
  while (i < level.length) {
    if (!(level[i] >= GAP_DB)) {
      i++;
      continue;
    }
    let hit = -1;
    for (let j = i + 1; j < level.length && Math.abs(pos[j] - pos[i]) <= span && hit < 0; j++)
      if (level[j] <= level[i] - CAPSULE_END_DROP_DB) hit = j;
    if (hit < 0) {
      i++;
      continue;
    }
    if (landed < 0 || Math.abs(pos[i] - pos[landed]) > span) events++;
    landed = hit;
    i = hit;
    while (i < level.length && !(level[i] >= GAP_DB)) i++;
  }
  return events;
}

/** Extremos bruscos de la cápsula en todas sus paredes y medianas evaluadas (ver `ContourStats.capsuleEnds`). */
function capsuleEndsOf(sel: readonly KeyedSample[]): { ends: number; lines: number } {
  let ends = 0;
  let lines = 0;
  for (const list of byWall(sel))
    for (const run of consecutiveRuns(list)) {
      if (run.length < 3) continue;
      // mediana de 3 líneas en las interiores y posición a lo largo de la pared (paso lateral en el borde)
      const level: number[] = [];
      const pos: number[] = [];
      let x = 0;
      for (let i = 1; i + 1 < run.length; i++) {
        x += run[i].pitchMm;
        level.push(medianOf([run[i - 1].deltaDb, run[i].deltaDb, run[i + 1].deltaDb]));
        pos.push(x);
      }
      lines += level.length;
      ends += abruptDrops(level, pos) + abruptDrops([...level].reverse(), [...pos].reverse());
    }
  return { ends: lines ? ends : Number.NaN, lines };
}

/**
 * Métricas del contorno de la cápsula y de Morison sobre uno o más planos (como `summarizeFaces`: las
 * paredes se enlazan dentro de su plano). Solo se informan (banco con GPU, bloque `contour`); las puertas
 * llegan con las decisiones 60 (`capsuleEnds`, `incidenceJumpMaxDeg`) y 61 (cápsula a 20–60°). El contorno
 * del hígado es el de la cápsula y el de la línea del peritoneo con ella (decisión 62, `peritoneum`): la misma
 * pared, que bajo la pared abdominal se ve como esa línea.
 */
export function contourStats(poses: readonly (readonly FaceSample[])[]): ContourStats {
  const all: KeyedSample[] = poses.flatMap((list, p) =>
    list.map((s) => {
      const kind: FaceKind = s.kind === 'peritoneum' ? 'capsule' : s.kind;
      return { ...s, kind, key: `${p}:${kind}:${s.wall}` };
    }),
  );
  const bins = (kind: FaceKind): ContourBin[] =>
    WALL_INCIDENCE_BINS_DEG.slice(0, -1).map((b0, j) => {
      const b1 = WALL_INCIDENCE_BINS_DEG[j + 1];
      return contourBin(
        all.filter((s) => s.kind === kind && s.incidenceDeg >= b0 && s.incidenceDeg < b1),
        b0,
        b1,
      );
    });
  const capsule = all.filter((s) => s.kind === 'capsule');
  const jumps: number[] = [];
  for (const list of byWall(capsule))
    for (const run of consecutiveRuns(list))
      for (let i = 1; i < run.length; i++) jumps.push(Math.abs(run[i].incidenceDeg - run[i - 1].incidenceDeg));
  const ends = capsuleEndsOf(capsule);
  return {
    capsule: bins('capsule'),
    renalCapsule: bins('renalCapsule'),
    capsuleEnds: ends.ends,
    capsuleEndLines: ends.lines,
    incidenceJumpP99Deg: percentileOf(jumps, 0.99),
    incidenceJumpMaxDeg: jumps.length ? Math.max(...jumps) : Number.NaN,
    incidencePairs: jumps.length,
  };
}
