import { dirname, join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GLSL_WORDS, GLSL_PHRASES, GLSL_MARKERS, glslMarker, unpackGlsl } from '../core/glslPacking';
import { glslPacking, packGlslTemplates } from '../../tools/build/glslPacking';
import { threeGlslCompact } from '../../tools/build/threeGlslCompact';
import { prepareGlslMangle, readSources, transformWithMangle } from '../../tools/build/glslMinify';
import { bindingNames, compactBindings } from '../../tools/build/glslUniformNames';
import { loadShaderGraph } from './support/shaderGraph';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
describe('transporte GLSL sin pérdida', () => {
  it('decodifica el diccionario completo sin tocar texto normal', () => {
    // Identidad anterior a la serialización compacta: un marcador no puede cambiar de palabra.
    expect(createHash('sha256').update(JSON.stringify(GLSL_WORDS)).digest('hex')).toBe(
      'd5949a89a4bbd52a858ea47330623fae48857cd865d9c1ede433fbec2f441391',
    );
    expect(unpackGlsl(GLSL_WORDS.map((_, i) => glslMarker(i)).join(' '))).toBe(GLSL_WORDS.join(' '));
    expect(unpackGlsl('x + 1.0; @! @[')).toBe('x + 1.0; @! @[');
    expect(unpackGlsl('@z')).toBe('logdepthbuf_pars_vertex');
    expect([0, 63, 64, 127, 128, 191, 192, 255].map(glslMarker)).toEqual(['@A', '@$', '@~A', '@~$', '@!A', '@!$', '@:A', '@:$']);
    expect([256, 319, 320, 383, 384, 447, 448, 511].map(glslMarker)).toEqual(['@;A', '@;$', '@?A', '@?$', '@%A', '@%$', '@=A', '@=$']);
    expect(new Set(GLSL_WORDS.map((_, i) => glslMarker(i))).size).toBe(GLSL_WORDS.length);
    expect(unpackGlsl('@~! @~~A @:! @::A')).toBe('@~! @~~A @:! @::A');
    expect(GLSL_WORDS).toHaveLength(512);
    // Los bancos nuevos no reinterpretan ninguno de los 640 códigos anteriores.
    expect(
      createHash('sha256')
        .update(JSON.stringify(GLSL_PHRASES.slice(0, 128)))
        .digest('hex'),
    ).toBe('d0514d1bdc94d37a600cf255b9f854c36fec5ca5ecb1f0e0cbc161890ee17df4');
    expect(GLSL_PHRASES.length).toBeLessThanOrEqual(5 * GLSL_MARKERS.length);
    const codes = Array.from({ length: GLSL_WORDS.length + GLSL_PHRASES.length }, (_, index) => glslMarker(index));
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((code) => Buffer.byteLength(code, 'utf8') <= 3)).toBe(true);
    expect(unpackGlsl(GLSL_PHRASES.map((_, i) => glslMarker(512 + i)).join('\n'))).toBe(GLSL_PHRASES.join('\n'));
    expect([512, 575, 576, 639].map(glslMarker)).toEqual(['@+A', '@+$', '@^A', '@^$']);
    expect([640, 703, 704, 767, 768, 831].map(glslMarker)).toEqual(['@&A', '@&$', '@<A', '@<$', '@>A', '@>$']);
    expect(unpackGlsl('@+! @++A @^! @^^A')).toBe('@+! @++A @^! @^^A');
    expect(unpackGlsl('@&! @&&A @<! @<<A @>! @>>A')).toBe('@&! @&&A @<! @<<A @>! @>>A');
    // Los códigos sin entrada y texto no marcado siguen sin tocarse.
    expect(unpackGlsl(glslMarker(831))).toBe(glslMarker(831));
    for (const index of [-1, 832, NaN, 0.5]) expect(() => glslMarker(index)).toThrow(RangeError);
  });
  it('decodifica los diez tokens adicionales sin renombrar identificadores', () => {
    expect(unpackGlsl('@Q @R @S @T @U @V @W @X @Y @Z')).toBe(
      'tissue define texelFetch int gl_FragCoord referenceCartilage min ivec2 continue max',
    );
    expect(new Set(GLSL_WORDS).size).toBe(GLSL_WORDS.length);
    expect(GLSL_WORDS.length).toBeLessThanOrEqual(8 * GLSL_MARKERS.length);
  });
  it('conserva interpolaciones con marcadores, coerción, orden y escapes', () => {
    const filler = 'float x = 1.0; return vec3(x);\n'.repeat(100);
    const id = join(root, 'src/example.ts');
    const code =
      'const calls: string[]=[]; const obj={toString(){calls.push("coerce");return "@A";}}; export const result=/* glsl */ `' +
      filler +
      '${obj}${(calls.push("next"), "vec4")}' +
      filler +
      '`; export {calls};';
    const helper = readSources(join(root, 'src/core')).find((x) => x.path.endsWith('/glslPacking.ts'))!;
    const sources = new Map([
      [id, code],
      [helper.path, helper.code],
    ]);
    const before = loadShaderGraph(id, sources, (_, c) => c);
    const after = loadShaderGraph(id, sources, (p, c) => packGlslTemplates(c, p, root));
    expect(after).toEqual(before);
    expect(after.calls).toEqual(['coerce', 'next']);
    const unsafe = 'export const x=/* glsl */ `' + filler + '\\n @A`;';
    expect(packGlslTemplates(unsafe, id, root)).toBe(unsafe);
  });
  it('cada programa ensamblado es idéntico byte por byte al build sin empaquetar', () => {
    const sources = readSources(join(root, 'src'));
    const map = new Map(sources.map((s) => [s.path, s.code]));
    const ctx = prepareGlslMangle(sources);
    const bindings = bindingNames(sources.map((s) => s.code).join('\n'));
    const compact = (p: string, c: string) => compactBindings(transformWithMangle(c, p, ctx, { compact: true }), bindings);
    const entry = join(root, 'src/ultrasound/shaders/passes.glsl.ts');
    // El diccionario de transporte también se escanea como JS: sus frases no deben reservar
    // nombres nuevos ni cambiar los programas antes de aplicar el empaquetado.
    const withoutPhrases = sources.map((s) =>
      s.path === join(root, 'src/core/glslPacking.ts')
        ? {
            ...s,
            code: s.code.replace(
              /export const GLSL_PHRASES[\s\S]*?(?=export const GLSL_MARKERS)/,
              'export const GLSL_PHRASES = [] as const;\n',
            ),
          }
        : s,
    );
    expect(withoutPhrases.find((s) => s.path.endsWith('/src/core/glslPacking.ts'))!.code).not.toBe(
      map.get(join(root, 'src/core/glslPacking.ts')),
    );
    const withoutPhraseNames = prepareGlslMangle(withoutPhrases);
    const baseline = loadShaderGraph(entry, map, (p, c) =>
      compactBindings(transformWithMangle(c, p, withoutPhraseNames, { compact: true }), bindings),
    );
    const before = loadShaderGraph(entry, map, compact);
    expect(before).toEqual(baseline);
    // La cadena concatenada conserva también las reservas del minificador, no solo el decoder.
    const arrayWords = sources.map((s) =>
      s.path === join(root, 'src/core/glslPacking.ts')
        ? {
            ...s,
            code: s.code.replace(
              /export const GLSL_WORDS: readonly string\[\] = \([\s\S]*?\)\.split\(' '\);/,
              `export const GLSL_WORDS = ${JSON.stringify(GLSL_WORDS)} as const;`,
            ),
          }
        : s,
    );
    const arrayNames = prepareGlslMangle(arrayWords);
    expect(arrayWords.find((s) => s.path.endsWith('/src/core/glslPacking.ts'))!.code).not.toBe(
      map.get(join(root, 'src/core/glslPacking.ts')),
    );
    const arrayPrograms = loadShaderGraph(entry, map, (p, c) =>
      compactBindings(transformWithMangle(c, p, arrayNames, { compact: true }), bindings),
    );
    expect(before).toEqual(arrayPrograms);
    const after = loadShaderGraph(entry, map, (p, c) => packGlslTemplates(compact(p, c), p, root));
    let programs = 0,
      saved = 0;
    for (const [k, value] of Object.entries(before))
      if (typeof value === 'string') {
        expect(after[k], k).toBe(value);
        if (value.startsWith('#version')) programs++;
      }
    for (const { path, code } of sources) {
      const c = compact(path, code);
      saved += c.length - packGlslTemplates(c, path, root).length;
    }
    expect(programs).toBeGreaterThan(15);
    expect(saved).toBeGreaterThan(5000);
  });

  it('conserva cada export GLSL de Three byte por byte después del compactado existente', () => {
    const plugin = threeGlslCompact();
    (plugin.configResolved as (config: { root: string }) => void)({ root });
    (plugin.buildStart as () => void)();
    const compact = plugin.transform as (code: string, id: string) => { code: string };
    const helper = join(root, 'src/core/glslPacking.ts');
    const sources = new Map([[helper, readFileSync(helper, 'utf8')]]);
    let modules = 0,
      exports = 0,
      saved = 0;
    for (const folder of ['ShaderChunk', 'ShaderLib']) {
      const dir = join(root, 'node_modules/three/src/renderers/shaders', folder);
      for (const name of readdirSync(dir).filter((n) => n.endsWith('.glsl.js'))) {
        const id = join(dir, name);
        const code = compact(readFileSync(id, 'utf8'), id).code;
        sources.set(id, code);
        const before = loadShaderGraph(id, sources, (_, c) => c);
        const after = loadShaderGraph(id, sources, (p, c) => packGlslTemplates(c, p, root));
        expect(after, `${folder}/${name}`).toEqual(before);
        for (const value of Object.values(before)) {
          expect(typeof value, name).toBe('string');
          exports++;
        }
        saved += code.length - packGlslTemplates(code, id, root).length;
        modules++;
      }
    }
    expect(modules).toBeGreaterThan(100);
    expect(exports).toBeGreaterThanOrEqual(modules);
    expect(saved).toBeGreaterThan(0); // El ahorro final se mide sobre el bundle, no sobre módulos aún sin tree-shaking.
  });

  it('limita el plugin a nuestras fuentes y los módulos GLSL de Three', () => {
    const plugin = glslPacking();
    (plugin.configResolved as (config: { root: string }) => void)({ root });
    const transform = plugin.transform as (code: string, id: string) => { code: string } | null;
    const code = 'export default /* glsl */ `' + 'float x=1.; return vec3(x);'.repeat(100) + '`;';
    const paths = ['src/example.ts', 'node_modules/three/src/renderers/shaders/ShaderChunk/example.glsl.js'];
    for (const path of paths) expect(transform(code, join(root, path))?.code).toContain('__unpackGlsl');
    for (const path of ['node_modules/other/src/example.ts', 'node_modules/three/src/renderers/WebGLRenderer.js', 'tools/example.ts'])
      expect(transform(code, join(root, path))).toBeNull();
  });
});
