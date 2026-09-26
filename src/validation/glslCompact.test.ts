import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LINE_CAP, compactGlslParts, needsSpace } from '../../tools/build/glslCompact';
import {
  findGlslTemplates,
  glslMinify,
  minifyGlslTemplates,
  prepareGlslMangle,
  readSources,
  scanModule,
  transformWithMangle,
} from '../../tools/build/glslMinify';
import { fragmentOutputCount } from '../ultrasound/gl';
import { loadShaderGraph } from './support/shaderGraph';

/**
 * Espacios y saltos de línea del GLSL en el build (`tools/build/glslCompact.ts`, tercera etapa de `glslMinify.ts`).
 * Las unitarias fijan cada regla; las del fuente real montan cada programa que enlaza el renderer con y sin la etapa y
 * exigen la misma secuencia de tokens con los dos léxicos de abajo, las mismas directivas, cada una en su línea, y lo
 * mismo en lo que la app lee del texto de un shader al ejecutar (`fragmentOutputCount`). Los léxicos de la prueba se
 * escriben aparte de los de la etapa, para no comprobarla consigo misma.
 */

const OPS = [
  '<<=',
  '>>=',
  '++',
  '--',
  '<<',
  '>>',
  '<=',
  '>=',
  '==',
  '!=',
  '&&',
  '||',
  '^^',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '^=',
  '|=',
];
const ID = /[A-Za-z_][A-Za-z0-9_]*/y;
/** Números como el preprocesador de C (Mesa): el signo tras e/E/p/P es parte del número, también en hexadecimal. */
const C_NUM = /(?:[0-9]|\.[0-9])(?:[eEpP][+-]|[A-Za-z0-9_.])*/y;
/** Números como ANGLE: hexadecimal sin exponente; decimal con `e±dígitos`; lo demás que empieza por dígito, sin signo. */
const ANGLE_NUM = [
  /0[xX][0-9a-fA-F]+[uU]?/y,
  /[0-9]*\.?[0-9]+[eE][+-]?[0-9]+[fF]?/y,
  /[0-9]+\.[0-9]*[eE][+-]?[0-9]+[fF]?/y,
  /(?:[0-9]|\.[0-9])[A-Za-z0-9_.]*/y,
];

/**
 * Tokens de un texto GLSL como los leería un compilador (con la regla de números dada): sin blancos ni comentarios,
 * operadores por máxima coincidencia y cada directiva (una línea que empieza por `#`) como un solo token con su línea
 * entera. Si la etapa juntara una directiva con otra línea, o dejara un `#` fuera de principio de línea, la secuencia
 * cambiaría.
 */
function tokens(src: string, numbers: readonly RegExp[]): string[] {
  const out: string[] = [];
  let lineStart = true;
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') {
      lineStart = true;
      i++;
    } else if (c === ' ' || c === '\t' || c === '\r') i++;
    else if (src.startsWith('//', i)) {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (src.startsWith('/*', i)) {
      const e = src.indexOf('*/', i + 2);
      i = e < 0 ? src.length : e + 2;
    } else if (c === '#' && lineStart) {
      const e = src.indexOf('\n', i);
      const end = e < 0 ? src.length : e;
      out.push(`⟨${src.slice(i, end).trim()}⟩`);
      i = end;
    } else {
      lineStart = false;
      ID.lastIndex = i;
      let t = ID.exec(src)?.[0] ?? '';
      for (const re of numbers) {
        re.lastIndex = i;
        const m = re.exec(src)?.[0] ?? '';
        if (m.length > t.length) t = m;
      }
      if (!t) t = OPS.find((o) => src.startsWith(o, i)) ?? c;
      out.push(t);
      i += t.length;
    }
  }
  return out;
}
const cTokens = (s: string): string[] => tokens(s, [C_NUM]);
const angleTokens = (s: string): string[] => tokens(s, ANGLE_NUM);
/** Mismos tokens con los dos léxicos. */
const sameTokens = (a: string, b: string, tag = ''): void => {
  expect(cTokens(b), `${tag} (léxico C)`).toEqual(cTokens(a));
  expect(angleTokens(b), `${tag} (léxico ANGLE)`).toEqual(angleTokens(a));
};

