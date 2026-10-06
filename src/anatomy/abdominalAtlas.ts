import type { Vec3 } from '../core/vec3';
import { ABDOMINAL_ATLAS, ABDOMINAL_FIELDS } from './abdominalAtlasData';

/** Half-float source data shared by CPU, GPU and 3D. Never resize an individual organ. */
export let abdominalAtlas: Uint16Array | undefined;
const HALF = Float32Array.from({ length: 65536 }, (_, bits) => {
  const sign = bits & 0x8000 ? -1 : 1,
    exponent = (bits >>> 10) & 31,
    mantissa = bits & 1023;
  return (
    sign *
    (exponent === 0 ? mantissa * 2 ** -24 : exponent === 31 ? (mantissa ? NaN : Infinity) : (1 + mantissa / 1024) * 2 ** (exponent - 15))
  );
});

export function setAbdominalAtlas(values?: Uint16Array): void {
  if (values && values.byteLength !== ABDOMINAL_ATLAS.rawBytes) throw new Error('Tamaño del atlas abdominal inválido');
  abdominalAtlas = values;
}

export function abdominalAtlasValue(p: Vec3, field: number): { d: number; label: number } {
  const data = abdominalAtlas,
    f = ABDOMINAL_FIELDS[field];
  if (!data || !f) return { d: 16, label: 0 };
  const q = p.map((v, i) => (v - f.originMm[i]) / f.pitchMm);
  if (q.some((v, i) => v < 0 || v > f.dimensions[i] - 1)) return { d: 16, label: 0 };
  const a = q.map((v, i) => Math.min(f.dimensions[i] - 2, Math.floor(v))),
    t = q.map((v, i) => v - a[i]);
  const [w, h] = ABDOMINAL_ATLAS.textureDimensions;
  const index = (x: number, y: number, z: number) => 2 * ((z + f.offset[2]) * w * h + (y + f.offset[1]) * w + x + f.offset[0]);
  let d = 0;
  for (let z = 0; z <= 1; z++)
    for (let y = 0; y <= 1; y++)
      for (let x = 0; x <= 1; x++)
        d += HALF[data[index(a[0] + x, a[1] + y, a[2] + z)]] * (x ? t[0] : 1 - t[0]) * (y ? t[1] : 1 - t[1]) * (z ? t[2] : 1 - t[2]);
  return { d, label: HALF[data[index(...(q.map(Math.round) as Vec3)) + 1]] };
}

export function abdominalAtlasSdf(p: Vec3, field: number): number {
  return abdominalAtlasValue(p, field).d;
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
// Labels are categorical metadata;  nearest texel, never interpolated.
// Trilinear distance interpolation uses explicit source texels for CPU/GPU parity.
vec2 abdominalAtlasValue(vec3 p, int k){
  if(uAbdominalAtlasEnabled==0)return vec2(16.0,0.0); 
  vec3 lo,dim,off; 
  ${ABDOMINAL_FIELDS.map((f, i) => `${i ? 'else ' : ''}if(k==${i}){lo=vec3(${f.originMm.map((v) => v.toFixed(3)).join(',')}); dim=vec3(${f.dimensions.map((v) => v.toFixed(1)).join(',')}); off=vec3(${f.offset.map((v) => v.toFixed(1)).join(',')}); }`).join('\n')}
  else return vec2(16.0,0.0); 
  vec3 q=(p-lo)/1.5; 
  if(any(lessThan(q,vec3(0.0)))||any(greaterThan(q,dim-1.0)))return vec2(16.0,0.0); 
  vec3 base=min(dim-2.0,floor(q)),t=q-base; 
  ivec3 a=ivec3(off+base); 
  float d=0.0; 
  for(int z=0; z<=1; z++)for(int y=0; y<=1; y++)for(int x=0; x<=1; x++){
    vec3 weight=mix(1.0-t,t,vec3(float(x),float(y),float(z))); 
    d+=texelFetch(uAbdominalAtlas,a+ivec3(x,y,z),0).r*weight.x*weight.y*weight.z; 
  }
  float label=texelFetch(uAbdominalAtlas,ivec3(off+floor(q+0.5)),0).g; 
  return vec2(d,label); 
}
float abdominalAtlasSdf(vec3 p, int k){return abdominalAtlasValue(p,k).x; }
vec3 abdominalAtlasGradient(vec3 p, int k){
  vec2 h=vec2(0.25,0.0); 
  return vec3(abdominalAtlasSdf(p+h.xyy,k)-abdominalAtlasSdf(p-h.xyy,k),abdominalAtlasSdf(p+h.yxy,k)-abdominalAtlasSdf(p-h.yxy,k),abdominalAtlasSdf(p+h.yyx,k)-abdominalAtlasSdf(p-h.yyx,k))/0.5; 
}
`;
