import { ABDOMINAL_FIELDS } from '../abdominalAtlasData';
import type { PersonDescriptors } from '../anatomyBundle';
import { s0028WallShader } from './s0028Wall.glsl';
import { S0028_READER_GLSL } from './s0028Solids.glsl';

/**
 * Una fuente por persona: la de la persona por defecto, intacta, o la de s0028 con sus lectores P1 (atlas abdominal y
 * torácico, gas, piel), la pared P2 y los sólidos P3 (`s0028WallShader`).
 * @twin tronco-primitivas
 * @twin atlas-abdominal
 * @twin atlas-toracico
 * @twin organo-abdomen
 * @twin s0028-lector
 */
export function personShader(source: string, selection: { person: 'current' } | { person: 's0028'; bundle: PersonDescriptors }): string {
  if (selection.person === 'current' || !/vec2\s+abdominalAtlasValue\s*\(/.test(source)) return source;
  const { fields, depth } = selection.bundle;
  const field = (name: string, asset: 'abdominal' | 'thoracic') => {
    const found = fields.find((f) => f.name === name);
    if (!found || found.asset !== asset || found.pitchMm !== 1.5) throw new Error('Falta campo B o procedencia: ' + name);
    return found;
  };
  const unknown = { originMm: [0, 0, 0], dimensions: [0, 0, 0], offset: [0, 0, 0] };
  const abdominal = ABDOMINAL_FIELDS.map((f) => (['psoas', 'lumbarDiscs'].includes(f.name) ? unknown : field(f.name, 'abdominal')));
  const bone = field('thoracicBone', 'thoracic');
  field('digestiveTract', 'abdominal');
  if (depth.pitchMm !== 3) throw new Error('Pitch de profundidad distinto');
  const vec = (v: readonly number[]): string => `vec3(${v.map((n) => n.toFixed(15)).join(',')})`;
  const tables = (['originMm', 'dimensions', 'offset'] as const)
    .map(
      (key, i) => `const vec3 S28_${['LO', 'DIM', 'OFF'][i]}[${abdominal.length}]=vec3[](${abdominal.map((f) => vec(f[key])).join(',')});`,
    )
    .join('\n');
  const reader = `
${tables}
vec2 abdominalAtlasValue(vec3 p,int k){
  if(uAbdominalAtlasEnabled==0||k<0||k>=${abdominal.length})return vec2(16.0,0.0);
  vec3 dim=S28_DIM[k],off=S28_OFF[k],q=(p-S28_LO[k])/1.5;
  if(any(lessThan(q,vec3(0.0)))||any(greaterThan(q,dim-1.0)))return vec2(16.0,0.0);
  float d=textureLod(uAbdominalAtlas,(off+q+0.5)/vec3(textureSize(uAbdominalAtlas,0)),0.0).r;
  if(k==8&&abs(d)<1.5)d=sourceDistancePrecise(uAbdominalAtlas,q,ivec3(dim),ivec3(off));
  float label=texelFetch(uAbdominalAtlas,ivec3(off+floor(q+0.5)),0).g;
  return vec2(d,mod(label,128.0));
}
float s28Gas(vec3 p){
  vec3 q=(p-S28_LO[1])/1.5;
  if(any(lessThan(q,vec3(0.0)))||any(greaterThan(q,S28_DIM[1]-1.0)))return 0.0;
  return texelFetch(uAbdominalAtlas,ivec3(S28_OFF[1]+floor(q+0.5)),0).g>=128.0?1.0:0.0;
}
vec2 thoracicValue(vec3 p){
  if(uAbdominalAtlasEnabled==0)return vec2(16.0,0.0);
  vec3 q=(p-${vec(bone.originMm)})/1.5;
  if(any(lessThan(q,vec3(0.0)))||any(greaterThan(q,${vec(bone.dimensions.map((n) => n - 1))})))return vec2(16.0,0.0);
  float d=textureLod(uThoracicAtlas,(${vec(bone.offset)}+q+0.5)/vec3(textureSize(uThoracicAtlas,0)),0.0).r;
  if(abs(d)<1.5)d=sourceDistancePrecise(uThoracicAtlas,q,ivec3(${bone.dimensions.join(',')}),ivec3(${bone.offset.join(',')}));
  return vec2(d,texelFetch(uThoracicAtlas,ivec3(${vec(bone.offset)}+floor(q+0.5)),0).g);
}
`;
  let changed = source.replace(/const\s+vec3\s+ATLAS_(LO|DIM|OFF)\[\d+\]\s*=\s*vec3\[\]\([^;]+;/g, '');
  changed = replaceFunction(changed, 'vec2', 'abdominalAtlasValue', '');
  changed = replaceFunction(changed, 'vec2', 'thoracicValue', reader);
  changed = replaceFunction(changed, 'vec4', 'registeredDomeSample', 'vec4 registeredDomeSample(vec2 p){return vec4(0.0);}');
  changed = replaceFunction(changed, 'vec2', 'hepaticDomeValue', 'vec2 hepaticDomeValue(vec2 p){return vec2(0.0);}');
  changed = replaceFunction(
    changed,
    'float',
    'torsoDepth',
    `float torsoDepth(vec3 p){
    vec3 q=(p-${vec(depth.originMm)})/3.0;
    vec3 at=clamp(q,vec3(0.0),${vec(depth.dimensions.map((n) => n - 1))});
    return textureLod(uAbdominalAtlas,(${vec(depth.offset)}+at+0.5)/vec3(textureSize(uAbdominalAtlas,0)),0.0).r+length(q-at)*3.0;
  }`,
  );
  changed = replaceFunction(
    changed,
    'vec3',
    'torsoNormal',
    `vec3 s28DepthGradient(vec3 p){vec2 e=vec2(1.5,0.0);
    return vec3(torsoDepth(p+e.xyy)-torsoDepth(p-e.xyy),torsoDepth(p+e.yxy)-torsoDepth(p-e.yxy),torsoDepth(p+e.yyx)-torsoDepth(p-e.yyx))/3.0;
  }
  vec3 torsoNormal(vec3 p){return normalize(s28DepthGradient(p));}`,
  );
  changed = replaceFunction(changed, 'vec3', 'torsoDepthGrad', 'vec3 torsoDepthGrad(vec3 p){return s28DepthGradient(p);}');
  changed = changed.replace(
    /bool\s+gas\s*=\s*inner\s*<\s*0\.0\s*&&\s*digestiveGasPlane\(m,label\)\s*>\s*0\.0;/,
    'bool gas=inner<0.0&&s28Gas(m)>0.5;',
  );
  changed = changed.replace(
    /const int THORACIC_MATERIALS\[\d+\]\s*=\s*int\[\d+\]\([^;]+;/,
    `const int THORACIC_MATERIALS[38]=int[38](${Array.from({ length: 38 }, (_, i) => (i >= 25 && i <= 36 ? 2 : 0)).join(',')});`,
  );
  changed = replaceFunction(
    changed,
    'int',
    'thoracicMaterial',
    'int thoracicMaterial(float label){return THORACIC_MATERIALS[clamp(int(label+.5),0,37)];}',
  );
  changed = replaceFunction(
    changed,
    'float',
    'digestiveWallMm',
    'float digestiveWallMm(float label){return label==1.0?3.0:label==4.0?2.5:2.0;}',
  );
  changed = replaceFunction(
    changed,
    'float',
    'digestiveGasPlane',
    'float digestiveGasPlane(vec3 m,float label){return s28Gas(m)>0.5?1.0:-1.0;}',
  );
  changed = changed.replace(/label\s*>=\s*5\.0\s*&&\s*label\s*<=\s*9\.0/g, 'label==4.0');
  // Lectores P1 de P3 (r3), antes de la pared y de la clasificación que los usan.
  changed = changed.replace('float respWeight(vec3 m)', S0028_READER_GLSL + '\nfloat respWeight(vec3 m)');
  return s0028WallShader(changed, replaceFunction);
}

function replaceFunction(source: string, type: string, name: string, replacement: string): string {
  const at = source.search(new RegExp('\\b' + type + '\\s+' + name + '\\s*\\('));
  if (at < 0) throw new Error('Falta función GLSL ' + name);
  // Las declaraciones adelantadas pueden preceder a la definición.
  const brace = source.indexOf('{', at);
  const semicolon = source.indexOf(';', at);
  if (semicolon >= 0 && semicolon < brace) {
    const prefix = source.slice(0, semicolon + 1);
    return prefix + replaceFunction(source.slice(semicolon + 1), type, name, replacement);
  }
  let i = brace + 1,
    depth = 1;
  for (; depth && i < source.length; i++) depth += source[i] === '{' ? 1 : source[i] === '}' ? -1 : 0;
  if (brace < 0 || depth) throw new Error('Función GLSL sin cerrar: ' + name);
  return source.slice(0, at) + replacement + source.slice(i);
}
