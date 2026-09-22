/**
 * Utilidades sobre series temporales y listas de números, compartidas por la
 * medición de la verdad fisiológica (`vexus/measurements.ts`) y la medición
 * del espectro adquirido (`doppler/spectralMeasure.ts`). Sin dependencias.
 */
export type TimeWindow = readonly [number, number];

/** Mediana; NaN si la lista está vacía. */
export function median(xs: readonly number[]): number {
  if (!xs.length) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
}

/**
 * Valor `v` del elemento que maximiza `pick(v)` dentro de la ventana `w`
 * (por ejemplo `pick = (v) => v` para el máximo, `(v) => -v` para el mínimo,
 * `Math.abs` para el de mayor magnitud). NaN si no hay muestras en la ventana.
 */
export function extremeInWindow<T>(
  xs: readonly T[],
  w: TimeWindow,
  t: (x: T) => number,
  v: (x: T) => number,
  pick: (v: number) => number,
): number {
  let best = Number.NaN;
  for (const x of xs) {
    const tx = t(x);
    // Ventana NaN (p. ej. onda A inexistente en fibrilación auricular) = vacía
    if (!(tx >= w[0] && tx <= w[1])) continue;
    const vx = v(x);
    if (Number.isNaN(best) || pick(vx) > pick(best)) best = vx;
  }
  return best;
}

/**
 * Extremo ROBUSTO en una ventana: el valor cuyo `pick` ocupa el cuantil `q` (0,9 = se
 * descarta el 10 % más extremo). Para trazas medidas sobre el espectro, donde una
 * columna aislada con caída de señal o ruido no debe decidir el pico; con q = 1 es
 * `extremeInWindow`. NaN si la ventana está vacía.
 */
export function robustExtremeInWindow<T>(
  xs: readonly T[],
  w: TimeWindow,
  t: (x: T) => number,
  v: (x: T) => number,
  pick: (v: number) => number,
  q = 0.9,
): number {
  const vals: number[] = [];
  for (const x of xs) {
    const tx = t(x);
    if (!(tx >= w[0] && tx <= w[1])) continue;
    vals.push(v(x));
  }
  if (!vals.length) return Number.NaN;
  vals.sort((a, b) => pick(a) - pick(b));
  return vals[Math.min(vals.length - 1, Math.floor(q * (vals.length - 1) + 0.5))];
}
