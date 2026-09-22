import { describe, expect, it } from 'vitest';
import { COUINAUD_LABEL, couinaudPlanes, couinaudSegment } from '../anatomy/couinaud';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { Tissue } from '../anatomy/tissues';
import { NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';

/**
 * Segmentación de Couinaud (decisión 42): los planos salen de las suprahepáticas, la
 * fisura umbilical y el plano portal de la MISMA escena, así que si un vaso se mueve
 * los segmentos lo siguen. Puntos de referencia del parénquima por segmento.
 */
const scene = new AnatomyScene(NORMAL_ADULT);
const planes = couinaudPlanes(scene);
const seg = (p: Vec3) => couinaudSegment(p, planes);

describe('Segmentos de Couinaud', () => {
  it('ocho segmentos en sus cuadrantes: derecho anterior/posterior × superior/inferior, IV, II/III, caudado', () => {
    expect(seg([-100, 30, -45])).toBe(5);
    expect(seg([-100, 30, 10])).toBe(8);
    expect(seg([-110, -30, -45])).toBe(6);
    expect(seg([-110, -30, 10])).toBe(7);
    expect(seg([-20, 30, -45])).toBe(4);
    expect(seg([-30, 20, 0])).toBe(4);
    expect(seg([60, 30, -45])).toBe(3);
    expect(seg([40, 10, 0])).toBe(2);
    expect(seg([-25, -8, -20])).toBe(1);
  });

  it('los planos siguen a los vasos: la derecha separa V/VIII de VI/VII a ambos lados de hvRight', () => {
    const hv = scene.vessels.find((v) => v.id === 'hvRight' && v.flowFactor === undefined)!;
    const mid = hv.tube.nodes[1].p;
    const n = planes.rightHv.normal;
    const ant: Vec3 = [mid[0] + n[0] * 12, mid[1] + n[1] * 12, mid[2] + n[2] * 12];
    const post: Vec3 = [mid[0] - n[0] * 12, mid[1] - n[1] * 12, mid[2] - n[2] * 12];
    expect([5, 8]).toContain(seg(ant));
    expect([6, 7]).toContain(seg(post));
    expect(planes.umbilicalX).toBe(scene.umbilicalFissure.x);
    expect(Object.keys(COUINAUD_LABEL)).toHaveLength(8);
  });

  it('el ligamento venoso es una lámina ecogénica dentro del hígado, delante del caudado', () => {
    for (const p of [
      [-20, 4, -20],
      [-10, 6, 0],
      [-5, 8, 20],
    ] as Vec3[]) {
      expect(scene.classify(p, BASELINE_CALIBER).tissue).toBe(Tissue.LigamentumVenosum);
      expect(scene.ligamentumVenosumSdf(p)).toBeLessThan(0);
    }
    // 4 mm por detrás de la lámina: caudado (hígado); 4 mm por delante: segmento II/IV (hígado)
    const n = planes.venosum.normal;
    const back: Vec3 = [-10 - 4 * n[0], 6 - 4 * n[1], 0 - 4 * n[2]];
    const front: Vec3 = [-10 + 4 * n[0], 6 + 4 * n[1], 0 + 4 * n[2]];
    expect(scene.classify(back, BASELINE_CALIBER).tissue).toBe(Tissue.Liver);
    expect(scene.classify(front, BASELINE_CALIBER).tissue).toBe(Tissue.Liver);
    expect(seg(back)).toBe(1);
    expect(seg(front)).not.toBe(1);
    // fuera de la caja de la lámina no hay ligamento
    expect(scene.classify([-60, 20, -10], BASELINE_CALIBER).tissue).toBe(Tissue.Liver);
  });
});
