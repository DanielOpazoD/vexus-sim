import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { INTERFACE_COUNT } from '../anatomy/interfaces';
import { TISSUE_COUNT } from '../anatomy/tissues';
import { CASES } from '../cases';
import { ANATOMY_GLSL, MAX_NODES, MAX_TUBES, MAX_TUBE_SEGMENTS } from '../anatomy/gpu/anatomy.glsl';
import * as PASSES from '../ultrasound/shaders/passes.glsl';
import {
  FRAG_COMPOUND,
  FRAG_RAWFIELD,
  FRAG_RAWFIELD_STEERED,
  FRAG_TRANS_PREFIX,
  FRAG_TRANS_PREFIX_STEERED,
  FRAG_TRANSMISSION,
  FRAG_TRANSMISSION_STEERED,
  STEERED_FIELD_GLSL,
  TISSUE_VEC4,
} from '../ultrasound/shaders/passes.glsl';
import { COMPOUND } from '../ultrasound/compound';
import { STEERED_APERTURE_GLSL } from '../ultrasound/aperture';
import { SPECKLE_LOOK_GLSL } from '../ultrasound/speckleField';
import { STEERING_GLSL } from '../ultrasound/steering';
import { STEERED_PREFIX_GLSL } from '../ultrasound/transmission';

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
/** Funciones de un shader (sin comentarios): nombre → cuerpo. El compilador inlinea cada llamada. */
function glslCallGraph(src: string): Map<string, string> {
  const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const fns = new Map<string, string>();
  const re = /(?:^|\n)[ \t]*(?:void|float|int|bool|[iu]?vec[234]|mat[234]|[A-Z]\w*)\s+(\w+)\s*\([^)]*\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    let depth = 1;
    let i = re.lastIndex;
    while (depth > 0 && i < code.length) {
      if (code[i] === '{') depth++;
      else if (code[i] === '}') depth--;
      i++;
    }
    fns.set(m[1], code.slice(re.lastIndex, i - 1));
    re.lastIndex = i;
  }
  return fns;
}
/** Llamadas a funciones del shader en un trozo de código (una por aparición). */
const callsIn = (g: Map<string, string>, code: string, self?: string): string[] =>
  [...code.matchAll(/\b(\w+)\s*\(/g)].map((x) => x[1]).filter((f) => g.has(f) && f !== self);
/** Copias inlineadas del cuerpo de `target` en `fn` (por todos los caminos de llamadas). */
function inlinedCopies(g: Map<string, string>, fn: string, target: string): number {
  return callsIn(g, g.get(fn)!, fn).reduce((n, c) => n + (c === target ? 1 : 0) + inlinedCopies(g, c, target), 0);
}
/** ¿Llega el código a `target` por alguna cadena de llamadas? */
function reaches(g: Map<string, string>, code: string, target: string, seen = new Set<string>()): boolean {
  return callsIn(g, code).some((c) => c === target || (!seen.has(c) && (seen.add(c), reaches(g, g.get(c)!, target, seen))));
}
/** Cuerpos de los bucles `for` de todas las funciones del shader. */
function loopBodies(g: Map<string, string>): string[] {
  const out: string[] = [];
  for (const body of g.values())
    for (const m of body.matchAll(/\bfor\s*\(/g)) {
      let i = m.index + m[0].length;
      for (let depth = 1; depth > 0; i++) depth += body[i] === '(' ? 1 : body[i] === ')' ? -1 : 0;
      while (/\s/.test(body[i])) i++;
      if (body[i] !== '{') {
        out.push(body.slice(i, body.indexOf(';', i)));
        continue;
      }
      const start = ++i;
      for (let depth = 1; depth > 0; i++) depth += body[i] === '{' ? 1 : body[i] === '}' ? -1 : 0;
      out.push(body.slice(start, i - 1));
    }
  return out;
}

const FRAGMENT_SHADERS = Object.entries(PASSES).filter((e): e is [string, string] => e[0].startsWith('FRAG_') && typeof e[1] === 'string');

/**
 * Pasadas con miradas (decisión 58): el programa de la mirada 0, el dirigido y el fragmento GLSL de la
 * mirada dirigida que solo lleva el segundo.
 */
const LOOK_PAIRS = [
  { name: 'FRAG_TRANS_PREFIX', look0: FRAG_TRANS_PREFIX, steered: FRAG_TRANS_PREFIX_STEERED, snippet: STEERED_PREFIX_GLSL },
  { name: 'FRAG_TRANSMISSION', look0: FRAG_TRANSMISSION, steered: FRAG_TRANSMISSION_STEERED, snippet: STEERED_APERTURE_GLSL },
  { name: 'FRAG_RAWFIELD', look0: FRAG_RAWFIELD, steered: FRAG_RAWFIELD_STEERED, snippet: STEERED_FIELD_GLSL },
] as const;

const uncommented = (src: string): string => src.replace(/\/\/.*$/gm, '');
const declaredUniforms = (src: string): Set<string> =>
  new Set([...uncommented(src).matchAll(/\buniform\s+(?:(?:lowp|mediump|highp)\s+)?\w+\s+(\w+)/g)].map((m) => m[1]));
const declaredOutputs = (src: string): Set<string> => new Set([...uncommented(src).matchAll(/\bout\s+\w+\s+(\w+)\s*;/g)].map((m) => m[1]));
/** Funciones que define un fragmento GLSL. */
const functionsOf = (src: string): string[] =>
  [...uncommented(src).matchAll(/\b(?:void|float|int|bool|[iu]?vec[234]|mat[234])\s+(\w+)\s*\(/g)].map((m) => m[1]);

/**
 * Identificadores de la mirada dirigida (decisión 58), sacados del código y no de una lista a mano: los
 * uniforms y las salidas que declara el programa dirigido y no el de la mirada 0, y las funciones de los
 * fragmentos de la mirada dirigida (geometría, fase por nodo, prefijo, penumbra y rama de B).
 */
function steeredIdentifiers(look0: string, steered: string): string[] {
  const own = (f: (src: string) => Set<string>) => [...f(steered)].filter((n) => !f(look0).has(n));
  const fns = [STEERING_GLSL, SPECKLE_LOOK_GLSL, STEERED_PREFIX_GLSL, STEERED_APERTURE_GLSL, STEERED_FIELD_GLSL].flatMap(functionsOf);
  return [...new Set([...own(declaredUniforms), ...own(declaredOutputs), ...fns])].sort();
}

/** Los identificadores de la mirada dirigida que aparecen en un programa (fuera de los comentarios). */
const steeredLeaks = (src: string, ids: readonly string[]): string[] =>
  ids.filter((id) => new RegExp(`\\b${id}\\b`).test(uncommented(src)));

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
  // ranuras (antes 156), QUERY 85 (antes 145) y la pasada B 114 (125 antes del empaquetado; 165 antes de
  // que el eco de interfaz, decisión 57, le quitara la atenuación y las banderas, que no lee; 105 antes de las
  // 9 caras de la pared y las costillas de la decisión 62, en uIface); su programa dirigido (decisión 58),
  // 116: uSteer y uLookSalt. Los programas dirigidos son FRAG_* y entran aquí.
  it(`cada shader de fragmentos declara ≤ ${SLOT_GUARD} ranuras vec4 de uniforms (80 % de 224)`, () => {
    expect(FRAGMENT_SHADERS.length).toBeGreaterThan(8);
    for (const [name, src] of FRAGMENT_SHADERS) {
      const { slots, arrays } = uniformSlots(src);
      expect(slots, `${name}: ${slots} ranuras (${arrays.join(' ')})`).toBeLessThanOrEqual(SLOT_GUARD);
      // ninguna tabla por tejido vuelve a gastar una ranura por tejido
      const perTissue = arrays.filter((a) => a.endsWith(`[${TISSUE_COUNT}]`));
      expect(perTissue, `${name} declara una tabla de un float por tejido`).toEqual([]);
    }
    expect(FRAGMENT_SHADERS.map(([name]) => name)).toEqual(expect.arrayContaining(LOOK_PAIRS.map((p) => `${p.name}_STEERED`)));
    // la pasada B cuenta sus arrays de tejidos, de caras y de escena: 128 ranuras y 130 en su programa dirigido (114 y
    // 116 con las caras de la pared, decisión 62; la armónica, decisión 77, y los tejidos del retroperitoneo, decisión 81,
    // con TISSUE_VEC4 de 7 a 8, llevan al tope de 130)
    const raw = uniformSlots(FRAG_RAWFIELD);
    const rawSteered = uniformSlots(FRAG_RAWFIELD_STEERED);
    expect(raw.arrays).toContain(`uTissueBack4[${TISSUE_VEC4}]`);
    expect(raw.arrays).toContain(`uTissueClump4[${TISSUE_VEC4}]`);
    expect(raw.arrays).toContain(`uIface[${INTERFACE_COUNT}]`);
    expect(raw.arrays).not.toContain(`uTissueAlpha4[${TISSUE_VEC4}]`);
    expect(raw.arrays).not.toContain(`uTissueFlag4[${TISSUE_VEC4}]`);
    expect(rawSteered.arrays).toEqual(raw.arrays);
    expect(rawSteered.slots).toBe(raw.slots + 2);
    expect(raw.slots).toBeGreaterThan(90);
    expect(rawSteered.slots).toBeLessThanOrEqual(130);
  });

  // Composición espacial (decisión 58, T7): WebGL2 garantiza 16 unidades de textura por shader de
  // fragmentos. Los programas de la mirada 0 conservan los samplers de siempre; el dirigido de B cambia A o0
  // por A o3 (la mirada dirigida), el de A suma el prefijo dirigido de A2 y K lee una textura por mirada. Los
  // dos de B leen además la pleura parietal de A0 (uHits2) y el rayo único de A (uTrans2), decisión 61.
  it('cada shader de fragmentos declara ≤ 16 samplers; B, A y K, los de su diseño', () => {
    for (const [name, src] of FRAGMENT_SHADERS) expect(samplersOf(src).length, name).toBeLessThanOrEqual(16);
    expect(samplersOf(FRAG_RAWFIELD)).toEqual(['uSceneTex', 'uCoupling', 'uTrans0', 'uTrans1', 'uHits2', 'uTrans2']);
    expect(samplersOf(FRAG_RAWFIELD_STEERED)).toEqual(['uSceneTex', 'uCoupling', 'uTrans1', 'uTrans3', 'uHits2', 'uTrans2']);
    expect(samplersOf(FRAG_TRANSMISSION)).toEqual(['uCoupling', 'uPre0', 'uPre1', 'uHits0']);
    expect(samplersOf(FRAG_TRANSMISSION_STEERED)).toEqual(['uCoupling', 'uPre0', 'uPre1', 'uHits0', 'uPreSteer', 'uPreSteerX']);
    expect(samplersOf(FRAG_TRANS_PREFIX_STEERED)).toEqual(samplersOf(FRAG_TRANS_PREFIX));
    expect(samplersOf(FRAG_COMPOUND)).toEqual([...COMPOUND.order.map((_, i) => `uLook${i}`), 'uHits2']);
  });

  // Decisión 58: la rama dirigida compilada en el programa de la mirada 0 (detrás de un `if` que con θ = 0
  // no se toma) le costaba a B ~2 ms por cuadro en el M4 aun con el compuesto apagado. Los programas de la
  // mirada 0 no llevan nada de la dirigida; esta guarda falla si alguien vuelve a meterla en ellos.
  it('los programas de la mirada 0 no llevan nada de la mirada dirigida y los dirigidos sí', () => {
    for (const { name, look0, steered, snippet } of LOOK_PAIRS) {
      const ids = steeredIdentifiers(look0, steered);
      expect(ids, name).toContain('uSteer');
      expect(steeredLeaks(look0, ids), `${name}: la mirada 0 lleva código de la dirigida`).toEqual([]);
      // el dirigido lleva su fragmento y la geometría de la mirada, y lee uSteer
      expect(steered, name).toContain(snippet);
      expect(steered, name).toContain(STEERING_GLSL);
      expect(uncommented(steered), name).toMatch(/\buSteer\.[xyzw]/);
      // ninguno de los dos decide la mirada en el shader: la elige el renderizador
      for (const src of [look0, steered]) expect(src, name).not.toMatch(/if \(uSteer\.x != 0\.0\)/);
    }
    // B dirigido: solo la rama dirigida, sin el cuerpo de la mirada 0 (no lee A o0)
    expect(FRAG_RAWFIELD_STEERED.slice(FRAG_RAWFIELD_STEERED.lastIndexOf('\nvoid main() {'))).toBe(
      '\nvoid main() {\n  oField = steeredField();\n}\n',
    );
    // volver a meter la rama en el programa de la mirada 0: se detecta
    const ids = steeredIdentifiers(FRAG_RAWFIELD, FRAG_RAWFIELD_STEERED);
    const reinlined = FRAG_RAWFIELD.replace(
      '\nvoid main() {\n',
      `${STEERED_FIELD_GLSL}\nvoid main() {\n  if (uSteer.x != 0.0) { oField = steeredField(); return; }\n`,
    );
    expect(steeredLeaks(reinlined, ids)).toEqual(expect.arrayContaining(['uSteer', 'steeredField', 'speckleFieldPh', 'lookPhase']));
  });

  // El programa de la mirada 0 es el de antes de la composición: al separar los programas se comprobó que
  // los tres (A2, A y B) eran byte a byte los de main eabd2aa (`git show eabd2aa:src/…/passes.glsl.ts` en una
  // copia y emitidos con tsx). Aquí queda la huella de su main, que no depende de los fragmentos compartidos
  // (la anatomía cambia a menudo). Si cambias a propósito el main de la mirada 0 de una pasada, actualiza su
  // huella; si no lo cambiaste, alguien lo ha tocado sin querer. Cambio deliberado: el main de B lleva la
  // rama de la cortina (decisión 61; antes 4314c49a44f58052); fuera de las líneas con pleura parietal hace
  // las mismas cuentas que antes (el peso del tejido es 1 y la transmisión, la de siempre). Después (e5fca934a2dddf02
  // → b6752d41c82c4fe2), la muestra de la imagen sale del bucle de la serie (mediumField, una vez, como antes de
  // la decisión 61) y la pared copiada se clasifica con el prefijo de la pared (wallField): el JIT de
  // SwiftShader. Después (1a2d3049e1b0adbc), wallField recibe la dirección de la línea para el eco de cara plana de
  // las capas de la pared en las copias (decisión 62, `wallFaceEchoFlat`). Después (→ la de abajo), la compresión
  // de la sonda (decisión 63): la incidencia de la pleura sale de su normal llevada al mundo por la jacobiana
  // (`warpAt` en la pleura, solo en las líneas con cortina) y wallField recibe esa jacobiana; sin compresión
  // (uCompC.w = 0) las cuentas son las de antes. Después (1b85e5e856534fd1 → la de abajo), el transitorio lleva
  // su ganancia (`uTransientGain`, decisión 77): 1 en fundamental, el rechazo de su banda en armónica; y el eco del
  // tejido, la acumulación del armónico (`harmonicNearGain`, 1 en fundamental) antes del transitorio y del ruido.
  it('el main de los programas de la mirada 0 es, letra a letra, el de antes de la composición', () => {
    const mainOf = (src: string): string => src.slice(src.lastIndexOf('\nvoid main() {'));
    const print = (src: string): string => createHash('sha256').update(mainOf(src)).digest('hex').slice(0, 16);
    expect(Object.fromEntries(LOOK_PAIRS.map((p) => [p.name, print(p.look0)]))).toEqual({
      FRAG_TRANS_PREFIX: 'f6b08093f699bc04',
      FRAG_TRANSMISSION: '668efb9a2b5c7008',
      FRAG_RAWFIELD: 'd2e0f2cd7f45185c',
    });
    // y el resto de B es el mismo texto en los dos programas: solo cambian sus entradas y su main
    const inputs0 = 'uniform sampler2D uTrans0;\nuniform sampler2D uTrans1;\n';
    const at = FRAG_RAWFIELD.indexOf(inputs0);
    const afterInputs = FRAG_RAWFIELD.slice(at + inputs0.length, FRAG_RAWFIELD.lastIndexOf('\nvoid main() {'));
    expect(at).toBeGreaterThan(0);
    expect(FRAG_RAWFIELD_STEERED.startsWith(FRAG_RAWFIELD.slice(0, at))).toBe(true);
    expect(FRAG_RAWFIELD_STEERED).toContain(afterInputs);
  });

  it('K dimensiona sus arrays con el número de miradas interpolado, no escrito a mano', () => {
    const n = COMPOUND.order.length;
    const k = uniformSlots(FRAG_COMPOUND);
    expect(k.arrays).toEqual([`uLookSteer[${n}]`, `uLookValid[${n}]`]);
    // 2 arrays de n, 4 de la rejilla y, por la cortina de la mirada 0 (decisión 61), 3 ejes, 3 de la lente (con
    // la armónica, decisión 77) y 3 de la PSF lateral (con la emisión)
    expect(k.slots).toBe(2 * n + 13);
    // con el identificador GLSL en lugar del número interpolado, el recuento no adivina el tamaño
    expect(() => uniformSlots(FRAG_COMPOUND.replace(`uLookSteer[${n}]`, 'uLookSteer[COMPOUND_LOOKS]'))).toThrow(/sin resolver/);
  });

  it('todo uniform que usa un shader está declarado en él (un nombre suelto no compila)', () => {
    for (const [name, src] of FRAGMENT_SHADERS) expect(undeclaredUniforms(src), name).toEqual([]);
    // el programa dirigido de B sin sus uniforms: se ve
    expect(undeclaredUniforms(FRAG_RAWFIELD_STEERED.replace('uniform float uLookSalt;', ''))).toEqual(['uLookSalt']);
    expect(undeclaredUniforms(FRAG_RAWFIELD_STEERED.replace(/uniform vec4 uSteer;[^\n]*\n/, ''))).toEqual(['uSteer']);
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

  // Coste de compilación en SwiftShader (el de la e2e y el CI): el compilador inlinea cada llamada, y el JIT
  // (LLVM) de SwiftShader crece con el código inlineado y se dispara con código pesado dentro de un bucle. La
  // decisión 61 metió faceGradient (6–8 distancias, ~67 kB) en el bucle de las muestras del medio de B: el
  // primer dibujo de B pasó de 6 s a 128 s y el vigilante de la GPU de Chrome perdía el contexto al arrancar.
  // Estas cotas son las de main a9520b8 (A0 2 copias de classify, A1 1, B 3, color, consulta y mapa 1).
  it('ningún shader inlinea classify más veces que antes de la decisión 61, ni faceGradient dentro de un bucle', () => {
    const budget: Record<string, number> = {
      FRAG_TRANS_HITS: 2,
      FRAG_TRANS_SEGMENTS: 1,
      FRAG_RAWFIELD: 3,
      FRAG_RAWFIELD_STEERED: 3,
      FRAG_COLOR: 1,
      FRAG_QUERY: 1,
      FRAG_TISSUEMAP: 1,
    };
    for (const [name, src] of FRAGMENT_SHADERS) {
      const g = glslCallGraph(src);
      if (!g.has('main')) continue;
      expect(inlinedCopies(g, 'main', 'classifyWith'), name).toBe(budget[name] ?? 0);
      for (const body of loopBodies(g)) expect(reaches(g, body, 'faceGradient'), `${name}: faceGradient en un bucle`).toBe(false);
      // la jacobiana de la compresión (decisión 63: siete evaluaciones del campo) tampoco va en un bucle
      for (const body of loopBodies(g)) expect(reaches(g, body, 'warpAt'), `${name}: warpAt en un bucle`).toBe(false);
      // ni la textura del psoas y del cuadrado (decisión 81: un Voronoi de 3 × 3 células por plano de elevación)
      for (const body of loopBodies(g)) expect(reaches(g, body, 'fascicleSeptum'), `${name}: fascicleSeptum en un bucle`).toBe(false);
    }
    // el detector ve la regresión: la pared que copia la serie con la textura del retroperitoneo (fieldFor, no la base)
    const wallInLoop = FRAG_RAWFIELD.replace(
      'vec2 field = fieldForBase(m, se, c.tissue, normalize(p - uCurvC), w);',
      'vec2 field = fieldFor(m, se, c.tissue, normalize(p - uCurvC), w);',
    );
    expect(wallInLoop).not.toBe(FRAG_RAWFIELD);
    const gw = glslCallGraph(wallInLoop);
    expect(loopBodies(gw).some((b) => reaches(gw, b, 'fascicleSeptum'))).toBe(true);
    // el detector ve la regresión: la muestra completa del medio (con su eco de interfaz) en el bucle de la serie
    const inLoop = FRAG_RAWFIELD.replace(
      'vec2 f = wallField(pointOnLine(dir0, d), dir0, elevSigma(d), wD);',
      'vec2 f = mediumField(pointOnLine(dir0, d), dir0, d, elevSigma(d), true);',
    );
    expect(inLoop).not.toBe(FRAG_RAWFIELD);
    const g = glslCallGraph(inLoop);
    expect(loopBodies(g).some((b) => reaches(g, b, 'faceGradient'))).toBe(true);
  });

  // El GLSL de las costillas (`sdRib`) corta en x > 15 mm sin mirar `rightOnly`: todas deben serlo
  // hasta que el corte viaje como dato (`no-spleen-no-left-ribs`).
  it('todas las costillas son derechas, como supone el corte del shader', () => {
    for (const c of CASES) for (const rib of new AnatomyScene(c).ribs) expect(rib.rightOnly, c.id).toBe(true);
  });
});
