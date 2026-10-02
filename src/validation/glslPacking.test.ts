import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GLSL_WORDS, unpackGlsl } from '../core/glslPacking';
import { packGlslTemplates } from '../../tools/build/glslPacking';
import { prepareGlslMangle, readSources, transformWithMangle } from '../../tools/build/glslMinify';
import { bindingNames, compactBindings } from '../../tools/build/glslUniformNames';
import { loadShaderGraph } from './support/shaderGraph';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
describe('transporte GLSL sin pérdida', () => {
  it('decodifica el diccionario completo sin tocar texto normal', () => {
    expect(unpackGlsl(GLSL_WORDS.map((_, i) => '@' + String.fromCharCode(65 + i)).join(' '))).toBe(GLSL_WORDS.join(' '));
    expect(unpackGlsl('x + 1.0; @Z')).toBe('x + 1.0; @Z');
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
});
