import { describe, expect, it } from 'vitest';
import {
  depthProfile,
  displayStats,
  echoWidthMm,
  envelopeTexture,
  halfWidth,
  measureFaceLine,
  RAYLEIGH_DARK_FRACTION,
  secondaryLobe,
  summarizeFaces,
  type EnvelopeGeometry,
  type FaceKind,
  type FaceLine,
  type FaceSample,
} from '../app/fidelity';
import { SeededRandom } from '../core/random';
import { greyOfLevel, levelOfGrey } from '../ultrasound/greyMap';
import { COLOR_PRIORITY_GREY, DEFAULT_BMODE, DISPLAY_REF_DB, type DisplayFrame } from '../ultrasound/renderer';
import { detect, psf, whiteField } from './syntheticSpeckle';

/**
 * Métricas del banco de fidelidad (decisión 52) sobre campos sintéticos con la geometría del
 * renderizador (192 líneas × 1024 muestras a 18 cm, convexo de ±34° y R 60 mm): el moteado ideal
 * (campo gaussiano complejo + PSF gaussiana) fija la referencia y cada defecto conocido se sale de
 * ella. Valores de referencia medidos con estas semillas: SNR 1,93, fracción oscura 0,068 (Rayleigh
 * 0,0682), grano = 2,355·σ ± 5 %, grietas 0,045; con |Re| (la envolvente como valor absoluto de un
 * campo real): SNR 1,34, oscuros 0,19, grietas 0,31.
 */
const G = { lines: 192, samples: 1024 };
const GEOM: EnvelopeGeometry = { depthMm: 180, halfSector: (34 * Math.PI) / 180, curvatureRadius: 60 };
const DR_MM = GEOM.depthMm / G.samples;
const everywhere = (): boolean => true;
const field = psf(G, whiteField(G, 7), 1.5, 1.0);
const ideal = envelopeTexture(detect(G, field, Math.hypot), everywhere, GEOM);

