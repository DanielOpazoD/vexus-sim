/**
 * Estadísticos de listas que comparten las métricas del banco de fidelidad: mediana, percentil, desviación típica y
 * correlación de Pearson.
 */

/** Mediana (NaN si vacío). */
export function medianOf(a: readonly number[]): number {
  if (!a.length) return Number.NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1];
}

/** Percentil `p` (0–1) por rango (NaN si vacío). */
export function percentileOf(a: readonly number[], p: number): number {
  if (!a.length) return Number.NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

/** Desviación típica poblacional (NaN si vacío). */
export function sdOf(a: readonly number[]): number {
  if (!a.length) return Number.NaN;
  const m = a.reduce((s, x) => s + x, 0) / a.length;
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length);
}

export function pearson(x: Float64Array, y: Float64Array): number {
  const n = x.length;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i];
    my += y[i];
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i] - mx;
    const b = y[i] - my;
    sxy += a * b;
    sxx += a * a;
    syy += b * b;
  }
  return sxy / Math.sqrt(sxx * syy);
}
