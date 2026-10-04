// @tier slow
import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeContour, contourView } from './support/liverContour';

/** Same 56 poses and 0.25 mm sampling; representative contours remain covered in liverContour.test.ts. */
describe('matriz exhaustiva del contorno hepático', () => {
  const reports: { id: string; creases: number }[] = [];
  beforeAll(() => {
    const d = (6 * Math.PI) / 180;
    const offsets: [number, number, number][] = [
      [0, 0, 0],
      [0, d, 0],
      [0, -d, 0],
      [0, 0, d],
      [0, 0, -d],
      [0.05, 0, 0],
      [-0.05, 0, 0],
    ];
    for (const c of ['normal', 'severe'] as const)
      for (const sp of ['subxiphoid', 'intercostal', 'flank', 'renal'] as const)
        for (const [dPhi, dRock, dTilt] of offsets) {
          const report = analyzeContour(contourView(c, sp, dPhi, dRock, dTilt));
          reports.push({ id: `${c}/${sp}/${dPhi}/${dRock}/${dTilt}`, creases: report.creases.filter((x) => !x.fissure).length });
        }
  }, 600_000);
  // Unexpected computation failures must fail setup, not be accepted as the known geometric defect.
  it('ejecuta las 56 poses únicas con resultados enteros válidos', () => {
    expect(reports).toHaveLength(56);
    expect(new Set(reports.map((r) => r.id)).size).toBe(56);
    for (const r of reports) {
      expect(Number.isInteger(r.creases), r.id).toBe(true);
      expect(r.creases, r.id).toBeGreaterThanOrEqual(0);
    }
  });
  it.fails('60: ≤ 15 aristas fuera de la fisura en las mismas 56 poses', () => {
    expect(reports.reduce((sum, r) => sum + r.creases, 0)).toBeLessThanOrEqual(15);
  });
});
