import type { FaceGeometry } from '../../anatomy/scene';
import { levelOfGrey } from '../../ultrasound/greyMap';
import type { EnvelopeFrame } from '../speckle';
import { medianOf, percentileOf, sdOf } from './statistics';

/**
 * Banco de interfaces (decisiones 52 y 57): la medida de una línea en la pared de un vaso o en la cara de un órgano
 * (pico, anchura del eco, línea pleural y costura) y su resumen por tramos de incidencia.
 */

/**
 * Contraste de una interfaz (pared anterior de un vaso o cara de un órgano) en un tramo de incidencia
 * (ángulo entre el haz y su normal). Cada línea que cruza la interfaz da un registro (`FaceSample`).
 */
export interface WallBin {
  fromDeg: number;
  toDeg: number;
  /** Paredes medidas en el tramo (una por línea que entra del tejido previo a la interfaz). */
  walls: number;
  /** Mediana del cociente gris del pico / mediana del hígado de referencia (sin eco, el moteado da ~1,1). */
  ratio: number;
  /** Lo mismo en nivel mostrado (dB, invirtiendo la curva de grises). */
  deltaDb: number;
  /** Fracción de líneas con el pico a < 6 dB (nivel mostrado) sobre la mediana del hígado: huecos. */
  gapFraction: number;
  /** Hueco más largo a lo largo de la pared (mm): líneas de hueco consecutivas × paso de línea en el borde. */
  longestGapMm: number;
  /**
   * Rosario: coeficiente de variación del pico de envolvente de cada línea dividido por la mediana de
   * sus vecinas a ±3 líneas de la misma pared (quita la tendencia del lóbulo y de la profundidad).
   */
  beading: number;
  /** Anchura del eco a −6 dB alrededor de su pico en la envolvente (mm, mediana). */
  echoFwhmMm: number;
  /**
   * Pico sobre la mediana del hígado de referencia (dB, mediana), en la envolvente con la compensación
   * nominal (`envelopeLine`): sin ella, la atenuación de ida y vuelta entre la cara y su referencia, a
   * 3–10 mm, restaba ~2 dB con la referencia encima y los sumaba con ella debajo.
   */
  peakDb: number;
}

/** Cara hepática del diafragma y línea pleural con su espejo. */
export interface DiaphragmBin extends WallBin {
  /** Línea pleural: pico de envolvente a ±1,5 mm del cruce exacto con el pulmón, sobre el hígado (dB, mediana). */
  lineDb: number;
  /** Desviación típica (mm) de la posición de ese pico respecto al cruce exacto de la CPU. */
  positionSdMm: number;
  /** Líneas con una racha ≥ 0,3 mm de envolvente < hígado − 15 dB en [pleura; pleura + 2,5 mm]: costura. */
  seamFraction: number;
  /**
   * p95 de |espejo de la GPU − pleura de la CPU| (mm); NaN sin la transmisión de la GPU. Incluye el error
   * de colocación de la pasada A (`mirrorFloorMm`): no baja de él aunque la geometría sea exacta.
   */
  mirrorOffsetMm: number;
  /**
   * Suelo de `mirrorOffsetMm` con la colocación de la pasada A: p95 de |espejo de A0 − pleura| (mm), con
   * A0 (`FRAG_TRANS_HITS`: marcha de paso profundidad/`COARSE_DEPTH` y bisección de
   * `MIRROR_BISECTION_STEPS` pasos, `mirrorCrossing`) emulada en la CPU. Con la bisección (decisión 57)
   * es ≤ 0,009 mm; con la marcha gruesa sola caía en [0; paso), ~1 mm de p95.
   */
  mirrorFloorMm: number;
}

/**
 * Tramos de incidencia (°): una pared especular brilla a 0–20° y se apaga hacia 60°. El de 60–80° solo
 * se informa (la cápsula oblicua de la subxifoidea, decisiones 60 y 64); a ≥ 80° no se agrega nada.
 */
export const WALL_INCIDENCE_BINS_DEG = [0, 20, 40, 60, 80] as const;

