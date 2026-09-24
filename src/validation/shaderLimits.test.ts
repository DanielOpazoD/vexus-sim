import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { INTERFACE_COUNT } from '../anatomy/interfaces';
import { TISSUE_COUNT } from '../anatomy/tissues';
import { CASES } from '../cases';
import { ANATOMY_GLSL, MAX_NODES, MAX_TUBES, MAX_TUBE_SEGMENTS } from '../anatomy/gpu/anatomy.glsl';
import * as PASSES from '../ultrasound/shaders/passes.glsl';
import { FRAG_COMPOUND, FRAG_RAWFIELD, FRAG_TRANSMISSION, TISSUE_VEC4 } from '../ultrasound/shaders/passes.glsl';
import { COMPOUND } from '../ultrasound/compound';

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

/** Samplers que declara un shader, en orden. */
const samplersOf = (src: string): string[] =>
  [...src.replace(/\/\/.*$/gm, '').matchAll(/\buniform\s+(?:(?:lowp|mediump|highp)\s+)?\w*sampler\w*\s+(\w+)/g)].map((m) => m[1]);

/**
 * Uniforms (`uNombre`) que un shader usa sin declararlos: un nombre suelto no compila, y la GPU de las
 * pruebas unitarias no existe. Se excluyen los accesos a campos (`c.uRef`) y los nombres declarados como
 * variable local o parámetro.
 */
function undeclaredUniforms(src: string): string[] {
  const code = src.replace(/\/\/.*$/gm, '');
  const declared = new Set([...code.matchAll(/\buniform\s+(?:(?:lowp|mediump|highp)\s+)?\w+\s+(\w+)/g)].map((m) => m[1]));
  const locals = new Set([...code.matchAll(/\b(?:float|int|bool|vec[234]|ivec[234]|mat[34]|Cls)\s+(u[A-Z]\w*)/g)].map((m) => m[1]));
  const used = new Set((code.match(/(?<![.\w])u[A-Z][A-Za-z0-9]*\b/g) ?? []).filter((n) => !locals.has(n) || declared.has(n)));
  return [...used].filter((n) => !declared.has(n)).sort();
}

