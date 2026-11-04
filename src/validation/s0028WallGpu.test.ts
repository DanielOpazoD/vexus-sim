import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import * as PASSES from '../ultrasound/shaders/passes.glsl';
import { personShader } from '../anatomy/gpu/personShader';
import { S0028_BUNDLE as bundle } from '../anatomy/anatomyBundle';
import { shaderCosts } from '../../tools/anatomy/s0028-shader-metrics';
import { minifyGlslBody } from '../../tools/build/glslMinify';
import baseline from './fixtures/s0028-shader-default.json';

it('conserva los ocho GLSL default byte a byte respecto de main 8ee9fbd', () => {
  for (const [name, hash] of Object.entries(baseline)) {
    const source = Object.entries(PASSES).find(([key]) => key === name)?.[1];
    if (typeof source !== 'string') throw new Error('Programa ausente');
    expect(
      createHash('sha256')
        .update(personShader(source, { person: 'current' }))
        .digest('hex'),
      name,
    ).toBe(hash);
    expect(
      createHash('sha256')
        .update(source + '\n')
        .digest('hex'),
    ).not.toBe(hash);
  }
});

it('s0028 sustituye W global en todos los consumidores alcanzables y lee cuatro soportes geométricos', () => {
  const source = personShader(PASSES.FRAG_RAWFIELD_CLASS, { person: 's0028', bundle });
  expect(source).not.toMatch(/uWall\.x\s*\+\s*uWall\.y\s*\+\s*uWall\.z|skin\s*\+\s*uWall\.y\s*\+\s*uWall\.z/);
  expect(source).toContain('s28WallKnown');
  expect(source).toContain('s28WallAt');
});

it('rechaza el sampler 17 en ECHO usando el contrato real intacto', () => {
  const rows = shaderCosts((source) => {
    const changed = personShader(source, { person: 's0028', bundle });
    return source === PASSES.FRAG_RAWFIELD_ECHO ? changed + '\nuniform sampler2D uForbiddenWall;' : changed;
  });
  const echo = rows.find((row) => row.name === 'FRAG_RAWFIELD_ECHO');
  expect(echo?.specialized.samplers).toBe(17);
  expect(echo?.specialized.pass).toBe(false);
});

it('especializa los programas s0028 después de compactar GLSL para producción', () => {
  for (const name of Object.keys(baseline)) {
    const source = Object.entries(PASSES).find(([key]) => key === name)?.[1];
    if (typeof source !== 'string') throw new Error('Programa ausente');
    const compact = minifyGlslBody([source], [], undefined, 'join');
    const specialized = personShader(compact, { person: 's0028', bundle });
    expect(specialized, name).toContain('s28WallAt');
    expect(specialized, name).toContain('s28_posteriorMuscle(m)');
    expect(specialized, name).not.toMatch(/uWall\.x\s*\+\s*uWall\.y\s*\+\s*uWall\.z/);
  }
});
