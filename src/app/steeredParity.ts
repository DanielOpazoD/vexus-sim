import { type ApertureGeometry } from '../ultrasound/aperture';
import { type SegmentGrid } from '../ultrasound/transmission';
import {
  apertureEcho,
  lineHits,
  prefixDb,
  refractionGain,
  refractionPsi,
  refractionSlope,
  steeredApertureEcho,
  steeredPrefixDb,
  type ApertureEcho,
  type SteeredPrefix,
} from '../ultrasound/transmissionTwin';

/**
 * Paridad de la mirada dirigida de la GPU con sus gemelos de TS (G8, decisión 58), sin WebGL: la usa el
 * gancho `transmissionParity({ look })` sobre lo que lee de la GPU y la prueban `steeredParity.test.ts`.
 *
 * Empates de redondeo. La GPU elige en float32 la línea que cruza el camino en cada fila (A2) y las de los tramos de la
 * refracción de las luces (A), redondeando `x + 0,5` hacia abajo; el gemelo lo hace en float64 (el cono de la penumbra ya
 * no redondea: es la integral exacta de su ventana sobre las líneas, decisión 91). Una muestra cuyo resultado
 * cambia al desplazar TODOS esos argumentos ±`STEERED_TIE_LINES` líneas (`roundBias` de los gemelos) está
 * en un empate: se cuenta aparte y no entra en el máximo. El margen es absoluto porque el error también lo
 * es: emulado operación a operación en float32, ≤ 1,1·10⁻⁵ líneas en la línea del camino (y ≤ 4,3·10⁻⁵ en
 * las tomas del cono de antes de la decisión 91, en las primeras filas, con ±8°), y el asin de la GPU añade ~10⁻⁶ líneas por ULP
 * (`steeredParity.test.ts` exige ≤ la mitad del margen en θ = 6–8°). Antes el empate se buscaba con
 * θ·(1 ± 2·10⁻⁴): un desplazamiento de hasta 2·10⁻³ líneas en las filas hondas (100 veces el error de
 * float32) que marcaba 0,6–1,4 % de las muestras, cerca del 1 % que admite la e2e.
 */
export const STEERED_TIE_LINES = 1e-4;

/** Diferencia (dB) a partir de la cual el desplazamiento del redondeo cambia una muestra del prefijo. */
const TIE_DB = 1e-3;
/**
 * La de la transmisión con apertura: la mitad de lo que admite la e2e (0,01 dB). Desde la decisión 91 cada muestra
 * integra todas las líneas de su cono (antes, nueve tomas), así que un empate del camino de una línea vecina la mueve
 * lo que esa línea pesa en el cono: con el umbral del prefijo marcaba 0,3–0,9 % de las muestras en las cuatro vistas
 * (0,2–0,6 % con las tomas). Por debajo de la mitad de la tolerancia, el redondeo de la GPU no la saca de ella.
 */
export const TIE_APERTURE_DB = 5e-3;

/**
 * Gemelos del prefijo dirigido de A2 y de la transmisión con apertura (y refracción, decisión 86) de A en (línea, fila k), y
 * la de los ecos especulares (A o2.w, decisión 91; sin la refracción).
 */
export interface SteeredTwin {
  db: (l: number, k: number) => number;
  aperture: (l: number, k: number) => number;
  specular: (l: number, k: number) => number;
}

/** `steeredPrefixDb` y `steeredApertureTransmission` sobre la rejilla, con los redondeos desplazados `roundBias`. */
export function steeredTransmissionTwin(grid: SegmentGrid, ap: ApertureGeometry, theta: number, roundBias = 0): SteeredTwin {
  const cache = new Map<number, SteeredPrefix>();
  const pre = (l: number, k: number): SteeredPrefix => {
    const key = l * grid.rows + k;
    let p = cache.get(key);
    if (!p) {
      p = steeredPrefixDb(grid, ap, theta, l, k, roundBias);
      cache.set(key, p);
    }
    return p;
  };
  const first = (a: number, b: number) => (a >= 0 ? (b >= 0 ? Math.min(a, b) : a) : b);
  const echoes = new Map<number, ApertureEcho>();
  const echo = (l: number, k: number): ApertureEcho => {
    const key = l * grid.rows + k;
    let e = echoes.get(key);
    if (!e) {
      e = steeredApertureEcho(
        ap,
        theta,
        l,
        (k + 0.5) * grid.stepMm,
        (m) => Math.pow(10, -pre(m, k).db / 40),
        (m) => {
          const o = first(pre(m, k).sGas, pre(m, k).sBone);
          return o >= 0 ? o : Infinity;
        },
      );
      echoes.set(key, e);
    }
    return e;
  };
  return {
    db: (l, k) => pre(l, k).db,
    // la penumbra y la refracción en las luces del camino dirigido (decisión 86), como la pasada A
    aperture: (l, k) => echo(l, k).diffuse * refractionGain(ap, grid.stepMm, l, k, (m) => pre(m, k), roundBias),
    specular: (l, k) => echo(l, k).specular,
  };
}

