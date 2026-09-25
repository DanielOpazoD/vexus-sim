import { steeredApertureTransmission, type ApertureGeometry } from '../ultrasound/aperture';
import { steeredPrefixDb, type SegmentGrid, type SteeredPrefix } from '../ultrasound/transmission';

/**
 * Paridad de la mirada dirigida de la GPU con sus gemelos de TS (G8, decisión 58), sin WebGL: la usa el
 * gancho `transmissionParity({ look })` sobre lo que lee de la GPU y la prueban `steeredParity.test.ts`.
 *
 * Empates de redondeo. La GPU elige en float32 la línea que cruza el camino en cada fila (A2) y las tomas
 * del cono (A), redondeando `x + 0,5` hacia abajo; el gemelo lo hace en float64. Una muestra cuyo resultado
 * cambia al desplazar TODOS esos argumentos ±`STEERED_TIE_LINES` líneas (`roundBias` de los gemelos) está
 * en un empate: se cuenta aparte y no entra en el máximo. El margen es absoluto porque el error también lo
 * es: emulado operación a operación en float32, ≤ 1,1·10⁻⁵ líneas en la línea del camino y ≤ 4,3·10⁻⁵ en
 * las tomas del cono (en las primeras filas, con ±8°), y el asin de la GPU añade ~10⁻⁶ líneas por ULP
 * (`steeredParity.test.ts` exige ≤ la mitad del margen en θ = 6–8°). Antes el empate se buscaba con
 * θ·(1 ± 2·10⁻⁴): un desplazamiento de hasta 2·10⁻³ líneas en las filas hondas (100 veces el error de
 * float32) que marcaba 0,6–1,4 % de las muestras, cerca del 1 % que admite la e2e.
 */
export const STEERED_TIE_LINES = 1e-4;

/** Diferencia (dB) a partir de la cual el desplazamiento del redondeo cambia una muestra. */
const TIE_DB = 1e-3;

/** Gemelos del prefijo dirigido de A2 y de la transmisión con apertura de A en (línea, fila k). */
export interface SteeredTwin {
  db: (l: number, k: number) => number;
  aperture: (l: number, k: number) => number;
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
  return {
    db: (l, k) => pre(l, k).db,
    aperture: (l, k) =>
      steeredApertureTransmission(
        ap,
        theta,
        l,
        (k + 0.5) * grid.stepMm,
        (m) => Math.pow(10, -pre(m, k).db / 40),
        (m) => {
          const o = first(pre(m, k).sGas, pre(m, k).sBone);
          return o >= 0 ? o : Infinity;
        },
        roundBias,
      ),
  };
}

/** Lo que la paridad lee de la GPU: prefijo de A2 (dB) y transmisión con apertura de A, fila k·líneas + línea. */
export interface SteeredGpuRead {
  lines: number;
  samples: number;
  prefixDb: ArrayLike<number>;
  aperture: ArrayLike<number>;
}

export interface SteeredParity {
  lines: number;
  samples: number;
  maxDiffDb: number;
  apertureMaxDiffDb: number;
  ambiguous: number;
  worst: { line: number; depthMm: number; cpuDb: number; gpuDb: number; tissue: string } | null;
}

/**
 * Compara, cada `every` líneas y en todas las filas, el prefijo y la transmisión con apertura de la GPU con
 * los gemelos sobre los mismos segmentos. Se saltan las muestras con los dos prefijos bajo −60 dB.
 */
export function compareSteeredTransmission(
  grid: SegmentGrid,
  ap: ApertureGeometry,
  theta: number,
  gpu: SteeredGpuRead,
  every: number,
  tieLines = STEERED_TIE_LINES,
): SteeredParity {
  const exact = steeredTransmissionTwin(grid, ap, theta);
  const lo = steeredTransmissionTwin(grid, ap, theta, -tieLines);
  const hi = steeredTransmissionTwin(grid, ap, theta, tieLines);
  const db = (x: number) => -20 * Math.log10(Math.max(x, 1e-12));
  let lines = 0;
  let samples = 0;
  let ambiguous = 0;
  let maxDiffDb = 0;
  let apertureMaxDiffDb = 0;
  let worst: SteeredParity['worst'] = null;
  for (let u = 0; u < gpu.lines; u += every) {
    lines++;
    for (let k = 0; k < gpu.samples; k++) {
      const i = k * gpu.lines + u;
      const tsDb = exact.db(u, k);
      const gpuDb = gpu.prefixDb[i];
      if (tsDb > 60 && gpuDb > 60) continue;
      const tsAp = db(exact.aperture(u, k));
      const gpuAp = db(gpu.aperture[i]);
      const tie =
        Math.abs(lo.db(u, k) - tsDb) > TIE_DB ||
        Math.abs(hi.db(u, k) - tsDb) > TIE_DB ||
        Math.abs(db(lo.aperture(u, k)) - tsAp) > TIE_DB ||
        Math.abs(db(hi.aperture(u, k)) - tsAp) > TIE_DB;
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
      if (tsAp < 60 || gpuAp < 60) apertureMaxDiffDb = Math.max(apertureMaxDiffDb, Math.abs(tsAp - gpuAp));
    }
  }
  return { lines, samples, maxDiffDb, apertureMaxDiffDb, ambiguous, worst };
}
