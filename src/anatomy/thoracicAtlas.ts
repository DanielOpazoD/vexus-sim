import type { Vec3 } from '../core/vec3';
import { sourceDistance, sourceLabel } from './sourceVolume';
import { THORACIC_ATLAS as F } from './thoracicAtlasData';
export let thoracicAtlas: Uint16Array | undefined;
const VOLUME = { originMm: F.originMm, dimensions: F.textureDimensions, offset: [0, 0, 0], pitchMm: F.pitchMm } as const;
export function setThoracicAtlas(data?: Uint16Array): void {
  if (data && data.byteLength !== F.rawBytes) throw new Error('Campo torácico incompleto');
  thoracicAtlas = data;
}
export function thoracicValue(p: Vec3): { d: number; label: number } {
  if (!thoracicAtlas) return { d: 16, label: 0 };
  return {
    d: sourceDistance(thoracicAtlas, p, VOLUME, F.textureDimensions),
    label: sourceLabel(thoracicAtlas, p, VOLUME, F.textureDimensions),
  };
}
export const thoracicSdf = (p: Vec3): number => (thoracicAtlas ? sourceDistance(thoracicAtlas, p, VOLUME, F.textureDimensions) : 16);
export const thoracicMaterial = (label: number): string | undefined => ['bone', 'cartilage', 'vertebra'][F.materials[label] ?? -1];
export function thoracicGradient(p: Vec3): Vec3 {
  return [0, 1, 2].map((i) => {
    const a: Vec3 = [...p],
      b: Vec3 = [...p];
    a[i] += 0.25;
    b[i] -= 0.25;
    return (thoracicSdf(a) - thoracicSdf(b)) / 0.5;
  }) as Vec3;
}
/** Local principal directions of the same field; resolution remains 1.5 mm. */
export function thoracicFrame(p: Vec3): { axis: Vec3; curvature: number } {
  const g = thoracicGradient(p),
    norm = Math.hypot(...g),
    n = g.map((v) => v / (norm || 1)) as Vec3;
  if (norm < 1e-6) return { axis: [0, 0, 1], curvature: 0 };
  const u: Vec3 = Math.abs(n[2]) < 0.9 ? [-n[1], n[0], 0] : [0, -n[2], n[1]];
  const l = Math.hypot(...u);
  u.forEach((v, i) => (u[i] = v / (l || 1)));
  const v: Vec3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const h = 2 * F.pitchMm,
    at = (a: number, b: number) => thoracicSdf(p.map((x, i) => x + h * (a * u[i] + b * v[i])) as Vec3),
    d = at(0, 0);
  const a = (at(1, 0) + at(-1, 0) - 2 * d) / (h * h),
    c = (at(0, 1) + at(0, -1) - 2 * d) / (h * h),
    b = (at(1, 1) - at(1, -1) - at(-1, 1) + at(-1, -1)) / (4 * h * h);
  const theta = 0.5 * Math.atan2(2 * b, a - c),
    co = Math.cos(theta),
    si = Math.sin(theta);
  const hi = 0.5 * (a + c + Math.hypot(a - c, 2 * b)),
    lo = 0.5 * (a + c - Math.hypot(a - c, 2 * b)),
    high = Math.abs(hi) < Math.abs(lo);
  return {
    axis: u.map((x, i) => (high ? co * x + si * v[i] : -si * x + co * v[i])) as Vec3,
    curvature: Math.max(Math.abs(lo), Math.abs(hi)) / (norm || 1),
  };
}
const vec = (a: readonly number[]) => a.map((v) => v.toFixed(3)).join(',');
export const THORACIC_GLSL = /* glsl */ `
vec2 thoracicValue(vec3 p) {
  if (uAbdominalAtlasEnabled == 0) return vec2(16.0, 0.0);
  vec3 q=(p-vec3(${vec(F.originMm)}))/${F.pitchMm.toFixed(1)};
  if(any(lessThan(q,vec3(0.0)))||any(greaterThan(q,vec3(${vec(F.textureDimensions.map((v) => v - 1))}))))return vec2(16.0,0.0);
  return vec2(textureLod(uThoracicAtlas,(q+0.5)/vec3(${vec(F.textureDimensions)}),0.0).r,texelFetch(uThoracicAtlas,ivec3(floor(q+0.5)),0).g);
}
float thoracicSdf(vec3 p) { return thoracicValue(p).x; }
const int THORACIC_MATERIALS[${F.materials.length}]=int[${F.materials.length}](${F.materials.join(',')});
int thoracicMaterial(float label){return THORACIC_MATERIALS[clamp(int(label+.5),0,${F.materials.length - 1})];}

vec3 thoracicGradient(vec3 p){vec2 h=vec2(.25,0);return vec3(thoracicSdf(p+h.xyy)-thoracicSdf(p-h.xyy),thoracicSdf(p+h.yxy)-thoracicSdf(p-h.yxy),thoracicSdf(p+h.yyx)-thoracicSdf(p-h.yyx))/.5;}
void thoracicFrame(vec3 p,out vec3 axis,out float curvature){
  vec3 g=thoracicGradient(p);float gn=length(g);if(gn<1e-6){axis=vec3(0,0,1);curvature=0.0;return;}vec3 n=g/gn;
  vec3 u=abs(n.z)<.9?vec3(-n.y,n.x,0):vec3(0,-n.z,n.y);u/=max(length(u),1e-6);vec3 v=cross(n,u);float h=${(2 * F.pitchMm).toFixed(1)};vec3 U=h*u,V=h*v;float d=thoracicSdf(p);
  float a=(thoracicSdf(p+U)+thoracicSdf(p-U)-2.0*d)/(h*h),c=(thoracicSdf(p+V)+thoracicSdf(p-V)-2.0*d)/(h*h),b=(thoracicSdf(p+U+V)-thoracicSdf(p+U-V)-thoracicSdf(p-U+V)+thoracicSdf(p-U-V))/(4.0*h*h);
  float theta=.5*atan(2.0*b,a-c),co=cos(theta),si=sin(theta),hi=.5*(a+c+length(vec2(a-c,2.0*b))),lo=.5*(a+c-length(vec2(a-c,2.0*b)));
  axis=abs(hi)<abs(lo)?co*u+si*v:-si*u+co*v;curvature=max(abs(lo),abs(hi))/gn;
}
`;