/** Sistemas venosos con banco de pared propio. */
export type WallSystem = 'ivc' | 'hepaticVein' | 'portal';
export const WALL_SYSTEMS: readonly WallSystem[] = ['ivc', 'hepaticVein', 'portal'];
/** Paredes de la tabla histórica del banco (decisión 52): VCI y suprahepáticas juntas. */
export const HISTORIC_WALL_SYSTEMS: readonly WallSystem[] = ['ivc', 'hepaticVein'];
/**
 * Caras de órgano del banco de interfaces: cápsula hepática, la línea del peritoneo parietal sobre la
 * cápsula (decisión 62), diafragma (con la pleura) y Morison.
 */
export type OrganFace = 'capsule' | 'peritoneum' | 'diaphragm' | 'renalCapsule';
/** Interfaz de un registro del banco: el sistema de la pared o la cara del órgano. */
export type FaceKind = WallSystem | OrganFace;

/** Ventana del pico: desde 1,5 mm antes del borde hasta 0,5 mm después del objetivo. */
export const PEAK_BEFORE_MM = 1.5;
export const PEAK_AFTER_MM = 0.5;
/** Paso de la envolvente para el pico y su anchura (mm). */
export const ECHO_STEP_MM = 0.05;
/** Hasta dónde se busca el −6 dB a cada lado del pico (mm). */
const ECHO_SEARCH_MM = 3;
/** Un pico a menos de esto (dB, nivel mostrado) sobre el hígado es un hueco de la pared. */
export const GAP_DB = 6;
/** Vecinas a cada lado de la línea para el rosario, y cuántas (con ella) hacen falta. */
export const BEADING_HALF_LINES = 3;
export const BEADING_MIN_LINES = 5;
/** Ventana de la línea pleural alrededor del cruce exacto (mm). */
const PLEURA_LINE_MM = 1.5;
/** Costura: envolvente bajo el hígado − 15 dB en [pleura; pleura + 2,5 mm], en rachas ≥ 0,3 mm. */
export const SEAM_DB = -15;
const SEAM_SPAN_MM = 2.5;
export const SEAM_MIN_MM = 0.3;
const SEAM_STEP_MM = 0.02;

/** Una línea de imagen alrededor de una interfaz (`measureFaceLine`): la prueban líneas pintadas sin WebGL. */
export interface FaceLine {
  /** Envolvente detectada a la profundidad r (mm), sin tendencia con la profundidad (`envelopeLine`). */
  env: (r: number) => number;
  /** Gris mostrado (0–255) a la profundidad r; NaN fuera de la imagen. */
  gray: (r: number) => number;
  /** ¿Hay hígado en r? Solo el hígado entra en la referencia. */
  liver: (r: number) => boolean;
}

/** Dónde está la interfaz en la línea (mm). */
export interface FaceLineGeometry {
  /** Borde: primera celda que ya no es el tejido previo. */
  rb: number;
  /** Primera celda del objetivo (luz, cápsula o cápsula renal) o, en el diafragma, el cruce exacto con la pleura. */
  rTarget: number;
  /** Referencia de hígado: [rb − 10; rb − 3] encima o [rTarget + 3; rTarget + 10] debajo. */
  ref: 'above' | 'below';
  /** Solo el diafragma: el objetivo es la pleura y se miden su línea, su posición y la costura. */
  pleura?: boolean;
  /** Inicio de la ventana del pico si no es rb − `PEAK_BEFORE_MM` (la línea del peritoneo). */
  peakFrom?: number;
}

/** Medida de una línea en una interfaz. */
export interface FaceLineMeasure {
  ratio: number;
  deltaDb: number;
  peakDb: number;
  echoFwhmMm: number;
  /** Gris (0–255) de la cresta: el pico de `ratio`, sin dividir (contraste y CVc en gris, `contourStats`). */
  crestGray: number;
  /** Mediana del gris del hígado de referencia de la línea. */
  refGray: number;
  lineDb?: number;
  positionErrMm?: number;
  seamMm?: number;
}

/**
 * Registro del banco de interfaces: una línea que cruza una pared o una cara, con su incidencia. Con
 * `fidelityStats(…, { samples: true })` se devuelven todos y `summarizeFaces` los agrega entre poses.
 */
