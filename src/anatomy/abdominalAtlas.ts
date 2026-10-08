import type { Vec3 } from '../core/vec3';
import { ABDOMINAL_ATLAS, ABDOMINAL_FIELDS, HEPATIC_DOME, REGISTERED_DOME } from './abdominalAtlasData';
import { HALF } from './halfFloat';
import { sourceDistance, sourceLabel } from './sourceVolume';
export { HALF } from './halfFloat';

/** Half-float source data shared by CPU, GPU and 3D. Never resize an individual organ. */
export let abdominalAtlas: Uint16Array | undefined;

export function setAbdominalAtlas(values?: Uint16Array): void {
  if (values && values.byteLength !== ABDOMINAL_ATLAS.rawBytes) throw new Error('Tamaño del atlas abdominal inválido');
  abdominalAtlas = values;
}

export function abdominalAtlasValue(p: Vec3, field: number): { d: number; label: number } {
  const data = abdominalAtlas,
    f = ABDOMINAL_FIELDS[field];
  if (!data || !f) return { d: 16, label: 0 };
  return {
    d: sourceDistance(data, p, f, ABDOMINAL_ATLAS.textureDimensions),
    label: sourceLabel(data, p, f, ABDOMINAL_ATLAS.textureDimensions),
  };
}

export function abdominalAtlasSdf(p: Vec3, field: number): number {
  const f = ABDOMINAL_FIELDS[field];
  return abdominalAtlas && f ? sourceDistance(abdominalAtlas, p, f, ABDOMINAL_ATLAS.textureDimensions) : 16;
}

/** Upper-source roof approximation, including the same hepatic contact. Not crura or hiatal openings. */
export function registeredDomeHeight(x: number, y: number): number | undefined {
  const data = abdominalAtlas,
    f = REGISTERED_DOME,
    qx = (x - f.originMm[0]) / f.pitchMm,
    qy = (y - f.originMm[1]) / f.pitchMm;
  if (!data || qx < 0 || qy < 0 || qx > f.dimensions[0] - 1 || qy > f.dimensions[1] - 1) return undefined;
  const ix = Math.min(f.dimensions[0] - 2, Math.floor(qx)),
    iy = Math.min(f.dimensions[1] - 2, Math.floor(qy)),
    tx = qx - ix,
    ty = qy - iy,
    [w, h] = ABDOMINAL_ATLAS.textureDimensions,
    // XY is transposed in the free plane; organ bricks and contact support are unchanged.
    k = 2 * (f.offset[2] * w * h + (f.offset[1] + ix) * w + f.offset[0] + iy),
    a = HALF[data[k]] + ty * (HALF[data[k + 2]] - HALF[data[k]]),
    b = HALF[data[k + 2 * w]] + ty * (HALF[data[k + 2 * w + 2]] - HALF[data[k + 2 * w]]);
  return a + tx * (b - a);
}

/** CPU twin of GLSL's height/validity query; scalar callers avoid the result allocation. */
export function registeredDomeValue(x: number, y: number): [number, number] {
  const height = registeredDomeHeight(x, y);
  return height === undefined ? [0, 0] : [height, 1];
}

/** Estimated hepatic contact surface, sampled in material coordinates like the organs. */
export function hepaticDomeValue(x: number, y: number): [number, number] {
  const data = abdominalAtlas,
    f = HEPATIC_DOME,
    q = [(x - f.originMm[0]) / f.pitchMm, (y - f.originMm[1]) / f.pitchMm];
  if (!data || q.some((v, i) => v < 0 || v > f.dimensions[i] - 1)) return [0, 0];
  const a = q.map((v, i) => Math.min(f.dimensions[i] - 2, Math.floor(v))),
    t = q.map((v, i) => v - a[i]),
    [w, h] = ABDOMINAL_ATLAS.textureDimensions,
    result: [number, number] = [0, 0];
  for (let j = 0; j <= 1; j++)
    for (let i = 0; i <= 1; i++) {
      const k = 2 * (f.offset[2] * w * h + (f.offset[1] + a[1] + j) * w + f.offset[0] + a[0] + i),
        weight = (i ? t[0] : 1 - t[0]) * (j ? t[1] : 1 - t[1]);
      result[0] += HALF[data[k]] * weight;
      result[1] += HALF[data[k + 1]] * weight;
    }
  return result;
}

/** The gradient of the SAME interpolated distance. Subvoxel offsets do not add source resolution. */
export function abdominalAtlasGradient(p: Vec3, field: number): Vec3 {
  const h = 0.25;
  return [0, 1, 2].map((i) => {
    const a: Vec3 = [...p],
      b: Vec3 = [...p];
    a[i] += h;
    b[i] -= h;
    return (abdominalAtlasSdf(a, field) - abdominalAtlasSdf(b, field)) / (2 * h);
  }) as Vec3;
}

