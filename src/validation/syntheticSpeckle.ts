/**
 * Campos de moteado sintéticos para probar las métricas de imagen sin WebGL (`speckle.test.ts`,
 * `fidelity.test.ts`): campo complejo gaussiano blanco por muestra y línea, PSF gaussiana
 * separable de energía unitaria (como las pasadas C y D del renderizador) y detección. Sin
 * imports: la capa `validation` no depende de ninguna otra (`layers.test.ts`).
 */
export interface Grid {
  lines: number;
  samples: number;
}

/** Generador determinista (mulberry32). */
export function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Campo complejo gaussiano blanco (re, im intercalados; índice (muestra · líneas + línea) · 2). */
export function whiteField(g: Grid, seed: number): Float32Array {
  const rnd = rng(seed);
  const f = new Float32Array(g.lines * g.samples * 2);
  for (let i = 0; i < g.lines * g.samples; i++) {
    const r = Math.sqrt(-2 * Math.log(Math.max(1e-12, rnd())));
    const ph = 2 * Math.PI * rnd();
    f[i * 2] = r * Math.cos(ph);
    f[i * 2 + 1] = r * Math.sin(ph);
  }
  return f;
}

/** Convolución gaussiana separable de energía unitaria (Σw² = 1), axial y luego lateral. */
export function psf(g: Grid, field: Float32Array, sigmaAx: number, sigmaLat: number): Float32Array {
  const conv = (src: Float32Array, sigma: number, axial: boolean): Float32Array => {
    const R = Math.ceil(sigma * 2.5);
    const w = Array.from({ length: 2 * R + 1 }, (_, k) => Math.exp(-0.5 * ((k - R) / sigma) ** 2));
    const norm = Math.sqrt(w.reduce((a, x) => a + x * x, 0));
    const out = new Float32Array(src.length);
    for (let v = 0; v < g.samples; v++)
      for (let u = 0; u < g.lines; u++) {
        let re = 0;
        let im = 0;
        for (let k = -R; k <= R; k++) {
          const vv = axial ? v + k : v;
          const uu = axial ? u : u + k;
          if (vv < 0 || vv >= g.samples || uu < 0 || uu >= g.lines) continue;
          const i = (vv * g.lines + uu) * 2;
          re += w[k + R] * src[i];
          im += w[k + R] * src[i + 1];
        }
        const o = (v * g.lines + u) * 2;
        out[o] = re / norm;
        out[o + 1] = im / norm;
      }
    return out;
  };
  return conv(conv(field, sigmaAx, true), sigmaLat, false);
}

/** Detección por muestra: `map(re, im)` (Math.hypot = envolvente coherente). */
export function detect(
  g: Grid,
  field: Float32Array,
  map: (re: number, im: number) => number,
): { lines: number; samples: number; data: Float32Array } {
  const data = new Float32Array(g.lines * g.samples);
  for (let i = 0; i < data.length; i++) data[i] = map(field[i * 2], field[i * 2 + 1]);
  return { lines: g.lines, samples: g.samples, data };
}
