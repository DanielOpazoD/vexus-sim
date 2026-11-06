import { focalGain } from '../../ultrasound/beamEcho';
import { bmodeBeam } from '../../ultrasound/transducerProfile';
import { CURTAIN_MIN_AIR, edgeWidth1090Mm, normalCdf } from '../../ultrasound/pleura';
import { nominalTgcDbPerCm, type DisplayFrame } from '../../ultrasound/renderer';
import { beamToPixel, pixelToBeam } from '../../ultrasound/sectorGeometry';
import type { EnvelopeFrame } from '../speckle';
import type { Simulator } from '../simulator';
import { clearLiverGrid } from './clearLiver';
import type { CurtainLine } from './curtain';
import { displayStats } from './display';
import { envelopeTexture, type EnvelopeTexture } from './envelope';
import { envelopeLine } from './faces';
import { DISPLAY_CLEARANCE_MM } from './grid';
import { medianOf, pearson } from './statistics';

/**
 * Métricas de la pleura parietal y de la cortina pulmonar (decisión 61) sobre las líneas de la cortina (`curtain.ts`):
 * línea pleural, neblina, líneas A, borde blando y deslizamiento.
 */

/** Líneas con la cortina entera (fracción de aire ≥ esto): las de la línea pleural, la neblina y las líneas A. */
export const CURTAIN_FULL_AIR = 0.99;
/** Incidencia máxima (°) de las líneas en que se mide la línea pleural y las líneas A. */
export const PLEURA_MAX_INCIDENCE_DEG = 15;
/** Gris de saturación de la imagen mostrada. */
const SATURATED_GREY = 250;

/**
 * Métricas de la pleura parietal y la cortina en el plano actual (spec §4 de la decisión 61; referencias en
 * docs/fidelity/README.md). Se informan, no se exigen: las vigila el responsable con GPU.
 */
export interface PleuraStats {
  /**
   * Líneas con pleura y fracción de aire ≥ 10⁻³; con la cortina entera y sin costilla delante; y de ellas, a
   * ≤ 15° de incidencia.
   */
  lines: number;
  fullLines: number;
  normalLines: number;
  /** Línea pleural a 0–15°: mediana del ancho saturado (≥ 250, mm) y del gris pico. */
  pleuraSaturatedMm: number;
  pleuraPeakGrey: number;
  /** Hígado puro fuera de la cortina (gris mostrado, mediana) y cuántos píxeles. */
  liverP50: number;
  liverPixels: number;
  /** Neblina: mediana del gris en [D + 2, 2D − 2] y en [2D + 2, 3D − 2] (cortina entera, ≤ 25°) y su cociente con el hígado. */
  hazeGrey: number;
  hazeGreyDeep: number;
  hazeRatio: number;
  /** Línea A de orden 2: pico sobre la mediana de la neblina vecina (dB); picos de las de orden 2 y 3 (dB, envolvente compensada). */
  aLine2ProminenceDb: number;
  aLine2PeakDb: number;
  aLine3PeakDb: number;
  /** Textura de la neblina en [D + 2, 2D − 2] (parches del banco) y anisotropía FWHM lateral/axial. */
  haze: EnvelopeTexture;
  hazeAnisotropy: number;
  /**
   * Borde blando: ajuste de Φ al nivel medio (dB) de [2D + 3, 2D + 20] frente a la z del cruce de la pleura;
   * centro (z, mm), anchura 10–90 % en z y a lo largo de la pleura en la imagen (mm), y sus mesetas.
   */
  edge: { centerZMm: number; width1090Mm: number; width1090ImageMm: number; lines: number; liverSideDb: number; lungSideDb: number } | null;
}

/** Mediana de una lista (NaN si está vacía). */
const med = (a: readonly number[]): number => medianOf(a);

/**
 * Métricas de la pleura y la cortina (`PleuraStats`) sobre la envolvente de la mirada 0 o la compuesta y, si
 * la hay, la imagen mostrada. `curtain`: `curtainLines` del mismo cuadro.
 */
