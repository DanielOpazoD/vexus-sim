import { describe, expect, it } from 'vitest';
import { WallFilter, effectiveWallFilterCutoff } from '../doppler/wallFilter';
import { normalizeEquipment } from '../app/equipment';
import { defaultEquipment } from '../app/simulator';
import { C_RECONSTRUCTION_MM_S } from '../core/units';
import { CONVEX_C35 } from '../probe/probe';

describe('contrato físico del filtro de pared PW', () => {
  it('expone el corte efectivo compatible con PRF sin mutar la solicitud', () => {
    const input = defaultEquipment();
    input.pw.prfHz = 250;
    input.pw.wallFilterHz = 300;
    const e = normalizeEquipment(input, { halfSectorRad: CONVEX_C35.halfSector, cMmS: C_RECONSTRUCTION_MM_S });
    expect(e.pw.wallFilterHz).toBe(112.5);
    const filter = new WallFilter(e.pw.wallFilterHz, e.pw.prfHz);
    expect(filter.cutoffHz).toBe(e.pw.wallFilterHz);
    expect(filter.magnitude(filter.cutoffHz)).toBeCloseTo(0.5, 10);
    expect(input.pw.wallFilterHz).toBe(300);
  });
  it('rechaza frecuencias inválidas antes de dañar un diseño válido', () => {
    const filter = new WallFilter(25, 2500);
    for (const [cutoff, fs] of [
      [NaN, 2500],
      [Infinity, 2500],
      [25, NaN],
      [25, Infinity],
      [25, 0],
      [25, -1],
    ]) {
      expect(() => filter.design(cutoff, fs)).toThrow(RangeError);
      expect(filter.cutoffHz).toBe(25);
      expect(filter.magnitude(25)).toBeCloseTo(0.5, 10);
    }
    expect(effectiveWallFilterCutoff(-25, 2500)).toBe(0);
  });
  it.each([
    [25, 2500],
    [100, 2000],
    [300, 1000],
  ])('conserva la cascada de dos etapas a %i Hz / PRF %i', (fc, fs) => {
    const filter = new WallFilter(fc, fs);
    expect(filter.magnitude(fc)).toBeCloseTo(0.5, 10);
    for (const f of [fc / 4, fc / 2, fc, Math.min(2 * fc, 0.49 * fs)]) {
      const warped = Math.tan((Math.PI * fc) / fs) / Math.tan((Math.PI * f) / fs);
      expect(filter.magnitude(f)).toBeCloseTo(1 / (1 + warped ** 4), 8);
    }
  });
  it('la IQ procesada reproduce la atenuación analítica tras el transitorio', () => {
    const fs = 2500,
      fc = 25,
      n = 5000;
    const re = Float32Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * fc * i) / fs));
    const im = Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * fc * i) / fs));
    new WallFilter(fc, fs).process(re, im);
    let energy = 0;
    for (let i = 2500; i < n; i++) energy += re[i] ** 2 + im[i] ** 2;
    expect(Math.sqrt(energy / 2500)).toBeCloseTo(0.5, 5);
  });
});
