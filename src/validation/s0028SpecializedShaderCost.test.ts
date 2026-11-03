import { describe, expect, it } from 'vitest';
import { FRAG_COLOR, FRAG_RAWFIELD_CLASS } from '../ultrasound/shaders/passes.glsl';
import { S0028_BUNDLE as bundle } from '../anatomy/anatomyBundle';
import { personShader } from '../../tools/anatomy/s0028-p1-specialized';
import { shaderCosts } from '../../tools/anatomy/s0028-shader-metrics';

describe('especialización previa por persona, sin selector de sampler en GLSL', () => {
  it('conserva las fuentes actuales exactamente y elimina las lecturas del otro donante en s0028', () => {
    expect(personShader(FRAG_RAWFIELD_CLASS, { person: 'current' })).toBe(FRAG_RAWFIELD_CLASS);
    const source = personShader(FRAG_RAWFIELD_CLASS, { person: 's0028', bundle });
    expect(source).not.toContain('S28_ASSET');
    expect(source).not.toContain('s28Value(');
    expect(source).not.toContain('registeredDomeSample(vec2 p){\n  if');
    expect(source).toContain('mod(label,128.0)');
    expect(source).toContain('sourceDistancePrecise(uThoracicAtlas');
    expect(source).toContain('sourceDistancePrecise(uAbdominalAtlas');
  });

  it('cubre los ocho programas de ambas personas con las cotas y helpers originales', () => {
    const rows = shaderCosts(
      (source) => personShader(source, { person: 's0028', bundle }),
      (source) => personShader(source, { person: 'current' }),
    );
    expect(rows).toHaveLength(8);
    for (const row of rows) {
      expect(row.current.pass, row.name + ' actual').toBe(true);
      expect(row.specialized.pass, row.name + ' s0028').toBe(true);
    }
  });

  it('detecta una regresión en cualquiera de las dos variantes', () => {
    const inflate = (source: string): string =>
      source === FRAG_COLOR ? source.replace(/void main\(\)\s*\{/, 'void main() {\n' + '0.0;\n'.repeat(12000)) : source;
    expect(shaderCosts((s) => inflate(s)).find((r) => r.name === 'FRAG_COLOR')?.specialized.pass).toBe(false);
    expect(
      shaderCosts(
        (s) => s,
        (s) => inflate(s),
      ).find((r) => r.name === 'FRAG_COLOR')?.current.pass,
    ).toBe(false);
    expect(personShader(FRAG_COLOR, { person: 'current' })).toBe(FRAG_COLOR);
  });
});
