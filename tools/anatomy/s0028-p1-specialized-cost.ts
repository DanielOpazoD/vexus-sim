/** Ronda 2: medir exactamente las dos variantes completas antes de integrarlas. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as PASSES from '../../src/ultrasound/shaders/passes.glsl';
import type { S0028Field } from './s0028-p1-reader';
import { personShader } from './s0028-p1-specialized';
import { parseFields, triple } from './s0028-contract';
import { shaderContract, shaderCosts } from './s0028-shader-metrics';

const [input, out] = process.argv.slice(2);
if (!input || !out) throw new Error('Indicar paquete B y evidencia externa');
const packing: unknown = JSON.parse(readFileSync(resolve(input, 'packing.json'), 'utf8'));
if (!packing || typeof packing !== 'object' || !('assets' in packing) || !Array.isArray(packing.assets))
  throw new Error('Packing inválido');
const fields: S0028Field[] = [];
let depthOffset: [number, number, number] | undefined;
for (const value of packing.assets) {
  const asset: unknown = value;
  if (
    !asset ||
    typeof asset !== 'object' ||
    !('name' in asset) ||
    (asset.name !== 'abdominal' && asset.name !== 'thoracic') ||
    !('fields' in asset) ||
    !Array.isArray(asset.fields)
  )
    throw new Error('Asset inválido');
  const parsed = parseFields(asset);
  for (const [i, field] of parsed.entries()) {
    const raw: unknown = asset.fields[i];
    if (!raw || typeof raw !== 'object' || !('offset' in raw)) throw new Error('Offset ausente');
    if (field.asset !== asset.name) throw new Error('Campo de otro atlas');
    fields.push({ ...field, offset: triple(raw.offset), pitchMm: 1.5 });
  }
  if (asset.name === 'abdominal' && 'depthOffset' in asset) depthOffset = triple(asset.depthOffset);
}
const manifest: unknown = JSON.parse(readFileSync(resolve(input, 'candidate-manifest.json'), 'utf8'));
if (
  !manifest ||
  typeof manifest !== 'object' ||
  !('depth' in manifest) ||
  !manifest.depth ||
  typeof manifest.depth !== 'object' ||
  !('originMm' in manifest.depth) ||
  !('dimensions' in manifest.depth) ||
  !depthOffset
)
  throw new Error('Falta profundidad');
const bundle = {
  fields,
  depth: { originMm: triple(manifest.depth.originMm), dimensions: triple(manifest.depth.dimensions), offset: depthOffset, pitchMm: 3 },
};

const rows = shaderCosts(
  (source) => personShader(source, { person: 's0028', bundle }),
  (source) => personShader(source, { person: 'current' }),
);
for (const row of rows) {
  const source = Object.entries(PASSES).find(([name]) => name === row.name)?.[1];
  if (typeof source !== 'string') throw new Error('Fuente ausente');
  writeFileSync(resolve(out, row.name + '-current.glsl'), personShader(source, { person: 'current' }));
  writeFileSync(resolve(out, row.name + '-s0028.glsl'), personShader(source, { person: 's0028', bundle }));
}
const result = {
  timestamp: new Date().toISOString(),
  ...shaderContract,
  rows,
  allPass: rows.every((r) => r.current.pass && r.specialized.pass),
  runtimeInstalled: false,
  classifierComplete: false,
};
writeFileSync(resolve(out, 'shader-cost.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
if (!result.allPass) process.exitCode = 1;