export interface FaceSample extends FaceLineMeasure {
  kind: FaceKind;
  /** Pared a la que pertenece la línea en su pose (líneas contiguas enlazadas por su borde). */
  wall: number;
  u: number;
  rb: number;
  /** Paso lateral entre líneas a la profundidad del borde (mm). */
  pitchMm: number;
  incidenceDeg: number;
  /** Solo el diafragma: |espejo de la GPU − pleura de la CPU| (mm). */
  mirrorOffsetMm?: number;
  /** Solo el diafragma: |espejo de la marcha gruesa emulada en la CPU − pleura de la CPU| (mm). */
  mirrorFloorMm?: number;
}

/** Tramos de incidencia de cada interfaz, agregados sobre uno o más planos. */
export interface FaceSummary {
  /** VCI y suprahepáticas juntas: la tabla histórica del banco. */
  walls: WallBin[];
  wallSystems: Record<WallSystem, WallBin[]>;
  /** Cápsula hepática sin la cara interna de la pared en la ventana del pico: su eco solo. */
  capsule: WallBin[];
  /** Cápsula con el peritoneo parietal en la ventana (`PERITONEUM_REACH_MM`): la línea de los dos. */
  peritoneum: WallBin[];
  diaphragm: DiaphragmBin[];
  renalCapsule: WallBin[];
}

/** Recorre [r0; r1] en pasos de `step` sin acumular error de coma flotante. */
function* stepsMm(r0: number, r1: number, step: number): Generator<number> {
  for (let i = 0; r0 + i * step <= r1 + 1e-9; i++) yield r0 + i * step;
}

/**
 * Envolvente de la línea `u` a la profundidad r (mm), interpolada entre los centros de muestra y con
 * la compensación nominal de la pasada de escaneo, `tgcDbPerCm`·r (`nominalTgcDbPerCm`; sin la TGC del
 * usuario ni su techo). La envolvente de la GPU lleva la atenuación de ida y vuelta (~3 dB/cm en el
 * hígado a 2,5 MHz) y el banco compara cada cara con el hígado a 3–10 mm: sin quitar la tendencia, el
 * mismo eco medía ~4 dB distinto con la referencia encima (pared) o debajo (cápsula), la línea pleural
 * ~3 dB de menos y la costura contaba huecos del moteado de un diafragma sin costura. `beamGain` (amplitud)
 * quita además la ganancia focal de la emisión (`focalGain`, decisión 84): es la corrección de difracción con que
 * el método del maniquí de referencia compara ecos de distintas profundidades (Yao, Zagzebski y Madsen 1990,
 * Ultrason Imaging 12:58); la imagen mostrada la conserva.
 */
export function envelopeLine(
  env: EnvelopeFrame,
  depthMm: number,
  tgcDbPerCm: number,
  beamGain: (r: number) => number = () => 1,
): (u: number, r: number) => number {
  const dr = depthMm / env.samples;
  const gain = Float64Array.from(
    { length: env.samples },
    (_, v) => Math.pow(10, (tgcDbPerCm * ((v + 0.5) * dr)) / 200) / beamGain((v + 0.5) * dr),
  );
  return (u, r) => {
    const x = Math.min(env.samples - 1, Math.max(0, r / dr - 0.5));
    const v = Math.min(env.samples - 2, Math.floor(x));
    const f = x - v;
    return env.data[v * env.lines + u] * gain[v] * (1 - f) + env.data[(v + 1) * env.lines + u] * gain[v + 1] * f;
  };
}

/**
 * Anchura (mm) a −6 dB (mitad de la amplitud) alrededor del pico `rPeak` de `f`, con los cruces
 * interpolados entre pasos de `stepMm`; NaN si a `maxMm` de un lado no baja de la mitad.
 */
export function echoWidthMm(f: (r: number) => number, rPeak: number, stepMm = ECHO_STEP_MM, maxMm = ECHO_SEARCH_MM): number {
  const top = f(rPeak);
  const half = top / 2;
  const edge = (dir: 1 | -1): number => {
    let prev = top;
    for (let i = 1; i * stepMm <= maxMm + 1e-9; i++) {
      const v = f(rPeak + dir * i * stepMm);
      if (v < half) return (i - 1 + (prev - half) / (prev - v)) * stepMm;
      prev = v;
    }
    return Number.NaN;
  };
  return edge(1) + edge(-1);
}

