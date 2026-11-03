import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import manifest from '../../tools/anatomy/s0028-case.json';

it('mide los ocho programas con lector B, gas y profundidad alcanzables sin TAC', () => {
  const out = mkdtempSync(join(tmpdir(), 's0028-B-cost-'));
  try {
    const fields = manifest.fieldGroups.map((f) => ({
      name: f.name,
      asset: f.asset,
      status: 'source',
      dimensions: [2, 3, 4],
      originMm: [1, -2, 3],
      offset: [0, 0, 0],
      rawBytes: 96,
      gzipBytes: 32,
      sha256Raw: 'a'.repeat(64),
    }));
    writeFileSync(
      join(out, 'packing.json'),
      JSON.stringify({
        assets: ['abdominal', 'thoracic'].map((name) => ({
          name,
          fields: fields.filter((f) => f.asset === name),
          textureDimensions: [16, 16, 16],
          depthOffset: [8, 8, 8],
        })),
      }),
    );
    writeFileSync(join(out, 'candidate-manifest.json'), JSON.stringify({ depth: { dimensions: [2, 2, 2], originMm: [-4, -5, -6] } }));
    execFileSync(process.execPath, ['--import', 'tsx', 'tools/anatomy/s0028-direct-cost.ts', out], { stdio: 'pipe' });
    const result: unknown = JSON.parse(readFileSync(join(out, 'shader-cost.json'), 'utf8'));
    if (!result || typeof result !== 'object' || !('rows' in result) || !Array.isArray(result.rows)) throw new Error('Informe ausente');
    expect(result.rows).toHaveLength(8);
    for (const value of result.rows) {
      const row: unknown = value;
      if (!row || typeof row !== 'object' || !('name' in row) || typeof row.name !== 'string') throw new Error('Programa ausente');
      const glsl = readFileSync(join(out, row.name + '-direct.glsl'), 'utf8');
      expect(glsl).toContain('return s28Depth(p)');
      expect(glsl).toContain('return normalize(s28DepthGradient(p))');
      expect(glsl).toContain('s28DigestiveGas(m)>0.5');
      expect(glsl.indexOf('vec2 abdominalAtlasValue(')).toBeLessThan(glsl.indexOf('vec2 thoracicValue('));
      expect(row).toMatchObject({ pass: true });
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 30000);
