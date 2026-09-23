import { describe, expect, it } from 'vitest';
import { patchSnr, RAYLEIGH_SNR, type EnvelopeFrame } from '../app/speckle';
import { detect, psf as gaussPsf, whiteField as white } from './syntheticSpeckle';

/**
 * El estimador del speckle (guarda de imagen de la e2e) sobre campos sintéticos con la misma
 * geometría que el renderizador (192 líneas × 1024 muestras, pulso σ ≈ 1,5 muestras, haz σ ≈ 1
 * línea): debe dar Rayleigh con una envolvente coherente y salirse de la banda de la e2e
 * [1,6; 2,25] con los defectos que rompen el speckle.
 */
const LINES = 192;
const SAMPLES = 1024;
const BAND = [1.6, 2.25] as const;

const G = { lines: LINES, samples: SAMPLES };
const whiteField = (seed: number): Float32Array => white(G, seed);
const psf = (field: Float32Array, sigmaAx: number, sigmaLat: number): Float32Array => gaussPsf(G, field, sigmaAx, sigmaLat);
const envelope = (field: Float32Array, map: (re: number, im: number) => number): EnvelopeFrame => detect(G, field, map);

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
