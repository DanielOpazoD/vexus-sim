/** Extrae literalmente el contrato vigente: ni copia ajustada ni segundo presupuesto. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { transpileModule, ScriptTarget } from 'typescript';
import * as PASSES from '../../src/ultrasound/shaders/passes.glsl';
import { SAMPLER_GUARD, SLOT_GUARD } from '../ci/shaderBudgets';

const guard = readFileSync('src/validation/shaderLimits.test.ts', 'utf8');
const extract = (from: string, to: string): string => {
  const start = guard.indexOf(from),
    end = guard.indexOf(to, start);
  if (start < 0 || end <= start) throw new Error('Helper de coste cambió');
  return guard.slice(start, end);
};
const helpers = extract('function glslCallGraph(', '/** ¿Llega el código') + extract('function uniformSlots(', '/** Samplers que declara');
const js = transpileModule(
  helpers +
    '\nJSON.stringify({tokens:expandedTokens(glslCallGraph(source),"main"),branches:expandedBranches(glslCallGraph(source),"main"),slots:uniformSlots(source).slots})',
  {
    compilerOptions: { target: ScriptTarget.ES2022 },
  },
).outputText;
const limits = [...extract('const limits: Record<string, [number, number]> = {', '};').matchAll(/(FRAG_\w+): \[([\d_]+), ([\d_]+)\]/g)];
if (limits.length !== 8) throw new Error('Deben medirse exactamente ocho programas por persona');
const hash = (s: string): string => createHash('sha256').update(s).digest('hex');
export const shaderContract = { guardSha256: hash(guard), helpersSha256: hash(helpers) };

function measure(source: string, tokenLimit: number, branchLimit: number) {
  const value: unknown = JSON.parse(String(runInNewContext(js, { source }, { timeout: 10000 })));
  if (
    !value ||
    typeof value !== 'object' ||
    !('tokens' in value) ||
    typeof value.tokens !== 'number' ||
    !('branches' in value) ||
    typeof value.branches !== 'number' ||
    !('slots' in value) ||
    typeof value.slots !== 'number'
  )
    throw new Error('Medida inválida');
  const samplers = [...source.replace(/\/\/.*$/gm, '').matchAll(/\buniform\s+(?:(?:lowp|mediump|highp)\s+)?\w*sampler\w*\s+(\w+)/g)].length;
  return {
    tokens: value.tokens,
    branches: value.branches,
    slots: value.slots,
    samplers,
    sourceSha256: hash(source),
    pass: value.tokens <= tokenLimit && value.branches <= branchLimit && value.slots <= SLOT_GUARD && samplers <= SAMPLER_GUARD,
  };
}

export function shaderCosts(specialize: (source: string) => string, current: (source: string) => string = (s) => s) {
  return limits.map((m) => {
    const source = Object.entries(PASSES).find(([name]) => name === m[1])?.[1];
    if (typeof source !== 'string') throw new Error('Fuente ausente: ' + m[1]);
    const tokenLimit = Number(m[2].replaceAll('_', '')),
      branchLimit = Number(m[3].replaceAll('_', ''));
    return {
      name: m[1],
      tokenLimit,
      branchLimit,
      current: measure(current(source), tokenLimit, branchLimit),
      specialized: measure(specialize(source), tokenLimit, branchLimit),
    };
  });
}
