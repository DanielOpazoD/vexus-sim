import { describe, expect, it } from 'vitest';
import { FFT, hannWindow } from '../core/fft';
import { SeededRandom } from '../core/random';
import {
  C_RECONSTRUCTION_MM_S,
  dopplerShiftHz,
  nyquistVelocityCms,
  prfFromNyquistCms,
  velocityFromShiftMmS,
  wrapToNyquist,
} from '../core/units';
import {
  SpectralProcessor,
  columnBandEnvelopes,
  columnEnvelope,
  columnPercentileEnvelope,
  noiseFloorDb,
  peakFrequency,
  type SpectralColumn,
} from '../doppler/spectral';
import { robustExtremeInWindow } from '../core/series';
import { WallFilter } from '../doppler/wallFilter';

/**
 * Procesado de señal Doppler con valores CERRADOS (nivel rápido): unidades,
 * FFT, filtro de pared, STFT y envolvente. Ninguna aserción depende de la
 * calibración del simulador; solo de matemáticas.
 */
function complexTone(fHz: number, prfHz: number, n: number): { re: Float32Array; im: Float32Array } {
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    re[i] = Math.cos((2 * Math.PI * fHz * i) / prfHz);
    im[i] = Math.sin((2 * Math.PI * fHz * i) / prfHz);
  }
  return { re, im };
}

describe('Unidades Doppler', () => {
  it('fD = 2·f0·v/c exacta, inversa de la corrección angular y plegado en los bordes de Nyquist', () => {
    expect(C_RECONSTRUCTION_MM_S).toBe(1_540_000);
    expect(dopplerShiftHz(200, 3e6)).toBeCloseTo(779.220779220779, 6);
    expect(dopplerShiftHz(100, 3e6)).toBeCloseTo(dopplerShiftHz(200, 3e6) / 2, 9);
    for (const v of [-300, -12.83, 0, 200]) {
      expect(velocityFromShiftMmS(dopplerShiftHz(v, 2.5e6), 2.5e6, 0)).toBeCloseTo(v, 9);
    }
    // la corrección angular solo rotula: divide por cos α
    expect(velocityFromShiftMmS(500, 3e6, Math.PI / 3) / velocityFromShiftMmS(500, 3e6, 0)).toBeCloseTo(2, 9);
    expect(Number.isNaN(velocityFromShiftMmS(500, 3e6, Math.PI / 2))).toBe(true);
    // plegado: intervalo [−PRF/2, PRF/2), borde superior cae en el inferior
    expect(wrapToNyquist(600, 1000)).toBeCloseTo(-400, 9);
    expect(wrapToNyquist(-600, 1000)).toBeCloseTo(400, 9);
    expect(wrapToNyquist(500, 1000)).toBeCloseTo(-500, 9);
    expect(wrapToNyquist(-500, 1000)).toBeCloseTo(-500, 9);
    expect(wrapToNyquist(2500, 1000)).toBeCloseTo(-500, 9);
    expect(wrapToNyquist(-1500, 1000)).toBeCloseTo(-500, 9);
    for (let f = -3000; f <= 3000; f += 137) {
      const w = wrapToNyquist(f, 1000);
      expect(w).toBeGreaterThanOrEqual(-500);
      expect(w).toBeLessThan(500);
      expect(wrapToNyquist(w, 1000)).toBeCloseTo(w, 9);
    }
  });

  it('la escala de Nyquist y su inversa son consistentes y dependen de cos α', () => {
    const f0 = 2.5e6;
    expect(nyquistVelocityCms(2500, f0)).toBeCloseTo((1250 * 1_540_000) / (2 * f0) / 10, 9);
    expect(prfFromNyquistCms(nyquistVelocityCms(2600, f0), f0)).toBeCloseTo(2600, 9);
    expect(nyquistVelocityCms(2500, f0, Math.PI / 3)).toBeCloseTo(2 * nyquistVelocityCms(2500, f0), 9);
  });
});

