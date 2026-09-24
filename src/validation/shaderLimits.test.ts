import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { TISSUE_COUNT } from '../anatomy/tissues';
import { CASES } from '../cases';
import { ANATOMY_GLSL, MAX_NODES, MAX_TUBES, MAX_TUBE_SEGMENTS } from '../anatomy/gpu/anatomy.glsl';
import { FRAG_RAWFIELD, FRAG_TRANSMISSION } from '../ultrasound/shaders/passes.glsl';

/**
 * Límites fijos del shader frente a la escena real (Fase 0). Superarlos no da error de
 * compilación: el renderer lanza en ejecución o, peor, el shader trunca tubos en
 * silencio. Cada caso (la hepatomegalia cambia el árbol procedural) debe dejar margen.
 */
describe('Límites del shader con margen para crecer', () => {
  for (const c of CASES) {
    it(`${c.id}: tubos, nodos y segmentos por tubo dentro de los límites con ≥ 20 % de margen`, () => {
      const scene = new AnatomyScene(c);
      const tubes = [...scene.vessels.map((v) => v.tube), ...scene.ducts.map((d) => d.tube)];
      const nodes = tubes.reduce((a, t) => a + t.nodes.length, 0);
      expect(tubes.length).toBeLessThanOrEqual(0.8 * MAX_TUBES);
      expect(nodes).toBeLessThanOrEqual(0.8 * MAX_NODES);
      for (const t of tubes) expect(t.nodes.length - 1).toBeLessThanOrEqual(MAX_TUBE_SEGMENTS);
    });
  }

  it('los tamaños compartidos TS ↔ GLSL salen de las constantes, no de literales', () => {
    expect(FRAG_TRANSMISSION).toContain(`uTissueAlpha[${TISSUE_COUNT}]`);
    expect(FRAG_TRANSMISSION).toContain(`uTissueFlag[${TISSUE_COUNT}]`);
    expect(ANATOMY_GLSL).toContain(`#define MAX_TUBE_SEGMENTS ${MAX_TUBE_SEGMENTS}`);
    expect(ANATOMY_GLSL).not.toMatch(/i & 255/);
    // cada tejido tiene su #define en GLSL
    expect((ANATOMY_GLSL.match(/#define T_[A-Z_]+ \d+/g) ?? []).length).toBe(TISSUE_COUNT);
  });

  // Las constantes de TS entran en el GLSL interpoladas (`${...}`); un identificador suelto como
  // TISSUE_COUNT no existe en el shader y no compila (le pasó a `uTissueClump4`).
  it('ningún shader usa TISSUE_COUNT como identificador suelto', () => {
    const code = FRAG_RAWFIELD.replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bTISSUE_COUNT\b/);
    expect(FRAG_RAWFIELD).toContain(`uTissueClump4[${Math.ceil(TISSUE_COUNT / 4)}]`);
  });
});