/** Las líneas de directiva de un texto, tal cual. */
const directives = (src: string): string[] =>
  src
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('#'));

/** Compacta una plantilla de una pieza con la forma de las reales (empieza y acaba en salto de línea). */
function compact(glsl: string): string {
  const out = compactGlslParts([`\n${glsl}\n`])[0];
  expect(out.startsWith('\n') && out.endsWith('\n'), out).toBe(true);
  return out.slice(1, -1);
}

describe('Espacios del GLSL en el build: reglas', () => {
  it('quita el blanco entre tokens y deja un espacio solo donde dos tokens se fundirían', () => {
    const glsl = [
      'float gain = 1.0 ;',
      'vec3 dir = normalize( vec3 ( 0.0 , 1.0 , 0.0 ) );',
      'if ( a >= b && c != d ) { x += y * ( z - 2.0 ); }',
      'return value;',
    ].join('\n');
    expect(compact(glsl)).toBe('float gain=1.0;vec3 dir=normalize(vec3(0.0,1.0,0.0));if(a>=b&&c!=d){x+=y*(z-2.0);}return value;');
    sameTokens(glsl, compact(glsl));
  });

  it('operadores que se fundirían en otro token conservan su espacio: - -, + +, < <, & &, = =, - =, / /, / *…', () => {
    const cases = [
      'a - -b',
      'a + +b',
      'a - --b',
      'a + ++b',
      'i++ + j',
      'x = - -1.0',
      'b = a < <c',
      'b = a > >c',
      'b = p & &q',
      'b = p | |q',
      'b = p ^ ^q',
      'b = a = =c',
      'b = a ! =c',
      'b = a < =c',
      'x - = 1.0',
      'x * = 2.0',
      'r = a / /b',
      'r = a / *p',
      'r = a * /b',
      'k = 1 << = 2',
    ];
    for (const c of cases) {
      const out = compact(c);
      sameTokens(c, out, `${c} → ${out}`);
      expect(out.length, c).toBeLessThan(c.length);
    }
    expect(compact('a - -b')).toBe('a- -b');
    expect(compact('a + ++b')).toBe('a+ ++b');
    expect(compact('x = -1.0 - -2.0')).toBe('x=-1.0- -2.0');
  });

  it('números: los dos léxicos (C de Mesa y ANGLE) tienen que leer igual lo pegado', () => {
    // `0x1e-5` es un solo número para el preprocesador de C; `0xCAFE--1u`, para ANGLE, `0xCAFE` `--` `1u`
    expect(compact('a = 0x1e - 5;')).toBe('a=0x1e -5;');
    expect(compact('uint c = 0xCAFE- -1u;')).toBe('uint c=0xCAFE- -1u;');
    expect(compact('int b = 0xFE+ +y;')).toBe('int b=0xFE+ +y;');
    expect(compact('a = 2.0 - 5.0;')).toBe('a=2.0-5.0;');
    expect(compact('a = 1e-5 + 2.5E+3 * 3.0f;')).toBe('a=1e-5+2.5E+3*3.0f;');
    expect(compact('a = v . x + w . 5;')).toBe('a=v.x+w. 5;');
    // `1.5e` `-` `3`: cada pareja se puede pegar con ANGLE, las tres juntas no (`1.5e-3`)
    expect(compact('a = 1.5e - 3;')).toBe('a=1.5e -3;');
    for (const [a, b, space] of [
      ['1', '.5', true],
      ['1.', 'x', true],
      ['x', '1', true],
      ['1', 'x', true],
      ['e', '-', false],
      ['1e', '-', true],
      ['0x1E', '+', true],
      ['0x1', '-', false],
      ['0xCAFE-', '-', true],
      [')', '.', false],
      ['.', 'x', false],
      ['.', '5', true],
    ] as const) {
      expect(needsSpace(a, b), `${a} ${b}`).toBe(space);
    }
  });

  it('las directivas se quedan en su línea, con el salto que las precede y el que las cierra', () => {
    const glsl = [
      '#version 300 es',
      'precision highp float;',
      'precision highp int;',
      '#define N 4',
      '#define SCALE(v) ((v) * 2.0)',
      'float a = SCALE(1.0);',
      '#if N > 2',
      'float b = 1.0;',
      '#endif',
      'float c = 2.0;',
    ].join('\n');
    const out = compact(glsl);
    expect(out.split('\n')).toEqual([
      '#version 300 es',
      'precision highp float;precision highp int;',
      '#define N 4',
      '#define SCALE(v) ((v) * 2.0)',
      'float a=SCALE(1.0);',
      '#if N > 2',
      'float b=1.0;',
      '#endif',
      'float c=2.0;',
    ]);
    sameTokens(glsl, out);
    expect(directives(out)).toEqual(directives(glsl));
  });

  it('junto a una interpolación o a un extremo de la plantilla el blanco se queda (como espacio o como salto)', () => {
    // `uniform ${TIPO} gain;`, `x ${OP} y`, una línea que es solo una interpolación y una directiva con un valor interpolado
    const parts = ['\nuniform ', ' gain;\nfloat y = x ', ' 2.0;\n', '\n#define N ', '\nfloat z = 3.0;\n'];
    expect(compactGlslParts(parts)).toEqual(['\nuniform ', ' gain;\nfloat y=x ', ' 2.0;\n', '\n#define N ', '\nfloat z=3.0;\n']);
    // un trozo pegado a la interpolación siguiente (su token puede seguir en ella): el blanco de antes se queda
    expect(compactGlslParts(['\nfloat a = uLook', ';\n'])).toEqual(['\nfloat a= uLook', ';\n']);
    // una directiva que empieza antes de una interpolación sigue hasta el salto de línea
    expect(compactGlslParts(['\n#define K ', ' + 1\nfloat c = K;\n'])).toEqual(['\n#define K ', ' + 1\nfloat c=K;\n']);
  });

  it('lo que sigue a una interpolación hasta el final de su línea, y la primera línea de la plantilla, van tal cual', () => {
    // el texto interpolado puede abrir una directiva (`${define('N')} 4`) o un comentario de línea (`uniform …; // doc`)
    const parts = ['\n', ' 4\nfloat x = float(N);\n', ' (sin salto)\nfloat y = uA;\n'];
    expect(compactGlslParts(parts)).toEqual(['\n', ' 4\nfloat x=float(N);\n', ' (sin salto)\nfloat y=uA;\n']);
    const glsl = (define: string, uniforms: string, p: readonly string[]) => p[0] + define + p[1] + uniforms + p[2];
    const before = glsl('#define N', 'uniform float uA; // doc', parts);
    const after = glsl('#define N', 'uniform float uA; // doc', compactGlslParts(parts));
    sameTokens(before, after);
    expect(directives(after)).toEqual(['#define N 4']);
    // la primera línea de una plantilla puede seguir una directiva del texto donde se interpola
    expect(compactGlslParts([' 4 + 1\nfloat w = 1.0;\n'])).toEqual([' 4 + 1\nfloat w=1.0;\n']);
  });

  it('una línea larga conserva un salto de los que había cada LINE_CAP caracteres (los errores de compilación citan la línea)', () => {
    const glsl = Array.from({ length: 400 }, (_, i) => `float value${i} = ${i}.0;`).join('\n');
    const out = compact(glsl);
    const lines = out.split('\n');
    expect(lines.length).toBeGreaterThan(5);
    for (const l of lines.slice(0, -1)) expect(l.length).toBeGreaterThanOrEqual(LINE_CAP);
    for (const l of lines) expect(l.length).toBeLessThan(LINE_CAP + 40);
    sameTokens(glsl, out);
  });

  it('`lines` conserva todos los saltos de línea, también varios seguidos junto a directivas y extremos', () => {
    const parts = ['\n\nfloat a = 1.0;\n\n#define N 3\n\nfloat b = a;\n\n', '\n\n#define M 2\n\nfloat c = b * 2.0;\n\n'];
    const out = compactGlslParts(parts, 'lines');
    expect(out).toEqual(['\n\nfloat a=1.0;\n\n#define N 3\n\nfloat b=a;\n\n', '\n\n#define M 2\n\nfloat c=b*2.0;\n\n']);
    out.forEach((o, i) => expect(o.split('\n')).toHaveLength(parts[i].split('\n').length));
    // una plantilla con escapes del literal no se toca
    expect(compactGlslParts(['\nfloat a = 1.0;\\nfloat b = 2.0;\n'])).toEqual(['\nfloat a = 1.0;\\nfloat b = 2.0;\n']);
  });

  it('en el módulo, los saltos que pierde la plantilla van delante de cada `${…}` y tras el acento grave: las líneas no cambian', () => {
    const code = [
      'export const A = /* glsl */ `',
      'float a = 1.0;',
      'float b = a + 2.0;',
      'const float K = ${K.toFixed(2)};',
      'float c = b * K;',
      '`;',
      'export const B = 1;',
      '',
    ].join('\n');
    const out = minifyGlslTemplates(code, undefined, { compact: true });
    expect(out.split('\n')).toHaveLength(code.split('\n').length);
    // la expresión sigue en su línea del fuente (la 4.ª), y lo que sigue a la plantilla también
    const lineOf = (s: string, what: string): number => s.slice(0, s.indexOf(what)).split('\n').length;
    expect(lineOf(out, 'K.toFixed(2)')).toBe(lineOf(code, 'K.toFixed(2)'));
    expect(lineOf(out, 'export const B')).toBe(lineOf(code, 'export const B'));
    expect(out).toContain('float a=1.0;float b=a+2.0;const float K= ${');
    // si lo que sigue al acento grave no admite un salto delante (`as`, `!`…), la plantilla no junta líneas
    const typed = ['export const C = /* glsl */ `', 'float a = 1.0;', 'float b = a;', '` as string;', ''].join('\n');
    const kept = minifyGlslTemplates(typed, undefined, { compact: true });
    expect(kept).toBe(['export const C = /* glsl */ `', 'float a=1.0;', 'float b=a;', '` as string;', ''].join('\n'));
    const spaced = typed.replace('` as string;', '`    as string;');
    const spacedOut = minifyGlslTemplates(spaced, undefined, { compact: true });
    expect(spacedOut.split('\n')).toHaveLength(spaced.split('\n').length);
    expect(spacedOut).toContain('`    as string;');
    // sin la opción, la tercera etapa no actúa
    expect(minifyGlslTemplates(code)).toBe(code);
  });

  it('`fragmentOutputCount` (la app cuenta las salidas leyendo el texto del shader) no depende de los saltos de línea', () => {
    const glsl =
      '#version 300 es\nprecision highp float;\nin vec2 vUv;\nout vec4 oColor;\nvoid f(out float x) { x = 1.0; }\nvoid main() { oColor = vec4(1.0); }\n';
    const out = compactGlslParts([glsl])[0];
    expect(out).toContain('in vec2 vUv;out vec4 oColor;');
    expect(fragmentOutputCount(glsl)).toBe(1);
    expect(fragmentOutputCount(out)).toBe(1);
    // una `out` de parámetro no es una salida
    expect(fragmentOutputCount('void f(out float x);\nvoid g(int a,out vec4 c);')).toBe(0);
    expect(fragmentOutputCount('layout(location=0)out vec4 a;layout(location=2)out vec4 b;')).toBe(3);
  });
});

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SOURCES = readSources(join(ROOT, 'src'));
const CTX = prepareGlslMangle(SOURCES);
const SOURCE_BY_PATH = new Map(SOURCES.map((m) => [m.path, m.code]));
const WITH_GLSL = SOURCES.filter((m) => (CTX.modules.get(m.path)?.templates.length ?? 0) > 0);

