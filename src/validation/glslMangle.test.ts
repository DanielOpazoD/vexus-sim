import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInThisContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  GLSL_BUILTINS,
  buildMangleMap,
  glslDeclarations,
  glslStructNames,
  mangleGlslParts,
  tokenizeGlsl,
  type MangleOptions,
} from '../../tools/build/glslMangle';
import {
  findGlslTemplates,
  glslMinify,
  minifyGlslTemplates,
  prepareGlslMangle,
  readSources,
  scanModule,
  stripGlslComments,
  transformWithMangle,
  type SourceModule,
} from '../../tools/build/glslMinify';
import * as PASSES from '../ultrasound/shaders/passes.glsl';

/**
 * Renombrado de identificadores GLSL en el build (`tools/build/glslMangle.ts`, cableado en `glslMinify.ts`). Las
 * unitarias fijan cada regla (qué se renombra, qué nunca); las del fuente real, que ningún uniform ni entrada/salida
 * cambia y que cada programa que compila el renderer, montado con el fuente transformado, es el original renombrado
 * con el mapa: mismo texto salvo los nombres, sin colisiones (la prueba de que un nombre que también aparece en el
 * código JS se puede renombrar).
 */

/** Renombra unas plantillas (cada una, sus trozos estáticos) con el mapa que sale de ellas. */
function mangle(templates: ReadonlyArray<readonly string[]>, options: MangleOptions = {}) {
  const map = buildMangleMap(templates, options);
  const out = templates.map((parts) => mangleGlslParts(parts, map));
  const to = (name: string): string => {
    const short = map.names.get(name);
    if (short === undefined) throw new Error(`«${name}» no se renombra (${map.analysis.reserved.get(name) ?? 'sin motivo'})`);
    return short;
  };
  return { map, out, to };
}

/** Nombres declarados como uniform o entrada/salida en un texto GLSL (o en los trozos de una plantilla). */
function interfaceNames(glsl: string | readonly string[]): string[] {
  const toks = tokenizeGlsl(typeof glsl === 'string' ? [glsl] : glsl);
  return glslDeclarations(toks, new Set(glslStructNames(toks)))
    .filter((d) => d.kind === 'uniform' || d.kind === 'interface')
    .map((d) => `${d.kind} ${d.name}`)
    .sort();
}

