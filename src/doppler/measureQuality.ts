import { median } from '../core/series';
import type { Beat } from '../physiology/rhythm';
import type { VesselSystem } from '../physiology/vessels';
import { captureNoiseFloorsDb, noiseFloorDb, type SpectralColumn } from './spectral';
import type { ProtocolVessel } from './vesselIdentity';

/**
 * Control de calidad de una captura PW (base de conocimiento A.4: «no medible» nunca es
 * sinónimo de normal). Se juzga sobre el espectro adquirido, como haría un operador:
 *  - sangre: potencia sobre el suelo + margen FUERA de la banda del filtro de pared (el clutter
 *    residual junto a 0 Hz no cuenta);
 *  - por latido: un latido vale si hay sangre en el 60 % de sus columnas (las ondas venosas graves
 *    pasan fases cerca de cero, así que no se exige en todas). Medido: en apnea todos los latidos
 *    pasan del 79 %; con respiración, la interlobar del caso grave cae al 31 % en algún latido;
 *  - intermitente: si algún latido no vale, el vaso entra y sale de la puerta y la medición mezcla
 *    ciclos con y sin vaso (la interlobar grave salía «bifásica» siendo monofásica). También si
 *    ningún latido vale pero hay sangre en ≥ 20 % de las columnas: con respiración tranquila la
 *    suprahepática solo pasa por la puerta en parte del ciclo, y «no hay flujo» mandaba al alumno
 *    a buscar sombras en vez de pedir apnea;
 *  - aliasing: la sangre toca a la vez los dos bordes de la banda (el pico que rebasa ±Nyquist
 *    reaparece por el otro lado) con un hueco al nivel del ruido entre ambos (≥ 15 % de los bins
 *    contiguos, fuera de la muesca del filtro de pared) en ≥ 3 columnas de algún latido, o más del
 *    25 % de su energía está en el 15 % exterior de la banda. Sin el hueco, la fuga del clutter del
 *    tejido que respira (toda la banda 10–15 dB sobre el suelo) parecía un plegado. A PRF baja el pico S de la VSH del sano, plegado al lado
 *    negativo, imitaba la inversión de S: «grave» con el visto bueno de la calidad (PRF 1000–1400;
 *    la energía junto a ±Nyquist era solo del 10–14 %). Medido: 11–30 columnas por latido con la
 *    VSH plegada y 0 en toda captura sin plegar (también la D grave o la porta rozando un borde);
 *  - inconsistente (suprahepática): la onda no se reproduce de un latido a otro. Con respiración
 *    tranquila la puerta fija pasa de la vena a otro vaso sin quedarse sin sangre: en el sano se
 *    midió S +36 cm/s en un latido y −13 en el siguiente (la mediana daba «grave»), o S invertida
 *    en los tres latidos con D invertida en uno (−7 frente a +16 y +12). S no puede cambiar de
 *    dirección entre latidos y D es anterógrada en todo grado VExUS; una onda casi nula
 *    (|x| < 25 % de D) no cuenta.
 */
export type QualityIssue =
  'no-signal' | 'intermittent' | 'aliasing' | 'inconsistent' | 'few-beats' | 'wrong-vessel' | 'wall-filter' | 'renal-identity';

export interface MeasurementQuality {
  /** Latidos cubiertos por el espectro en la ventana y cuántos tienen sangre suficiente. */
  beats: number;
  validBeats: number;
  /** Fracción de la energía de sangre junto a ±Nyquist. */
  edgeEnergyFraction: number;
  /** Latidos en los que la sangre toca a la vez los dos bordes de la banda (se pliega). */
  wrappedBeats: number;
  /** Fracción de las columnas de los latidos con sangre. */
  bloodColumns: number;
  /** Primer problema encontrado, o null si la captura es medible. */
  issue: QualityIssue | null;
  /** Con 'wrong-vessel' (decisión 94): la fila y el sistema vascular que dominaba la puerta. */
  wrongVessel?: { kind: ProtocolVessel; found: VesselSystem };
}

