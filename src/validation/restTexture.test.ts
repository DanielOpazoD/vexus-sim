import { describe, expect, it } from 'vitest';
import { REST_TEXTURE, REST_TEXTURE_GLSL, restTexture } from '../ultrasound/restTexture';
import type { Vec3 } from '../core/vec3';

/**
 * Textura del resto del abdomen (decisión 74): asas con la firma intestinal (serosa brillante, muscular hipoecoica,
 * mucosa brillante, contenido líquido o mixto) en grasa mesentérica hiperecoica, anclada al material.
 */
describe('Textura del resto del abdomen (decisión 74)', () => {
  // rejilla de puntos del abdomen (mm) con la semilla de la escena de referencia
  const seed = 11;
  const pts: Vec3[] = [];
  for (let x = -120; x <= 120; x += 7) for (let y = -60; y <= 60; y += 7) for (let z = -160; z <= -40; z += 7) pts.push([x, y, z]);
  const v = pts.map((m) => restTexture(m, seed));

  it('grasa hiperecoica entre las asas, paredes hipoecoicas y mucosa brillante; niveles acotados', () => {
    const R = REST_TEXTURE;
    const frac = (f: (x: number) => boolean) => v.filter(f).length / v.length;
    // la grasa mesentérica (el nivel de fondo) es la moda y es más brillante que el hígado (= 1)
    expect(frac((x) => Math.abs(x - R.fatBack) < 1e-6)).toBeGreaterThan(0.3);
    expect(R.fatBack).toBeGreaterThan(1.2);
    // hay muscular (hipoecoica), mucosa o serosa (brillantes) y contenido líquido (casi anecoico)
    expect(frac((x) => x < 0.5)).toBeGreaterThan(0.05);
    expect(frac((x) => x > 1.9)).toBeGreaterThan(0.02);
    for (const x of v) {
      expect(x).toBeGreaterThanOrEqual(R.contentDark - 1e-9);
      expect(x).toBeLessThanOrEqual(Math.max(R.serosaBack, R.mucosaBack, R.contentBright) + 1e-9);
    }
    // la media del resto queda por encima del hígado: el riñón y la porta ya no parecen rodeados de hígado
    expect(v.reduce((a, b) => a + b, 0) / v.length).toBeGreaterThan(1.05);
  });

  it('anclada: el mismo punto da el mismo valor; otra semilla, otra realización', () => {
    const m: Vec3 = [-40, 10, -90];
    expect(restTexture(m, seed)).toBe(restTexture(m, seed));
    const other = pts.map((p) => restTexture(p, seed + 100));
    expect(other.some((x, i) => Math.abs(x - v[i]) > 0.2)).toBe(true);
  });

  it('el shader toma las constantes del módulo', () => {
    expect(REST_TEXTURE_GLSL).toContain(`REST_LOOP_CELL_MM = ${REST_TEXTURE.loopCellMm.toFixed(4)}`);
    expect(REST_TEXTURE_GLSL).toContain(`REST_THRESHOLD = ${REST_TEXTURE.threshold.toFixed(4)}`);
    expect(REST_TEXTURE_GLSL).toContain(`${REST_TEXTURE.fatBack.toFixed(4)}, ${REST_TEXTURE.serosaBack.toFixed(4)}`);
    expect(REST_TEXTURE_GLSL).toContain('uSeed + 41.0');
  });
});
