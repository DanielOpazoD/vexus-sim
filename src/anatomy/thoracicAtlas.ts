import { THORACIC_ATLAS as F } from './thoracicAtlasData';
export { boneSurfaceFrame } from './boneSurfaceFrame';
const vec = (a: readonly number[]) => a.map((v) => v.toFixed(3)).join(',');
/** Lado GLSL de un par TS/GLSL (`tools/twins/registry.ts`). @twin atlas-toracico */
export const THORACIC_GLSL = /* glsl */ `
vec2 thoracicValue(vec3 p) {
  if (uAbdominalAtlasEnabled == 0) return vec2(16.0, 0.0);
  vec3 q=(p-vec3(${vec(F.originMm)}))/${F.pitchMm.toFixed(1)};
  if(any(lessThan(q,vec3(0.0)))||any(greaterThan(q,vec3(${vec(F.textureDimensions.map((v) => v - 1))}))))return vec2(16.0,0.0);
  float d=textureLod(uThoracicAtlas,(q+0.5)/vec3(${vec(F.textureDimensions)}),0.0).r;
  // Una celda contiene la cortical y sus diferencias de 0,02 mm: evita
  // amplificar la cuantización del filtro fijo en la norma del gradiente (223).
  if(abs(d)<${F.pitchMm.toFixed(1)})d=sourceDistancePrecise(uThoracicAtlas,q,ivec3(${F.textureDimensions.join(',')}),ivec3(0));
  return vec2(d,texelFetch(uThoracicAtlas,ivec3(floor(q+0.5)),0).g);
}
float thoracicSdf(vec3 p) { return thoracicValue(p).x; }
const int THORACIC_MATERIALS[${F.materials.length}]=int[${F.materials.length}](${F.materials.join(',')});
int thoracicMaterial(float label){return THORACIC_MATERIALS[clamp(int(label+.5),0,${F.materials.length - 1})];}

vec3 thoracicGradient(vec3 p){vec2 h=vec2(.25,0);return vec3(thoracicSdf(p+h.xyy)-thoracicSdf(p-h.xyy),thoracicSdf(p+h.yxy)-thoracicSdf(p-h.yxy),thoracicSdf(p+h.yyx)-thoracicSdf(p-h.yyx))/.5;}
float spineBodySd(vec3 m);
float boneFrameDistance(vec3 p,bool spine){return spine?spineBodySd(p):thoracicSdf(p);}
void boneSurfaceFrame(vec3 p,bool spine,out vec3 axis,out float curvature){
  vec2 e=vec2(.25,0);vec3 g=vec3(boneFrameDistance(p+e.xyy,spine)-boneFrameDistance(p-e.xyy,spine),boneFrameDistance(p+e.yxy,spine)-boneFrameDistance(p-e.yxy,spine),boneFrameDistance(p+e.yyx,spine)-boneFrameDistance(p-e.yyx,spine))/.5;
  float gn=length(g);if(gn<1e-6){axis=vec3(0,0,1);curvature=0.0;return;}vec3 n=g/gn;
  vec3 u=abs(n.z)<.9?vec3(-n.y,n.x,0):vec3(0,-n.z,n.y);u/=max(length(u),1e-6);vec3 v=cross(n,u);float h=${(2 * F.pitchMm).toFixed(1)};vec3 U=h*u,V=h*v;float d=boneFrameDistance(p,spine);
  float a=(boneFrameDistance(p+U,spine)+boneFrameDistance(p-U,spine)-2.0*d)/(h*h),c=(boneFrameDistance(p+V,spine)+boneFrameDistance(p-V,spine)-2.0*d)/(h*h),b=(boneFrameDistance(p+U+V,spine)-boneFrameDistance(p+U-V,spine)-boneFrameDistance(p-U+V,spine)+boneFrameDistance(p-U-V,spine))/(4.0*h*h);
  float theta=.5*atan(2.0*b,a-c),co=cos(theta),si=sin(theta),hi=.5*(a+c+length(vec2(a-c,2.0*b))),lo=.5*(a+c-length(vec2(a-c,2.0*b)));
  axis=abs(hi)<abs(lo)?co*u+si*v:-si*u+co*v;curvature=max(abs(lo),abs(hi))/gn;
}
void thoracicFrame(vec3 p,out vec3 axis,out float curvature){boneSurfaceFrame(p,false,axis,curvature);}
`;