export interface QualityOptions {
  wallFilterHz: number;
  /**
   * Lado del espectro que se juzga: ambos (suprahepática, porta: el flujo se invierte) o solo el
   * de la vena en la interlobar (la arteria vecina siempre da señal y no dice nada de la vena).
   */
  side?: 'both' | 'pos' | 'neg';
  /** Margen sobre el suelo de ruido (dB). */
  marginDb?: number;
  /**
   * Ventana de fase de cada latido en la que el flujo debe estar (la diastólica en la vena renal).
   * Con ella, un latido también vale si la sangre cubre ≥ PHASE_COVERAGE de esa ventana y su fracción
   * de columnas con sangre se repite (a ≤ PHASE_REPRODUCIBILITY de la mediana de la captura): una
   * vena monofásica solo lleva flujo en diástole, menos del 60 % del ciclo, y no por eso entra y sale
   * de la puerta (hallazgo C10 de la revisión externa).
   */
  phaseWindow?: (b: Beat) => readonly [number, number];
  /**
   * Presencia de flujo por columna medida por la propia medición (la porta, decisión 94: la columna tiene traza
   * unilateral en su semiplano). Sin ella, `bloodInColumn`: con el clutter simétrico de la respiración contado
   * como sangre, un latido sin traza de la porta «valía».
   */
  present?: (c: SpectralColumn) => boolean;
  /**
   * Ruido del receptor por bin (dB, `receiverNoiseDb` con la ganancia del equipo). Con él se reconoce el aliasing fuerte
   * (decisión 94): con la escala muy por debajo de la velocidad la sangre se pliega varias veces, se reparte por toda
   * la banda y no deja banda que detectar; la captura decía «no hay flujo» o «entra y sale de la puerta». Sin él (una
   * prueba sin equipo) no se comprueba.
   */
  receiverNoiseDb?: number;
}

/** Cobertura de la ventana de fase con sangre para que el latido valga. */
const PHASE_COVERAGE = 0.8;
/** Diferencia máxima de la fracción de sangre de un latido frente a la mediana de la captura. */
const PHASE_REPRODUCIBILITY = 0.15;

/** Latidos de una captura: los últimos completos de sus 7 s de espectro (4 caben a 45 lpm). */
export { CAPTURE_BEATS, qualityText } from './qualityMessages';
/** Fracción del latido que deben cubrir las columnas del espectro para juzgarlo. */
const BEAT_COVERAGE = 0.9;
/**
 * Margen (Hz) sobre el corte del filtro de pared para contar flujo: la banda de transición deja pasar
 * clutter residual del tejido que respira (≲ 15 mm/s, ~50 Hz). Antes era 2,5 × el corte: con el
 * filtro a 300 Hz se excluía hasta 750 Hz (23 cm/s) y un flujo real de 10–22 cm/s salía «sin señal».
 */
const WALL_MARGIN_HZ = 37.5;

/** Frecuencia mínima (Hz) a la que se cuenta flujo: sobre el filtro de pared y fuera de los 2 bins centrales. */
export function flowBandMinHz(wallFilterHz: number, prfHz: number, fftSize: number): number {
  return Math.max(wallFilterHz + WALL_MARGIN_HZ, (2 * prfHz) / fftSize);
}

/** Fracción mínima de columnas con sangre para que un latido valga. */
const BEAT_SIGNAL_FRACTION = 0.6;
/** Fracción de columnas con sangre por debajo de la cual no hay señal (y no intermitencia). */
const MIN_BLOOD_COLUMNS = 0.2;
/** Latidos válidos mínimos. */
const MIN_VALID_BEATS = 3;
/** Fracción de energía junto a ±Nyquist por encima de la cual se declara aliasing. */
const EDGE_BAND = 0.15;
const MAX_EDGE_ENERGY = 0.25;
/** Borde de la banda para la envoltura: el 10 % exterior de cada lado (|f| > 0,4·PRF). */
const WRAP_BAND = 0.1;
/** Columnas de un latido con sangre en los dos bordes a partir de las cuales se ha plegado. */
const WRAP_COLUMNS = 3;
/** Hueco contiguo bajo el umbral (fracción de los bins) que distingue un plegado de un espectro ancho. */
const WRAP_GAP = 0.15;
/** Por debajo de esta fracción de D, una onda es casi nula y su signo no cuenta. */
const S_SIGN_FRACTION = 0.25;
/**
 * Aliasing fuerte (decisión 94): mediana, sobre las columnas de la captura, de la potencia media en la mitad exterior de
 * la banda (|f| > PRF/4) sobre el ruido del receptor. Medido en la cadena del alumno en apnea: la sangre plegada deja
 * 3–21 dB (±6–14 cm/s en los tres territorios); la puerta fuera del vaso, con el clutter del tejido que respira,
 * −0,2 a +0,3 dB. Solo cambia el motivo de una captura que ya no era medible («no hay flujo» o «intermitente»).
 */
const SEVERE_ALIAS_OUTER_DB = 3;
/** Borde de la mitad exterior de la banda (fracción de la PRF). */
const OUTER_BAND = 0.25;