describe('banco de fidelidad: textura de la envolvente', () => {
  it('el moteado ideal da Rayleigh: SNR 1,91, fracción oscura 0,068 y grano del tamaño de la PSF', () => {
    expect(ideal.patches).toBe((192 / 16) * Math.floor(1024 / 48));
    expect(ideal.snr).toBeGreaterThan(1.85);
    expect(ideal.snr).toBeLessThan(2.0);
    expect(Math.abs(ideal.darkFraction - RAYLEIGH_DARK_FRACTION)).toBeLessThan(0.006);
    // speckle = célula de resolución: FWHM de la autocovarianza ≈ 2,355·σ de la PSF de amplitud
    expect(ideal.fwhmAxialMm / (2.3548 * 1.5 * DR_MM)).toBeGreaterThan(0.9);
    expect(ideal.fwhmAxialMm / (2.3548 * 1.5 * DR_MM)).toBeLessThan(1.1);
    const spacing = (GEOM.curvatureRadius + ideal.depthMm) * ((2 * GEOM.halfSector) / G.lines);
    expect(ideal.fwhmLateralMm / (2.3548 * 1.0 * spacing)).toBeGreaterThan(0.88);
    expect(ideal.fwhmLateralMm / (2.3548 * 1.0 * spacing)).toBeLessThan(1.12);
    expect(ideal.secondaryLobeAxial).toBeLessThan(0.05);
    expect(ideal.secondaryLobeLateral).toBeLessThan(0.05);
    expect(ideal.crackIndex).toBeLessThan(0.08);
  });

  it('una envolvente que es el valor absoluto de un campo real forma grietas: ceros en líneas', () => {
    const t = envelopeTexture(
      detect(G, psf(G, whiteField(G, 9), 1.5, 1.0), (re) => Math.abs(re)),
      everywhere,
      GEOM,
    );
    expect(t.snr).toBeLessThan(1.45); // 1,32 teórico
    expect(t.darkFraction).toBeGreaterThan(0.15);
    expect(t.crackIndex).toBeGreaterThan(3 * ideal.crackIndex);
  });

  it('una estructura periódica (retícula, bloques repetidos) deja un lóbulo secundario', () => {
    const env = detect(G, psf(G, whiteField(G, 11), 1.5, 1.0), Math.hypot);
    for (let v = 0; v < G.samples; v++)
      for (let u = 0; u < G.lines; u++) env.data[v * G.lines + u] *= 1 + 0.8 * Math.cos((2 * Math.PI * v) / 8);
    expect(envelopeTexture(env, everywhere, GEOM).secondaryLobeAxial).toBeGreaterThan(0.3);
  });

  it('solo mide los parches de dentro; sin parches, todo NaN', () => {
    const env = detect(G, field, Math.hypot);
    const none = envelopeTexture(env, () => false, GEOM);
    expect(none.patches).toBe(0);
    expect(none.snr).toBeNaN();
    const shallow = envelopeTexture(env, (_u, v) => v < 512, GEOM);
    expect(shallow.patches).toBe((192 / 16) * Math.floor(512 / 48));
    expect(shallow.depthMm).toBeLessThan(90);
  });

  it('si el grano no cabe en el parche, grietas y lóbulos son NaN, no un «ideal» 0', () => {
    // rampa axial en un parche de 200 muestras: la autocovarianza sigue en ~0,78 a 20 muestras
    // (en un parche corto, cualquier variación lenta cae a 0,5 hacia la mitad del parche y se mide
    // como un grano grande: límite del estimador, no de la imagen)
    const ramp = { lines: G.lines, samples: G.samples, data: new Float32Array(G.lines * G.samples) };
    for (let v = 0; v < G.samples; v++) ramp.data.fill(1 + v / G.samples, v * G.lines, (v + 1) * G.lines);
    const t = envelopeTexture(ramp, everywhere, GEOM, { axial: 200, lateral: 16 });
    expect(t.patches).toBeGreaterThan(0);
    expect(t.fwhmAxialMm).toBeNaN();
    expect(t.crackIndex).toBeNaN();
    expect(t.secondaryLobeAxial).toBeNaN();
  });

  it('un parche menor que los desfases de la autocovarianza no produce NaN', () => {
    const t = envelopeTexture(detect(G, field, Math.hypot), everywhere, GEOM, { axial: 16, lateral: 8 });
    expect(Number.isFinite(t.secondaryLobeAxial)).toBe(true);
    expect(Number.isFinite(t.secondaryLobeLateral)).toBe(true);
    expect(Number.isFinite(t.crackIndex)).toBe(true);
  });

  it('semianchura y lóbulo secundario de una autocovarianza', () => {
    expect(halfWidth([1, 0.8, 0.4])).toBeCloseTo(1.75, 10);
    expect(halfWidth([1, 0.9, 0.7])).toBeNaN();
    expect(secondaryLobe([1, 0.6, 0.2, -0.1, 0.3, 0.1])).toBeCloseTo(0.3, 10);
    expect(secondaryLobe([1, 0.4, 0.1, 0])).toBe(0);
    expect(secondaryLobe([1, 0.9, 0.7])).toBeNaN();
  });
});

describe('preajuste abdominal (decisión 53)', () => {
  it('el hígado queda a media escala: 70 dB y referencia −33 dB', () => {
    expect(DEFAULT_BMODE.dynamicRangeDb).toBe(70);
    // la mediana del hígado estaba 16,5 dB bajo el techo con −20 dB y 60 dB (gris 144); ahora, 29,5
    expect(greyOfLevel((-16.5 - 13 + 70) / 70) * 255).toBeGreaterThan(90);
    expect(greyOfLevel((-16.5 - 13 + 70) / 70) * 255).toBeLessThan(110);
    expect(DISPLAY_REF_DB).toBe(-33);
  });

  it('la prioridad del color bloquea el mismo tejido que antes: 6 dB sobre la referencia', () => {
    // con el preajuste anterior (−20 dB, 60 dB) la misma fórmula da el 0,62 de siempre
    expect(greyOfLevel((6 - 20 + 60) / 60)).toBeCloseTo(0.62, 2);
    expect(COLOR_PRIORITY_GREY).toBeCloseTo(greyOfLevel((6 + DISPLAY_REF_DB + 70) / 70), 12);
    expect(COLOR_PRIORITY_GREY).toBeCloseTo(0.434, 3);
  });
});

