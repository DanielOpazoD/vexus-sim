import { describe, expect, it } from 'vitest';
import { apertureTransmission, type ApertureGeometry } from '../ultrasound/aperture';
import { CONVEX_BEAM } from '../ultrasound/beamModel';

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
