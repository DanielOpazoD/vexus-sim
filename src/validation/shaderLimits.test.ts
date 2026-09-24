import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { TISSUE_COUNT } from '../anatomy/tissues';
import { CASES } from '../cases';
import { ANATOMY_GLSL, MAX_NODES, MAX_TUBES, MAX_TUBE_SEGMENTS } from '../anatomy/gpu/anatomy.glsl';
import * as PASSES from '../ultrasound/shaders/passes.glsl';
import { FRAG_RAWFIELD, FRAG_TRANSMISSION } from '../ultrasound/shaders/passes.glsl';

/**
 * Ranuras vec4 de uniforms que declara un shader (cota superior del empaquetado de GLSL ES 3.0):
 * escalar o vector = 1, array = n, mat3 = 3, mat4 = 4; los samplers no cuentan. El tamaño de un array
 * puede ser un literal o un `#define` del propio shader; si no se resuelve, lanza (nada de contar 1).
 */
function uniformSlots(src: string): { slots: number; arrays: string[] } {
  const code = src.replace(/\/\/.*$/gm, '');
  const defines = new Map<string, number>();
  for (const m of code.matchAll(/^\s*#define\s+(\w+)\s+(\d+)\s*$/gm)) defines.set(m[1], Number(m[2]));
  let slots = 0;
  const arrays: string[] = [];
  for (const m of code.matchAll(/\buniform\s+(?:(?:lowp|mediump|highp)\s+)?(\w+)\s+(\w+)\s*(?:\[\s*(\w+)\s*\])?\s*;/g)) {
    const [, type, name, size] = m;
    if (type.startsWith('sampler')) continue;
    const n = size === undefined ? 1 : /^\d+$/.test(size) ? Number(size) : defines.get(size);
    if (n === undefined) throw new Error(`uniform ${name}[${size}]: tamaño sin resolver`);
    slots += n * (type === 'mat4' ? 4 : type === 'mat3' ? 3 : type === 'mat2' ? 2 : 1);
    if (size !== undefined) arrays.push(`${name}[${n}]`);
  }
  return { slots, arrays };
}

/** Mínimo de MAX_FRAGMENT_UNIFORM_VECTORS en WebGL2; la guarda deja un 20 % de margen. */
const WEBGL2_MIN_FRAGMENT_VECTORS = 224;
const SLOT_GUARD = Math.floor(0.8 * WEBGL2_MIN_FRAGMENT_VECTORS);

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

  // Un shader con más uniforms de los que admite la GPU no compila en ella (o, peor, en unas sí y en
  // otras no): cada shader de fragmentos cabe con margen en el mínimo de WebGL2 (224 vec4). Hoy la
  // pasada B (FRAG_RAWFIELD) declara 165 ranuras, COLOR 156 y QUERY 145.
  it(`cada shader de fragmentos declara ≤ ${SLOT_GUARD} ranuras vec4 de uniforms (80 % de 224)`, () => {
    const shaders = Object.entries(PASSES).filter(([name, src]) => name.startsWith('FRAG_') && typeof src === 'string');
    expect(shaders.length).toBeGreaterThan(8);
    for (const [name, src] of shaders) {
      const { slots, arrays } = uniformSlots(src);
      expect(slots, `${name}: ${slots} ranuras (${arrays.join(' ')})`).toBeLessThanOrEqual(SLOT_GUARD);
    }
    // la pasada B, la más cargada, cuenta sus arrays de tejidos y de escena
    const raw = uniformSlots(FRAG_RAWFIELD);
    expect(raw.arrays).toContain(`uTissueBack[${TISSUE_COUNT}]`);
    expect(raw.slots).toBeGreaterThan(150);
  });

  it('el recuento de ranuras sigue las reglas de empaquetado y no adivina tamaños', () => {
    const src = `#define N 5
      uniform highp float uA;      // 1
      uniform vec4 uB[3];          // 3
      uniform mat4 uM;             // 4
      uniform vec2 uC[N];          // 5 (tamaño de un #define)
      uniform sampler2D uTex;      // no cuenta
      // uniform vec4 uComentado[100];`;
    expect(uniformSlots(src)).toEqual({ slots: 13, arrays: ['uB[3]', 'uC[5]'] });
    expect(() => uniformSlots('uniform vec4 uX[SIN_DEFINIR];')).toThrow(/sin resolver/);
  });

  // El GLSL de las costillas (`sdRib`) corta en x > 15 mm sin mirar `rightOnly`: todas deben serlo
  // hasta que el corte viaje como dato (`no-spleen-no-left-ribs`).
  it('todas las costillas son derechas, como supone el corte del shader', () => {
    for (const c of CASES) for (const rib of new AnatomyScene(c).ribs) expect(rib.rightOnly, c.id).toBe(true);
  });
});