describe('banco de fidelidad: imagen mostrada', () => {
  it('gris del tejido: media, percentiles y fracción de huecos', () => {
    const img: DisplayFrame = { width: 100, height: 50, gray: new Uint8Array(5000).fill(100) };
    for (let i = 0; i < 500; i++) img.gray[i * 10] = 0;
    const s = displayStats(img, () => true);
    expect(s.pixels).toBe(5000);
    expect(s.mean).toBeCloseTo(90, 10);
    expect(s.p05).toBe(0);
    expect(s.p50).toBe(100);
    expect(s.darkFraction).toBeCloseTo(0.1, 10);
    expect(displayStats(img, () => false).mean).toBeNaN();
  });

  it('el perfil en profundidad recupera la pendiente en dB a través de la curva de grises', () => {
    // 200 filas = 100 mm; nivel −30 dB + 0,4 dB/cm bajo un techo de 60 dB
    const W = 60;
    const H = 200;
    const gray = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const db = -30 + 0.4 * ((y * 0.5) / 10);
      gray.fill(Math.round(greyOfLevel((db + 60) / 60) * 255), y * W, (y + 1) * W);
    }
    const p = depthProfile({ width: W, height: H, gray }, (_x, y) => y * 0.5, 60, 10, 1, 10);
    expect(p.bands).toHaveLength(10);
    expect(p.slopeDbPerCm).toBeGreaterThan(0.35);
    expect(p.slopeDbPerCm).toBeLessThan(0.45);
    expect(p.bands[0].db).toBeGreaterThan(-31);
    expect(p.bands[0].db).toBeLessThan(-29);
  });

  it('la curva de grises y su inversa son la misma función', () => {
    for (let y = 0; y <= 1; y += 0.125) expect(levelOfGrey(greyOfLevel(y))).toBeCloseTo(y, 12);
    expect(greyOfLevel(0)).toBe(0);
    expect(greyOfLevel(1)).toBeCloseTo(1, 12);
  });
});

