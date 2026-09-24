import { describe, expect, it } from 'vitest';
import { Tissue } from '../anatomy/tissues';
import {
  APERTURE_GLSL,
  STEERED_APERTURE_GLSL,
  apertureTransmission,
  steeredApertureTransmission,
  type ApertureGeometry,
} from '../ultrasound/aperture';
import { CONVEX_BEAM } from '../ultrasound/beamModel';
import { COMPOUND, lookTheta } from '../ultrasound/compound';
import { CONVEX_C35_PROFILE } from '../ultrasound/transducerProfile';
import { GRID_GEOMETRY, lookTransmission, segmentGridFromScene } from './support/segmentGrid';

/**
 * Penumbra de la apertura (decisión 54) sobre una costilla sintética: un bloque de 20 líneas a 25 mm
 * de profundidad que no deja pasar nada. Con la geometría del convexo (192 líneas, ±34°, R 60 mm,
 * apertura 26 mm, F# 2,5), la sombra es completa bajo la costilla cerca de ella, se rellena en
 * profundidad y su borde es una rampa, no un escalón.
 */
const GEOM: ApertureGeometry = {
  lines: 192,
  halfSector: (34 * Math.PI) / 180,
  curvatureRadius: 60,
  apertureTxMm: CONVEX_BEAM.apertureTxMm,
  apertureRxMaxMm: CONVEX_BEAM.apertureRxMaxMm,
  fNumberRxMin: CONVEX_BEAM.fNumberRxMin,
};
const RIB = { from: 86, to: 105, depthMm: 25 };
const onRib = (l: number): boolean => l >= RIB.from && l <= RIB.to;
const oneWay = (r: number) => (l: number) => (onRib(l) && r > RIB.depthMm ? 0 : 1);
const obstacle = (l: number): number => (onRib(l) ? RIB.depthMm : Infinity);
const T = (line: number, r: number): number => apertureTransmission(GEOM, line, r, oneWay(r), obstacle);
const db = (x: number): number => 20 * Math.log10(Math.max(x, 1e-6));

describe('penumbra de la apertura', () => {
  it('sin obstáculo por encima es un solo rayo', () => {
    expect(
      apertureTransmission(
        GEOM,
        40,
        80,
        () => 0.7,
        () => Infinity,
      ),
    ).toBeCloseTo(0.49, 12);
    // el obstáculo por debajo del punto no cuenta
    expect(T(95, 20)).toBe(1);
  });

  it('bajo la costilla la sombra es completa cerca de ella y se rellena en profundidad', () => {
    const center = (RIB.from + RIB.to) / 2;
    expect(T(Math.round(center), 35)).toBeLessThan(0.02);
    const shallow = db(T(Math.round(center), 45));
    const deep = db(T(Math.round(center), 150));
    expect(deep).toBeGreaterThan(shallow);
    expect(deep).toBeLessThan(-6); // sigue siendo sombra, rellena solo en parte
  });

  it('el borde de la sombra es una rampa del ancho del cono, no un escalón de una línea', () => {
    // a 90 mm el cono sobre la costilla (25 mm) mide ±18 líneas: el perfil empieza fuera de él
    const r = 90;
    const profile = Array.from({ length: 40 }, (_, i) => T(RIB.from - 25 + i, r));
    // fuera del cono: sin sombra; dentro, en el centro: la más honda
    expect(profile[0]).toBeGreaterThan(0.95);
    const min = Math.min(...profile);
    expect(min).toBeLessThan(0.3);
    // al menos 5 líneas intermedias entre el 90 % y el 10 % del salto (una sombra de un solo rayo tiene 0)
    const hi = 1 - 0.1 * (1 - min);
    const lo = min + 0.1 * (1 - min);
    expect(profile.filter((x) => x < hi && x > lo).length).toBeGreaterThanOrEqual(5);
    // monótona hasta el mínimo (entrando en la sombra)
    const iMin = profile.indexOf(min);
    for (let i = 1; i <= iMin; i++) expect(profile[i]).toBeLessThanOrEqual(profile[i - 1] + 1e-12);
  });
});

/**
 * Penumbra y refuerzo de las miradas dirigidas (decisión 58, T4), con los gemelos de producción: la
 * rejilla de segmentos de A1 de una escena 2D, el prefijo dirigido de A2 (`steeredPrefixDb`) y el cono de
 * la pasada A sobre los caminos dirigidos (`steeredApertureTransmission`). El compuesto de transmisiones
 * es su media lineal (la media de las envolventes de miradas con el mismo moteado medio).
 */
