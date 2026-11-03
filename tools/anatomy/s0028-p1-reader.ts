import { ABDOMINAL_FIELDS } from '../../src/anatomy/abdominalAtlasData';
import type { SourceVolume } from '../../src/anatomy/sourceVolume';

export interface S0028Field extends SourceVolume {
  readonly name: string;
  readonly asset: 'abdominal' | 'thoracic';
}
export interface S0028Descriptors {
  readonly fields: readonly S0028Field[];
  readonly depth: SourceVolume;
}

/** Sustitución por persona antes del enlace; el programa vigente no adquiere ramas nuevas.
 * Preflight de carga B: no convierte el clasificador histórico en anatomía s0028.
 */
export function s0028Shader(source: string, bundle: S0028Descriptors): string {
  if (!source.includes('vec2 abdominalAtlasValue(')) return source;
  const fields = bundle.fields;
  const index = (name: string): number => {
    const i = fields.findIndex((f) => f.name === name);
    if (i < 0) throw new Error('Falta campo B: ' + name);
    return i;
  };
  const digestive = index('digestiveTract');
  const bone = index('thoracicBone');
  const legacy = ABDOMINAL_FIELDS.map((f) => fields.findIndex((g) => g.name === f.name));
  const vec = (v: readonly number[]): string => `vec3(${v.map((n) => n.toFixed(15)).join(',')})`;
  const table = (name: string, key: 'originMm' | 'dimensions' | 'offset'): string =>
    `const vec3 ${name}[${fields.length}]=vec3[](${fields.map((f) => vec(f[key])).join(',')});`;
  // La selección de sampler se realiza en la misma consulta. Ni el sampler abdominal
  // puede leer los campos torácicos ni una etiqueta interpolada decide la procedencia.
  const reader = `
${table('S28_LO', 'originMm')}
${table('S28_DIM', 'dimensions')}
${table('S28_OFF', 'offset')}
const int S28_ASSET[${fields.length}]=int[](${fields.map((f) => (f.asset === 'abdominal' ? 0 : 1)).join(',')});
const int S28_PRECISE[${fields.length}]=int[](${fields.map((f) => (['thoracicBone', 'lumbarSacralBone', 'sacrum'].includes(f.name) ? 1 : 0)).join(',')});
const int S28_LEGACY[${legacy.length}]=int[](${legacy.join(',')});
vec2 s28Sample(highp sampler3D field,vec3 p,int k){
  vec3 dim=S28_DIM[k],off=S28_OFF[k],q=(p-S28_LO[k])/1.5;
  if(any(lessThan(q,vec3(0.0)))||any(greaterThan(q,dim-1.0)))return vec2(16.0,0.0);
  float d=textureLod(field,(off+q+0.5)/vec3(textureSize(field,0)),0.0).r;
  if(S28_PRECISE[k]!=0&&abs(d)<1.5)d=sourceDistancePrecise(field,q,ivec3(dim),ivec3(off));
  float label=texelFetch(field,ivec3(off+floor(q+0.5)),0).g;
  return vec2(d,label);
}
vec2 s28Value(vec3 p,int k){
  if(uAbdominalAtlasEnabled==0||k<0||k>=${fields.length})return vec2(16.0,0.0);
  if(S28_ASSET[k]==0)return s28Sample(uAbdominalAtlas,p,k);
  return s28Sample(uThoracicAtlas,p,k);
}
vec2 abdominalAtlasValue(vec3 p,int k){
  if(k<0||k>=${legacy.length})return vec2(16.0,0.0);
  int j=S28_LEGACY[k];if(j<0)return vec2(16.0,0.0);
  vec2 q=s28Value(p,j);return vec2(q.x,mod(q.y,128.0));
}
float s28Gas(vec3 p){return s28Value(p,${digestive}).y>=128.0?1.0:0.0;}
`;
  let changed = source.replace(/const vec3 ATLAS_(LO|DIM|OFF)\[\d+\]=vec3\[\]\([^;]+;/g, '');
  changed = replaceFunction(changed, 'vec2', 'abdominalAtlasValue', '');
  changed = replaceFunction(changed, 'vec2', 'thoracicValue', reader + `\nvec2 thoracicValue(vec3 p){return s28Value(p,${bone});}`);
  const depth = bundle.depth;
  const depthReader = `float torsoDepth(vec3 p){
    vec3 q=(p-${vec(depth.originMm)})/3.0;
    vec3 at=clamp(q,vec3(0.0),${vec(depth.dimensions.map((n) => n - 1))});
    return textureLod(uAbdominalAtlas,(${vec(depth.offset)}+at+0.5)/vec3(textureSize(uAbdominalAtlas,0)),0.0).r+length(q-at)*3.0;
  }`;
  changed = replaceFunction(changed, 'float', 'torsoDepth', depthReader);
  const gradient = `vec3 s28DepthGradient(vec3 p){vec2 e=vec2(1.5,0.0);
    return vec3(torsoDepth(p+e.xyy)-torsoDepth(p-e.xyy),torsoDepth(p+e.yxy)-torsoDepth(p-e.yxy),torsoDepth(p+e.yyx)-torsoDepth(p-e.yyx))/3.0;
  }`;
  changed = replaceFunction(
    changed,
    'vec3',
    'torsoNormal',
    gradient + '\nvec3 torsoNormal(vec3 p){return normalize(s28DepthGradient(p));}',
  );
  changed = replaceFunction(changed, 'vec3', 'torsoDepthGrad', 'vec3 torsoDepthGrad(vec3 p){return s28DepthGradient(p);}');
  changed = changed.replace('bool gas=inner<0.0&&digestiveGasPlane(m,label)>0.0;', 'bool gas=inner<0.0&&s28Gas(m)>0.5;');
  return changed;
}

function replaceFunction(source: string, type: string, name: string, replacement: string): string {
  const at = source.indexOf(type + ' ' + name + '(');
  if (at < 0) throw new Error('Falta función GLSL ' + name);
  let i = source.indexOf('{', at) + 1;
  let depth = 1;
  for (; depth && i < source.length; i++) depth += source[i] === '{' ? 1 : source[i] === '}' ? -1 : 0;
  if (depth) throw new Error('Función GLSL sin cerrar: ' + name);
  return source.slice(0, at) + replacement + source.slice(i);
}