describe('Renombrado del GLSL en el build: reglas', () => {
  it('un solo mapa para todas las plantillas: la función declarada en una se llama igual en otra', () => {
    const a = ['float helperFunction(float value) {\n  return value * 2.0;\n}\n'];
    const b = ['void main() {\n  float result = helperFunction(1.0);\n  gl_FragColor = vec4(result);\n}\n'];
    const { out, to } = mangle([a, b]);
    expect(out[0][0]).toBe(`float ${to('helperFunction')}(float ${to('value')}) {\n  return ${to('value')} * 2.0;\n}\n`);
    expect(out[1][0]).toBe(
      `void main() {\n  float ${to('result')} = ${to('helperFunction')}(1.0);\n  gl_FragColor = vec4(${to('result')});\n}\n`,
    );
    expect(to('helperFunction').length).toBeLessThanOrEqual(3);
  });

  it('nunca toca uniforms (también en listas), entradas, salidas, main ni lo integrado aunque se declare', () => {
    const glsl = [
      '#version 300 es',
      'precision highp float;',
      'uniform sampler2D uTexture;',
      'uniform float gain, bias;',
      'in vec2 vTexCoord;',
      'layout(location = 0) out vec4 fragColor;',
      'layout(location = 1) out vec4 secondOutput;',
      'float brighten(float level) { float step = 0.5; return clamp(level * gain + bias, 0.0, step); }',
      'void main() {',
      '  vec4 sampled = texture(uTexture, vTexCoord);',
      '  fragColor = vec4(brighten(sampled.r), mix(sampled.g, 1.0, step(0.5, sampled.b)), 0.0, 1.0);',
      '  secondOutput = gl_FragCoord;',
      '}',
    ].join('\n');
    const { map, out, to } = mangle([[glsl]]);
    const r = map.analysis.reserved;
    expect([r.get('gain'), r.get('bias'), r.get('uTexture')]).toEqual(['uniform', 'uniform', 'uniform']);
    expect([r.get('vTexCoord'), r.get('fragColor'), r.get('secondOutput')]).toEqual(Array(3).fill('entrada/salida del shader'));
    expect([r.get('main'), r.get('step')]).toEqual(['palabra de GLSL', 'palabra de GLSL']);
    const expected = glsl
      .replace(/\bbrighten\b/g, to('brighten'))
      .replace(/\blevel\b/g, to('level'))
      .replace(/\bsampled\b/g, to('sampled'));
    expect(out[0][0]).toBe(expected);
    expect(interfaceNames(out[0][0])).toEqual(interfaceNames(glsl));
  });

  it('#define: el nombre se renombra también en #if, defined, #ifdef, #ifndef y #undef; #version y #extension no se tocan', () => {
    const glsl = [
      '#version 300 es',
      '#extension GL_EXT_shader_texture_lod : enable',
      '#define SAMPLE_COUNT 4',
      '#define USE_FANCY_PATH',
      '#if SAMPLE_COUNT > 2 && defined(USE_FANCY_PATH)',
      'float weight = 1.0 / float(SAMPLE_COUNT);',
      '#elif defined USE_FANCY_PATH',
      'float weight = 0.0;',
      '#endif',
      '#ifdef USE_FANCY_PATH',
      '#undef USE_FANCY_PATH',
      '#endif',
      '#ifndef SAMPLE_COUNT',
      'float enable = 1.0;',
      '#endif',
    ].join('\n');
    const { map, out, to } = mangle([[glsl]]);
    const [N, F, W] = [to('SAMPLE_COUNT'), to('USE_FANCY_PATH'), to('weight')];
    expect(out[0][0].split('\n')).toEqual([
      '#version 300 es',
      '#extension GL_EXT_shader_texture_lod : enable',
      `#define ${N} 4`,
      `#define ${F}`,
      `#if ${N} > 2 && defined(${F})`,
      `float ${W} = 1.0 / float(${N});`,
      `#elif defined ${F}`,
      `float ${W} = 0.0;`,
      '#endif',
      `#ifdef ${F}`,
      `#undef ${F}`,
      '#endif',
      `#ifndef ${N}`,
      'float enable = 1.0;',
      '#endif',
    ]);
    // un nombre que aparece en una directiva que no se toca (#extension) no se renombra en ninguna parte
    expect(map.analysis.reserved.get('enable')).toBe('en una directiva #extension');
  });

  it('sobrecargas: todas las funciones con el mismo nombre pasan al mismo nombre corto', () => {
    const glsl = [
      'float blend(float a, float b) { return a + b; }',
      'vec3 blend(vec3 a, vec3 b) { return a + b; }',
      'void main() { float total = blend(1.0, 2.0); vec3 mixed = blend(vec3(1.0), vec3(2.0)); }',
    ].join('\n');
    const { out, to } = mangle([[glsl]]);
    expect(out[0][0].match(new RegExp(`\\b${to('blend')}\\(`, 'g'))).toHaveLength(4);
    expect(out[0][0]).not.toMatch(/\bblend\b/);
  });

  it('tras un punto hay un selector: un swizzle nunca se renombra, aunque una variable se llame igual', () => {
    const glsl =
      'void main() {\n  vec4 color = vec4(1.0);\n  vec4 rgba = color.rgba;\n  float total = rgba.x + color.rgba.y + rgba.st.t;\n}';
    const { out, to } = mangle([[glsl]]);
    const R = to('rgba');
    expect(out[0][0]).toBe(
      `void main() {\n  vec4 ${to('color')} = vec4(1.0);\n  vec4 ${R} = ${to('color')}.rgba;\n  float ${to('total')} = ${R}.x + ${to('color')}.rgba.y + ${R}.st.t;\n}`,
    );
  });

  it('structs: el tipo, su constructor y sus campos con el mismo mapa; un campo con forma de swizzle no se toca', () => {
    const glsl = [
      'struct Surface { float roughness; vec3 normal; float s; };',
      'Surface makeSurface(float roughness) { return Surface(roughness, vec3(0.0, 1.0, 0.0), 0.5); }',
      'float shade(Surface surf) { return surf.roughness * surf.normal.y + surf.s; }',
    ].join('\n');
    const { map, out, to } = mangle([[glsl]]);
    const [S, R, N, F] = [to('Surface'), to('roughness'), to('normal'), to('surf')];
    expect(out[0][0].split('\n')).toEqual([
      `struct ${S} { float ${R}; vec3 ${N}; float s; };`,
      `${S} ${to('makeSurface')}(float ${R}) { return ${S}(${R}, vec3(0.0, 1.0, 0.0), 0.5); }`,
      `float ${to('shade')}(${S} ${F}) { return ${F}.${R} * ${F}.${N}.y + ${F}.s; }`,
    ]);
    expect(map.analysis.reserved.get('s')).toBe('campo con forma de swizzle');
    expect([...map.afterDot].sort()).toEqual(['normal', 'roughness']);
  });

  it('un struct usado como tipo de un uniform conserva sus campos (la API los busca por nombre: «light.position»)', () => {
    const glsl = [
      'struct Light { vec3 position; float intensity; };',
      'uniform Light light;',
      'float lit(vec3 point) { return light.intensity / length(light.position - point); }',
    ].join('\n');
    const { map, out, to } = mangle([[glsl]]);
    expect(map.analysis.reserved.get('position')).toBe('campo de Light, el tipo de light');
    expect(map.analysis.reserved.get('intensity')).toBe('campo de Light, el tipo de light');
    expect(out[0][0]).toContain(
      `float ${to('lit')}(vec3 ${to('point')}) { return light.intensity / length(light.position - ${to('point')}); }`,
    );
    expect(out[0][0]).toContain('uniform Light light;');
    // anidados: los campos de un struct que es campo del tipo de un uniform también los ve la API («outerU.inner.gainA»)
    const nested = mangle([
      [
        'struct Inner { float gainA; };\nstruct Outer { Inner inner; float other2; };\nuniform Outer outerU;\nfloat get() { return outerU.inner.gainA + outerU.other2; }',
      ],
    ]);
    for (const f of ['inner', 'other2']) expect(nested.map.analysis.reserved.get(f)).toBe('campo de Outer, el tipo de outerU');
    expect(nested.map.analysis.reserved.get('gainA')).toBe('campo de Inner, el tipo de outerU');
    // también con el struct declarado en la misma línea que el uniform, y con instancias en lista
    const inline = mangle([
      ['uniform struct Material { vec3 albedo; float gloss; } material;\nstruct Pair { float lo; float hi; } pairA, pairB;'],
    ]);
    expect(inline.map.analysis.reserved.get('material')).toBe('uniform');
    expect(inline.map.analysis.reserved.get('albedo')).toBe('campo de Material, el tipo de material');
    expect(inline.map.analysis.reserved.get('gloss')).toBe('campo de Material, el tipo de material');
    expect([inline.to('pairA'), inline.to('pairB')]).toHaveLength(2);
  });

  it('números: exponentes, sufijos y hexadecimales no son identificadores', () => {
    const glsl = 'float e5 = 1e5 + 2.5e-3 + 1.0E+2 + float(0x1Fu) + 3.0f + .5e1;\nfloat xE2 = e5 * 1e2;';
    const { out, to } = mangle([[glsl]]);
    expect(out[0][0]).toBe(
      `float ${to('e5')} = 1e5 + 2.5e-3 + 1.0E+2 + float(0x1Fu) + 3.0f + .5e1;\nfloat ${to('xE2')} = ${to('e5')} * 1e2;`,
    );
  });

  it('una sentencia uniform/in/out reserva todos sus nombres, aunque su tipo no se vea (interpolación, macro)', () => {
    const t1 = ['uniform ', ' gain;\nuniform PREC float bias;\nout vec4 ', ';\n']; // `uniform ${T} gain;`, `out vec4 ${N};`
    const t2 = ['#define PREC highp\nfloat helper(float gain, float bias) { return gain * bias; }\n'];
    const { map, out, to } = mangle([t1, t2]);
    expect(map.analysis.reserved.get('gain')).toBe('en una declaración uniform/in/out');
    expect(map.analysis.reserved.get('bias')).toBe('en una declaración uniform/in/out');
    expect(map.analysis.reserved.get('PREC')).toBe('en una declaración uniform/in/out');
    expect(out[0]).toEqual(t1);
    expect(out[1][0]).toBe(`#define PREC highp\nfloat ${to('helper')}(float gain, float bias) { return gain * bias; }\n`);
  });

  it('una macro se renombra también tras un punto (el preprocesador la expande ahí)', () => {
    const glsl = '#define AXES xyz\n#define PICK(vec, comp) vec.comp\nvec3 pick(vec4 v) { return v.AXES + PICK(v, AXES); }';
    const { out, to } = mangle([[glsl]]);
    const [A, V, C] = [to('AXES'), to('vec'), to('comp')];
    expect(out[0][0]).toBe(
      `#define ${A} xyz\n#define ${to('PICK')}(${V}, ${C}) ${V}.${C}\nvec3 ${to('pick')}(vec4 v) { return v.${A} + ${to('PICK')}(v, ${A}); }`,
    );
  });

  it('un campo con el nombre de un campo de gl_DepthRange (near, far, diff) no se renombra', () => {
    const glsl =
      'struct Clip { float near; float far; float depthScale; };\nfloat span(Clip clip) { return clip.far - clip.near + gl_DepthRange.far * clip.depthScale; }';
    const { map, out, to } = mangle([[glsl]]);
    expect([map.analysis.reserved.get('near'), map.analysis.reserved.get('far')]).toEqual(['palabra de GLSL', 'palabra de GLSL']);
    const C = to('clip');
    expect(out[0][0]).toContain(`${C}.far - ${C}.near + gl_DepthRange.far * ${C}.${to('depthScale')}`);
  });

  it('un campo cuyo tipo no se ve (`${T} campo;`) es un campo: se renombra igual en su declaración y tras un punto', () => {
    const t1 = ['struct Wrap { ', ' inner; float wgt; };\nfloat read(Wrap w) { return w.inner.x + w.wgt; }'];
    const t2 = ['float inner = 2.0;'];
    const { out, to } = mangle([t1, t2]);
    const [I, W] = [to('inner'), to('wgt')];
    expect(out[0]).toEqual([
      `struct ${to('Wrap')} { `,
      ` ${I}; float ${W}; };\nfloat ${to('read')}(${to('Wrap')} w) { return w.${I}.x + w.${W}; }`,
    ]);
    expect(out[1][0]).toBe(`float ${I} = 2.0;`);
  });

  it('los extremos de una plantilla se pegan al texto con que se interpola: lo que puede formar otro nombre no se toca', () => {
    // `a` acaba en `gain` y `b` empieza tras una interpolación con `Scale`: al ejecutar, `${a}Scale` es `gainScale`
    const a = ['float gain'];
    const b = ['', 'Scale = 2.0;\nfloat total() { return gainScale; }'];
    const { map } = mangle([a, b]);
    expect(map.names.has('gain')).toBe(false);
    expect(map.analysis.reserved.get('gain')).toBe('empieza por «gain», pegado a una interpolación');
  });

  it('listas de declaración (también en el for) y macros con parámetros', () => {
    const glsl = [
      '#define SCALE(value) ((value) * 2.0)',
      'float first = 1.0, second = SCALE(first), third;',
      'void main() { for (int counter = 0, other = 1; counter < 3; counter++) { third += float(other); } }',
    ].join('\n');
    const { out, to } = mangle([[glsl]]);
    const names = ['SCALE', 'value', 'first', 'second', 'third', 'counter', 'other'];
    let expected = glsl;
    for (const n of names) expected = expected.replace(new RegExp(`\\b${n}\\b`, 'g'), to(n));
    expect(out[0][0]).toBe(expected);
  });

  it('no se renombra lo que nombra una cadena JS ni lo que puede formarse pegado a una interpolación', () => {
    // plantilla 1: `…sampleLook${i}(…)`: el nombre real se forma al ejecutar
    const t1 = ['float lookupTable(int i) { return float(i); }\nfloat sampleLook', '(vec2 uv) { return 1.0; }\n'];
    const t2 = [
      'float fromJs = 1.0;\nfloat plainName = 2.0;\nfloat prefixedValue = 3.0;\nfloat sampleLookAt = 4.0;\nfloat valueMm = 5.0;\n',
    ];
    const { map, to } = mangle([t1, t2], {
      reserved: new Set(['fromJs']),
      reservedPrefixes: new Set(['prefixed']),
      reservedSuffixes: new Set(['Mm']),
    });
    const r = map.analysis.reserved;
    expect(r.get('fromJs')).toBe('aparece en una cadena JS');
    expect(r.get('prefixedValue')).toBe('empieza por «prefixed», pegado a una interpolación');
    expect(r.get('sampleLookAt')).toBe('empieza por «sampleLook», pegado a una interpolación');
    expect(r.get('valueMm')).toBe('acaba en «Mm», pegado a una interpolación');
    expect(to('plainName')).toBeDefined();
    expect(to('lookupTable')).toBeDefined();
    // la plantilla con el nombre pegado queda con él intacto
    expect(mangleGlslParts(t1, map)[0].endsWith('\nfloat sampleLook')).toBe(true);
  });

  it('los nombres cortos no coinciden con nada que exista: GLSL, JS, cadenas ni palabras de GLSL; el mapa es inyectivo', () => {
    // muchos nombres de una y dos letras ya usados, y otros «ocupados» por JS
    const used = 'abcdefghijklmnopqrstuvwxyz'.split('').map((c, i) => `float ${c} = ${i}.0;`);
    const decls = Array.from({ length: 120 }, (_, i) => `float longName${i} = a * ${i}.0;`);
    const glsl = [...used, ...decls, 'float useAll() { return ' + decls.map((_, i) => `longName${i}`).join(' + ') + '; }'].join('\n');
    const taken = new Set(['A', 'B', 'C', 'Aa', 'Ab']);
    const { map } = mangle([[glsl]], { taken, reserved: new Set(['D']) });
    const shorts = [...map.names.values()];
    expect(new Set(shorts).size).toBe(shorts.length);
    for (const s of shorts) {
      expect(s).toMatch(/^[A-Za-z][A-Za-z0-9]{0,2}$/);
      expect(map.analysis.seen.has(s) || taken.has(s) || s === 'D' || GLSL_BUILTINS.has(s), s).toBe(false);
    }
    // los más usados reciben los más cortos
    expect(map.names.get('useAll')).toBeDefined();
    expect(map.names.size).toBe(121);
  });

  it('ningún nombre corto es una palabra de GLSL, aunque el reparto pase por `do`, `if` o `in`', () => {
    // palabras clave y reservadas de GLSL ES 3.00 (§3.8), escritas aparte de la lista del renombrador
    const keywords = `const uniform layout centroid flat smooth break continue do for while switch case default if else in out
      inout float int void bool true false invariant discard return mat2 mat3 mat4 mat2x2 mat2x3 mat2x4 mat3x2 mat3x3 mat3x4
      mat4x2 mat4x3 mat4x4 vec2 vec3 vec4 ivec2 ivec3 ivec4 bvec2 bvec3 bvec4 uint uvec2 uvec3 uvec4 lowp mediump highp
      precision sampler2D sampler3D samplerCube sampler2DShadow samplerCubeShadow sampler2DArray sampler2DArrayShadow
      isampler2D isampler3D isamplerCube isampler2DArray usampler2D usampler3D usamplerCube usampler2DArray struct attribute
      varying coherent volatile restrict readonly writeonly resource atomic_uint noperspective patch sample subroutine common
      partition active asm class union enum typedef template this goto inline noinline public static extern external
      interface long short double half fixed unsigned superp input output hvec2 hvec3 hvec4 dvec2 dvec3 dvec4 fvec2 fvec3
      fvec4 sampler3DRect filter sizeof cast namespace using abs all any cos dot exp fma log max min mix mod not pow sin tan`
      .split(/\s+/)
      .filter(Boolean);
    for (const k of keywords) expect(GLSL_BUILTINS.has(k), k).toBe(true);
    const decls = Array.from({ length: 700 }, (_, i) => `float name${i} = ${i}.0;`);
    const glsl = [...decls, `float useAll() { return ${decls.map((_, i) => `name${i}`).join(' + ')}; }`].join('\n');
    const shorts = [...mangle([[glsl]]).map.names.values()];
    for (const k of keywords) expect(shorts, k).not.toContain(k);
    // el reparto pasa de verdad por esas palabras: usa sus vecinas
    expect(shorts).toEqual(expect.arrayContaining(['dn', 'dp', 'ie', 'ig', 'im', 'io']));
  });

  it('determinista: el mismo fuente da el mismo mapa, en cualquier orden de plantillas', () => {
    const t = [
      ['float alpha(float x) { return x; }\nfloat beta = alpha(1.0);'],
      ['float gamma = beta + alpha(2.0);'],
      ['float delta = gamma;'],
    ];
    const a = [...buildMangleMap(t).names];
    const b = [...buildMangleMap([...t].reverse()).names];
    expect(a.length).toBe(4);
    expect(new Map(b)).toEqual(new Map(a));
  });

  it('si el mapa renombra un nombre pegado a una interpolación, la plantilla no pasó por el análisis: lanza', () => {
    const map = { names: new Map([['foo', 'a']]), afterDot: new Set<string>() };
    expect(() => mangleGlslParts(['float foo', ';'], map)).toThrow(/pegado a una interpolación/);
    expect(mangleGlslParts(['float foo;', ''], map)).toEqual(['float a;', '']);
  });
});

