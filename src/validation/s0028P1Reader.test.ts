import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import manifest from '../../tools/anatomy/s0028-case.json';
import { s0028Shader } from '../../tools/anatomy/s0028-p1-reader';
import { FRAG_RAWFIELD_CLASS } from '../ultrasound/shaders/passes.glsl';
import { ABDOMINAL_FIELDS } from '../anatomy/abdominalAtlasData';

const field = (name: string, asset: 'abdominal' | 'thoracic') => ({
  name,
  asset,
  originMm: [-3.04777431275115, -10, -20],
  dimensions: [3, 4, 5],
  offset: [0, 0, 0],
  pitchMm: 1.5,
});
const fields = [
  ...ABDOMINAL_FIELDS.filter((f) => !['psoas', 'lumbarDiscs'].includes(f.name)).map((f) => field(f.name, 'abdominal')),
  field('posteriorMuscle', 'abdominal'),
  field('sacrum', 'abdominal'),
  field('thoracicBone', 'thoracic'),
  field('cartilage', 'thoracic'),
  field('lung', 'thoracic'),
  field('heart', 'thoracic'),
];
const descriptors = { fields, depth: { originMm: [-20, -30, -40], dimensions: [4, 5, 6], offset: [0, 0, 8], pitchMm: 3 } };

describe('lector B previo a la integración del clasificador', () => {
  it('emite los dos atlas reales y precisión ósea, sin añadir samplers', () => {
    const result = s0028Shader(FRAG_RAWFIELD_CLASS, descriptors);
    expect(result).toContain('s28Sample(uAbdominalAtlas');
    expect(result).toContain('s28Sample(uThoracicAtlas');
    expect(result).toContain('sourceDistancePrecise(field');
    expect(result.match(/uniform highp sampler3D/g)).toHaveLength(FRAG_RAWFIELD_CLASS.match(/uniform highp sampler3D/g)!.length);
    expect(result).toContain('-3.047774312751150');
    expect(result).toContain('mod(q.y,128.0)');
  });
  it('rechaza descriptores incompletos antes de generar un shader', () => {
    expect(() => s0028Shader(FRAG_RAWFIELD_CLASS, { ...descriptors, fields: [] })).toThrow(/campo/);
  });
  it('no suplanta psoas por autóctono ni discos por sacro', () => {
    const result = s0028Shader(FRAG_RAWFIELD_CLASS, descriptors);
    expect(result).toContain('const int S28_LEGACY');
    expect(result).toContain('if(j<0)return vec2(16.0,0.0)');
    expect(result).toContain('s28Gas');
    expect(result).not.toBe(FRAG_RAWFIELD_CLASS);
  });
});

it('la CLI rechaza el lector de dos rutas que supera los ocho techos vigentes', () => {
  const out = mkdtempSync(join(tmpdir(), 's0028-p1-negative-'));
  try {
    const fields = manifest.fieldGroups
      .filter((f) => f.name !== 'digestiveGas')
      .map((f) => ({
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
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'tools/anatomy/s0028-p1-cost.ts', out, out], { encoding: 'utf8' });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    const report: unknown = JSON.parse(readFileSync(join(out, 'shader-cost.json'), 'utf8'));
    if (!report || typeof report !== 'object' || !('rows' in report) || !Array.isArray(report.rows)) throw new Error('Informe ausente');
    expect(report).toMatchObject({ allPass: false, runtimeInstalled: false, classifierComplete: false, fields: 19 });
    expect(report.rows).toHaveLength(8);
    for (const value of report.rows) {
      const row: unknown = value;
      expect(row).toMatchObject({ pass: false });
      if (
        !row ||
        typeof row !== 'object' ||
        !('baseline' in row) ||
        !('tokenLimit' in row) ||
        typeof row.tokenLimit !== 'number' ||
        !('branchLimit' in row) ||
        typeof row.branchLimit !== 'number' ||
        !row.baseline ||
        typeof row.baseline !== 'object' ||
        !('tokens' in row.baseline) ||
        typeof row.baseline.tokens !== 'number' ||
        !('branches' in row.baseline) ||
        typeof row.baseline.branches !== 'number'
      )
        throw new Error('Fila inválida');
      expect(row.baseline.tokens).toBeLessThanOrEqual(row.tokenLimit);
      expect(row.baseline.branches).toBeLessThanOrEqual(row.branchLimit);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 30000);
