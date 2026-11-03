/** Preflight P1: sampler y precisión correctos; todavía NO es el clasificador de s0028. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { transpileModule, ScriptTarget } from 'typescript';
import * as PASSES from '../../src/ultrasound/shaders/passes.glsl';
import { s0028Shader, type S0028Field } from './s0028-p1-reader';
import { parseFields, triple } from './s0028-contract';

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
const guard = readFileSync('src/validation/shaderLimits.test.ts', 'utf8');
const helpers = guard.slice(guard.indexOf('function glslCallGraph('), guard.indexOf('/** ¿Llega el código'));
const slotHelpers = guard.slice(guard.indexOf('function uniformSlots('), guard.indexOf('/** Samplers que declara'));
const js = transpileModule(
  helpers +
    slotHelpers +
    '\nJSON.stringify({tokens:expandedTokens(glslCallGraph(source),"main"),branches:expandedBranches(glslCallGraph(source),"main"),slots:uniformSlots(source).slots})',
  { compilerOptions: { target: ScriptTarget.ES2022 } },
).outputText;
const measure = (source: string): { tokens: number; branches: number; slots: number } => {
  const result: unknown = JSON.parse(String(runInNewContext(js, { source }, { timeout: 10000 })));
  if (
    !result ||
    typeof result !== 'object' ||
    !('tokens' in result) ||
    typeof result.tokens !== 'number' ||
    !('branches' in result) ||
    typeof result.branches !== 'number' ||
    !('slots' in result) ||
    typeof result.slots !== 'number'
  )
    throw new Error('Medida inválida');
  return { tokens: result.tokens, branches: result.branches, slots: result.slots };
};
const limitSource = guard.slice(guard.indexOf('const limits: Record<string, [number, number]> = {'));
const limits = [...limitSource.slice(0, limitSource.indexOf('};')).matchAll(/(FRAG_\w+): \[([\d_]+), ([\d_]+)\]/g)];
if (limits.length !== 8) throw new Error('Deben ser ocho programas');
const rows = limits.map((m) => {
  const source = Object.entries(PASSES).find(([name]) => name === m[1])?.[1];
  if (typeof source !== 'string') throw new Error('Fuente ausente');
  const candidate = s0028Shader(source, bundle);
  const baseline = measure(source),
    direct = measure(candidate);
  const samplers = [...candidate.replace(/\/\/.*$/gm, '').matchAll(/\buniform\s+(?:(?:lowp|mediump|highp)\s+)?\w*sampler\w*\s+(\w+)/g)].map(
    (x) => x[1],
  );
  const tokenLimit = Number(m[2].replaceAll('_', '')),
    branchLimit = Number(m[3].replaceAll('_', ''));
  writeFileSync(resolve(out, m[1] + '-direct.glsl'), candidate);
  writeFileSync(resolve(out, m[1] + '-baseline.glsl'), source);
  return {
    name: m[1],
    tokenLimit,
    branchLimit,
    baseline,
    direct,
    samplers: samplers.length,
    pass: direct.tokens <= tokenLimit && direct.branches <= branchLimit && direct.slots <= 179 && samplers.length <= 16,
  };
});
const hash = (s: string): string => createHash('sha256').update(s).digest('hex');
const result = {
  timestamp: new Date().toISOString(),
  guardSha256: hash(guard),
  helperSha256: hash(helpers),
  fields: fields.length,
  rows,
  allPass: rows.every((r) => r.pass),
  runtimeInstalled: false,
  classifierComplete: false,
  scope: 'Preflight del lector correcto B con consultas históricas; no anatomía completa, no primer cuadro',
};
writeFileSync(resolve(out, 'shader-cost.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
if (!result.allPass) process.exitCode = 1;