describe('Renombrado del GLSL en el build: lo que JS puede escribir en un shader', () => {
  it('se reservan los identificadores de cadenas, plantillas sin etiqueta y expresiones regulares; una GLSL anidada cuenta como cadena', () => {
    const code = [
      "const a = 'uniform float uDepth;';",
      'const b = `#define ${name} ${value}`;',
      'const c = /fromRegex\\d+/;',
      'const g = /* glsl */ `float x = ${/* glsl */ `nestedName`};`;',
      '// no es una etiqueta: /* glsl */ `',
      'const h = /* otra */ `float notGlsl;`;',
    ].join('\n');
    const s = scanModule(code);
    expect(s.templates).toHaveLength(1);
    expect(s.templates[0].statics).toEqual(['float x = ', ';']);
    for (const n of ['uniform', 'float', 'uDepth', 'define', 'fromRegex', 'nestedName', 'notGlsl'])
      expect(s.stringNames.has(n), n).toBe(true);
    expect(s.stringNames.has('name')).toBe(false); // una expresión, no una cadena
  });

  it('fragmentos pegados: a una interpolación, o en una concatenación cuyo vecino es desconocido o acaba en letra', () => {
    const code = [
      'const c = `uLook${i}`;', // «uLook…»
      "const d = 'sample' + k;", // «sample…»
      "const e = k + 'Mm';", // «…Mm»
      "const f = 'line\\n' + 'other' + 'x' + 7;", // 'other' no se pega a nada; 'x' sí al 7 (y 'other' por detrás)
      "let g = ''; g += 'tail';", // lo añadido se pega a lo que había y a lo que venga
      'const h = `0x${n}`;', // un número, no un nombre
    ].join('\n');
    const s = scanModule(code);
    expect([...s.prefixes].sort()).toEqual(['other', 'sample', 'tail', 'uLook', 'x'].sort());
    expect([...s.suffixes].sort()).toEqual(['Mm', 'tail', 'x'].sort());
  });

  it('la transformación con el mapa del bundle se niega con un módulo con GLSL que no se analizó', () => {
    const mod: SourceModule = { path: '/proyecto/src/a.ts', code: 'export const A = /* glsl */ `float someName = 1.0;`;\n' };
    const ctx = prepareGlslMangle([mod]);
    expect(transformWithMangle(mod.code, mod.path, ctx)).toBe(
      `export const A = /* glsl */ \`float ${ctx.map.names.get('someName')} = 1.0;\`;\n`,
    );
    expect(() => transformWithMangle(mod.code.replace('1.0', '2.0'), mod.path, ctx)).toThrow(/no es el módulo/);
    expect(() => transformWithMangle(mod.code, '/proyecto/src/b.ts', ctx)).toThrow(/no es el módulo/);
    expect(transformWithMangle('export const B = 1;\n', '/proyecto/src/c.ts', ctx)).toBe('export const B = 1;\n');
  });
});

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SOURCES = readSources(join(ROOT, 'src'));
const CTX = prepareGlslMangle(SOURCES);
const SOURCE_BY_PATH = new Map(SOURCES.map((m) => [m.path, m.code]));
/** Texto GLSL sin comentarios y sin sangría (el que compara las dos versiones de un programa). */
const canon = (glsl: string): string =>
  stripGlslComments([glsl], [])
    .parts[0].split('\n')
    .map((l) => l.trim())
    .join('\n');

