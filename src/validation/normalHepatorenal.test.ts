import { describe, expect, it } from 'vitest';
import { Tissue, TISSUES } from '../anatomy/tissues';
import { DENSITY, densityDb, densityGain, strongScatter } from '../ultrasound/speckleField';
import { Interface, INTERFACES } from '../anatomy/interfaces';
import { PERIRENAL } from '../anatomy/organs/kidney';

describe('apariencia hepatorrenal normal sin cambiar el contraste parenquimatoso basal', () => {
  it('conserva hígado/corteza y absorción: no usa ganancia global para ocultar un contraste patológico', () => {
    expect(TISSUES[Tissue.Liver].backscatter).toBe(1);
    expect(TISSUES[Tissue.RenalCortex].backscatter).toBe(0.72);
    expect(TISSUES[Tissue.Liver].alpha1).toBe(0.601);
    expect(TISSUES[Tissue.RenalCortex].alpha1).toBe(0.7);
    expect(strongScatter(Tissue.Liver)[0]).toBe(0.012);
  });
  it('fina heterogeneidad material, simétrica en dB y sin señal distinta en otros tejidos', () => {
    expect(DENSITY.cellMm).toBe(3);
    expect(DENSITY.scaleDb).toBe(4);
    let sum = 0,
      min = Infinity,
      max = -Infinity;
    for (let i = 0; i < 10000; i++) {
      const p: [number, number, number] = [(i % 43) * 0.71, (Math.floor(i / 43) % 37) * 0.83, Math.floor(i / (43 * 37)) * 1.19];
      const d = densityDb(p, 7);
      sum += d;
      min = Math.min(min, d);
      max = Math.max(max, d);
      expect(densityGain(p, 7, Tissue.RenalCortex)).toBe(1);
    }
    expect(Math.abs(sum / 10000)).toBeLessThan(0.5);
    expect(max - min).toBeGreaterThan(1);
    expect(max - min).toBeLessThanOrEqual(4);
  });
  it('grasa perirrenal menos dominante; seno brillante, médula hipoecoica e interfaces intactas', () => {
    expect(TISSUES[Tissue.PerirenalFat].backscatter).toBe(1.8);
    expect(TISSUES[Tissue.PerirenalFat].speckleClump).toBe(0.5);
    expect(TISSUES[Tissue.RenalSinus].backscatter).toBe(4.5);
    expect(TISSUES[Tissue.RenalMedulla].backscatter).toBe(0.28);
    expect(PERIRENAL).toEqual({ minMm: 1, maxMm: 9, faceMaxMm: 2.5 });
    expect(INTERFACES[Interface.RenalCapsule].roughnessMm).toBe(0.06);
    expect(INTERFACES[Interface.RenalCapsule].slopeRms).toBe(0.2);
  });
});
