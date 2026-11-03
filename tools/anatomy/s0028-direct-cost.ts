/** B P0e: lector, gas y profundidad alcanzables; coste estático, sin instalar runtime. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { transpileModule, ScriptTarget } from 'typescript';
import * as PASSES from '../../src/ultrasound/shaders/passes.glsl';
import { ABDOMINAL_FIELDS } from '../../src/anatomy/abdominalAtlasData';
import { parseFields, triple } from './s0028-contract';

const out = process.argv[2];
if (!out) throw new Error('Indicar evidencia externa');
const readJson = (name: string): unknown => JSON.parse(readFileSync(resolve(out, name), 'utf8'));
const value = readJson('packing.json');
if (!value || typeof value !== 'object' || !('assets' in value) || !Array.isArray(value.assets)) throw new Error('Packing ausente');
const assets = value.assets.map((a: unknown) => {
  if (
    !a ||
    typeof a !== 'object' ||
    !('name' in a) ||
    typeof a.name !== 'string' ||
    !('fields' in a) ||
    !Array.isArray(a.fields) ||
    !('textureDimensions' in a) ||
    !('depthOffset' in a)
  )
    throw new Error('Asset inválido');
  const fields = parseFields(a);
  const offsets = a.fields.map((f: unknown) => {
    if (!f || typeof f !== 'object' || !('offset' in f)) throw new Error('Offset ausente');
    return triple(f.offset);
  });
  return {
    name: a.name,
    depthOffset: triple(a.depthOffset),
    fields: fields.map((f, i) => ({ ...f, offset: offsets[i] })),
    dimensions: triple(a.textureDimensions),
  };
});
const abdomen = assets.find((a) => a.name === 'abdominal');
const thorax = assets.find((a) => a.name === 'thoracic');
if (!abdomen || !thorax) throw new Error('Faltan atlas');
const manifest = readJson('candidate-manifest.json');
if (
  !manifest ||
  typeof manifest !== 'object' ||
  !('depth' in manifest) ||
  !manifest.depth ||
  typeof manifest.depth !== 'object' ||
  !('originMm' in manifest.depth) ||
  !('dimensions' in manifest.depth)
)
  throw new Error('Profundidad ausente');
const depthOrigin = triple(manifest.depth.originMm),
  depthDimensions = triple(manifest.depth.dimensions);
const depthOffset = abdomen.depthOffset;
// Los primeros nueve índices conservan el significado del selector vigente. Psoas pasa al
// observado posteriorMuscle y el slot discos es U: alias exclusivamente de coste, no anatomía.
const names = [
  ...ABDOMINAL_FIELDS.map((f) => (f.name === 'psoas' ? 'posteriorMuscle' : f.name === 'lumbarDiscs' ? 'sacrum' : f.name)),
  ...[
    'aorta',
    'inferior_vena_cava',
    'portal_vein_and_splenic_vein',
    'renalCysts',
    'thoracicBone',
    'cartilage',
    'lung',
    'heart',
    'digestiveGas',
  ],
];
const fields = names.map((name) => {
  const f = [...abdomen.fields, ...thorax.fields].find((f) => f.name === (name === 'digestiveGas' ? 'digestiveTract' : name));
  if (!f) throw new Error('Descriptor ausente ' + name);
  return f;
});
if (fields.length !== 20) throw new Error('20 entradas requeridas');
const vec = (v: readonly number[]) => `vec3(${v.map((x) => x.toFixed(9)).join(',')})`;
const guard = readFileSync('src/validation/shaderLimits.test.ts', 'utf8');
const start = guard.indexOf('function glslCallGraph('),
  end = guard.indexOf('/** ¿Llega el código');
if (start < 0 || end < start) throw new Error('Helper cambió');
const helpers = guard.slice(start, end);
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
function replaceFunction(source: string, type: string, name: string, replacement: string): string {
  const at = source.indexOf(type + ' ' + name + '(');
  if (at < 0) throw Error('Missing ' + name);
  let i = source.indexOf('{', at) + 1,
    depth = 1;
  for (; depth && i < source.length; i++) depth += source[i] === '{' ? 1 : source[i] === '}' ? -1 : 0;
  if (depth) throw Error('Unclosed ' + name);
  return source.slice(0, at) + replacement + source.slice(i);
}
const tables = ['LO', 'DIM']
  .map((key, i) => `const vec3 ATLAS_${key}[20]=vec3[](${fields.map((f) => vec(f[i === 0 ? 'originMm' : 'dimensions'])).join(',')});`)
  .join('\n');
const reader = `const vec3 ATLAS_OFF[20]=vec3[](${fields.map((f) => vec(f.offset)).join(',')});
 vec2 abdominalAtlasValue(vec3 p,int k){
   if(uAbdominalAtlasEnabled==0||k<0||k>=20)return vec2(16,0);
   vec3 lo=ATLAS_LO[k],dim=ATLAS_DIM[k],off=ATLAS_OFF[k];vec3 q=(p-lo)/1.5;
   if(any(lessThan(q,vec3(0)))||any(greaterThan(q,dim-1.0)))return vec2(16,0);
   float d=textureLod(uAbdominalAtlas,(off+q+0.5)/${vec(abdomen.dimensions)},0.0).r;
   if((k==8||k==10)&&abs(d)<1.5)d=sourceDistancePrecise(uAbdominalAtlas,q,ivec3(dim),ivec3(off));
   float label=texelFetch(uAbdominalAtlas,ivec3(off+floor(q+0.5)),0).g;return vec2(d,mod(label,128.0));
 }
 float s28DigestiveGas(vec3 p){vec3 q=(p-ATLAS_LO[1])/1.5;
   if(any(lessThan(q,vec3(0)))||any(greaterThan(q,ATLAS_DIM[1]-1.0)))return 0.0;
   return texelFetch(uAbdominalAtlas,ivec3(ATLAS_OFF[1]+floor(q+0.5)),0).g>=128.0?1.0:0.0;
 }
 `;
const bodyReader = `float s28Depth(vec3 p){
   vec3 q=(p-${vec(depthOrigin)})/3.0;
   vec3 at=clamp(q,vec3(0),${vec(depthDimensions.map((n) => n - 1))});
   return textureLod(uAbdominalAtlas,(${vec(depthOffset)}+at+0.5)/${vec(abdomen.dimensions)},0.0).r+length(q-at)*3.0;
 }
 vec3 s28DepthGradient(vec3 p){vec3 e=vec3(1.5,0,0);
   return vec3(s28Depth(p+e.xyy)-s28Depth(p-e.xyy),s28Depth(p+e.yxy)-s28Depth(p-e.yxy),s28Depth(p+e.yyx)-s28Depth(p-e.yyx))/3.0;
 }
 `;
function candidate(source: string): string {
  let changed = source.replace(/const vec3 ATLAS_(LO|DIM|OFF)\[\d+\]=vec3\[\]\([^;]+;/g, '');
  changed = replaceFunction(changed, 'vec2', 'abdominalAtlasValue', tables + '\n' + reader);
  changed = changed.replace('bool gas=inner<0.0&&digestiveGasPlane(m,label)>0.0;', 'bool gas=inner<0.0&&s28DigestiveGas(m)>0.5;');
  const bone = thorax!.fields.find((f) => f.name === 'thoracicBone');
  if (!bone) throw new Error('Hueso torácico ausente');
  const thoracic = `vec2 thoracicValue(vec3 p){if(uAbdominalAtlasEnabled==0)return vec2(16,0);vec3 q=(p-${vec(bone.originMm)})/1.5;
  if(any(lessThan(q,vec3(0)))||any(greaterThan(q,${vec(bone.dimensions.map((n) => n - 1))})))return vec2(16,0);
  float d=textureLod(uThoracicAtlas,(${vec(bone.offset)}+q+0.5)/${vec(thorax!.dimensions)},0.0).r;
  if(abs(d)<1.5)d=sourceDistancePrecise(uThoracicAtlas,q,ivec3(${bone.dimensions.join(',')}),ivec3(${bone.offset.join(',')}));
  return vec2(d,texelFetch(uThoracicAtlas,ivec3(${vec(bone.offset)}+floor(q+0.5)),0).g);}`;
  changed = replaceFunction(changed, 'vec2', 'thoracicValue', thoracic);
  // thoracicValue occurs before abdominalAtlasValue: all shared helpers must precede both.
  const pos = changed.indexOf(tables + '\n' + reader);
  changed = changed.slice(0, pos) + changed.slice(pos + (tables + '\n' + reader).length);
  const ta = changed.indexOf('vec2 thoracicValue(');
  changed = changed.slice(0, ta) + tables + '\n' + reader + '\n' + changed.slice(ta);
  {
    changed = replaceFunction(changed, 'float', 'torsoDepth', bodyReader + '\nfloat torsoDepth(vec3 p){return s28Depth(p); }');
    changed = replaceFunction(changed, 'vec3', 'torsoNormal', 'vec3 torsoNormal(vec3 p){return normalize(s28DepthGradient(p));}');
    changed = replaceFunction(changed, 'vec3', 'torsoDepthGrad', 'vec3 torsoDepthGrad(vec3 p){return s28DepthGradient(p);}');
  }
  return changed;
}

const limitSource = guard.slice(guard.indexOf('const limits: Record<string, [number, number]> = {'));
const limits = [...limitSource.slice(0, limitSource.indexOf('};')).matchAll(/(FRAG_\w+): \[([\d_]+), ([\d_]+)\]/g)].map((m) => ({
  name: m[1],
  tokens: Number(m[2].replaceAll('_', '')),
  branches: Number(m[3].replaceAll('_', '')),
}));
if (limits.length !== 8) throw new Error('Se requieren los ocho techos vigentes');
const js = transpileModule(
  helpers + `\nJSON.stringify([expandedTokens(glslCallGraph(source),'main'),expandedBranches(glslCallGraph(source),'main')])`,
  { compilerOptions: { target: ScriptTarget.ES2022 } },
).outputText;
function measure(source: string): [number, number] {
  const v: unknown = runInNewContext(js, { source }, { timeout: 10000 });
  if (typeof v !== 'string') throw new Error('Medida inválida');
  const a: unknown = JSON.parse(v);
  if (!Array.isArray(a) || a.length !== 2 || !a.every((x: unknown) => typeof x === 'number')) throw new Error('Recuento inválido');
  return [Number(a[0]), Number(a[1])];
}
const slotHelpers = guard.slice(guard.indexOf('function uniformSlots('), guard.indexOf('/** Samplers que declara'));
const slotJs = transpileModule(slotHelpers + '\nJSON.stringify(uniformSlots(source))', {
  compilerOptions: { target: ScriptTarget.ES2022 },
}).outputText;
function slots(source: string): number {
  const result: unknown = JSON.parse(String(runInNewContext(slotJs, { source }, { timeout: 10000 })));
  if (!result || typeof result !== 'object' || !('slots' in result) || typeof result.slots !== 'number') throw new Error('Slots inválidos');
  return result.slots;
}
const samplers = (source: string) =>
  [...source.replace(/\/\/.*$/gm, '').matchAll(/\buniform\s+(?:(?:lowp|mediump|highp)\s+)?\w*sampler\w*\s+(\w+)/g)].map((m) => m[1]);
const rows = limits.map((limit) => {
  const source = Object.entries(PASSES).find(([name]) => name === limit.name)?.[1];
  if (typeof source !== 'string') throw new Error('Programa ausente');
  const changed = candidate(source),
    baseline = measure(source),
    direct = measure(changed);
  writeFileSync(resolve(out, limit.name + '-baseline.glsl'), source);
  writeFileSync(resolve(out, limit.name + '-direct.glsl'), changed);
  return {
    ...limit,
    baseline,
    direct,
    pass: direct[0] <= limit.tokens && direct[1] <= limit.branches && samplers(changed).length <= 16 && slots(changed) <= 179,
    samplers: samplers(changed),
    uniformSlots: slots(changed),
    baselineSha256: hash(source),
    directSha256: hash(changed),
  };
});
writeFileSync(
  resolve(out, 'direct-descriptors.json'),
  JSON.stringify({ names, fields, abdomenDimensions: abdomen.dimensions, thoraxDimensions: thorax.dimensions }, null, 2) + '\n',
);
const result = {
  helperSha256: hash(helpers),
  limitsFileSha256: hash(guard),
  fieldTableRows: 20,
  abdomenQueryIterations: 4,
  rows,
  textureReadsPerQuery: {
    baseline: { hardwareLinear: 1, nearest: 1, extraPreciseBone: 8 },
    direct: { hardwareLinear: 1, nearest: 1, extraPreciseBone: 8, extraNearestGasPerDigestiveClassification: 1 },
    depth: { hardwareLinear: 1, gradient: 6, samplersAdded: 0 },
  },
  exclusions: [
    's0028 classifier, organs currently not selected',
    'fine annotations; skin and probeFrame stay CPU',
    'legacy procedural organs remain; disc slot aliases sacrum for cost only',
    'gas identity uses exact nodal nearest bit; boundary distance still legacy plane, not accepted anatomy',
  ],
  runtimeInstalled: false,
};
writeFileSync(resolve(out, 'shader-cost.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
if (rows.some((row) => !row.pass)) process.exitCode = 1;
