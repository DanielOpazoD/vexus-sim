import { describe, expect, it } from 'vitest';
import { Tissue } from '../anatomy/tissues';
import { compareTissueGrids } from '../app/equivalenceCheck';

/** Comparador de mapas de tejido (comprobación TS ↔ GLSL en vivo, decisión 30). */
describe('compareTissueGrids', () => {
  const grid = (w: number, h: number, fill: (u: number, v: number) => Tissue) => {
    const tissue = new Uint8Array(w * h);
    for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) tissue[v * w + u] = fill(u, v);
    return { width: w, height: h, tissue };
  };

  it('mapas idénticos → acuerdo 1; una franja de borde solo baja el acuerdo total, no el interior', () => {
    const a = grid(10, 10, (u) => (u < 5 ? Tissue.Liver : Tissue.Bowel));
    expect(compareTissueGrids(a, a)).toEqual({ agreement: 1, interiorAgreement: 1, worst: [], cells: 100 });
    // la GPU desplaza el borde una celda: 10 celdas distintas, todas en el borde CPU
    const b = grid(10, 10, (u) => (u < 6 ? Tissue.Liver : Tissue.Bowel));
    const r = compareTissueGrids(a, b)!;
    expect(r.agreement).toBeCloseTo(0.9, 12);
    expect(r.interiorAgreement).toBe(1);
    expect(r.worst).toEqual([{ cpu: Tissue.Bowel, gpu: Tissue.Liver, count: 10 }]);
  });

  it('un desacuerdo interior sí baja el acuerdo interior y aparece en «peor»', () => {
    const a = grid(10, 10, () => Tissue.Liver);
    const b = grid(10, 10, (u, v) => (u === 5 && v === 5 ? Tissue.Blood : Tissue.Liver));
    const r = compareTissueGrids(a, b)!;
    expect(r.agreement).toBeCloseTo(0.99, 12);
    expect(r.interiorAgreement).toBeCloseTo(1 - 1 / 64, 12); // 8×8 celdas interiores
    expect(r.worst[0]).toEqual({ cpu: Tissue.Liver, gpu: Tissue.Blood, count: 1 });
  });

  it('rejillas de distinto tamaño no se comparan', () => {
    expect(
      compareTissueGrids(
        grid(4, 4, () => Tissue.Liver),
        grid(5, 4, () => Tissue.Liver),
      ),
    ).toBeNull();
  });
});