/** Los shaders de fragmentos que exporta `passes.glsl.ts` (sus otras exportaciones no son shaders). */
const FRAGMENT_SHADERS = Object.entries(PASSES).filter((e): e is [string, string] => e[0].startsWith('FRAG_') && typeof e[1] === 'string');

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
    expect(TISSUE_VEC4).toBe(Math.ceil(TISSUE_COUNT / 4));
    expect(FRAG_TRANSMISSION).toContain(`uTissueAlpha4[${TISSUE_VEC4}]`);
    expect(FRAG_TRANSMISSION).toContain(`uTissueFlag4[${TISSUE_VEC4}]`);
    expect(ANATOMY_GLSL).toContain(`#define MAX_TUBE_SEGMENTS ${MAX_TUBE_SEGMENTS}`);
    expect(ANATOMY_GLSL).not.toMatch(/i & 255/);
    // cada tejido tiene su #define en GLSL
    expect((ANATOMY_GLSL.match(/#define T_[A-Z_]+ \d+/g) ?? []).length).toBe(TISSUE_COUNT);
  });

  // Las constantes de TS entran en el GLSL interpoladas (`${...}`); un identificador suelto como
  // TISSUE_COUNT no existe en el shader y no compila (le pasó a `uTissueClump4`).
  it('ningún shader usa TISSUE_COUNT, TISSUE_VEC4 ni INTERFACE_COUNT como identificador suelto', () => {
    for (const [name, src] of FRAGMENT_SHADERS) {
      const code = src.replace(/\/\/.*$/gm, '');
      expect(code, name).not.toMatch(/\bTISSUE_COUNT\b|\bTISSUE_VEC4\b|\bINTERFACE_COUNT\b/);
      // y ninguno indexa una tabla por tejido que no declara (el nombre viejo tras empaquetarla no compila)
      const declared = new Set([...code.matchAll(/\buniform\s+\w+\s+(uTissue\w+)/g)].map((m) => m[1]));
      for (const m of code.matchAll(/\b(uTissue\w+)\s*\[/g)) expect(declared.has(m[1]), `${name} usa ${m[1]} sin declararlo`).toBe(true);
    }
    expect(FRAG_RAWFIELD).toContain(`uTissueClump4[${TISSUE_VEC4}]`);
    expect(FRAG_RAWFIELD).toContain(`uIface[${INTERFACE_COUNT}]`);
  });

  // Un shader con más uniforms de los que admite la GPU no compila en ella (o, peor, en unas sí y en
  // otras no): cada shader de fragmentos cabe con margen en el mínimo de WebGL2 (224 vec4). Las tablas
  // por tejido van de 4 en 4 por vec4 (TISSUE_VEC4 ranuras cada una, no TISSUE_COUNT): COLOR declara 96
  // ranuras (antes 156), QUERY 85 (antes 145) y la pasada B 107 (105 antes de la composición espacial,
  // decisión 58, que le suma uSteer y uLookSalt; 125 antes del empaquetado; 165 antes de que el eco de
  // interfaz, decisión 57, le quitara la atenuación y las banderas, que no lee).
  it(`cada shader de fragmentos declara ≤ ${SLOT_GUARD} ranuras vec4 de uniforms (80 % de 224)`, () => {
    expect(FRAGMENT_SHADERS.length).toBeGreaterThan(8);
    for (const [name, src] of FRAGMENT_SHADERS) {
      const { slots, arrays } = uniformSlots(src);
      expect(slots, `${name}: ${slots} ranuras (${arrays.join(' ')})`).toBeLessThanOrEqual(SLOT_GUARD);
      // ninguna tabla por tejido vuelve a gastar una ranura por tejido
      const perTissue = arrays.filter((a) => a.endsWith(`[${TISSUE_COUNT}]`));
      expect(perTissue, `${name} declara una tabla de un float por tejido`).toEqual([]);
    }
    // la pasada B cuenta sus arrays de tejidos, de caras y de escena: 107 medidas con la composición
    // espacial, con sitio para la THI (~+14) sin pasar de 130
    const raw = uniformSlots(FRAG_RAWFIELD);
    expect(raw.arrays).toContain(`uTissueBack4[${TISSUE_VEC4}]`);
    expect(raw.arrays).toContain(`uTissueClump4[${TISSUE_VEC4}]`);
    expect(raw.arrays).toContain(`uIface[${INTERFACE_COUNT}]`);
    expect(raw.arrays).not.toContain(`uTissueAlpha4[${TISSUE_VEC4}]`);
    expect(raw.arrays).not.toContain(`uTissueFlag4[${TISSUE_VEC4}]`);
    expect(raw.slots).toBeGreaterThan(90);
    expect(raw.slots).toBeLessThanOrEqual(130);
  });

  // Composición espacial (decisión 58, T7): WebGL2 garantiza 16 unidades de textura por shader de
  // fragmentos; B pasa de 4 a 5 samplers (la mirada dirigida) y K lee una textura por mirada.
  it('cada shader de fragmentos declara ≤ 16 samplers; B y K, los de su diseño', () => {
    for (const [name, src] of FRAGMENT_SHADERS) expect(samplersOf(src).length, name).toBeLessThanOrEqual(16);
    expect(samplersOf(FRAG_RAWFIELD)).toEqual(['uSceneTex', 'uCoupling', 'uTrans0', 'uTrans1', 'uTrans3']);
    expect(samplersOf(FRAG_TRANSMISSION)).toEqual(['uCoupling', 'uPre0', 'uPre1', 'uHits0', 'uPreSteer', 'uPreSteerX']);
    expect(samplersOf(FRAG_COMPOUND)).toEqual(COMPOUND.order.map((_, i) => `uLook${i}`));
  });

  it('K dimensiona sus arrays con el número de miradas interpolado, no escrito a mano', () => {
    const n = COMPOUND.order.length;
    const k = uniformSlots(FRAG_COMPOUND);
    expect(k.arrays).toEqual([`uLookSteer[${n}]`, `uLookValid[${n}]`]);
    expect(k.slots).toBe(2 * n + 4);
    // con el identificador GLSL en lugar del número interpolado, el recuento no adivina el tamaño
    expect(() => uniformSlots(FRAG_COMPOUND.replace(`uLookSteer[${n}]`, 'uLookSteer[COMPOUND_LOOKS]'))).toThrow(/sin resolver/);
  });

  it('todo uniform que usa un shader está declarado en él (un nombre suelto no compila)', () => {
    for (const [name, src] of FRAGMENT_SHADERS) expect(undeclaredUniforms(src), name).toEqual([]);
    // la rama dirigida de B sin sus uniforms: se ve
    expect(undeclaredUniforms(FRAG_RAWFIELD.replace('uniform float uLookSalt;', ''))).toEqual(['uLookSalt']);
    expect(undeclaredUniforms(FRAG_RAWFIELD.replace(/uniform vec4 uSteer;[^\n]*\n/, ''))).toEqual(['uSteer']);
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
