import { describe, expect, it } from 'vitest';
import { assessQuality, bloodInColumn, wavesInconsistent } from '../doppler/measureQuality';
import type { SpectralColumn } from '../doppler/spectral';
import type { Beat } from '../physiology/rhythm';

/**
 * Control de calidad de la captura PW (base A.4: «no medible» nunca es normal), con espectros
 * sintéticos: suelo de ruido de −60 dB con moteado y, cuando hay sangre, una banda 30 dB por encima.
 */
const N = 128;
const PRF = 4000;
const DT = 0.006;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

/** `band(t)` devuelve los bins [k0, k1) con sangre en el instante t, o null. */
function columns(seconds: number, band: (t: number) => [number, number] | null, seed = 1): SpectralColumn[] {
  const r = rng(seed);
  const out: SpectralColumn[] = [];
  for (let t = 0; t < seconds; t += DT) {
    const p = new Float32Array(N);
    for (let k = 0; k < N; k++) p[k] = -60 + 6 * (r() - 0.5);
    const b = band(t);
    if (b) for (let k = b[0]; k < b[1]; k++) p[k] = -30 + 3 * (r() - 0.5);
    out.push({ t, prfHz: PRF, powerDb: p });
  }
  return out;
}

const beats: Beat[] = Array.from({ length: 5 }, (_, i) => ({ tR: 0.5 + i * 0.8, rr: 0.8 }) as Beat);
const venous: [number, number] = [N / 2 + 12, N / 2 + 20]; // ≈ 375–625 Hz, hacia la sonda

