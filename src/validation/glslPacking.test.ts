import { dirname, join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GLSL_WORDS, GLSL_MARKERS, glslMarker, unpackGlsl } from '../core/glslPacking';
import { glslPacking, packGlslTemplates } from '../../tools/build/glslPacking';
import { threeGlslCompact } from '../../tools/build/threeGlslCompact';
import { prepareGlslMangle, readSources, transformWithMangle } from '../../tools/build/glslMinify';
import { bindingNames, compactBindings } from '../../tools/build/glslUniformNames';
import { loadShaderGraph } from './support/shaderGraph';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
describe('transporte GLSL sin pérdida', () => {
  it('decodifica el diccionario completo sin tocar texto normal', () => {
    expect(unpackGlsl(GLSL_WORDS.map((_, i) => glslMarker(i)).join(' '))).toBe(GLSL_WORDS.join(' '));
    expect(unpackGlsl('x + 1.0; @! @[')).toBe('x + 1.0; @! @[');
    expect(unpackGlsl('@z')).toBe('logdepthbuf_pars_vertex');
    expect(new Set(GLSL_WORDS.map((_, i) => glslMarker(i))).size).toBe(GLSL_WORDS.length);
    expect(unpackGlsl('@~! @~~A')).toBe('@~! @~~A');
    for (const index of [-1, 128, NaN, 0.5]) expect(() => glslMarker(index)).toThrow(RangeError);
  });
  it('decodifica los diez tokens adicionales sin renombrar identificadores', () => {
    expect(unpackGlsl('@Q @R @S @T @U @V @W @X @Y @Z')).toBe(
      'tissue define texelFetch int gl_FragCoord referenceCartilage min ivec2 continue max',
    );
    expect(new Set(GLSL_WORDS).size).toBe(GLSL_WORDS.length);
    expect(GLSL_WORDS.length).toBeLessThanOrEqual(2 * GLSL_MARKERS.length);
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
    const before = loadShaderGraph(entry, map, compact);
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