export function pleuraStats(
  sim: Simulator,
  env: EnvelopeFrame,
  img: DisplayFrame | null,
  curtain: readonly (CurtainLine | null)[],
): PleuraStats {
  const tr = sim.transducer;
  const depth = sim.bmode.depthMm;
  const lines = env.lines;
  const dTheta = (2 * tr.halfSector) / lines;
  const thetaOf = (u: number): number => -tr.halfSector + dTheta * (u + 0.5);
  const dr = depth / env.samples;
  const beam = bmodeBeam(sim.profile, sim.bmode);
  const envAt = envelopeLine(env, depth, nominalTgcDbPerCm(sim.profile.bEffectiveMHz), (r) => focalGain(r, sim.bmode.focusMm, beam));
  const db = (x: number): number => 20 * Math.log10(Math.max(x, 1e-12));
  const withAir = curtain.filter((c): c is CurtainLine => c !== null && c.fAir >= CURTAIN_MIN_AIR);
  // la cortina entera, fuera de la sombra de las costillas (bajo una costilla la pleura está en sombra)
  const full = withAir.filter((c) => c.fAir >= CURTAIN_FULL_AIR && !c.shadowed && 2 * c.D + 4 < depth);
  const normal = full.filter((c) => c.incidenceDeg <= PLEURA_MAX_INCIDENCE_DEG);
  const hazeLines = full.filter((c) => c.incidenceDeg <= 25);
  const layout = img && img.width ? sim.renderer.display : null;
  const grayAt = (u: number, r: number): number => {
    if (!img || !layout) return Number.NaN;
    const p = beamToPixel(layout, tr, thetaOf(u), r);
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return Number.NaN;
    return img.gray[y * img.width + x];
  };
  const inBand = (c: CurtainLine, lo: number, hi: number, f: (u: number, r: number) => number): number[] => {
    const out: number[] = [];
    for (let r = Math.max(0, lo); r <= Math.min(depth - dr, hi); r += dr) {
      const v = f(c.u, r);
      if (Number.isFinite(v)) out.push(v);
    }
    return out;
  };
  // línea pleural: ancho saturado y pico, en la imagen mostrada
  const widths: number[] = [];
  const peaks: number[] = [];
  if (img && layout)
    for (const c of normal) {
      let w = 0;
      let pk = 0;
      for (let r = c.D - 3; r <= c.D + 3; r += 0.02) {
        const g = grayAt(c.u, r);
        if (!Number.isFinite(g)) continue;
        pk = Math.max(pk, g);
        if (g >= SATURATED_GREY) w += 0.02;
      }
      widths.push(w);
      peaks.push(pk);
    }
  // el hígado puro fuera de la cortina, en la imagen mostrada (la misma máscara que la guarda del moteado)
  let liverP50 = Number.NaN;
  let liverPixels = 0;
  if (img && layout) {
    const clear = clearLiverGrid(sim, lines, DISPLAY_CLEARANCE_MM);
    const st = displayStats(
      img,
      (x, y) => {
        const b = pixelToBeam(layout, tr, depth, x, y);
        if (!b || b.r < 20 || b.r > 120) return false;
        return clear.at(Math.round((b.theta + tr.halfSector) / dTheta - 0.5), b.r);
      },
      2,
    );
    liverP50 = st.p50;
    liverPixels = st.pixels;
  }
  // neblina en la imagen mostrada
  const haze = hazeLines.flatMap((c) => inBand(c, c.D + 2, 2 * c.D - 2, grayAt));
  const hazeDeep = hazeLines.flatMap((c) => inBand(c, 2 * c.D + 2, 3 * c.D - 2, grayAt));
  const hazeGrey = med(haze);
  // líneas A en la envolvente compensada: pico de orden k frente a la neblina a ±(0,15–0,4)·D
  const peakDb = (c: CurtainLine, k: number): number => {
    let p = -Infinity;
    for (let r = k * c.D - 1.5; r <= Math.min(depth - dr, k * c.D + 1); r += 0.05) p = Math.max(p, db(envAt(c.u, r)));
    return p;
  };
  const aroundDb = (c: CurtainLine, k: number): number =>
    med([
      ...inBand(c, (k - 0.4) * c.D, (k - 0.15) * c.D, (u, r) => db(envAt(u, r))),
      ...inBand(c, (k + 0.15) * c.D, (k + 0.4) * c.D, (u, r) => db(envAt(u, r))),
    ]);
  const deepEnough = (k: number) => normal.filter((c) => (k + 0.4) * c.D < depth);
  // textura de la neblina (parches del banco, 48 × 16)
  const byU = new Map<number, CurtainLine>(hazeLines.map((c) => [c.u, c]));
  const hazeTexture = envelopeTexture(
    env,
    (u, v) => {
      const c = byU.get(u);
      const r = (v + 0.5) * dr;
      return c !== undefined && r >= c.D + 2 && r <= 2 * c.D - 2;
    },
    { depthMm: depth, halfSector: tr.halfSector, curvatureRadius: tr.curvatureRadius },
  );
  return {
    lines: withAir.length,
    fullLines: full.length,
    normalLines: normal.length,
    pleuraSaturatedMm: med(widths),
    pleuraPeakGrey: med(peaks),
    liverP50,
    liverPixels,
    hazeGrey,
    hazeGreyDeep: med(hazeDeep),
    hazeRatio: hazeGrey / liverP50,
    aLine2ProminenceDb: med(deepEnough(2).map((c) => peakDb(c, 2) - aroundDb(c, 2))),
    aLine2PeakDb: med(deepEnough(3).map((c) => peakDb(c, 2))),
    aLine3PeakDb: med(deepEnough(3).map((c) => peakDb(c, 3))),
    haze: hazeTexture,
    hazeAnisotropy: hazeTexture.fwhmLateralMm / hazeTexture.fwhmAxialMm,
    edge: curtainEdgeFit(curtain, (u, r) => db(envAt(u, r)), depth, dr),
  };
}

