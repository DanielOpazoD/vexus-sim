import { expect, it } from 'vitest';
import { ABDOMINAL_FIELDS } from '../anatomy/abdominalAtlasData';
import { ABDOMINAL_FIELD_TEXELS, writeAbdominalFieldDescriptors } from '../anatomy/abdominalAtlasDescriptors';
import { ATLAS_FIELD_BASE, BOWEL_BASE, SCENE_TEX_H, SCENE_TEX_W } from '../anatomy/gpu/anatomy.glsl';
import { BOWEL_TEXELS } from '../anatomy/organs/bowel';

it('transporta todos los descriptores exactos sin tocar otros registros ni crecer la textura actual', () => {
  const data = new Float32Array(SCENE_TEX_H * SCENE_TEX_W * 4).fill(-99);
  writeAbdominalFieldDescriptors(data, ATLAS_FIELD_BASE);
  expect(ATLAS_FIELD_BASE).toBe(BOWEL_BASE + BOWEL_TEXELS);
  expect(ATLAS_FIELD_BASE + ABDOMINAL_FIELD_TEXELS).toBeLessThanOrEqual(SCENE_TEX_W * SCENE_TEX_H);
  expect(SCENE_TEX_H).toBe(10);
  for (let i = 0; i < ATLAS_FIELD_BASE * 4; i++) expect(data[i]).toBe(-99);
  for (const [i, f] of ABDOMINAL_FIELDS.entries()) {
    const base = (ATLAS_FIELD_BASE + i * 3) * 4;
    expect(Array.from(data.subarray(base, base + 3))).toEqual([...f.originMm]);
    expect(data[base + 3]).toBe(f.pitchMm);
    expect(Array.from(data.subarray(base + 4, base + 7))).toEqual([...f.dimensions]);
    expect(Array.from(data.subarray(base + 8, base + 11))).toEqual([...f.offset]);
  }
  for (let i = (ATLAS_FIELD_BASE + ABDOMINAL_FIELD_TEXELS) * 4; i < data.length; i++) expect(data[i]).toBe(-99);
});