/**
 * Gemelos de A2 y A de la mirada 0 (decisiones 54 y 86): el prefijo de la línea (`prefixDb`), la penumbra con el primer
 * gas o hueso de A0 en el centro de su segmento (como `APERTURE_GLSL` con uHits0) y la refracción de las luces con la Ψ̃
 * de cada línea (`refractionPsi`) y su pendiente (`refractionSlope`). Con `roundBias`, los redondeos
 * de los tramos de la refracción desplazados (empates).
 */
export function look0TransmissionTwin(grid: SegmentGrid, ap: ApertureGeometry, roundBias = 0): SteeredTwin {
  const pre = new Map<number, number>();
  const psiCache = new Map<number, number>();
  const cached = (m: Map<number, number>, key: number, f: () => number): number => {
    let v = m.get(key);
    if (v === undefined) {
      v = f();
      m.set(key, v);
    }
    return v;
  };
  const db = (l: number, k: number) => cached(pre, l * grid.rows + k, () => prefixDb(grid, l, k).db);
  const psi = (l: number, k: number) => cached(psiCache, l * grid.rows + k, () => refractionPsi(grid, ap.curvatureRadius, l, k));
  const slopeCache = new Map<number, number>();
  const slope = (l: number, k: number) => cached(slopeCache, l * grid.rows + k, () => refractionSlope(grid, ap.curvatureRadius, l, k));
  const hits = new Map<number, number>();
  // el primer gas o hueso de A0 (h0.y/h0.z) si la rejilla viene de la GPU, como `APERTURE_GLSL`; si no, de las marcas de A1
  const obstacle = (l: number): number =>
    cached(hits, l, () => {
      const h = grid.hitGasSeg && grid.hitBoneSeg ? { gasSeg: grid.hitGasSeg[l], boneSeg: grid.hitBoneSeg[l] } : lineHits(grid, l);
      const seg = h.gasSeg >= 0 ? (h.boneSeg >= 0 ? Math.min(h.gasSeg, h.boneSeg) : h.gasSeg) : h.boneSeg;
      return seg >= 0 ? (seg + 0.5) * grid.stepMm : Infinity;
    });
  const echoes = new Map<number, ApertureEcho>();
  const echo = (l: number, k: number): ApertureEcho => {
    const key = l * grid.rows + k;
    let e = echoes.get(key);
    if (!e) {
      e = apertureEcho(ap, l, (k + 0.5) * grid.stepMm, (m) => Math.pow(10, -db(m, k) / 40), obstacle);
      echoes.set(key, e);
    }
    return e;
  };
  return {
    db,
    aperture: (l, k) =>
      echo(l, k).diffuse * refractionGain(ap, grid.stepMm, l, k, (m) => ({ psi: psi(m, k), slope: slope(m, k) }), roundBias),
    specular: (l, k) => echo(l, k).specular,
  };
}

/**
 * Lo que la paridad lee de la GPU: prefijo de A2 (dB), transmisión con apertura de A y, si la hay, la de los especulares
 * (A o2.w), fila k·líneas + línea.
 */
export interface SteeredGpuRead {
  lines: number;
  samples: number;
  prefixDb: ArrayLike<number>;
  aperture: ArrayLike<number>;
  specular?: ArrayLike<number>;
}