/** Mediana de la potencia media de |f| > OUTER_BAND·PRF sobre el ruido del receptor (dB). */
export function outerBandExcessDb(columns: readonly SpectralColumn[], receiverNoiseDb: number): number {
  const ex = columns.map((c) => {
    const N = c.powerDb.length;
    let s = 0;
    let n = 0;
    for (let k = 0; k < N; k++) {
      if (Math.abs(((k - N / 2) / N) * c.prfHz) <= OUTER_BAND * c.prfHz) continue;
      s += Math.pow(10, c.powerDb[k] / 10);
      n++;
    }
    return n ? 10 * Math.log10(s / n) - receiverNoiseDb : Number.NaN;
  });
  return median(ex.filter(Number.isFinite));
}

/**
 * ¿La onda de la suprahepática no se reproduce? `s` y `d` son los picos por latido, orientados por
 * el signo mediano de D (D > 0 anterógrada). Es inconsistente si hay latidos con S anterógrada y
 * otros con S invertida, o algún latido con D invertida: otro vaso ocupa la puerta a ratos. La
 * inversión sostenida de S (congestión grave) no es inconsistente.
 */
export function wavesInconsistent(s: readonly number[], d: readonly number[]): boolean {
  if (s.length < 2 || d.length === 0) return false;
  // Umbral fijo sobre D, no sobre la propia S: un umbral relativo a la S típica rechaza menos
  // capturas de FA, pero deja pasar una S invertida falsa (el cambio que sí altera el grado)
  const tau = S_SIGN_FRACTION * median(d.map(Math.abs));
  const sMixed = s.some((v) => v > tau) && s.some((v) => v < -tau);
  return sMixed || d.some((v) => v < -tau);
}

/** ¿Hay sangre en la columna? Devuelve la energía total y la de los bordes de la banda. */
export function bloodInColumn(
  col: SpectralColumn,
  opts: QualityOptions,
  /** Suelo de la columna (por defecto su mediana; en una captura, `captureNoiseFloorsDb`). */
  floor = noiseFloorDb(col),
): { present: boolean; energy: number; edgeEnergy: number; wrapped: boolean } {
  const N = col.powerDb.length;
  const thr = floor + (opts.marginDb ?? 12);
  // fuera del filtro de pared y de los 2 bins centrales (clutter residual), sin excluir venas lentas
  const fMin = flowBandMinHz(opts.wallFilterHz, col.prfHz, N);
  let energy = 0;
  let edgeEnergy = 0;
  let run = 0;
  let present = false;
  // envoltura: sangre en los dos bordes a la vez, se juzgue el lado que se juzgue
  let runPos = 0;
  let runNeg = 0;
  let edgePos = false;
  let edgeNeg = false;
  let gap = 0;
  let maxGap = 0;
  for (let k = 0; k < N; k++) {
    const f = ((k - N / 2) / N) * col.prfHz;
    // hueco: bins bajo el umbral fuera de la muesca del filtro de pared (que no cuenta ni corta)
    if (Math.abs(f) >= fMin) {
      gap = col.powerDb[k] > thr ? 0 : gap + 1;
      maxGap = Math.max(maxGap, gap);
    }
    const outer = Math.abs(f) > (0.5 - WRAP_BAND) * col.prfHz && col.powerDb[k] > thr;
    if (f > 0) {
      runPos = outer ? runPos + 1 : 0;
      if (runPos >= 2) edgePos = true;
    } else {
      runNeg = outer ? runNeg + 1 : 0;
      if (runNeg >= 2) edgeNeg = true;
    }
    const side = opts.side ?? 'both';
    const onSide = side === 'both' || (side === 'pos' ? f > 0 : f < 0);
    const above = onSide && Math.abs(f) >= fMin && col.powerDb[k] > thr;
    run = above ? run + 1 : 0;
    if (run >= 2) present = true;
    if (!above) continue;
    const p = Math.pow(10, (col.powerDb[k] - floor) / 10);
    energy += p;
    if (Math.abs(f) > (0.5 - EDGE_BAND / 2) * col.prfHz) edgeEnergy += p;
  }
  return { present, energy, edgeEnergy, wrapped: edgePos && edgeNeg && maxGap >= WRAP_GAP * N };
}