/** Racha más larga (mm) de `f` por debajo de `threshold` en [r0; r1], en pasos de `stepMm`. */
export function longestRunBelowMm(f: (r: number) => number, r0: number, r1: number, threshold: number, stepMm = SEAM_STEP_MM): number {
  let run = 0;
  let best = 0;
  for (const r of stepsMm(r0, r1, stepMm)) {
    if (f(r) < threshold) {
      run += stepMm;
      best = Math.max(best, run);
    } else run = 0;
  }
  return best;
}

/**
 * Mide una línea en una interfaz: pico de gris y de envolvente en [rb − 1,5; rTarget + 0,5] frente a
 * la mediana del hígado de referencia (≥ 8 muestras cada 0,25 mm, si no null), anchura del eco a −6 dB
 * y, en el diafragma, la línea pleural (±1,5 mm del cruce), su posición y la costura.
 */
export function measureFaceLine(line: FaceLine, g: FaceLineGeometry, dynamicRangeDb: number): FaceLineMeasure | null {
  const [a, b] = g.ref === 'above' ? [g.rb - 10, g.rb - 3] : [g.rTarget + 3, g.rTarget + 10];
  const refGray: number[] = [];
  const refEnv: number[] = [];
  for (const r of stepsMm(a, b, 0.25)) {
    const gr = line.gray(r);
    if (!Number.isFinite(gr) || !line.liver(r)) continue;
    refGray.push(gr);
    refEnv.push(line.env(r));
  }
  if (refGray.length < 8) return null;
  const med = medianOf(refGray);
  const medEnv = medianOf(refEnv);
  if (!(med > 0) || !(medEnv > 0)) return null;
  const w0 = g.peakFrom ?? g.rb - PEAK_BEFORE_MM;
  const w1 = g.rTarget + PEAK_AFTER_MM;
  let peak = 0;
  for (const r of stepsMm(w0, w1, 0.1)) peak = Math.max(peak, line.gray(r) || 0);
  let peakEnv = 0;
  let rPeak = w0;
  for (const r of stepsMm(w0, w1, ECHO_STEP_MM)) {
    const e = line.env(r);
    if (e > peakEnv) {
      peakEnv = e;
      rPeak = r;
    }
  }
  const out: FaceLineMeasure = {
    ratio: peak / med,
    deltaDb: (levelOfGrey(peak / 255) - levelOfGrey(med / 255)) * dynamicRangeDb,
    peakDb: 20 * Math.log10(peakEnv / medEnv),
    echoFwhmMm: echoWidthMm(line.env, rPeak),
    crestGray: peak,
    refGray: med,
  };
  if (g.pleura) {
    let top = 0;
    let rTop = g.rTarget;
    for (const r of stepsMm(g.rTarget - PLEURA_LINE_MM, g.rTarget + PLEURA_LINE_MM, SEAM_STEP_MM)) {
      const e = line.env(r);
      if (e > top) {
        top = e;
        rTop = r;
      }
    }
    out.lineDb = 20 * Math.log10(top / medEnv);
    out.positionErrMm = rTop - g.rTarget;
    out.seamMm = longestRunBelowMm(line.env, g.rTarget, g.rTarget + SEAM_SPAN_MM, medEnv * Math.pow(10, SEAM_DB / 20));
  }
  return out;
}

export type KeyedSample = FaceSample & { key: string };

/** Hueco más largo (mm) entre líneas consecutivas de una misma pared con el pico bajo `GAP_DB`. */
function longestGapMm(sel: readonly KeyedSample[]): number {
  if (!sel.length) return Number.NaN;
  let best = 0;
  const byWall = new Map<string, KeyedSample[]>();
  for (const s of sel) byWall.set(s.key, [...(byWall.get(s.key) ?? []), s]);
  for (const list of byWall.values()) {
    list.sort((x, y) => x.u - y.u);
    let run = 0;
    let lastU = Number.NaN;
    for (const s of list) {
      if (s.deltaDb < GAP_DB) {
        run = s.u === lastU + 1 ? run + s.pitchMm : s.pitchMm;
        best = Math.max(best, run);
      } else run = 0;
      lastU = s.u;
    }
  }
  return best;
}