describe('Calidad de la captura PW', () => {
  it('flujo estable en todos los latidos: medible', () => {
    const q = assessQuality(
      columns(5, () => venous),
      beats,
      { wallFilterHz: 25 },
    );
    expect(q.issue).toBeNull();
    expect(q.validBeats).toBe(5);
  });

  it('solo ruido (puerta fuera del vaso o sin contacto): sin señal', () => {
    expect(
      assessQuality(
        columns(5, () => null),
        beats,
        { wallFilterHz: 25 },
      ).issue,
    ).toBe('no-signal');
  });

  it('el clutter residual junto a 0 Hz no es sangre', () => {
    const clutter: [number, number] = [N / 2 - 1, N / 2 + 2];
    expect(
      assessQuality(
        columns(5, () => clutter),
        beats,
        { wallFilterHz: 25 },
      ).issue,
    ).toBe('no-signal');
  });

  it('el vaso sale de la puerta en un latido (respiración): intermitente', () => {
    const q = assessQuality(
      columns(5, (t) => (t > 2.1 && t < 2.9 ? null : venous)),
      beats,
      { wallFilterHz: 25 },
    );
    expect(q.issue).toBe('intermittent');
    expect(q.validBeats).toBe(4);
  });

  it('sangre solo en parte de cada ciclo (el vaso cruza la puerta al respirar): intermitente, no sin señal', () => {
    // la vena pasa por la puerta un 30 % de cada latido: ningún latido vale, pero hay flujo
    const q = assessQuality(
      columns(5, (t) => ((((t - 0.5) % 0.8) + 0.8) % 0.8 < 0.24 ? venous : null)),
      beats,
      { wallFilterHz: 25 },
    );
    expect(q.validBeats).toBe(0);
    expect(q.bloodColumns).toBeGreaterThan(0.2);
    expect(q.issue).toBe('intermittent');
  });

  it('un pico que rebasa ±Nyquist reaparece por el otro lado: aliasing aunque la energía en los bordes sea poca', () => {
    // 60 ms de cada latido la sangre llena de +0 a +Nyquist y sigue desde −Nyquist (el pico S plegado)
    const sPeak = (t: number) => (((t - 0.5) % 0.8) + 0.8) % 0.8 < 0.06;
    const cols = columns(5, (t) => (sPeak(t) ? [N / 2 + 2, N] : venous)).map((c) => {
      if (!sPeak(c.t)) return c;
      const p = Float32Array.from(c.powerDb);
      for (let k = 0; k < 6; k++) p[k] = -30;
      return { ...c, powerDb: p };
    });
    const q = assessQuality(cols, beats, { wallFilterHz: 25 });
    expect(q.edgeEnergyFraction).toBeLessThan(0.25);
    expect(q.wrappedBeats).toBe(5);
    expect(q.issue).toBe('aliasing');
  });

  it('una onda que roza un solo borde (escala justa) no es aliasing', () => {
    const peak = (t: number) => (((t - 0.5) % 0.8) + 0.8) % 0.8 < 0.12;
    const q = assessQuality(
      columns(5, (t) => (peak(t) ? [N / 2 + 2, N] : venous)),
      beats,
      { wallFilterHz: 25 },
    );
    expect(q.wrappedBeats).toBe(0);
    expect(q.issue).toBeNull();
  });

  it('un latido sin espectro que lo cubra no cuenta: el PW recién encendido no es «intermitente»', () => {
    // el espectro empieza a los 2,5 s (se encendió el PW): los latidos anteriores no se juzgan
    const q = assessQuality(
      columns(5, () => venous).filter((c) => c.t >= 2.5),
      beats,
      { wallFilterHz: 25 },
    );
    expect(q.beats).toBe(2);
    expect(q.validBeats).toBe(2);
    expect(q.issue).toBe('few-beats');
  });

  it('con el filtro de pared alto el flujo por encima de su corte sigue contando', () => {
    // bins 76–86 ≈ 375–720 Hz a PRF 4000; filtro de pared a 300 Hz (antes se excluía hasta 750 Hz)
    const q = assessQuality(
      columns(5, () => [N / 2 + 10, N / 2 + 23]),
      beats,
      { wallFilterHz: 300 },
    );
    expect(q.issue).toBeNull();
  });

  it('la energía junto a ±Nyquist es aliasing', () => {
    const edge: [number, number] = [N - 8, N];
    expect(
      assessQuality(
        columns(5, () => edge),
        beats,
        { wallFilterHz: 25 },
      ).issue,
    ).toBe('aliasing');
  });

  it('en la interlobar se juzga el lado de la vena: la arteria del otro lado no cuenta', () => {
    const artery: [number, number] = [N / 2 - 30, N / 2 - 20];
    const cols = columns(5, () => artery);
    expect(assessQuality(cols, beats, { wallFilterHz: 25, side: 'neg' }).issue).toBeNull();
    expect(assessQuality(cols, beats, { wallFilterHz: 25, side: 'pos' }).issue).toBe('no-signal');
    expect(bloodInColumn(cols[0], { wallFilterHz: 25, side: 'pos' }).present).toBe(false);
  });

  it('menos de tres latidos: pocos latidos', () => {
    expect(
      assessQuality(
        columns(5, () => venous),
        beats.slice(0, 2),
        { wallFilterHz: 25 },
      ).issue,
    ).toBe('few-beats');
  });

  // Picos por latido (cm/s, orientados) medidos en capturas reales de la cadena del alumno
  it('la S de la suprahepática cambia de dirección entre latidos: inconsistente', () => {
    // sano con respiración tranquila: la puerta fija mezcla la vena con otro vaso
    expect(wavesInconsistent([36, -13, -12], [20, 16, 6])).toBe(true);
    // FA con respiración tranquila: S pequeña pero anterógrada, y −4 en un latido contaminado
    expect(wavesInconsistent([12, -4, -4], [14, 12, 14])).toBe(true);
    // con sangre en todos los latidos (no es intermitente) la captura sigue sin valer
    const waves = { s: [36, -13, -12, 30, 33], d: [20, 16, 6, 18, 21] };
    expect(
      assessQuality(
        columns(5, () => venous),
        beats,
        { wallFilterHz: 25 },
        waves,
      ).issue,
    ).toBe('inconsistent');
  });

  it('una S invertida en todos los latidos (congestión grave) o casi nula no es inconsistente', () => {
    expect(wavesInconsistent([-10, -8, -11, -10], [28, 28, 26, 28])).toBe(false);
    expect(wavesInconsistent([11, 10, 8, 13], [15, 14, 13, 14])).toBe(false);
    // |S| < 25 % de D: el signo de una S casi nula no cuenta
    expect(wavesInconsistent([-2, 3, 1], [14, 15, 13])).toBe(false);
  });

  it('un latido con D invertida es otro vaso en la puerta: inconsistente aunque S no cambie', () => {
    // sano con respiración tranquila (puerta con ventana acústica): la mediana daba «grave»
    expect(wavesInconsistent([-36, -16, -9], [-7, 16, 12])).toBe(true);
  });
});