describe('FFT', () => {
  it('delta → espectro plano; tono complejo → un solo bin; coseno → dos bins; Parseval; Hann periódica', () => {
    const N = 64;
    const fft = new FFT(N);
    const re = new Float32Array(N);
    const im = new Float32Array(N);
    re[0] = 1;
    fft.forward(re, im);
    for (let k = 0; k < N; k++) {
      expect(re[k]).toBe(1);
      expect(im[k]).toBe(0);
    }
    const tone = complexTone(5 * (1000 / N), 1000, N); // bin +5 exacto
    fft.forward(tone.re, tone.im);
    expect(tone.re[5]).toBeCloseTo(N, 3);
    expect(tone.im[5]).toBeCloseTo(0, 3);
    let leak = 0;
    for (let k = 0; k < N; k++) if (k !== 5) leak = Math.max(leak, Math.hypot(tone.re[k], tone.im[k]));
    expect(leak).toBeLessThan(1e-4);
    const cosRe = new Float32Array(N);
    const cosIm = new Float32Array(N);
    for (let i = 0; i < N; i++) cosRe[i] = Math.cos((2 * Math.PI * 5 * i) / N);
    fft.forward(cosRe, cosIm);
    expect(Math.hypot(cosRe[5], cosIm[5])).toBeCloseTo(N / 2, 3);
    expect(Math.hypot(cosRe[N - 5], cosIm[N - 5])).toBeCloseTo(N / 2, 3);
    // Parseval con ruido con semilla
    const rng = new SeededRandom(1);
    const xr = new Float32Array(N);
    const xi = new Float32Array(N);
    let ex = 0;
    for (let i = 0; i < N; i++) {
      xr[i] = rng.gaussian();
      xi[i] = rng.gaussian();
      ex += xr[i] * xr[i] + xi[i] * xi[i];
    }
    fft.forward(xr, xi);
    let eX = 0;
    for (let k = 0; k < N; k++) eX += xr[k] * xr[k] + xi[k] * xi[k];
    expect(eX / (N * ex)).toBeCloseTo(1, 3);
    const w = hannWindow(128);
    expect(w[0]).toBe(0);
    expect(w[64]).toBe(1);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(64, 5);
    for (let i = 1; i < 128; i++) expect(w[i]).toBeCloseTo(w[128 - i], 6);
    expect(() => new FFT(100)).toThrow();
  });
});

describe('Filtro de pared', () => {
  it('borra exactamente la continua, vale ½ en el corte (dos secciones Q = 1/√2), deja pasar Nyquist', () => {
    const f = new WallFilter(100, 2500);
    expect(f.magnitude(0)).toBe(0);
    expect(f.magnitude(100)).toBeCloseTo(0.5, 9);
    expect(f.magnitude(1250)).toBeCloseTo(1, 9);
    expect(f.magnitude(200)).toBeGreaterThan(0.9);
    expect(f.magnitude(50)).toBeLessThan(0.1);
    const g = new WallFilter(25, 2600);
    expect(g.magnitude(25)).toBeCloseTo(0.5, 9);
    expect(g.magnitude(600)).toBeCloseTo(1, 5);
    // el diseño recorta fc a 0,45·fs
    expect(new WallFilter(2000, 2500).magnitude(1125)).toBeCloseTo(0.5, 9);
    // corte 0 = identidad
    const id = new WallFilter(0, 2500);
    for (const fr of [0, 100, 700]) expect(id.magnitude(fr)).toBe(1);
    // estado: la continua se extingue y reset() reinicia el transitorio
    const re = new Float32Array(4000).fill(1);
    const im = new Float32Array(4000);
    f.process(re, im);
    expect(Math.abs(re[3999])).toBeLessThan(1e-6);
    f.reset();
    const re2 = new Float32Array(4).fill(1);
    f.process(re2, new Float32Array(4));
    expect(re2[0]).toBeGreaterThan(0.6); // b0² de las dos secciones: el transitorio ha vuelto a empezar
  });
});

