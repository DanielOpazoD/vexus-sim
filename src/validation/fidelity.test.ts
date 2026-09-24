import { describe, expect, it } from 'vitest';
import {
  clearanceMask,
  depthProfile,
  displayStats,
  echoWidthMm,
  envelopeLine,
  envelopeTexture,
  halfWidth,
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
    expect(oblique.map((b) => b.walls)).toEqual([0, 30, 0]);
    expect(oblique[0].gapFraction).toBeNaN();
    // dos poses con la misma numeración de líneas y amplitudes distintas: cada pared es continua
    const b = summarizeFaces([wall(30, () => 10), wall(30, () => 40)]).wallSystems.hepaticVein[0];
    expect(b.walls).toBe(60);
    expect(b.beading).toBeLessThan(1e-9);
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