/** Rosario: CV del pico de envolvente de cada línea / mediana de sus vecinas a ±3 líneas (misma pared y tramo). */
function beadingOf(sel: readonly KeyedSample[]): number {
  const amp = new Map<string, Map<number, number>>();
  for (const s of sel) {
    const m = amp.get(s.key) ?? new Map<number, number>();
    m.set(s.u, Math.pow(10, s.peakDb / 20));
    amp.set(s.key, m);
  }
  const ratios: number[] = [];
  for (const s of sel) {
    const m = amp.get(s.key)!;
    const nb: number[] = [];
    for (let du = -BEADING_HALF_LINES; du <= BEADING_HALF_LINES; du++) {
      const a = m.get(s.u + du);
      if (a !== undefined) nb.push(a);
    }
    if (nb.length >= BEADING_MIN_LINES) ratios.push(m.get(s.u)! / medianOf(nb));
  }
  if (!ratios.length) return Number.NaN;
  const mean = ratios.reduce((x, y) => x + y, 0) / ratios.length;
  return sdOf(ratios) / mean;
}

function wallBin(sel: readonly KeyedSample[], fromDeg: number, toDeg: number): WallBin {
  return {
    fromDeg,
    toDeg,
    walls: sel.length,
    ratio: medianOf(sel.map((s) => s.ratio)),
    deltaDb: medianOf(sel.map((s) => s.deltaDb)),
    gapFraction: sel.length ? sel.filter((s) => s.deltaDb < GAP_DB).length / sel.length : Number.NaN,
    longestGapMm: longestGapMm(sel),
    beading: beadingOf(sel),
    echoFwhmMm: medianOf(sel.map((s) => s.echoFwhmMm).filter(Number.isFinite)),
    peakDb: medianOf(sel.map((s) => s.peakDb)),
  };
}

/**
 * Agrega los registros del banco de interfaces por tipo y tramo de incidencia. Cada elemento de
 * `poses` es un plano (una llamada a `fidelityStats` con `samples`): las paredes, los huecos y el
 * rosario se enlazan dentro de su plano y los tramos juntan todos los planos (`bench --sweep`).
 */
export function summarizeFaces(poses: readonly (readonly FaceSample[])[]): FaceSummary {
  const all: KeyedSample[] = poses.flatMap((list, p) => list.map((s) => ({ ...s, key: `${p}:${s.kind}:${s.wall}` })));
  const nBins = WALL_INCIDENCE_BINS_DEG.length - 1;
  const binsOf = (kinds: readonly FaceKind[]): KeyedSample[][] =>
    Array.from({ length: nBins }, (_, j) =>
      all.filter(
        (s) => kinds.includes(s.kind) && s.incidenceDeg >= WALL_INCIDENCE_BINS_DEG[j] && s.incidenceDeg < WALL_INCIDENCE_BINS_DEG[j + 1],
      ),
    );
  const wallBins = (kinds: readonly FaceKind[]): WallBin[] =>
    binsOf(kinds).map((sel, j) => wallBin(sel, WALL_INCIDENCE_BINS_DEG[j], WALL_INCIDENCE_BINS_DEG[j + 1]));
  const finite = (sel: readonly KeyedSample[], f: (s: KeyedSample) => number | undefined): number[] =>
    sel.map(f).filter((x): x is number => x !== undefined && Number.isFinite(x));
  const diaphragm = binsOf(['diaphragm']).map((sel, j): DiaphragmBin => {
    const seams = finite(sel, (s) => s.seamMm);
    return {
      ...wallBin(sel, WALL_INCIDENCE_BINS_DEG[j], WALL_INCIDENCE_BINS_DEG[j + 1]),
      lineDb: medianOf(finite(sel, (s) => s.lineDb)),
      positionSdMm: sdOf(finite(sel, (s) => s.positionErrMm)),
      seamFraction: seams.length ? seams.filter((x) => x >= SEAM_MIN_MM).length / seams.length : Number.NaN,
      mirrorOffsetMm: percentileOf(
        finite(sel, (s) => s.mirrorOffsetMm),
        0.95,
      ),
      mirrorFloorMm: percentileOf(
        finite(sel, (s) => s.mirrorFloorMm),
        0.95,
      ),
    };
  });
  return {
    walls: wallBins(HISTORIC_WALL_SYSTEMS),
    wallSystems: { ivc: wallBins(['ivc']), hepaticVein: wallBins(['hepaticVein']), portal: wallBins(['portal']) },
    capsule: wallBins(['capsule']),
    peritoneum: wallBins(['peritoneum']),
    diaphragm,
    renalCapsule: wallBins(['renalCapsule']),
  };
}

