import { describe, expect, it } from 'vitest';
import { patchSnr, RAYLEIGH_SNR, type EnvelopeFrame } from '../app/speckle';

/**
 * El estimador del speckle (guarda de imagen de la e2e) sobre campos sintéticos con la misma
 * geometría que el renderizador (192 líneas × 1024 muestras, pulso σ ≈ 1,5 muestras, haz σ ≈ 1
 * línea): debe dar Rayleigh con una envolvente coherente y salirse de la banda de la e2e
 * [1,6; 2,25] con los defectos que rompen el speckle.
 */
const LINES = 192;
const SAMPLES = 1024;
const BAND = [1.6, 2.25] as const;

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Campo complejo gaussiano blanco (re, im intercalados) por muestra y línea. */
function whiteField(seed: number): Float32Array {
  const rnd = rng(seed);
  const f = new Float32Array(LINES * SAMPLES * 2);
  for (let i = 0; i < LINES * SAMPLES; i++) {
    const r = Math.sqrt(-2 * Math.log(Math.max(1e-12, rnd())));
    const ph = 2 * Math.PI * rnd();
    f[i * 2] = r * Math.cos(ph);
    f[i * 2 + 1] = r * Math.sin(ph);
  }
  return f;
}

/** Convolución gaussiana separable de energía unitaria (como las pasadas C y D). */
function psf(field: Float32Array, sigmaAx: number, sigmaLat: number): Float32Array {
  const conv = (src: Float32Array, sigma: number, axial: boolean): Float32Array => {
    const R = Math.ceil(sigma * 2.5);
    const w = Array.from({ length: 2 * R + 1 }, (_, k) => Math.exp(-0.5 * ((k - R) / sigma) ** 2));
    const norm = Math.sqrt(w.reduce((a, x) => a + x * x, 0));
    const out = new Float32Array(src.length);
    for (let v = 0; v < SAMPLES; v++)
      for (let u = 0; u < LINES; u++) {
        let re = 0;
        let im = 0;
        for (let k = -R; k <= R; k++) {
          const vv = axial ? v + k : v;
          const uu = axial ? u : u + k;
          if (vv < 0 || vv >= SAMPLES || uu < 0 || uu >= LINES) continue;
          const i = (vv * LINES + uu) * 2;
          re += w[k + R] * src[i];
          im += w[k + R] * src[i + 1];
        }
        const o = (v * LINES + u) * 2;
        out[o] = re / norm;
        out[o + 1] = im / norm;
      }
    return out;
  };
  return conv(conv(field, sigmaAx, true), sigmaLat, false);
}

function envelope(field: Float32Array, map: (re: number, im: number) => number): EnvelopeFrame {
  const data = new Float32Array(LINES * SAMPLES);
  for (let i = 0; i < data.length; i++) data[i] = map(field[i * 2], field[i * 2 + 1]);
  return { lines: LINES, samples: SAMPLES, data };
}

const everywhere = (): boolean => true;
const coherent = psf(whiteField(7), 1.5, 1.0);

describe('estadística del speckle (guarda de imagen)', () => {
  it('una envolvente coherente da la SNR de Rayleigh', () => {
    const s = patchSnr(envelope(coherent, Math.hypot), everywhere);
    expect(s.patches).toBe((LINES / 8) * (SAMPLES / 16));
    // el parche 16 × 8 contiene ~20 células correlacionadas: sesgo ≈ +5 % (2,00 con esta semilla)
    expect(s.snr).toBeGreaterThan(RAYLEIGH_SNR - 0.05);
    expect(s.snr).toBeLessThan(RAYLEIGH_SNR * 1.1);
    expect(s.snr).toBeGreaterThan(BAND[0]);
    expect(s.snr).toBeLessThan(BAND[1]);
  });

  it('un segmento de una sola línea sesga la SNR al alza (por eso el parche es 2D)', () => {
    const s = patchSnr(envelope(coherent, Math.hypot), everywhere, { axial: 16, lateral: 1 });
    expect(s.snr).toBeGreaterThan(2.2);
  });

  it('la intensidad (sin raíz) sale por abajo de la banda: SNR exponencial = 1', () => {
    const s = patchSnr(
      envelope(coherent, (re, im) => re * re + im * im),
      everywhere,
    );
    expect(s.snr).toBeLessThan(BAND[0]);
  });

  it('la detección incoherente (magnitudes sumadas antes del haz) sale por arriba', () => {
    // el campo blanco se detecta ANTES de la PSF: se suman amplitudes, no fasores
    const white = whiteField(11);
    const mags = new Float32Array(white.length);
    for (let i = 0; i < LINES * SAMPLES; i++) mags[i * 2] = Math.hypot(white[i * 2], white[i * 2 + 1]);
    const s = patchSnr(
      envelope(psf(mags, 1.5, 1.0), (re) => re),
      everywhere,
    );
    expect(s.snr).toBeGreaterThan(BAND[1]);
  });

  it('suavizar la envolvente (persistencia espacial, compuesto) sale por arriba', () => {
    const env = envelope(coherent, Math.hypot);
    const smooth = new Float32Array(env.data.length);
    for (let v = 0; v < SAMPLES; v++)
      for (let u = 0; u < LINES; u++) {
        let acc = 0;
        let n = 0;
        for (let du = -1; du <= 1; du++)
          for (let dv = -2; dv <= 2; dv++) {
            const uu = u + du;
            const vv = v + dv;
            if (uu < 0 || uu >= LINES || vv < 0 || vv >= SAMPLES) continue;
            acc += env.data[vv * LINES + uu];
            n++;
          }
        smooth[v * LINES + u] = acc / n;
      }
    const s = patchSnr({ ...env, data: smooth }, everywhere);
    expect(s.snr).toBeGreaterThan(BAND[1]);
  });

  it('solo cuenta los parches cuyas muestras de control están dentro', () => {
    const env = envelope(coherent, Math.hypot);
    expect(patchSnr(env, () => false).patches).toBe(0);
    expect(patchSnr(env, () => false).snr).toBeNaN();
    // la mitad superficial de la imagen: la mitad de los parches
    const half = patchSnr(env, (_u, v) => v < SAMPLES / 2);
    expect(half.patches).toBe((LINES / 8) * (SAMPLES / 32));
  });
});
