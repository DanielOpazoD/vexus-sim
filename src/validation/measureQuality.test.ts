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

  // Hallazgo C10 de la revisión externa: una vena renal monofásica solo lleva flujo en diástole (la
  // mitad del ciclo o menos) y la regla «sangre en ≥ 60 % de las columnas del latido» la rechazaba
  // como intermitente aunque la puerta estuviera perfecta. Con la ventana de fase (la diastólica), el
  // latido vale si la sangre la cubre y se repite igual en todos; un latido distinto sigue siendo
  // intermitente.
  describe('hueco fisiológico que se repite en la misma fase (vena renal monofásica)', () => {
    const fullBeats = (rr: number, n: number): Beat[] =>
      Array.from({ length: n }, (_, i) => {
        const tR = 0.5 + i * rr;
        return {
          index: i,
          tR,
          rr,
          tP: tR - 0.15 * rr,
          tAtrialContraction: tR - 0.1 * rr,
          tX: tR + 0.225 * rr,
          tV: tR + 0.45 * rr,
          tY: tR + 0.625 * rr,
          tTend: tR + 0.45 * rr,
          atrialAmplitude: 1,
        };
      });
    const phase = (rr: number) => (t: number) => (((t - 0.5) % rr) + rr) % rr;
    // la ventana diastólica que usa la medición (`beatWindows`), con las fases de estos latidos
    const diastole = (b: Beat): [number, number] => {
      const s = Math.sqrt(b.rr / 0.8);
      return [b.tY - 0.07 * s, Math.min(b.tY + 0.22 * s, b.tR + b.rr - 0.02)];
    };
    for (const bpm of [75, 110]) {
      const rr = 60 / bpm;
      const beatsN = fullBeats(rr, 5);
      const seconds = 0.5 + 5 * rr + 0.1;
      // flujo solo en la segunda mitad de cada ciclo (diástole)
      const mono = columns(seconds, (t) => (phase(rr)(t) >= 0.5 * rr ? venous : null));
      it(`${bpm} lpm: flujo solo en diástole en todos los latidos es medible con la ventana de fase`, () => {
        expect(assessQuality(mono, beatsN, { wallFilterHz: 25, side: 'pos' }).issue).toBe('intermittent'); // sin ventana: la regla vieja
        const q = assessQuality(mono, beatsN, { wallFilterHz: 25, side: 'pos', phaseWindow: diastole });
        expect(q.issue).toBeNull();
        expect(q.validBeats).toBe(5);
      });
      it(`${bpm} lpm: un latido sin flujo en su diástole sigue siendo intermitente`, () => {
        const b2 = beatsN[2];
        const dropped = columns(seconds, (t) => (t >= b2.tR && t < b2.tR + rr ? null : phase(rr)(t) >= 0.5 * rr ? venous : null));
        expect(assessQuality(dropped, beatsN, { wallFilterHz: 25, side: 'pos', phaseWindow: diastole }).issue).toBe('intermittent');
      });
      it(`${bpm} lpm: la sangre solo en sístole no se acepta con la ventana diastólica`, () => {
        const sys = columns(seconds, (t) => (phase(rr)(t) < 0.3 * rr ? venous : null));
        expect(assessQuality(sys, beatsN, { wallFilterHz: 25, side: 'pos', phaseWindow: diastole }).issue).toBe('intermittent');
      });
    }
    it('con 4 latidos, la sístole perdida en 2 de ellos (reparto 2/2) no pasa: la mediana es la de los demás', () => {
      const rr = 60 / 70;
      const beats4 = fullBeats(rr, 4);
      // vena bifásica: S en su ventana sistólica y D en la diastólica; S desaparece en los latidos 0 y 2
      const sWin = (b: Beat): [number, number] => {
        const s = Math.sqrt(b.rr / 0.8);
        return [b.tX - 0.06 * s, b.tV - 0.02 * s];
      };
      const lostS = new Set([0, 2]);
      const cols = columns(0.5 + 4 * rr + 0.1, (t) => {
        const i = beats4.findIndex((b) => t >= b.tR && t < b.tR + b.rr);
        if (i < 0) return null;
        const b = beats4[i];
        const [s0, s1] = sWin(b);
        const [d0, d1] = diastole(b);
        if (t >= d0 - 0.03 && t <= d1) return venous;
        if (t >= s0 && t <= s1 && !lostS.has(i)) return venous;
        return null;
      });
      expect(assessQuality(cols, beats4, { wallFilterHz: 25, side: 'pos', phaseWindow: diastole }).issue).toBe('intermittent');
    });

    it('sin sangre en la ventana por el plegado: aliasing antes que intermitente (con ventana de fase)', () => {
      const rr = 0.8;
      const beatsN = fullBeats(rr, 4);
      // como el grave a 2600 Hz: la vena cubre solo parte de su ventana diastólica y, en el pico de D,
      // 60 ms plegados (sangre en los dos bordes); ningún latido vale, pero la causa es el plegado
      const ph = phase(rr);
      const folded = (t: number) => ph(t) >= 0.55 && ph(t) < 0.61;
      const cols = columns(0.5 + 4 * rr + 0.1, (t) => (folded(t) ? [N / 2 + 2, N] : ph(t) >= 0.43 && ph(t) < 0.55 ? venous : null)).map(
        (c) => {
          if (!folded(c.t)) return c;
          const p = Float32Array.from(c.powerDb);
          for (let k = 0; k < 6; k++) p[k] = -30;
          return { ...c, powerDb: p };
        },
      );
      const q = assessQuality(cols, beatsN, { wallFilterHz: 25, side: 'pos', phaseWindow: diastole });
      expect(q.validBeats).toBe(0);
      expect(q.wrappedBeats).toBeGreaterThan(0);
      expect(q.issue).toBe('aliasing');
      // sin ventana de fase (suprahepática, porta) el orden no cambia
      expect(assessQuality(cols, beatsN, { wallFilterHz: 25, side: 'pos' }).issue).toBe('intermittent');
    });

    it('un latido con la mitad de flujo que los demás (la puerta pierde el vaso en parte): intermitente por no reproducirse', () => {
      const rr = 0.8;
      const beatsN = fullBeats(rr, 5);
      // flujo en la segunda mitad de cada ciclo; en el latido 1, además, en todo el ciclo (otro vaso entra)
      const odd = columns(4.7, (t) => (t >= beatsN[1].tR && t < beatsN[1].tR + rr ? venous : phase(rr)(t) >= 0.5 * rr ? venous : null));
      expect(assessQuality(odd, beatsN, { wallFilterHz: 25, side: 'pos', phaseWindow: diastole }).issue).toBe('intermittent');
    });
  });
});