describe('banco de interfaces: líneas pintadas', () => {
  // Nivel mostrado como el preajuste abdominal: la envolvente del hígado (1) a 29,5 dB bajo el techo de
  // 70 dB (gris ≈ 100); el eco se pinta como una gaussiana de amplitud sobre ese fondo. Pared a 8 cm:
  // borde del hígado en 80 mm, luz desde 80,5 mm, 0,87 mm entre líneas.
  const DR = 70;
  const RB = 80;
  const R_LUMEN = 80.5;
  const PITCH = 0.87;
  const grayOfEnv = (e: number): number =>
    Math.round(255 * greyOfLevel(Math.min(1, Math.max(0, (20 * Math.log10(Math.max(e, 1e-9)) - 29.5 + DR) / DR))));
  const gauss = (x: number, sigma: number): number => Math.exp(-0.5 * (x / sigma) ** 2);
  const paint = (env: (r: number) => number): FaceLine => ({ env, gray: (r) => grayOfEnv(env(r)), liver: (r) => r < RB });
  /** Una pared de `n` líneas con un eco de amplitud `amp(u)` (0 = sin eco) en la cara de la luz. */
  const wall = (n: number, amp: (u: number) => number, o: { kind?: FaceKind; sigma?: number; incidenceDeg?: number } = {}): FaceSample[] =>
    Array.from({ length: n }, (_, u) => ({
      ...measureFaceLine(
        paint((r) => 1 + amp(u) * gauss(r - R_LUMEN, o.sigma ?? 0.3)),
        { rb: RB, rTarget: R_LUMEN, ref: 'above' },
        DR,
      )!,
      kind: o.kind ?? 'hepaticVein',
      wall: 0,
      u,
      rb: RB,
      pitchMm: PITCH,
      incidenceDeg: o.incidenceDeg ?? 5,
    }));
  const bin0 = (samples: FaceSample[]) => summarizeFaces([samples]).wallSystems.hepaticVein[0];

  it('una pared continua no tiene huecos ni rosario; su pico sale en dB de envolvente sobre el hígado', () => {
    const b = bin0(wall(60, () => 30));
    expect(b.walls).toBe(60);
    expect(b.gapFraction).toBe(0);
    expect(b.longestGapMm).toBe(0);
    expect(b.beading).toBeLessThan(0.1);
    expect(b.peakDb).toBeCloseTo(20 * Math.log10(31), 6);
    expect(b.deltaDb).toBeGreaterThan(25);
    // la tabla histórica (VCI y suprahepáticas) la incluye; la porta no
    expect(summarizeFaces([wall(60, () => 30)]).walls[0].walls).toBe(60);
    expect(summarizeFaces([wall(60, () => 30)]).wallSystems.portal[0].walls).toBe(0);
  });

  it('una de cada tres líneas apagada: un tercio de huecos, de una línea cada uno', () => {
    const b = bin0(wall(60, (u) => (u % 3 === 0 ? 0 : 30)));
    expect(b.gapFraction).toBeCloseTo(1 / 3, 10);
    expect(b.longestGapMm).toBeCloseTo(PITCH, 10);
    // dos líneas seguidas apagadas: el tramo es de dos pasos
    expect(bin0(wall(60, (u) => (u === 20 || u === 21 ? 0 : 30))).longestGapMm).toBeCloseTo(2 * PITCH, 10);
  });

  it('un eco que salta ±6 dB de línea a línea forma un rosario', () => {
    const rng = new SeededRandom(5);
    const gains = Array.from({ length: 60 }, () => Math.pow(10, rng.range(-6, 6) / 20));
    const b = bin0(wall(60, (u) => 30 * gains[u]));
    expect(b.gapFraction).toBe(0);
    expect(b.beading).toBeGreaterThan(0.3);
    // una tendencia lenta (el lóbulo o la profundidad) no es rosario
    expect(bin0(wall(60, (u) => 30 * Math.pow(10, (u - 30) / 60))).beading).toBeLessThan(0.1);
  });

  it('el eco gaussiano pintado mide 2,355·σ a −6 dB', () => {
    for (const sigma of [0.2, 0.3, 0.45]) {
      const b = bin0(wall(20, () => 100, { sigma }));
      expect(b.echoFwhmMm / (2.3548 * sigma), `σ ${sigma}`).toBeGreaterThan(0.95);
      expect(b.echoFwhmMm / (2.3548 * sigma), `σ ${sigma}`).toBeLessThan(1.05);
      expect(echoWidthMm((r) => gauss(r, sigma), 0) / (2.3548 * sigma)).toBeCloseTo(1, 2);
    }
    // sin bajar a la mitad dentro de la búsqueda: NaN, no un ancho inventado
    expect(echoWidthMm(() => 1, 0)).toBeNaN();
  });

  it('diafragma: una costura pintada de 0,5 mm tras la pleura cuenta en todas las líneas; sin ella, en ninguna', () => {
    const RP = 82;
    const pleura = (seam: boolean) => (r: number) => (seam && r > RP + 0.5 && r < RP + 1 ? 0.01 : 1 + 30 * gauss(r - RP, 0.25));
    const lines = (seam: boolean): FaceSample[] =>
      Array.from({ length: 30 }, (_, u) => ({
        ...measureFaceLine(paint(pleura(seam)), { rb: 79.5, rTarget: RP, ref: 'above', pleura: true }, DR)!,
        kind: 'diaphragm' as const,
        wall: 0,
        u,
        rb: 79.5,
        pitchMm: PITCH,
        incidenceDeg: 8,
        mirrorOffsetMm: u / 30,
      }));
    const withSeam = summarizeFaces([lines(true)]).diaphragm[0];
    expect(withSeam.walls).toBe(30);
    expect(withSeam.seamFraction).toBe(1);
    expect(withSeam.lineDb).toBeCloseTo(20 * Math.log10(31), 6);
    expect(withSeam.positionSdMm).toBeLessThan(1e-9);
    // p95 del desfase del espejo (0, 1/30, …, 29/30)
    expect(withSeam.mirrorOffsetMm).toBeCloseTo(28 / 30, 10);
    expect(summarizeFaces([lines(false)]).diaphragm[0].seamFraction).toBe(0);
  });

  it('los tramos van por incidencia y las paredes no se mezclan entre poses', () => {
    const oblique = summarizeFaces([wall(30, () => 30, { incidenceDeg: 25 })]).wallSystems.hepaticVein;
    expect(oblique.map((b) => b.walls)).toEqual([0, 30, 0]);
    expect(oblique[0].gapFraction).toBeNaN();
    // dos poses con la misma numeración de líneas y amplitudes distintas: cada pared es continua
    const b = summarizeFaces([wall(30, () => 10), wall(30, () => 40)]).wallSystems.hepaticVein[0];
    expect(b.walls).toBe(60);
    expect(b.beading).toBeLessThan(1e-9);
  });
});