export const ABDOMINAL_ATLAS_GLSL = /* glsl */ `
vec2 registeredDomeValue(vec2 p){
  if(uAbdominalAtlasEnabled==0)return vec2(0.0);
  vec2 q=(p-vec2(${REGISTERED_DOME.originMm.join(',')}))/${REGISTERED_DOME.pitchMm.toFixed(1)};
  if(any(lessThan(q,vec2(0.0)))||any(greaterThan(q,vec2(${REGISTERED_DOME.dimensions.map((v) => (v - 1).toFixed(1)).join(',')}))))return vec2(0.0);
  // Hardware filtering quantizes fractional texel weights. The nested 0.5 mm
  // slope and 0.02 mm face differences amplify that error on steep source roofs.
  // Interpolate the SAME four half-float heights in full shader precision,
  // matching the scalar CPU ordering; source resolution and geometry stay fixed.
  ivec2 a=min(ivec2(floor(q)),ivec2(${REGISTERED_DOME.dimensions.map((v) => v - 2).join(',')}));
  vec2 t=q-vec2(a);
  ivec3 k=ivec3(a.yx,0)+ivec3(${REGISTERED_DOME.offset.join(',')});
  float h00=texelFetch(uAbdominalAtlas,k,0).r;
  float h01=texelFetch(uAbdominalAtlas,k+ivec3(1,0,0),0).r;
  float h10=texelFetch(uAbdominalAtlas,k+ivec3(0,1,0),0).r;
  float h11=texelFetch(uAbdominalAtlas,k+ivec3(1,1,0),0).r;
  float row0=h00+t.y*(h01-h00),row1=h10+t.y*(h11-h10);
  return vec2(row0+t.x*(row1-row0),1.0);
}
vec2 hepaticDomeValue(vec2 p){
  if(uAbdominalAtlasEnabled==0)return vec2(0.0);
  vec2 q=(p-vec2(${HEPATIC_DOME.originMm.join(',')}))/${HEPATIC_DOME.pitchMm.toFixed(1)};
  if(any(lessThan(q,vec2(0.0)))||any(greaterThan(q,vec2(${HEPATIC_DOME.dimensions.map((v) => (v - 1).toFixed(1)).join(',')}))))return vec2(0.0);
  return textureLod(uAbdominalAtlas,(vec3(q,0.0)+vec3(${HEPATIC_DOME.offset.map((v) => v.toFixed(1)).join(',')})+0.5)/vec3(${ABDOMINAL_ATLAS.textureDimensions.map((v) => v.toFixed(1)).join(',')}),0.0).rg;
}
// Labels are categorical metadata;  nearest texel, never interpolated.
// Distance uses WebGL2 RG16F linear filtering of the same source lattice; categorical labels stay nearest.
vec2 abdominalAtlasValue(vec3 p, int k){
  if(uAbdominalAtlasEnabled==0)return vec2(16.0,0.0); 
  vec3 lo,dim,off; 
  ${ABDOMINAL_FIELDS.map((f, i) => `${i ? 'else ' : ''}if(k==${i}){lo=vec3(${f.originMm.map((v) => v.toFixed(3)).join(',')}); dim=vec3(${f.dimensions.map((v) => v.toFixed(1)).join(',')}); off=vec3(${f.offset.map((v) => v.toFixed(1)).join(',')}); }`).join('\n')}
  else return vec2(16.0,0.0); 
  vec3 q=(p-lo)/1.5; 
  if(any(lessThan(q,vec3(0.0)))||any(greaterThan(q,dim-1.0)))return vec2(16.0,0.0); 
  // Normalized texel-center coordinates; linear filtering stays inside the selected brick.
  float d=textureLod(uAbdominalAtlas,(off+q+0.5)/vec3(${ABDOMINAL_ATLAS.textureDimensions.map((v) => v.toFixed(1)).join(',')}),0.0).r;
  float label=texelFetch(uAbdominalAtlas,ivec3(off+floor(q+0.5)),0).g; 
  return vec2(d,label); 
}
float abdominalAtlasSdf(vec3 p, int k){return abdominalAtlasValue(p,k).x; }
vec3 abdominalAtlasGradient(vec3 p, int k){
  vec2 h=vec2(0.25,0.0); 
  return vec3(abdominalAtlasSdf(p+h.xyy,k)-abdominalAtlasSdf(p-h.xyy,k),abdominalAtlasSdf(p+h.yxy,k)-abdominalAtlasSdf(p-h.yxy,k),abdominalAtlasSdf(p+h.yyx,k)-abdominalAtlasSdf(p-h.yyx,k))/0.5; 
}
`;