describe('STFT y envolvente', () => {
  const prf = 2048;
  const N = 128; // df = 16 Hz exacto

  it('coloca un tono en su bin exacto, pliega PRF/2 al bin 0 y fecha cada columna en el centro de su ventana', () => {
    const sp = new SpectralProcessor({ fftSize: N, hop: 16 });
    sp.sync(10, prf);
    const z = complexTone(320, prf, N);
    sp.push(z.re, z.im, N);
    expect(sp.columns.length).toBe(1);
    expect(peakFrequency(sp.columns[0], N)).toBe(320);
    expect(sp.columns[0].t).toBeCloseTo(10 + 64 / prf, 12);
    const more = complexTone(320, prf, 16);
    sp.push(more.re, more.im, 16);
    expect(sp.columns.length).toBe(2);
    expect(sp.columns[1].t).toBeCloseTo(10 + 80 / prf, 12);
    // alias en el borde y tono negativo
    const edge = new SpectralProcessor({ fftSize: N, hop: 16 });
    edge.sync(0, prf);
    const zn = complexTone(prf / 2, prf, N);
    edge.push(zn.re, zn.im, N);
    expect(peakFrequency(edge.columns[0], N)).toBe(-prf / 2);
    expect(edge.binFrequency(64)).toBe(0);
    const neg = new SpectralProcessor({ fftSize: N, hop: 16 });
    neg.sync(0, prf);
    const zneg = complexTone(-320, prf, N);
    neg.push(zneg.re, zneg.im, N);
    expect(peakFrequency(neg.columns[0], N)).toBe(-320);
    // maxColumns conserva las últimas
    const cap = new SpectralProcessor({ fftSize: N, hop: 16, maxColumns: 3 });
    cap.sync(0, prf);
    const long = complexTone(320, prf, N + 16 * 9);
    cap.push(long.re, long.im, long.re.length);
    expect(cap.columns.length).toBe(3);
    expect(cap.columns[2].t).toBeGreaterThan(cap.columns[0].t);
  });

  it('columnEnvelope toma la frecuencia máxima de cada semiplano, ignora la continua y decide por energía', () => {
    const col = (set: Record<number, number>): SpectralColumn => {
      const powerDb = new Float32Array(N).fill(-100);
      for (const [k, v] of Object.entries(set)) powerDb[Number(k)] = v;
      return { t: 0, prfHz: 2000, powerDb };
    };
    const df = 2000 / N; // 15,625
    const pos = columnEnvelope(col({ 70: -50, 71: -50 }), N, -80);
    expect(pos.fPos).toBeCloseTo(7 * df, 9);
    expect(pos.fNeg).toBe(0);
    expect(pos.powerPosDb).toBe(-50);
    expect(pos.fEnvelope).toBeCloseTo(7 * df, 9);
    const neg = columnEnvelope(col({ 57: -50, 58: -50 }), N, -80);
    expect(neg.fNeg).toBeCloseTo(-7 * df, 9);
    expect(neg.fEnvelope).toBeCloseTo(-7 * df, 9);
    const dc = columnEnvelope(col({ 64: -20 }), N, -80);
    expect(dc.fPos).toBe(0);
    expect(dc.fNeg).toBe(0);
    expect(dc.fEnvelope).toBe(0);
    const both = columnEnvelope(col({ 71: -50, 50: -55 }), N, -80);
    expect(both.fEnvelope).toBe(both.fPos);
    const bothInv = columnEnvelope(col({ 71: -55, 50: -50 }), N, -80);
    expect(bothInv.fEnvelope).toBe(bothInv.fNeg);
    expect(noiseFloorDb(col({ 1: -20, 2: -20, 3: -20, 4: -20, 5: -20, 6: -20, 7: -20, 8: -20 }))).toBe(-100);
  });

  it('envolvente por percentil de la banda contigua: un bin de ruido aislado lejos no la mueve (decisión 44)', () => {
    const N = 128;
    const df = 2000 / N;
    const col = (set: Record<number, number>): SpectralColumn => {
      const powerDb = new Float32Array(N).fill(-100);
      for (const [k, v] of Object.entries(set)) powerDb[Number(k)] = v;
      return { t: 0, prfHz: 2000, powerDb };
    };
    // banda uniforme en bins +2…+11 (potencia igual): el percentil 92 cae en el 10.º bin (+11)
    const band: Record<number, number> = {};
    for (let j = 2; j <= 11; j++) band[64 + j] = -40;
    expect(columnPercentileEnvelope(col(band), N, -100)).toBeCloseTo(11 * df, 9);
    // un bin de ruido aislado en +40 (más de 3 bins de hueco): no cuenta
    expect(columnPercentileEnvelope(col({ ...band, [64 + 40]: -40 }), N, -100)).toBeCloseTo(11 * df, 9);
    // el «último bin sobre umbral» sí se iba al ruido
    expect(columnEnvelope(col({ ...band, [64 + 40]: -40 }), N, -80).fPos).toBeCloseTo(40 * df, 9);
    // dos lados simultáneos (arteria y vena): cada uno con su envolvente y su energía
    const both = columnBandEnvelopes(col({ ...band, [64 - 5]: -45, [64 - 6]: -45, [64 - 7]: -45 }), N, -100);
    expect(both.posHz).toBeCloseTo(11 * df, 9);
    expect(both.negHz).toBeCloseTo(7 * df, 9);
    expect(both.ePos).toBeGreaterThan(both.eNeg);
    // sin nada 12 dB por encima del suelo: no hay flujo detectable
    expect(columnPercentileEnvelope(col({ [64 + 5]: -95 }), N, -100)).toBe(0);
  });

  it('el extremo robusto ignora el 3 % más extremo de la ventana', () => {
    const xs = Array.from({ length: 100 }, (_, i) => ({ t: i, v: i === 50 ? 999 : Math.sin(i / 10) }));
    const plain = robustExtremeInWindow(
      xs,
      [0, 99],
      (x) => x.t,
      (x) => x.v,
      (v) => v,
      1,
    );
    const robust = robustExtremeInWindow(
      xs,
      [0, 99],
      (x) => x.t,
      (x) => x.v,
      (v) => v,
      0.97,
    );
    expect(plain).toBe(999);
    expect(robust).toBeLessThan(1.01);
    expect(
      Number.isNaN(
        robustExtremeInWindow(
          xs,
          [200, 300],
          (x) => x.t,
          (x) => x.v,
          (v) => v,
        ),
      ),
    ).toBe(true);
  });
});
