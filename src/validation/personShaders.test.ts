import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { prepareGlslMangle, readSources, transformWithMangle } from '../../tools/build/glslMinify';
import { packGlslTemplates } from '../../tools/build/glslPacking';
import { bindingNames, compactBindings } from '../../tools/build/glslUniformNames';
import abi from '../../tools/build/fixtures/person-glsl-abi.json';
import { personBindingAbi, personShaderAbi } from '../../tools/build/personShaderAbi';
import type { personShader } from '../anatomy/gpu/personShader';
import { S0028_BUNDLE } from '../anatomy/people/s0028/descriptor';
import baseline from './fixtures/person-shaders-main.json';
import { loadShaderGraph } from './support/shaderGraph';

const root = process.cwd();
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function programs(privateExtension = false) {
  const sources = readSources(join(root, 'src'));
  if (privateExtension)
    sources.push({
      path: join(root, 'src/anatomy/people/s0028/private-extension.ts'),
      code: 'export const shader = /* glsl */ `uniform float uAAbdominalPrivate; float privateS28(float x) { return x; }`;',
    });
  const code = new Map(sources.map((s) => [s.path, s.code]));
  const mangle = personShaderAbi(prepareGlslMangle(sources));
  const all = sources.map((s) => s.code).join('\n');
  const bindings = personBindingAbi(bindingNames(all), all);
  const transforms = {
    source: (_path: string, text: string) => text,
    productionTransforms: (path: string, text: string) =>
      packGlslTemplates(compactBindings(transformWithMangle(text, path, mangle, { compact: true }), bindings), path, root),
  };
  return Object.fromEntries(
    Object.entries(transforms).map(([mode, transform]) => {
      const shaders = loadShaderGraph(join(root, 'src/ultrasound/shaders/passes.glsl.ts'), code, transform);
      const specialize = loadShaderGraph(join(root, 'src/anatomy/gpu/personShader.ts'), code, transform)
        .personShader as typeof personShader;
      return [
        mode,
        Object.fromEntries(
          Object.entries(shaders)
            .filter(([name, value]) => /^(FRAG_\w+|VERT)$/.test(name) && typeof value === 'string')
            .map(([name, value]) => [
              name,
              { default: hash(value as string), s0028: hash(specialize(value as string, { person: 's0028', bundle: S0028_BUNDLE })) },
            ]),
        ),
      ];
    }),
  );
}

it('conserva los 38 fragmentos y el vértice de main, fuente y transformados', () => {
  expect(abi.base).toBe(baseline.base);
  expect(abi.base).toMatch(/^[0-9a-f]{40}$/);
  const result = programs();
  for (const mode of ['source', 'productionTransforms'] as const) {
    expect(Object.keys(result[mode])).toHaveLength(39);
    expect(result[mode]).toEqual(
      Object.fromEntries(baseline[mode].programs.map((p) => [p.name, { default: p.sha256, s0028: p.s0028Sha256 }])),
    );
  }
});

it('un uniform/símbolo privado nuevo no altera ningún programa default', () => {
  expect(programs(true)).toEqual(programs());
});
