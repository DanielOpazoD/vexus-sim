import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../core/vec3';
import { BOWEL_GAS_GLSL, bowelGas, bowelGasTail, GAS_FACE } from '../ultrasound/gasFace';
import { glslFloat } from '../ultrasound/receiver';
import * as PASSES from '../ultrasound/shaders/passes.glsl';

// Los programas de B que dibujan lo de detrás del gas: los que llevan las réplicas de su reverberación.
const gasPrograms = Object.entries(PASSES).filter(
  ([name, source]) => name.startsWith('FRAG_') && typeof source === 'string' && source.includes('pow(Tg, float(k))'),
) as [string, string][];

describe('gas intestinal (decisión 325)', () => {
  it('la gaussiana de reverberación permanece definida antes y después de cada réplica', () => {
    expect(gasPrograms.length).toBeGreaterThan(0);
    for (const [name, source] of gasPrograms) {
      // GLSL ES no define pow(x, y) para x negativo, incluso con y = 2: z·z en lugar de pow(r − k·gasHit, 2.0).
      const gaussian = source.match(/for \(int k = 2; k <= 4; k\+\+\) \{([^}]+)\}/)?.[1];
      expect(gaussian, name).toBeDefined();
      expect(gaussian, name).toContain('exp(-0.5 * z * z)');
      expect(gaussian, name).not.toMatch(/pow\(\s*\(/);
    }
  });

  it('la pasada B de las dos miradas dibuja la cara y las estrías del gas intestinal', () => {
    const names = gasPrograms.map(([n]) => n);
    expect(names).toContain('FRAG_RAWFIELD');
    expect(names).toContain('FRAG_RAWFIELD_STEERED');
    for (const [name, source] of gasPrograms) {
      // la cara con el perfil y la R de la pleura (tejido/aire) y la cola con su estría, solo en el gas intestinal (tipo 2)
      expect(source, name).toContain('vec3 bowelGas(vec3 p, float step)');
      expect(source, name).toMatch(/spec \+= g\.y \* interfaceProfileEcho\(IF_PLEURA, 1\.0, 1\.0, /);
      expect(source, name).toContain('bowelGasTail(g.z, ');
    }
  });

  it('la GLSL del gas lleva las constantes y las expresiones de su gemelo', () => {
    for (const v of [
      GAS_FACE.cellMm,
      GAS_FACE.streakCellMm,
      GAS_FACE.faceMin,
      1 - GAS_FACE.faceMin,
      GAS_FACE.tailBase,
      GAS_FACE.tailStreak,
      GAS_FACE.ringDownMm,
      GAS_FACE.salt,
      GAS_FACE.salt + 7,
      GAS_FACE.salt + 13,
    ])
      expect(BOWEL_GAS_GLSL).toContain(glslFloat(v));
    expect(BOWEL_GAS_GLSL).toContain('smoothstep(0.2, 0.8, v) * step');
    expect(BOWEL_GAS_GLSL).toContain('smoothstep(0.3, 0.7, u)');
    expect(BOWEL_GAS_GLSL).toContain('smoothstep(0.55, 0.75, w)');
    expect(BOWEL_GAS_GLSL).toContain('(1.0 + (band - 1.0) * w)');
  });

  // Una cara de gas de 80 mm, muestreada cada 0,7 mm (la separación de las líneas a 8–10 cm con el convexo).
  const face = Array.from({ length: 115 }, (_, i): Vec3 => [-30 + 0.7 * i * 0.8, 40 + 0.7 * i * 0.2, -110 + 0.7 * i * 0.56]);
  const step = 1.125; // paso de A0 con 18 cm

  it('la cara es irregular: tramos brillantes y huecos, ni uniforme ni una fila regular', () => {
    const gains = face.map((p) => bowelGas(p, step)[1]);
    const back = face.map((p) => bowelGas(p, step)[0]);
    // huecos (≤ 0,4) y tramos brillantes (≥ 0,8), cada uno entre el 10 y el 70 % de la cara
    const holes = gains.filter((g) => g <= 0.4).length / gains.length;
    const bright = gains.filter((g) => g >= 0.8).length / gains.length;
    expect(holes).toBeGreaterThan(0.1);
    expect(holes).toBeLessThan(0.7);
    expect(bright).toBeGreaterThan(0.1);
    expect(bright).toBeLessThan(0.7);
    expect(Math.min(...gains)).toBeGreaterThanOrEqual(GAS_FACE.faceMin);
    // la cara cae dentro del segmento de A0 en que empieza el gas, a profundidades distintas por línea
    expect(Math.min(...back)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...back)).toBeLessThan(step);
    expect(Math.max(...back) - Math.min(...back)).toBeGreaterThan(0.5 * step);
    // no periódica: los tramos brillantes no se repiten a intervalos fijos
    const runs: number[] = [];
    for (let i = 1; i < gains.length; i++) if (gains[i] >= 0.8 && gains[i - 1] < 0.8) runs.push(i);
    const gaps = runs.slice(1).map((v, i) => v - runs[i]);
    expect(new Set(gaps).size).toBeGreaterThan(1);
  });

  it('la sombra sucia lleva estrías en algunas líneas y la cola de antes en el resto', () => {
    const streaks = face.map((p) => bowelGas(p, step)[2]);
    const lit = streaks.filter((s) => s > 0.5).length / streaks.length;
    expect(lit).toBeGreaterThan(0.05);
    expect(lit).toBeLessThan(0.5);
    // sin estría, la cola de la decisión anterior, sin bandas
    for (const d of [0, 0.4, 3, 17]) expect(bowelGasTail(0, d)).toBeCloseTo(GAS_FACE.tailBase, 12);
    // con estría, más fuerte de media y en bandas del periodo de la reverberación
    const n = 600;
    const mean = Array.from({ length: n }, (_, i) => bowelGasTail(1, (i * GAS_FACE.ringDownMm) / 100)).reduce((a, b) => a + b) / n;
    expect(20 * Math.log10(mean / GAS_FACE.tailBase)).toBeGreaterThan(4);
    expect(bowelGasTail(1, 0)).toBeGreaterThan(bowelGasTail(1, GAS_FACE.ringDownMm / 2) * 5);
  });
});