/** Registros mínimos de un tramo para que el banco con GPU lo evalúe (plan de la tanda 1.5, §6.3). */
export const GATED_MIN_RECORDS = 10;

/**
 * Tramos que vigila el banco con GPU de los ecos de interfaz (decisión 57): solo los que el barrido llena
 * en alguna vista (docs/fidelity/README.md, «Qué llena el barrido»). La pared de la VCI a 0–20°, la VSH a
 * 20–40° y 40–60° (su caída), la porta a 20–40°, la línea del hígado bajo la pared (peritoneo y cápsula) y
 * Morison a 0–20° y el diafragma a 40–60°. La VSH y el diafragma a 0–20° no llegan a 10 registros en
 * ninguna vista y no se vigilan; desde la decisión 62 tampoco la cápsula sola: bajo la pared siempre tiene
 * la grasa preperitoneal y el peritoneo encima, en su ventana (su eco lo vigila el gemelo, `wallTwin.test.ts`).
 * @twin gemelo-pared
 */
export const GATED_FACE_BINS: readonly { label: string; kind: FaceKind; fromDeg: number }[] = [
  { label: 'VCI', kind: 'ivc', fromDeg: 0 },
  { label: 'VSH', kind: 'hepaticVein', fromDeg: 20 },
  { label: 'VSH', kind: 'hepaticVein', fromDeg: 40 },
  { label: 'porta', kind: 'portal', fromDeg: 20 },
  { label: 'peritoneo', kind: 'peritoneum', fromDeg: 0 },
  { label: 'diafragma', kind: 'diaphragm', fromDeg: 40 },
  { label: 'Morison', kind: 'renalCapsule', fromDeg: 0 },
];

/**
 * Tramos vigilados (`GATED_FACE_BINS`) que el resumen no llena: menos de `min` registros, o sin rosario
 * medible (ninguna pared con 5 líneas a ±3 en el tramo). Cada uno como «VSH 0–20°: 3 registros»; vacío si
 * todos se pueden evaluar. El banco lo escribe por escena para que las puertas no se salten en silencio.
 */
export function thinGatedBins(summary: FaceSummary, min = GATED_MIN_RECORDS): string[] {
  const bins = (kind: FaceKind): WallBin[] =>
    kind === 'ivc' || kind === 'hepaticVein' || kind === 'portal' ? summary.wallSystems[kind] : summary[kind];
  const out: string[] = [];
  for (const g of GATED_FACE_BINS) {
    const b = bins(g.kind).find((x) => x.fromDeg === g.fromDeg);
    if (!b) continue;
    const name = `${g.label} ${b.fromDeg}–${b.toDeg}°`;
    if (b.walls < min) out.push(`${name}: ${b.walls} registros`);
    else if (!Number.isFinite(b.beading)) out.push(`${name}: ${b.walls} registros, sin rosario`);
  }
  return out;
}

/**
 * Una interfaz del banco sobre la rejilla del plano: `before` (≥ 6 celdas seguidas), luego `target`
 * a < `maxCells` celdas del borde con solo celdas `between` en medio (al menos `minBetween`).
 */
export interface InterfaceSpec {
  kind: FaceKind;
  before: (i: number) => boolean;
  target: (i: number) => boolean;
  between: (i: number) => boolean;
  maxCells: number;
  minBetween: number;
  ref: 'above' | 'below';
  face: FaceGeometry;
}