export function assessQuality(
  columns: readonly SpectralColumn[],
  beats: readonly Beat[],
  opts: QualityOptions,
  /** Picos S y D por latido (suprahepática): comprueban que la onda se reproduce. */
  waves?: { s: readonly number[]; d: readonly number[] },
): MeasurementQuality {
  let coveredBeats = 0;
  let validBeats = 0;
  let wrappedBeats = 0;
  let energy = 0;
  let edgeEnergy = 0;
  let columnsSeen = 0;
  let columnsWithBlood = 0;
  const floors = captureNoiseFloorsDb(columns);
  const floorOf = new Map(columns.map((c, i) => [c, floors[i]]));
  // por latido: fracción de columnas con sangre y cobertura de su ventana de fase
  const perBeat: { fraction: number; phaseCover: number }[] = [];
  for (const b of beats) {
    const inBeat = columns.filter((c) => c.t >= b.tR && c.t < b.tR + b.rr);
    // un latido a medias (PW recién encendido, o búfer corto a PRF alta) no dice nada del vaso
    if (inBeat.length === 0 || inBeat[inBeat.length - 1].t - inBeat[0].t < BEAT_COVERAGE * b.rr) continue;
    coveredBeats++;
    let withBlood = 0;
    let wrappedColumns = 0;
    let inPhase = 0;
    let phaseBlood = 0;
    const w = opts.phaseWindow?.(b);
    for (const c of inBeat) {
      const r = bloodInColumn(c, opts, floorOf.get(c));
      const present = opts.present ? opts.present(c) : r.present;
      if (present) withBlood++;
      if (w && c.t >= w[0] && c.t <= w[1]) {
        inPhase++;
        if (present) phaseBlood++;
      }
      if (r.wrapped) wrappedColumns++;
      energy += r.energy;
      edgeEnergy += r.edgeEnergy;
    }
    perBeat.push({ fraction: withBlood / inBeat.length, phaseCover: inPhase ? phaseBlood / inPhase : 0 });
    if (wrappedColumns >= WRAP_COLUMNS) wrappedBeats++;
    columnsSeen += inBeat.length;
    columnsWithBlood += withBlood;
  }
  // reproducibilidad frente a la mediana de los DEMÁS latidos: con 4 latidos, la mediana de todos
  // promedia los dos centrales y un reparto 2/2 (la sístole perdida en dos latidos) pasaba entero
  const othersMedian = (i: number): number => {
    const rest = perBeat.filter((_, j) => j !== i).map((p) => p.fraction);
    return rest.length ? median(rest) : perBeat[i].fraction;
  };
  for (const [i, p] of perBeat.entries()) {
    const full = p.fraction >= BEAT_SIGNAL_FRACTION;
    if (opts.phaseWindow === undefined) {
      if (full) validBeats++;
      continue;
    }
    // con ventana de fase, también el latido «lleno» debe reproducirse: otro vaso que entra a ratos
    // llena un latido entero entre latidos monofásicos
    const repeats = Math.abs(p.fraction - othersMedian(i)) <= PHASE_REPRODUCIBILITY;
    if (repeats && (full || p.phaseCover >= PHASE_COVERAGE)) validBeats++;
  }
  const edgeEnergyFraction = energy > 0 ? edgeEnergy / energy : 0;
  const bloodColumns = columnsSeen > 0 ? columnsWithBlood / columnsSeen : 0;
  let issue: QualityIssue | null = null;
  const aliased = wrappedBeats > 0 || edgeEnergyFraction > MAX_EDGE_ENERGY;
  if (coveredBeats === 0) issue = 'few-beats';
  // con ventana de fase (vena renal), el plegado se dice antes que la intermitencia: la onda D del
  // grave roza el Nyquist a 2600 Hz, se pliega al otro lado, deja su ventana sin sangre y se leía
  // «el vaso entra y sale de la puerta» (en apnea) en vez de «suba la escala»
  else if (validBeats === 0 && opts.phaseWindow !== undefined && aliased && bloodColumns >= MIN_BLOOD_COLUMNS) issue = 'aliasing';
  else if (validBeats === 0) issue = bloodColumns >= MIN_BLOOD_COLUMNS ? 'intermittent' : 'no-signal';
  else if (aliased) issue = 'aliasing';
  else if (validBeats < coveredBeats) issue = 'intermittent';
  else if (waves && wavesInconsistent(waves.s, waves.d)) issue = 'inconsistent';
  else if (validBeats < MIN_VALID_BEATS) issue = 'few-beats';
  // la sangre plegada varias veces llena la banda sin dejar banda que detectar: es aliasing, no «sin flujo»
  if (
    (issue === 'no-signal' || issue === 'intermittent') &&
    opts.receiverNoiseDb !== undefined &&
    outerBandExcessDb(columns, opts.receiverNoiseDb) >= SEVERE_ALIAS_OUTER_DB
  )
    issue = 'aliasing';
  return { beats: coveredBeats, validBeats, edgeEnergyFraction, wrappedBeats, bloodColumns, issue };
}