describe('penumbra y refuerzo de las miradas dirigidas (decisión 58)', () => {
  const AP: ApertureGeometry = { ...GEOM, lines: GRID_GEOMETRY.lines, halfSector: GRID_GEOMETRY.halfSector };
  const F = CONVEX_C35_PROFILE.bEffectiveMHz;
  const TH = lookTheta(1, COMPOUND);
  const liver = segmentGridFromScene(() => Tissue.Liver, F);
  const step = liver.stepMm;
  const rowOf = (r: number) => Math.round(r / step - 0.5);
  /** Transmisión de las tres miradas y del compuesto, respecto al hígado sin obstáculo (dB por línea). */
  function looksDb(scene: ReturnType<typeof segmentGridFromScene>, k: number): { look0: number[]; compound: number[] } {
    const [t0, tp, tm] = [0, TH, -TH].map((th) => lookTransmission(scene, AP, th, k));
    const [r0, rp, rm] = [0, TH, -TH].map((th) => lookTransmission(liver, AP, th, k));
    return {
      look0: Array.from(t0, (t, l) => db(t / r0[l])),
      compound: Array.from(t0, (t, l) => db((t + tp[l] + tm[l]) / (r0[l] + rp[l] + rm[l]))),
    };
  }
  const median = (a: readonly number[]) => {
    const s = [...a].sort((x, y) => x - y);
    return s.length % 2 ? s[s.length >> 1] : 0.5 * (s[s.length / 2 - 1] + s[s.length / 2]);
  };

  it('con θ = 0 es la penumbra de la decisión 54, exactamente, en toda la rejilla', () => {
    let worst = 0;
    for (let line = 0; line < GEOM.lines; line++)
      for (let r = 2; r <= 180; r += 4) {
        const a = apertureTransmission(GEOM, line, r, oneWay(r), obstacle);
        const b = steeredApertureTransmission(GEOM, 0, line, r, oneWay(r), obstacle);
        worst = Math.max(worst, Math.abs(db(a) - db(b)));
      }
    expect(worst).toBe(0);
    // y la cadena de la GPU (A1 → A2 dirigido → A) con θ = 0 es la de hoy (A1 → A2 → A)
    const rib = segmentGridFromScene((x, z) => (Math.abs(x) < 6 && z > 18 && z < 26 ? Tissue.Bone : Tissue.Liver), F);
    for (const k of [10, 25, 40, 80, 150]) {
      const t = lookTransmission(rib, AP, 0, k);
      const r = (k + 0.5) * step;
      const hits = (l: number) => {
        for (let s = 0; s < rib.rows; s++) if (rib.bone[l * rib.rows + s]) return (s + 0.5) * step;
        return Infinity;
      };
      const pre = (l: number) => {
        let d = 0;
        let bone = false;
        for (let s = 0; s <= k; s++) {
          const i = l * rib.rows + s;
          if (rib.bone[i] && !bone) {
            d += 6;
            bone = true;
          }
          d += rib.db[i];
        }
        return Math.pow(10, -d / 40);
      };
      for (let l = 0; l < AP.lines; l++) expect(t[l]).toBe(apertureTransmission(AP, l, r, pre, hits));
    }
  });

  it('costilla de 12 mm a 18 mm: la umbra (−40 dB) acaba 2–6 mm antes y el núcleo sigue en el suelo', () => {
    const rib = segmentGridFromScene((x, z) => (Math.abs(x) < 6 && z > 18 && z < 26 ? Tissue.Bone : Tissue.Liver), F);
    const core = [94, 95, 96, 97];
    const rows: { behind: number; look0: number; compound: number }[] = [];
    for (let k = rowOf(26); k <= rowOf(80); k++) {
      const d = looksDb(rib, k);
      rows.push({
        behind: (k + 0.5) * step - 18,
        look0: median(core.map((l) => d.look0[l])),
        compound: median(core.map((l) => d.compound[l])),
      });
    }
    // fin de la umbra: donde el núcleo (mediana de las líneas centrales) sube de −40 dB, interpolado en dB
    const umbraEnd = (key: 'look0' | 'compound') => {
      for (let i = 1; i < rows.length; i++)
        if (rows[i - 1][key] < -40 && rows[i][key] >= -40)
          return rows[i - 1].behind + ((-40 - rows[i - 1][key]) / (rows[i][key] - rows[i - 1][key])) * step;
      return Number.NaN;
    };
    const u0 = umbraEnd('look0');
    const uc = umbraEnd('compound');
    // el gemelo del juez 1 (rib-cliff.ts): de 26–28 a 22–24 mm tras la cara de la costilla
    expect(u0).toBeGreaterThan(24);
    expect(u0).toBeLessThan(29);
    expect(u0 - uc).toBeGreaterThanOrEqual(2);
    expect(u0 - uc).toBeLessThanOrEqual(6);
    // núcleo: mediana de 10 a 40 mm tras la cara sobre el suelo de ruido de la GPU (K6: 22,6 dB bajo el
    // hígado, suma de potencias); el compuesto no rellena la sombra (22,6 → 22,2 dB)
    const FLOOR_DB = -22.6;
    const onFloor = (d: number) => 10 * Math.log10(10 ** (d / 10) + 10 ** (FLOOR_DB / 10));
    const win = rows.filter((q) => q.behind >= 10 && q.behind <= 40);
    const c0 = median(win.map((q) => onFloor(q.look0)));
    const cc = median(win.map((q) => onFloor(q.compound)));
    expect(Math.abs(cc - c0)).toBeLessThanOrEqual(1);
    expect(cc).toBeLessThanOrEqual(-20);
  });

  it('refuerzo tras un vaso de 12 mm a 60 mm: el borde se ensancha en profundidad y el pico apenas baja', () => {
    const vessel = segmentGridFromScene((x, z) => (Math.hypot(x, z - 60) < 6 ? Tissue.Blood : Tissue.Liver), F);
    const span = Array.from({ length: 61 }, (_, i) => 66 + i);
    const edge = (d: readonly number[], r: number) => {
      const p = span.map((l) => d[l]);
      const base = p[0];
      const peak = Math.max(...p);
      const iPk = p.indexOf(peak);
      const at = (f: number) => {
        const t = base + f * (peak - base);
        for (let i = 0; i < iPk; i++) if (p[i] <= t && p[i + 1] > t) return i + (t - p[i]) / (p[i + 1] - p[i]);
        return Number.NaN;
      };
      return {
        peakDb: peak - base,
        widthMm: (at(0.9) - at(0.1)) * (GRID_GEOMETRY.curvatureRadius + r) * ((2 * GRID_GEOMETRY.halfSector) / GRID_GEOMETRY.lines),
      };
    };
    for (const [rTarget, widen] of [
      [110, 1.15],
      [150, 1.35],
    ] as const) {
      const k = rowOf(rTarget);
      const r = (k + 0.5) * step;
      const d = looksDb(vessel, k);
      const e0 = edge(d.look0, r);
      const ec = edge(d.compound, r);
      // refuerzo de un solo rayo por mirada (como hoy en la pasada A), por su propio camino
      expect(e0.peakDb).toBeGreaterThan(2);
      expect(ec.widthMm / e0.widthMm, `borde 10–90 % a ${rTarget} mm`).toBeGreaterThanOrEqual(widen);
      expect(e0.peakDb - ec.peakDb, `pico a ${rTarget} mm`).toBeLessThanOrEqual(0.3);
      expect(e0.peakDb - ec.peakDb, `pico a ${rTarget} mm`).toBeGreaterThanOrEqual(0);
    }
  });

  it('el GLSL dirigido es el cono de la pasada A con el prefijo dirigido y el radio R·cos θ', () => {
    expect(STEERED_APERTURE_GLSL).toContain('return pow(10.0, -texelFetch(uPreSteer, ivec2(l, k), 0).x / 40.0);');
    expect(STEERED_APERTURE_GLSL).toContain('float maxHalf = (0.5 * uAperture.x) / (rc * dTheta);');
    expect(STEERED_APERTURE_GLSL).toContain('float halfRx = 0.5 * min(uAperture.y, s / uAperture.z) * shrink / spacing;');
    // usa las tomas y la búsqueda de APERTURE_GLSL, que va delante
    expect(STEERED_APERTURE_GLSL).toContain('AP_TAPS');
    expect(APERTURE_GLSL).toContain('const int AP_TAPS');
    expect(STEERED_APERTURE_GLSL).not.toMatch(/APERTURE_TAPS|APERTURE_SEARCH_LINES/);
  });
});