/** Uniforms y entradas/salidas globales por expresión regular (independiente del analizador del renombrado). */
const regexInterface = (glsl: string): string[] =>
  [
    ...[...glsl.matchAll(/\buniform\s+(?:(?:lowp|mediump|highp)\s+)?\w+\s+(\w+)/g)].map((m) => `uniform ${m[1]}`),
    ...[...glsl.matchAll(/^(?:layout\([^)]*\)\s*)?(in|out)\s+(?:(?:lowp|mediump|highp|flat|smooth)\s+)*\w+\s+(\w+)\s*;/gm)].map(
      (m) => `${m[1]} ${m[2]}`,
    ),
  ].sort();

/**
 * Evalúa en memoria el grafo de módulos de `entry` (CommonJS con `transpileModule`) con el fuente que da `codeOf`:
 * el original o el transformado por el plugin. Así se montan los programas tal como los monta la app.
 */
function loadGraph(entry: string, codeOf: (path: string, code: string) => string): Record<string, unknown> {
  const cache = new Map<string, { exports: Record<string, unknown> }>();
  const nodeRequire = createRequire(entry);
  const load = (path: string): Record<string, unknown> => {
    const hit = cache.get(path);
    if (hit) return hit.exports;
    const code = SOURCE_BY_PATH.get(path);
    if (code === undefined) throw new Error(`sin fuente: ${path}`);
    const js = ts.transpileModule(codeOf(path, code), {
      fileName: path,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const module = { exports: {} as Record<string, unknown> };
    cache.set(path, module);
    const require = (spec: string): unknown => {
      if (!spec.startsWith('.')) return nodeRequire(spec);
      const base = join(dirname(path), spec);
      const file = [base, `${base}.ts`, join(base, 'index.ts')].find((f) => SOURCE_BY_PATH.has(f));
      if (!file) throw new Error(`${path}: no se resuelve ${spec}`);
      return load(file);
    };
    const run = runInThisContext(`(function (require, module, exports) {${js}\n})`, { filename: path }) as (
      r: typeof require,
      m: typeof module,
      e: Record<string, unknown>,
    ) => void;
    run(require, module, module.exports);
    return module.exports;
  };
  return load(entry);
}

describe('Renombrado del GLSL en el build: el fuente real', () => {
  const withGlsl = SOURCES.filter((m) => (CTX.modules.get(m.path)?.templates.length ?? 0) > 0);

  it('renombra de verdad: cientos de nombres y más de 8 kB de texto GLSL menos', () => {
    let before = 0;
    let after = 0;
    for (const m of withGlsl) {
      for (const t of findGlslTemplates(m.code)) {
        const parts = stripGlslComments(t.statics, t.exprs).parts;
        before += parts.join('').length;
        after += mangleGlslParts(parts, CTX.map).join('').length;
      }
    }
    expect(withGlsl.length).toBeGreaterThan(15);
    expect(CTX.map.names.size).toBeGreaterThan(300);
    expect(before - after).toBeGreaterThan(8000);
  });

  it('el plugin transforma los módulos con el mapa del bundle; ningún uniform ni entrada/salida cambia y las líneas se conservan', () => {
    const plugin = glslMinify();
    expect(plugin.apply).toBe('build'); // ni el servidor de desarrollo ni vitest lo ven
    const hook = <F>(h: unknown): F => (typeof h === 'function' ? h : (h as { handler: unknown }).handler) as F;
    hook<(c: { root: string }) => void>(plugin.configResolved)({ root: ROOT });
    hook<() => void>(plugin.buildStart).call({ meta: { watchMode: false } });
    const transform = hook<(code: string, id: string) => { code: string } | null>(plugin.transform);
    for (const m of withGlsl) {
      const out = transform.call({}, m.code, m.path)?.code;
      expect(out, m.path).toBe(transformWithMangle(m.code, m.path, CTX));
      if (out === undefined) continue;
      expect(out.split('\n').length, m.path).toBe(m.code.split('\n').length);
      const before = findGlslTemplates(m.code);
      const after = findGlslTemplates(out);
      expect(after.length, m.path).toBe(before.length);
      before.forEach((t, i) => {
        const a = stripGlslComments(t.statics, t.exprs).parts;
        const b = after[i].statics;
        expect(interfaceNames(b), `${m.path} #${i}`).toEqual(interfaceNames(a));
        // cada uniform y cada entrada/salida del fuente sigue ahí con su nombre
        for (const n of interfaceNames(a)) expect(b.join('\n'), `${m.path} #${i}: ${n}`).toMatch(new RegExp(`\\b${n.split(' ')[1]}\\b`));
      });
    }
    // con `vite build --watch`, solo la primera etapa: una caché de transformaciones no puede mezclar mapas
    const watch = glslMinify();
    hook<(c: { root: string }) => void>(watch.configResolved)({ root: ROOT });
    hook<() => void>(watch.buildStart).call({ meta: { watchMode: true } });
    const watchTransform = hook<(code: string, id: string) => { code: string } | null>(watch.transform);
    for (const m of withGlsl.slice(0, 3)) expect(watchTransform.call({}, m.code, m.path)?.code, m.path).toBe(minifyGlslTemplates(m.code));
    // un módulo del proyecto con plantillas que no se analizó (fuera de `src/`, un `.js`) hace fallar el build; las
    // dependencias (three.js trae sus propias plantillas `/* glsl */`) no se tocan
    const stray = 'export const X = /* glsl */ `float someName = 1.0;`;\n';
    expect(() => transform.call({}, stray, join(ROOT, 'shared/extra.ts'))).toThrow(/no es el módulo/);
    expect(() => transform.call({}, stray, join(ROOT, 'src/extra.js'))).toThrow(/no es el módulo/);
    expect(transform.call({}, stray, join(ROOT, 'node_modules/three/build/three.module.js'))).toBeNull();
  });

  it('nada de lo que nombra una cadena JS de src/ se renombra (los uniforms que sube el renderer, los #define de TISSUE_DEFINES…)', () => {
    const inStrings = new Set<string>();
    for (const m of SOURCES) for (const n of scanModule(m.code, m.path).stringNames) inStrings.add(n);
    for (const n of ['uDepth', 'uSceneTex', 'uTorso', 'T_LIVER', 'IF_NONE', 'NOTCH', 'PELVIS', 'N_PYR'])
      expect(inStrings.has(n), n).toBe(true);
    expect([...CTX.map.names.keys()].filter((n) => inStrings.has(n))).toEqual([]);
  });

  it('cada programa del renderer, montado con el fuente transformado, es el original renombrado con el mapa (sin colisiones)', () => {
    const entry = join(ROOT, 'src/ultrasound/shaders/passes.glsl.ts').replace(/\\/g, '/');
    const original = loadGraph(entry, (_, code) => code);
    const built = loadGraph(entry, (path, code) => transformWithMangle(code, path, CTX));
    const programs = Object.keys(PASSES).filter((k) => String((PASSES as Record<string, unknown>)[k]).startsWith('#version'));
    // solo gl.ts compila shaders y solo el renderer enlaza programas: esta prueba cubre todo lo que llega a la GPU
    const rel = (m: SourceModule): string => m.path.slice(m.path.indexOf('/src/') + 1);
    expect(SOURCES.filter((m) => /\.shaderSource\(/.test(m.code)).map(rel)).toEqual(['src/ultrasound/gl.ts']);
    expect(SOURCES.filter((m) => /GLProgram\.link(?:All)?\(/.test(m.code)).map(rel)).toEqual([
      'src/ultrasound/gl.ts',
      'src/ultrasound/renderer.ts',
    ]);
    // están todos los que enlaza el renderer (el vértice, el lote y los de consulta)
    const linked = [...scanModule(SOURCE_BY_PATH.get(join(ROOT, 'src/ultrasound/renderer.ts')) ?? '').identifiers].filter((n) =>
      /^(?:FRAG_\w+|VERT)$/.test(n),
    );
    expect(linked.length).toBeGreaterThanOrEqual(18);
    expect(programs.slice().sort()).toEqual(linked.sort());
    const shorts = new Set(CTX.map.names.values());
    expect(shorts.size).toBe(CTX.map.names.size);
    for (const k of programs) {
      const o = original[k] as string;
      const b = built[k] as string;
      // el cargador en memoria reproduce el módulo que importa vitest
      expect(o, k).toBe((PASSES as Record<string, unknown>)[k]);
      expect(b.startsWith('#version 300 es\n'), k).toBe(true);
      expect(canon(b), k).toBe(mangleGlslParts([canon(o)], CTX.map)[0]);
      // ningún identificador del programa original es un nombre corto: el renombrado es inyectivo en el programa
      const ids = new Set(tokenizeGlsl([canon(o)]).flatMap((t) => (t.kind === 'id' ? [t.text] : [])));
      expect(
        [...ids].filter((n) => shorts.has(n)),
        k,
      ).toEqual([]);
      expect(interfaceNames(canon(b)), k).toEqual(interfaceNames(canon(o)));
      // lo mismo con una expresión regular, sin el analizador del renombrado: uniforms y entradas/salidas globales
      expect(regexInterface(canon(b)), k).toEqual(regexInterface(canon(o)));
      expect(regexInterface(canon(o)).length, k).toBeGreaterThan(0);
      expect(canon(b), k).toMatch(/\bvoid main\(\)/);
    }
  });
});