describe('Espacios del GLSL en el build: el fuente real', () => {
  it('cada programa que enlaza el renderer tiene los mismos tokens, las mismas directivas y las mismas salidas', () => {
    const entry = join(ROOT, 'src/ultrasound/shaders/passes.glsl.ts');
    const before = loadShaderGraph(entry, SOURCE_BY_PATH, (path, code) => transformWithMangle(code, path, CTX));
    const after = loadShaderGraph(entry, SOURCE_BY_PATH, (path, code) => transformWithMangle(code, path, CTX, { compact: true }));
    const renderer = SOURCE_BY_PATH.get(join(ROOT, 'src/ultrasound/renderer.ts')) ?? '';
    const linked = [...scanModule(renderer).identifiers].filter((n) => /^(?:FRAG_\w+|VERT)$/.test(n)).sort();
    expect(linked.length).toBeGreaterThanOrEqual(19);
    let saved = 0;
    for (const k of linked) {
      const a = before[k] as string;
      const b = after[k] as string;
      expect(typeof a, k).toBe('string');
      sameTokens(a, b, k);
      expect(directives(b), k).toEqual(directives(a));
      expect(b.startsWith('#version 300 es\n'), k).toBe(true);
      // fuera de las directivas no queda ningún `#`: ninguna directiva se juntó con otra línea
      expect(
        cTokens(b).filter((t) => t === '#'),
        k,
      ).toEqual([]);
      // lo que la app lee del texto al ejecutar: cuántas salidas de color escribe
      if (k !== 'VERT') expect(fragmentOutputCount(b), k).toBe(fragmentOutputCount(a));
      saved += a.length - b.length;
    }
    expect(saved).toBeGreaterThan(50_000); // los programas repiten los módulos compartidos
  });

  it('en cada módulo, cada `${…}` y lo que sigue a cada plantilla quedan en su línea del fuente', () => {
    for (const m of WITH_GLSL) {
      const out = transformWithMangle(m.code, m.path, CTX, { compact: true });
      expect(out.split('\n').length, m.path).toBe(m.code.split('\n').length);
      const a = findGlslTemplates(m.code);
      const b = findGlslTemplates(out);
      expect(b.length, m.path).toBe(a.length);
      const lineAt = (code: string, offset: number): number => code.slice(0, offset).split('\n').length;
      const firstAfter = (code: string, closing: number): number => {
        let j = closing + 1;
        while (/\s/.test(code[j] ?? '')) j++;
        return j;
      };
      a.forEach((t, i) => {
        // lo que sigue a cada plantilla, en su línea del fuente; cada expresión, en la suya
        expect(lineAt(out, firstAfter(out, b[i].end)), `${m.path} #${i}`).toBe(lineAt(m.code, firstAfter(m.code, t.end)));
        let offA = t.start;
        let offB = b[i].start;
        const kept = b[i].exprs.map((e) => e.replace(/^\n+/, ''));
        const bare = (e: string): string => e.replace(/^\n+/, '');
        let k = 0;
        t.exprs.forEach((e, j) => {
          offA += t.statics[j].length + 2;
          if (kept[k] === bare(e)) {
            offB = out.indexOf('${' + b[i].exprs[k], offB) + 2;
            expect(lineAt(out, offB + b[i].exprs[k].length - e.length), `${m.path} #${i} \${${e}}`).toBe(lineAt(m.code, offA));
            k++;
          }
          offA += e.length + 1;
        });
      });
    }
  });

  it('el plugin compacta por omisión, `compact: false` lo desactiva y cada módulo conserva su número de líneas', () => {
    const hook = <F>(h: unknown): F => (typeof h === 'function' ? h : (h as { handler: unknown }).handler) as F;
    const run = (options: Parameters<typeof glslMinify>[0]) => {
      const plugin = glslMinify(options);
      hook<(c: { root: string }) => void>(plugin.configResolved)({ root: ROOT });
      hook<() => void>(plugin.buildStart).call({ meta: { watchMode: false } });
      return hook<(code: string, id: string) => { code: string } | null>(plugin.transform);
    };
    const on = run({});
    const off = run({ compact: false });
    expect(WITH_GLSL.length).toBeGreaterThan(15);
    let smaller = 0;
    for (const m of WITH_GLSL) {
      const a = off.call({}, m.code, m.path)?.code ?? m.code;
      const b = on.call({}, m.code, m.path)?.code ?? m.code;
      expect(a, m.path).toBe(transformWithMangle(m.code, m.path, CTX));
      expect(b, m.path).toBe(transformWithMangle(m.code, m.path, CTX, { compact: true }));
      expect(b.split('\n').length, m.path).toBe(m.code.split('\n').length);
      if (b.length < a.length) smaller++;
    }
    expect(smaller).toBe(WITH_GLSL.length);
  });
});