/**
 * Borde de la cortina: Φ ajustada (rejilla) al nivel medio de cada línea con pleura en [2D + 3, 2D + 20] (bajo
 * la primera línea A: el hígado frente a la neblina del segundo intervalo, que es donde más se diferencian)
 * frente a la z del cruce de su pleura, entre las mesetas del lado del hígado (fracción de aire < 0,02) y del
 * pulmón (> 0,98). null si falta alguna meseta o hay menos de 12 líneas.
 */
export function curtainEdgeFit(
  curtain: readonly (CurtainLine | null)[],
  levelDb: (u: number, r: number) => number,
  depth: number,
  dr: number,
): PleuraStats['edge'] {
  const rows: { z: number; s: number; level: number; fAir: number }[] = [];
  let arc = 0;
  let prev: CurtainLine | null = null;
  for (const c of curtain) {
    if (!c) continue;
    // a través de las líneas sin pleura, la distancia entre los cruces que las rodean
    if (prev) arc += Math.hypot(c.point[0] - prev.point[0], c.point[1] - prev.point[1], c.point[2] - prev.point[2]);
    prev = c;
    // las líneas en la sombra de una costilla no dicen nada del borde
    if (c.shadowed || 2 * c.D + 20 > depth) continue;
    let sum = 0;
    let n = 0;
    for (let r = 2 * c.D + 3; r <= 2 * c.D + 20; r += dr) {
      sum += levelDb(c.u, r);
      n++;
    }
    rows.push({ z: c.z, s: arc, level: sum / n, fAir: c.fAir });
  }
  const liverSide = med(rows.filter((r) => r.fAir < 0.02).map((r) => r.level));
  const lungSide = med(rows.filter((r) => r.fAir > 0.98).map((r) => r.level));
  if (rows.length < 12 || !Number.isFinite(liverSide) || !Number.isFinite(lungSide)) return null;
  const fit = (x: (r: (typeof rows)[number]) => number): { c: number; sigma: number } => {
    const xs = rows.map(x);
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    // el nivel baja hacia el pulmón; el signo de la pendiente sale de las mesetas
    const sign = med(rows.filter((r) => r.fAir > 0.98).map(x)) > med(rows.filter((r) => r.fAir < 0.02).map(x)) ? 1 : -1;
    let best = { e: Infinity, c: 0, sigma: 1 };
    for (let c = lo; c <= hi; c += 0.25)
      for (let sigma = 0.5; sigma <= 15; sigma += 0.1) {
        let e = 0;
        for (let i = 0; i < rows.length; i++)
          e += (rows[i].level - (liverSide + (lungSide - liverSide) * normalCdf((sign * (xs[i] - c)) / sigma))) ** 2;
        if (e < best.e) best = { e, c, sigma };
      }
    return best;
  };
  const inZ = fit((r) => r.z);
  const inImage = fit((r) => r.s);
  return {
    centerZMm: inZ.c,
    width1090Mm: edgeWidth1090Mm(inZ.sigma),
    width1090ImageMm: edgeWidth1090Mm(inImage.sigma),
    lines: rows.length,
    liverSideDb: liverSide,
    lungSideDb: lungSide,
  };
}

/**
 * Deslizamiento (decisión 61): correlación entre dos cuadros de la banda de 2–6 mm bajo la pleura y de la de
 * la pared de 2–6 mm sobre ella, en las líneas con la cortina entera en los dos (misma pose; el pulmón ha
 * bajado entre ellos). La pared está quieta: su banda cambia solo por el ruido del receptor.
 */
export function slidingCorrelation(
  a: EnvelopeFrame,
  b: EnvelopeFrame,
  curtainA: readonly (CurtainLine | null)[],
  curtainB: readonly (CurtainLine | null)[],
  depthMm: number,
): { subPleural: number; wall: number; lines: number } {
  const dr = depthMm / a.samples;
  const sub: [number[], number[]] = [[], []];
  const wall: [number[], number[]] = [[], []];
  let lines = 0;
  for (let u = 0; u < a.lines; u++) {
    const ca = curtainA[u];
    const cb = curtainB[u];
    if (!ca || !cb || ca.fAir < CURTAIN_FULL_AIR || cb.fAir < CURTAIN_FULL_AIR) continue;
    lines++;
    for (let v = 0; v < a.samples; v++) {
      const r = (v + 0.5) * dr;
      const i = v * a.lines + u;
      if (r >= ca.D + 2 && r <= ca.D + 6) {
        sub[0].push(a.data[i]);
        sub[1].push(b.data[i]);
      } else if (r >= ca.D - 6 && r <= ca.D - 2) {
        wall[0].push(a.data[i]);
        wall[1].push(b.data[i]);
      }
    }
  }
  const pearsonOf = (x: number[], y: number[]): number => (x.length > 8 ? pearson(Float64Array.from(x), Float64Array.from(y)) : Number.NaN);
  return { subPleural: pearsonOf(sub[0], sub[1]), wall: pearsonOf(wall[0], wall[1]), lines };
}