export interface SteeredParity {
  lines: number;
  samples: number;
  maxDiffDb: number;
  apertureMaxDiffDb: number;
  /** El peor desacuerdo de la transmisión de los especulares (dB, decisión 91); 0 si la GPU no la dio. */
  specularMaxDiffDb: number;
  ambiguous: number;
  worst: { line: number; depthMm: number; cpuDb: number; gpuDb: number; tissue: string } | null;
  /** Dónde está el peor desacuerdo de la transmisión con apertura (dB de los gemelos y de la GPU). */
  worstAperture: { line: number; depthMm: number; tsDb: number; gpuDb: number } | null;
}

/**
 * Compara, cada `every` líneas y en todas las filas, el prefijo y la transmisión con apertura de la GPU con
 * los gemelos sobre los mismos segmentos. Se saltan las muestras con los dos prefijos bajo −60 dB. `twinOf` da los
 * gemelos con un desplazamiento del redondeo: por omisión, los de la mirada θ; la mirada 0 pasa `look0TransmissionTwin`.
 */
export function compareSteeredTransmission(
  grid: SegmentGrid,
  ap: ApertureGeometry,
  theta: number,
  gpu: SteeredGpuRead,
  every: number,
  tieLines = STEERED_TIE_LINES,
  twinOf: (roundBias: number) => SteeredTwin = (b) => steeredTransmissionTwin(grid, ap, theta, b),
): SteeredParity {
  const exact = twinOf(0);
  const lo = twinOf(-tieLines);
  const hi = twinOf(tieLines);
  const db = (x: number) => -20 * Math.log10(Math.max(x, 1e-12));
  let lines = 0;
  let samples = 0;
  let ambiguous = 0;
  let maxDiffDb = 0;
  let apertureMaxDiffDb = 0;
  let specularMaxDiffDb = 0;
  let worst: SteeredParity['worst'] = null;
  let worstAperture: SteeredParity['worstAperture'] = null;
  for (let u = 0; u < gpu.lines; u += every) {
    lines++;
    for (let k = 0; k < gpu.samples; k++) {
      const i = k * gpu.lines + u;
      const tsDb = exact.db(u, k);
      const gpuDb = gpu.prefixDb[i];
      if (tsDb > 60 && gpuDb > 60) continue;
      const tsAp = db(exact.aperture(u, k));
      const gpuAp = db(gpu.aperture[i]);
      const tsSpec = gpu.specular ? db(exact.specular(u, k)) : 0;
      const tie =
        Math.abs(lo.db(u, k) - tsDb) > TIE_DB ||
        Math.abs(hi.db(u, k) - tsDb) > TIE_DB ||
        Math.abs(db(lo.aperture(u, k)) - tsAp) > TIE_APERTURE_DB ||
        Math.abs(db(hi.aperture(u, k)) - tsAp) > TIE_APERTURE_DB ||
        (gpu.specular !== undefined &&
          (Math.abs(db(lo.specular(u, k)) - tsSpec) > TIE_APERTURE_DB || Math.abs(db(hi.specular(u, k)) - tsSpec) > TIE_APERTURE_DB));
      if (tie) {
        ambiguous++;
        continue;
      }
      samples++;
      const diff = Math.abs(tsDb - gpuDb);
      if (diff > maxDiffDb) {
        maxDiffDb = diff;
        worst = { line: u, depthMm: (k + 0.5) * grid.stepMm, cpuDb: tsDb, gpuDb, tissue: 'prefijo dirigido' };
      }
      if ((tsAp < 60 || gpuAp < 60) && Math.abs(tsAp - gpuAp) > apertureMaxDiffDb) {
        apertureMaxDiffDb = Math.abs(tsAp - gpuAp);
        worstAperture = { line: u, depthMm: (k + 0.5) * grid.stepMm, tsDb: tsAp, gpuDb: gpuAp };
      }
      if (gpu.specular) {
        const gpuSpec = db(gpu.specular[i]);
        if (tsSpec < 60 || gpuSpec < 60) specularMaxDiffDb = Math.max(specularMaxDiffDb, Math.abs(tsSpec - gpuSpec));
      }
    }
  }
  return { lines, samples, maxDiffDb, apertureMaxDiffDb, specularMaxDiffDb, ambiguous, worst, worstAperture };
}
