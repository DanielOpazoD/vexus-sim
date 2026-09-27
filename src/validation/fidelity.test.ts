import { describe, expect, it } from 'vitest';
import {
  CAPSULE_END_SPAN_MM,
  clearanceMask,
  contourStats,
  depthProfile,
  displayGrain,
  displayStats,
  echoWidthMm,
  envelopeLine,
  envelopeTexture,
  halfWidth,
  logEnvelopeGrain,
  lookCorrelations,
  measureFaceLine,
  RAYLEIGH_DARK_FRACTION,
  seamStats,
  secondaryLobe,
  summarizeFaces,
  thinGatedBins,
  umbraEndMm,
  type EnvelopeGeometry,
  type FaceKind,
  type FaceLine,
  type FaceSample,
} from '../app/fidelity';
import { SeededRandom } from '../core/random';
import { greyOfLevel, levelOfGrey } from '../ultrasound/greyMap';
import { attenuationDbPerCm, Tissue } from '../anatomy/tissues';
import type { EnvelopeFrame } from '../app/speckle';
import { COLOR_PRIORITY_GREY, DEFAULT_BMODE, DISPLAY_REF_DB, nominalTgcDbPerCm, type DisplayFrame } from '../ultrasound/renderer';
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

  it('el grano de la envolvente en dB sigue a la PSF y es algo más fino que el de la lineal', () => {
    // la compresión logarítmica quita peso a los picos del moteado: la autocovarianza del nivel en dB cae antes
    // (con estas semillas, 0,78 y 0,83 veces la de la envolvente lineal)
    const g = logEnvelopeGrain(detect(G, field, Math.hypot), everywhere, GEOM);
    expect(g.patches).toBe(ideal.patches);
    for (const [log, lin] of [
      [g.axialMm, ideal.fwhmAxialMm],
      [g.lateralMm, ideal.fwhmLateralMm],
    ]) {
      expect(log / lin).toBeGreaterThan(0.7);
      expect(log / lin).toBeLessThan(0.95);
    }
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

  it('el grano de la imagen se mide en los ejes locales del haz (radio desde el vértice y su perpendicular)', () => {
    // textura gaussiana anisótropa: ruido blanco filtrado con σ 2 px a lo largo de un eje y 5 px a lo largo del otro;
    // la autocovarianza de un ruido filtrado con σ es exp(−l²/4σ²): FWHM = 4σ·√ln2 = 3,33σ
    const W = 400;
    const H = 400;
    const texture = (sx: number, sy: number, seed: number): Uint8Array => {
      const rnd = new SeededRandom(seed);
      const white = Float64Array.from({ length: W * H }, () => rnd.gaussian());
      const blur = (src: Float64Array, s: number, horizontal: boolean): Float64Array => {
        const R = Math.ceil(3 * s);
        const w = Array.from({ length: 2 * R + 1 }, (_, k) => Math.exp(-0.5 * ((k - R) / s) ** 2));
        const out = new Float64Array(W * H);
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++) {
            let a = 0;
            for (let k = -R; k <= R; k++) {
              const xx = horizontal ? Math.min(W - 1, Math.max(0, x + k)) : x;
              const yy = horizontal ? y : Math.min(H - 1, Math.max(0, y + k));
              a += w[k + R] * src[yy * W + xx];
            }
            out[y * W + x] = a;
          }
        return out;
      };
      const f = blur(blur(white, sx, true), sy, false);
      const sd = Math.sqrt(f.reduce((a, x) => a + x * x, 0) / f.length);
      return Uint8Array.from(f, (x) => Math.max(0, Math.min(255, Math.round(128 + (30 * x) / sd))));
    };
    const scale = 5; // px/mm
    const img: DisplayFrame = { width: W, height: H, gray: texture(5, 2, 3) };
    const fwhm = (sigmaPx: number): number => (4 * sigmaPx * Math.sqrt(Math.log(2))) / scale;
    // vértice muy por encima: el haz baja en vertical (axial = y, lateral = x)
    const down = displayGrain(img, () => true, { apexX: W / 2, apexY: -1e6, scale });
    expect(down.patches).toBeGreaterThan(100);
    expect(down.axialMm / fwhm(2)).toBeGreaterThan(0.9);
    expect(down.axialMm / fwhm(2)).toBeLessThan(1.12);
    expect(down.lateralMm / fwhm(5)).toBeGreaterThan(0.88);
    expect(down.lateralMm / fwhm(5)).toBeLessThan(1.1);
    // vértice a la izquierda: el haz va en horizontal y los ejes se cambian
    const side = displayGrain(img, () => true, { apexX: -1e6, apexY: H / 2, scale });
    expect(side.axialMm / fwhm(5)).toBeGreaterThan(0.88);
    expect(side.lateralMm / fwhm(2)).toBeLessThan(1.12);
    // solo las ventanas de dentro: con la mitad derecha isótropa y fuera, la medida es la de la izquierda
    const mixed: DisplayFrame = { width: W, height: H, gray: Uint8Array.from(img.gray) };
    const iso = texture(2, 2, 5);
    for (let y = 0; y < H; y++) for (let x = W / 2; x < W; x++) mixed.gray[y * W + x] = iso[y * W + x];
    const left = displayGrain(mixed, (x) => x < W / 2, { apexX: W / 2, apexY: -1e6, scale });
    expect(left.patches).toBeGreaterThan(20);
    expect(left.lateralMm / fwhm(5)).toBeGreaterThan(0.85);
    expect(displayGrain(mixed, () => false, { apexX: W / 2, apexY: -1e6, scale }).axialMm).toBeNaN();
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

  it('el banco nombra los tramos vigilados que no llenan: pocos registros o sin rosario', () => {
    // 60 líneas de una suprahepática a 40–60° llenan ese tramo; el resto de los vigilados, vacíos. Solo
    // se vigilan los tramos que el barrido llena: ni la VSH ni el diafragma a 0–20° (decisión 57)
    const one = thinGatedBins(summarizeFaces([wall(60, () => 30, { incidenceDeg: 45 })]));
    expect(one.some((x) => x.startsWith('VSH 40–60°'))).toBe(false);
    expect(one).toContain('VSH 20–40°: 0 registros');
    expect(one).toContain('diafragma 40–60°: 0 registros');
    expect(one.some((x) => x.includes('0–20°') && (x.startsWith('VSH') || x.startsWith('diafragma')))).toBe(false);
    expect(one).toHaveLength(6);
    // 9 registros no bastan; 15 líneas sueltas de 15 paredes llenan el tramo pero no dan rosario
    expect(thinGatedBins(summarizeFaces([wall(9, () => 30, { incidenceDeg: 45 })]))).toContain('VSH 40–60°: 9 registros');
    const scattered = wall(15, () => 30, { kind: 'portal', incidenceDeg: 25 }).map((f, i) => ({ ...f, wall: i, u: 10 * i }));
    expect(thinGatedBins(summarizeFaces([scattered]))).toContain('porta 20–40°: 15 registros, sin rosario');
  });

  it('los tramos van por incidencia y las paredes no se mezclan entre poses', () => {
    const oblique = summarizeFaces([wall(30, () => 30, { incidenceDeg: 25 })]).wallSystems.hepaticVein;
    expect(oblique.map((b) => b.walls)).toEqual([0, 30, 0, 0]);
    expect(oblique[0].gapFraction).toBeNaN();
    // dos poses con la misma numeración de líneas y amplitudes distintas: cada pared es continua
    const b = summarizeFaces([wall(30, () => 10), wall(30, () => 40)]).wallSystems.hepaticVein[0];
    expect(b.walls).toBe(60);
    expect(b.beading).toBeLessThan(1e-9);
  });

  it('el tramo de 60–80° se informa y lo de ≥ 80° no entra en ninguno', () => {
    const bins = (inc: number) => summarizeFaces([wall(10, () => 30, { kind: 'capsule', incidenceDeg: inc })]).capsule.map((b) => b.walls);
    expect(bins(70)).toEqual([0, 0, 0, 10]);
    expect(bins(85)).toEqual([0, 0, 0, 0]);
  });
});

describe('contorno de las caras: líneas pintadas (PR 0 de las decisiones 60 y 64)', () => {
  // Cápsula: cresta pintada a 80,5 mm sobre el hígado de debajo (gris ≈ 100), 0,87 mm entre líneas
  const RB = 80;
  const R_FACE = 80.5;
  const PITCH = 0.87;
  const gauss = (x: number, sigma: number): number => Math.exp(-0.5 * (x / sigma) ** 2);
  /** Gris de la curva del simulador con el hígado (envolvente 1) 29,5 dB bajo el techo de `dr` dB. */
  const curveGray =
    (dr: number) =>
    (e: number): number =>
      Math.round(255 * greyOfLevel(Math.min(1, Math.max(0, (20 * Math.log10(Math.max(e, 1e-9)) - 29.5 + dr) / dr))));
  /** Gris lineal en dB: 100 en el hígado y `slope` grises por dB. */
  const linearGray =
    (slope: number) =>
    (e: number): number =>
      100 + slope * 20 * Math.log10(Math.max(e, 1e-9));
  const capsule = (
    n: number,
    amp: (u: number) => number,
    o: { gray?: (e: number) => number; dr?: number; incidenceDeg?: (u: number) => number; wall?: number } = {},
  ): FaceSample[] =>
    Array.from({ length: n }, (_, u) => {
      const env = (r: number): number => 1 + amp(u) * gauss(r - R_FACE, 0.3);
      const gray = o.gray ?? curveGray(70);
      return {
        ...measureFaceLine(
          { env, gray: (r) => gray(env(r)), liver: (r) => r > R_FACE + 1 },
          { rb: RB, rTarget: R_FACE, ref: 'below' },
          o.dr ?? 70,
        )!,
        kind: 'capsule' as const,
        wall: o.wall ?? 0,
        u,
        rb: RB,
        pitchMm: PITCH,
        incidenceDeg: o.incidenceDeg?.(u) ?? 5,
      };
    });
  const bin0 = (samples: FaceSample[]) => contourStats([samples]).capsule[0];
  const db = (x: number): number => Math.pow(10, x / 20);

  it('una cresta constante da CVc 0 y σ_L 0; su contraste es el de la cresta pintada en gris', () => {
    const b = bin0(capsule(60, () => 30));
    expect(b.walls).toBe(60);
    expect(b.cvc).toBe(0);
    expect(b.sigmaLDb).toBe(0);
    expect(b.contrastGrey).toBe(curveGray(70)(31) - curveGray(70)(1));
    // la tendencia lenta (lóbulo, profundidad) tampoco cuenta: las dos medianas la siguen
    expect(bin0(capsule(60, (u) => 30 * db((u - 30) / 6))).sigmaLDb).toBeLessThan(1e-9);
    // sin 41 líneas seguidas en el tramo no hay σ_L; sin cresta sobre el hígado, tampoco CVc
    expect(bin0(capsule(40, () => 30)).sigmaLDb).toBeNaN();
    expect(bin0(capsule(20, () => 0)).cvc).toBeNaN();
    // el CVc pide ≥ 10 desviaciones (líneas con ≥ 5 vecinas a ±3 en su pared): con una sola, su DE de 0
    // sería un CVc 0 falso (el tramo de 60–80° tiene ≤ 8 registros por vista)
    expect(bin0(capsule(12, () => 30)).cvcLines).toBe(10);
    expect(bin0(capsule(12, () => 30)).cvc).toBe(0);
    expect(bin0(capsule(11, () => 30)).cvcLines).toBe(9);
    expect(bin0(capsule(11, () => 30)).cvc).toBeNaN();
    const gapped = bin0(capsule(6, (u) => 30 * db(-2 * u)).filter((s) => s.u !== 3));
    expect([gapped.walls, gapped.cvcLines]).toEqual([5, 1]);
    expect(gapped.cvc).toBeNaN();
  });

  it('σ_L mide la variación a escala de centímetros: ±3 dB con periodo de 3,5 cm dan ~2 dB', () => {
    const b = bin0(capsule(90, (u) => 30 * db(3 * Math.sin((2 * Math.PI * u) / 40))));
    expect(b.sigmaLDb).toBeGreaterThan(1.5);
    expect(b.sigmaLDb).toBeLessThan(2.5);
  });

  it('el contraste en gris varía con la curva de grises del equipo; el CVc casi no', () => {
    const rng = new SeededRandom(5);
    const gains = Array.from({ length: 60 }, () => db(rng.range(-6, 6)));
    const amp = (u: number) => 10 * gains[u];
    // gris lineal en dB con la pendiente ±10 %: el contraste escala ±10 % y el CVc no cambia
    const ref = bin0(capsule(60, amp, { gray: linearGray(3) }));
    expect(ref.cvc).toBeGreaterThan(0.1);
    for (const k of [0.9, 1.1]) {
      const b = bin0(capsule(60, amp, { gray: linearGray(3 * k) }));
      expect(b.contrastGrey / ref.contrastGrey).toBeCloseTo(k, 9);
      expect(b.cvc).toBeCloseTo(ref.cvc, 9);
    }
    // la curva del simulador con el rango dinámico a ±10 %: el contraste se mueve 5–10 %, el CVc < 3 %
    const at70 = bin0(capsule(60, amp));
    for (const dr of [63, 77]) {
      const b = bin0(capsule(60, amp, { gray: curveGray(dr), dr }));
      expect(Math.abs(b.contrastGrey / at70.contrastGrey - 1), `${dr} dB`).toBeGreaterThan(0.04);
      expect(Math.abs(b.contrastGrey / at70.contrastGrey - 1), `${dr} dB`).toBeLessThan(0.1);
      expect(Math.abs(b.cvc / at70.cvc - 1), `${dr} dB`).toBeLessThan(0.03);
    }
  });

  it('extremos bruscos: la mediana de 3 líneas cae ≥ 10 dB en ≤ 1 mm de pared desde ≥ +6 dB', () => {
    const ends = (samples: FaceSample[]) => contourStats([samples]).capsuleEnds;
    // cápsula que se corta a mitad de la pared (en un sentido o en el otro): un extremo
    expect(ends(capsule(60, (u) => (u < 30 ? 30 : 0)))).toBe(1);
    expect(ends(capsule(60, (u) => (u < 30 ? 0 : 30)))).toBe(1);
    // un hueco de 3 líneas: dos extremos; una sola línea apagada (el moteado) no corta la línea
    expect(ends(capsule(60, (u) => (u >= 28 && u < 31 ? 0 : 30)))).toBe(2);
    expect(ends(capsule(60, (u) => (u === 30 ? 0 : 30)))).toBe(0);
    // fundido de 30 dB en 6 mm (4,4 dB por línea): no es brusco; la pared continua, tampoco
    const fade = (u: number) => 30 * db(-Math.min(30, Math.max(0, (u - 20) * ((30 * PITCH) / 6))));
    expect(ends(capsule(60, fade))).toBe(0);
    expect(ends(capsule(60, () => 30))).toBe(0);
    expect(CAPSULE_END_SPAN_MM).toBe(1);
    // la cara que sale de la imagen o de la pared (el registro termina) no es un extremo de la línea
    expect(ends(capsule(20, () => 30))).toBe(0);
    // el corte repartido por la PSF en varias líneas (28 → 17 → 6 → 0 dB, 11 dB por línea) es un solo
    // extremo, en los dos sentidos: la caída que arranca a ≤ 1 mm de donde aterrizó la anterior la continúa
    const stair = (u: number): number => db(u < 28 ? 28 : u === 28 ? 17 : u === 29 ? 6 : 0) - 1;
    expect(ends(capsule(60, stair))).toBe(1);
    expect(ends(capsule(60, (u) => stair(59 - u)))).toBe(1);
    // dos caídas con 8,7 mm de meseta entre ellas son dos, aunque el nivel no vuelva a subir
    expect(ends(capsule(60, (u) => db(u < 20 ? 28 : u < 30 ? 17 : 0) - 1))).toBe(2);
    // sin ninguna mediana de 3 evaluada (sin registros, o paredes de < 3 líneas seguidas) no hay cifra: NaN,
    // no un 0 que aprobaría en silencio la puerta de la 60 en una vista que perdió sus registros
    const none = contourStats([]);
    expect([none.capsuleEnds, none.capsuleEndLines]).toEqual([Number.NaN, 0]);
    expect(ends(capsule(2, () => 30))).toBeNaN();
    expect(contourStats([capsule(60, () => 30)]).capsuleEndLines).toBe(58);
  });

  it('el salto de incidencia se mide entre líneas contiguas de la misma pared', () => {
    const jump = (samples: FaceSample[]) => contourStats([samples]);
    const step = jump(capsule(60, () => 30, { incidenceDeg: (u) => (u < 30 ? 32 : 58) }));
    expect(step.incidenceJumpP99Deg).toBeCloseTo(26, 9);
    expect(step.incidenceJumpMaxDeg).toBeCloseTo(26, 9);
    expect(step.incidencePairs).toBe(59);
    // con más de 100 pares, una arista sola queda por encima del p99: el máximo la sigue viendo
    const long = jump(capsule(150, () => 30, { incidenceDeg: (u) => (u < 75 ? 32 : 58) }));
    expect(long.incidenceJumpP99Deg).toBe(0);
    expect(long.incidenceJumpMaxDeg).toBeCloseTo(26, 9);
    expect(jump(capsule(60, () => 30, { incidenceDeg: (u) => 10 + 0.2 * u })).incidenceJumpP99Deg).toBeCloseTo(0.2, 9);
    // dos paredes distintas a 5° y a 45° no son vecinas aunque compartan líneas
    const two = [...capsule(30, () => 30, { wall: 0 }), ...capsule(30, () => 30, { wall: 1, incidenceDeg: () => 45 })];
    expect(jump(two).incidenceJumpP99Deg).toBe(0);
    // sin pares, NaN (no un 0 falso)
    expect(jump([]).incidenceJumpP99Deg).toBeNaN();
    expect(jump([]).incidenceJumpMaxDeg).toBeNaN();
  });
});

describe('banco de interfaces: la envolvente de la GPU lleva la atenuación de ida y vuelta', () => {
  // La envolvente que lee el banco (`readEnvelope`) cae 2·α_hígado por cm con la profundidad: la TGC
  // nominal se suma después, en la pasada de escaneo. Moteado ideal con un eco de 30× en la cara
  // (100,5 mm) y la pendiente de la compensación nominal a 2,5 MHz (3 dB/cm).
  const SLOPE = nominalTgcDbPerCm(2.5);
  const speckle = detect(G, psf(G, whiteField(G, 7), 1.5, 1.0), Math.hypot);
  const gauss = (x: number, sigma: number): number => Math.exp(-0.5 * (x / sigma) ** 2);
  /** Envolvente pintada por muestra: moteado × `after(r)` + eco, atenuada `slope` dB/cm. */
  const frame = (slope: number, after: (r: number) => number, echo: (r: number) => number): EnvelopeFrame => ({
    ...speckle,
    data: speckle.data.map((x, i) => {
      const r = (Math.floor(i / G.lines) + 0.5) * DR_MM;
      return (x * after(r) + echo(r)) * Math.pow(10, (-slope * r) / 200);
    }),
  });
  const sample = (kind: FaceKind, u: number, m: ReturnType<typeof measureFaceLine>): FaceSample => ({
    ...m!,
    kind,
    wall: 0,
    u,
    rb: 100,
    pitchMm: 0.9,
    incidenceDeg: kind === 'diaphragm' ? 50 : 5,
  });
  /** Pico del mismo eco con la referencia encima (pared) y debajo (cápsula), con la compensación `tgc`. */
  const walls = (env: EnvelopeFrame, tgc: number) => {
    const line = envelopeLine(env, GEOM.depthMm, tgc);
    const above: FaceSample[] = [];
    const below: FaceSample[] = [];
    for (let u = 0; u < G.lines; u++) {
      const env = (r: number): number => line(u, r);
      above.push(
        sample(
          'hepaticVein',
          u,
          measureFaceLine({ env, gray: () => 100, liver: (r) => r < 100 }, { rb: 100, rTarget: 100.5, ref: 'above' }, 70),
        ),
      );
      below.push(
        sample(
          'capsule',
          u,
          measureFaceLine({ env, gray: () => 100, liver: (r) => r > 101 }, { rb: 100, rTarget: 100.5, ref: 'below' }, 70),
        ),
      );
    }
    const sum = summarizeFaces([[...above, ...below]]);
    return { above: sum.wallSystems.hepaticVein[0].peakDb, below: sum.capsule[0].peakDb };
  };
  /** Diafragma a 50° sin costura: 2,5 mm de músculo (retrodispersión 1,2) y la pleura a 2,5/cos 50° del borde. */
  const RP = 100 + 2.5 / Math.cos((50 * Math.PI) / 180);
  const diaphragm = (env: EnvelopeFrame, tgc: number) => {
    const line = envelopeLine(env, GEOM.depthMm, tgc);
    const list = Array.from({ length: G.lines }, (_, u) =>
      sample(
        'diaphragm',
        u,
        measureFaceLine(
          { env: (r) => line(u, r), gray: () => 100, liver: (r) => r < 100 },
          { rb: 100, rTarget: RP, ref: 'above', pleura: true },
          70,
        ),
      ),
    );
    return summarizeFaces([list]).diaphragm[2];
  };
  const echo = (r: number): number => 30 * gauss(r - 100.5, 0.3);
  const flatWall = walls(
    frame(0, () => 1, echo),
    0,
  );
  const slopedWall = frame(SLOPE, () => 1, echo);
  const dia = (slope: number) =>
    frame(
      slope,
      (r) => (r < 100 ? 1 : Math.sqrt(1.2)),
      (r) => 30 * gauss(r - RP, 0.3),
    );

  it('la compensación nominal es la atenuación de ida y vuelta del hígado, la de la pasada de escaneo', () => {
    expect(nominalTgcDbPerCm(2.5)).toBeCloseTo(2 * attenuationDbPerCm(Tissue.Liver, 2.5), 12);
    expect(SLOPE).toBeGreaterThan(2.5);
    expect(SLOPE).toBeLessThan(3.5);
    // sin pendiente ni compensación, la interpolación es la de siempre: el centro de cada muestra
    const line = envelopeLine(speckle, GEOM.depthMm, 0);
    expect(line(5, 10.5 * DR_MM)).toBeCloseTo(speckle.data[10 * G.lines + 5], 6);
  });

  it('con la compensación, el mismo eco mide igual con la referencia encima (pared) o debajo (cápsula)', () => {
    const fixed = walls(slopedWall, SLOPE);
    expect(Math.abs(fixed.above - fixed.below)).toBeLessThan(0.5);
    // la envolvente atenuada y compensada es la del moteado sin atenuar
    expect(fixed.above).toBeCloseTo(flatWall.above, 3);
    expect(fixed.below).toBeCloseTo(flatWall.below, 3);
    // sin compensarla, la referencia a 3–10 mm del eco lo desplaza ~2 dB en cada sentido
    const raw = walls(slopedWall, 0);
    expect(raw.below - raw.above).toBeGreaterThan(3);
  });

  it('diafragma sin costura: la compensación no inventa costura ni baja la línea pleural', () => {
    const flat = diaphragm(dia(0), 0);
    const fixed = diaphragm(dia(SLOPE), SLOPE);
    expect(fixed.walls).toBe(G.lines);
    expect(fixed.seamFraction).toBe(flat.seamFraction);
    expect(fixed.seamFraction).toBeLessThanOrEqual(0.02);
    expect(fixed.lineDb).toBeCloseTo(flat.lineDb, 3);
    // sin compensarla, la referencia 8 mm por encima de la pleura sube el umbral de la costura y los
    // huecos del moteado del espejo cuentan: falla el ≤ 0,02 de §6.3 sin haber costura
    const raw = diaphragm(dia(SLOPE), 0);
    expect(raw.seamFraction).toBeGreaterThan(0.02);
    expect(flat.lineDb - raw.lineDb).toBeGreaterThan(2);
  });
});

describe('banco de fidelidad: hígado despejado', () => {
  it('la distancia se mide en el plano y lo que cae fuera de la rejilla cuenta como otro tejido', () => {
    // todo hígado, 40 líneas × 60 celdas de 0,5 mm y 1 mm entre líneas: a 3 mm solo las celdas a ≥ 3 mm
    // de cada borde están despejadas (antes, fuera del sector contaba como hígado y lo estaban todas)
    const lines = 40;
    const nr = 60;
    const ok = clearanceMask(new Uint8Array(lines * nr).fill(Tissue.Liver), lines, nr, 0.5, () => 1, 3, Tissue.Liver);
    const at = (u: number, k: number): number => ok[u * nr + k];
    expect(at(20, 30)).toBe(1);
    for (const [u, k] of [
      [2, 30],
      [37, 30],
      [20, 5],
      [20, 54],
    ])
      expect(at(u, k), `${u}, ${k}`).toBe(0);
    for (const [u, k] of [
      [3, 30],
      [36, 30],
      [20, 6],
      [20, 53],
    ])
      expect(at(u, k), `${u}, ${k}`).toBe(1);
    // una celda de otro tejido dentro también la tapa, a la misma distancia euclídea
    const tissue = new Uint8Array(lines * nr).fill(Tissue.Liver);
    tissue[20 * nr + 30] = Tissue.Blood;
    const withVessel = clearanceMask(tissue, lines, nr, 0.5, () => 1, 3, Tissue.Liver);
    expect(withVessel[23 * nr + 30]).toBe(0);
    expect(withVessel[24 * nr + 30]).toBe(1);
    expect(withVessel[20 * nr + 30]).toBe(0);
  });
});

/**
 * Composición espacial en el banco (decisión 58), sobre campos sintéticos: la correlación de intensidad
 * entre miradas (con la compensación nominal: sin ella la tendencia común de la atenuación la infla), la
 * costura (parches 8 × 48) y el fin de la umbra.
 */
describe('banco de fidelidad: composición espacial', () => {
  const mix = (a: Float32Array, b: Float32Array, c: number): Float32Array =>
    Float32Array.from(a, (x, i) => Math.sqrt(c) * x + Math.sqrt(1 - c) * b[i]);
  const f0 = psf(G, whiteField(G, 11), 1.5, 1.0);
  const f1 = psf(G, whiteField(G, 12), 1.5, 1.0);
  const f2 = psf(G, whiteField(G, 13), 1.5, 1.0);
  const TGC = 3; // dB/cm de ida y vuelta, la del hígado
  const attenuate = (e: EnvelopeFrame): EnvelopeFrame => ({
    ...e,
    data: Float32Array.from(e.data, (x, i) => x * Math.pow(10, (-TGC * ((Math.floor(i / G.lines) + 0.5) * DR_MM)) / 200)),
  });
  const env = (f: Float32Array) => attenuate(detect(G, f, Math.hypot));

  it('ρ_I es |ρ del campo|²: 1 entre miradas iguales, ≈ 0 entre independientes, c con √c·A + √(1−c)·B', () => {
    const e0 = env(f0);
    const same = lookCorrelations([e0, e0], everywhere, GEOM.depthMm, TGC);
    expect(same.pairs[0]).toBeCloseTo(1, 10);
    const ind = lookCorrelations([e0, env(f1), env(f2)], everywhere, GEOM.depthMm, TGC);
    expect(ind.patches).toBe((192 / 16) * Math.floor(1024 / 48));
    for (const r of ind.pairs) expect(Math.abs(r)).toBeLessThan(0.03);
    const part = lookCorrelations([e0, env(mix(f0, f1, 0.6))], everywhere, GEOM.depthMm, TGC);
    // el campo √c·A + √(1−c)·B correlaciona √c con A: en intensidad, c
    expect(Math.abs(part.pairs[0] - 0.6)).toBeLessThan(0.04);
    // sin compensar la atenuación, la tendencia común dentro de cada parche infla la correlación
    const raw = lookCorrelations([e0, env(f1)], everywhere, GEOM.depthMm, 0);
    expect(raw.pairs[0]).toBeGreaterThan(ind.pairs[0] + 0.01);
  });

  it('costura: con dos miradas independientes la SNR es √(2/3) de la de tres; sin 5 parches, NaN', () => {
    const [a, b, c] = [f0, f1, f2].map((f) => detect(G, f, Math.hypot));
    const left = (u: number) => u < G.lines / 2;
    const compound = {
      ...a,
      data: Float32Array.from(a.data, (x, i) => (left(i % G.lines) ? (x + b.data[i]) / 2 : (x + b.data[i] + c.data[i]) / 3)),
    };
    const band = { r0: 0, r1: 180 };
    const st = seamStats(
      compound,
      (u) => left(u),
      (u) => !left(u),
      GEOM,
      band,
    );
    expect(st.patches2).toBe((96 / 8) * Math.floor(1024 / 48));
    expect(st.ratio).toBeGreaterThan(0.78);
    expect(st.ratio).toBeLessThan(0.86);
    const few = seamStats(
      compound,
      (u, v) => left(u) && v < 48 * 4,
      (u) => !left(u),
      GEOM,
      band,
    );
    expect(few.patches2).toBe(4 * 12);
    const none = seamStats(
      compound,
      (u, v) => u < 8 && v < 48 * 4,
      (u) => !left(u),
      GEOM,
      band,
    );
    expect(none.patches2).toBe(4);
    expect(none.ratio).toBeNaN();
  });

  it('fin de la umbra: el primer cruce de −40 dB hacia arriba, interpolado; NaN si no sale', () => {
    expect(umbraEndMm([-10, -30, -50, -45, -41, -39, -30])).toBeCloseTo(4.5, 10);
    expect(umbraEndMm([-60, -50, -40])).toBeCloseTo(2, 10);
    expect(umbraEndMm([-60, -55, -50])).toBeNaN();
    expect(umbraEndMm([-10, -20, -30])).toBeNaN();
    expect(umbraEndMm([-50, Number.NaN, -30])).toBeNaN();
  });
});
