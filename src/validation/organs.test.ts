import { describe, expect, it } from 'vitest';
import { ANATOMY_GLSL } from '../anatomy/gpu/anatomy.glsl';
import { ORGAN_MODULES } from '../anatomy/organs';
import { HILUM_NOTCH, PYRAMIDS, RENAL_CAPSULE_MM } from '../anatomy/organs/kidney';
import { LUNG_CURTAIN, lungCurtainDistance } from '../anatomy/organs/lungCurtain';
import { LIGAMENTUM_VENOSUM, ligamentumVenosumSdf, umbilicalFissureSdf, UMBILICAL_FISSURE } from '../anatomy/organs/liverLigaments';

/** Módulos de órgano (decisión 46): gemelos TS/GLSL juntos y con el mismo nombre. */
describe('Módulos de órgano', () => {
  for (const o of ORGAN_MODULES) {
    it(`${o.id}: cada función GLSL tiene su gemela TS exportada y el shader la incluye`, () => {
      const fns = [...o.glsl.matchAll(/^\s*(?:float|vec[234]|bool|int)\s+(\w+)\s*\(/gm)].map((m) => m[1]);
      expect(fns.length).toBeGreaterThan(0);
      const gpuOnly = Object.keys(o.gpuOnly ?? {});
      for (const f of fns.filter((f) => !gpuOnly.includes(f)))
        expect(typeof o.exports[f], `${o.id}: falta la gemela TS de ${f}`).toBe('function');
      // la lista de excepciones no se queda vieja: nombra funciones GLSL que existen y no tienen gemela
      for (const f of gpuOnly) {
        expect(fns, `${o.id}: gpuOnly nombra ${f}, que no está en el GLSL`).toContain(f);
        expect(o.exports[f], `${o.id}: ${f} ya tiene gemela TS; sácala de gpuOnly`).toBeUndefined();
      }
      expect(ANATOMY_GLSL).toContain(o.glsl);
    });
  }

  it('las constantes del shader salen del módulo, no de literales copiados', () => {
    const lig = ORGAN_MODULES.find((o) => o.id === 'liverLigaments')!.glsl;
    expect(lig).toContain(`FISSURE_ROUND_MM = ${UMBILICAL_FISSURE.roundMm.toFixed(3)}`);
    expect(lig).toContain(`LIG_VEN_HALF_MM = ${LIGAMENTUM_VENOSUM.halfMm.toFixed(3)}`);
    expect(ANATOMY_GLSL).toContain('FISSURE_ROUND_MM)');
    const kid = ORGAN_MODULES.find((o) => o.id === 'kidney')!.glsl;
    expect(kid).toContain(`#define N_PYR ${PYRAMIDS.length}`);
    expect(kid).toContain(`NOTCH_ROUND = ${HILUM_NOTCH.roundMm.toFixed(1)}`);
    expect(kid).toContain(`RENAL_CAPSULE_MM = ${RENAL_CAPSULE_MM.toFixed(2)}`);
  });

  it('las funciones TS del módulo se comportan como documentan', () => {
    // fisura: dentro de la lámina, cerca de la superficie, anterior y caudal → negativa
    expect(umbilicalFissureSdf([UMBILICAL_FISSURE.x, 50, -40], -5)).toBeLessThan(0);
    expect(umbilicalFissureSdf([UMBILICAL_FISSURE.x + 10, 50, -40], -5)).toBeGreaterThan(0);
    // ligamento venoso: su punto de anclaje está en la lámina solo dentro de la caja
    expect(ligamentumVenosumSdf([-10, 6, 0])).toBeLessThan(0);
    expect(ligamentumVenosumSdf([100, 6, 0])).toBeGreaterThan(0);
    // cortina: solo bajo la pared, en el lado derecho y por encima del borde que baja al inspirar
    expect(lungCurtainDistance([-100, 0, 10], 1, 0)).toBeNull();
    expect(lungCurtainDistance([-100, 0, 10], 1, 30)).toBeCloseTo(1, 9);
    expect(lungCurtainDistance([-100, 0, 10], LUNG_CURTAIN.thicknessMm + 1, 30)).toBeNull();
    // fuera del hemitórax derecho (decisión 71: la huella llega a la línea media, delante y detrás)
    expect(lungCurtainDistance([20, 0, 10], 1, 30)).toBeNull();
    // la lámina que baja sobre el hígado sigue solo en el receso lateral y posterior (la pleura anterior no la necesita)
    expect(lungCurtainDistance([-60, 90, 10], 1, 30)).toBeNull();
  });
});
