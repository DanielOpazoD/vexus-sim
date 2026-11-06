import { ABDOMINAL_ATLAS, ABDOMINAL_FIELDS, HEPATIC_DOME, REGISTERED_DOME, REGISTERED_DOME_GRADIENT } from './abdominalAtlasData';
/** Lado GLSL de un par TS/GLSL (`tools/twins/registry.ts`). @twin atlas-abdominal */
export const ABDOMINAL_ATLAS_GLSL = /* glsl */ `
vec4 registeredDomeSample(vec2 p){
  if(uAbdominalAtlasEnabled==0)return vec4(0.0);
  vec2 q=(p-vec2(${REGISTERED_DOME.originMm.join(',')}))/${REGISTERED_DOME.pitchMm.toFixed(1)};
  if(any(lessThan(q,vec2(0.0)))||any(greaterThan(q,vec2(${REGISTERED_DOME.dimensions.map((v) => (v - 1).toFixed(1)).join(',')}))))return vec4(0.0);
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
  ivec3 g=k+ivec3(0,0,${REGISTERED_DOME_GRADIENT.offset[2] - REGISTERED_DOME.offset[2]});
  vec2 ga=texelFetch(uAbdominalAtlas,g,0).rg;
  vec2 gb=texelFetch(uAbdominalAtlas,g+ivec3(1,0,0),0).rg;
  vec2 gc=texelFetch(uAbdominalAtlas,g+ivec3(0,1,0),0).rg;
  vec2 gd=texelFetch(uAbdominalAtlas,g+ivec3(1,1,0),0).rg;
  vec2 g0=ga+t.y*(gb-ga),g1=gc+t.y*(gd-gc);
  return vec4(row0+t.x*(row1-row0),g0+t.x*(g1-g0),1.0);
}
vec2 registeredDomeValue(vec2 p){
  return registeredDomeSample(p).xw;
}
vec2 hepaticDomeValue(vec2 p){
  if(uAbdominalAtlasEnabled==0)return vec2(0.0);
  vec2 q=(p-vec2(${HEPATIC_DOME.originMm.join(',')}))/${HEPATIC_DOME.pitchMm.toFixed(1)};
  if(any(lessThan(q,vec2(0.0)))||any(greaterThan(q,vec2(${HEPATIC_DOME.dimensions.map((v) => (v - 1).toFixed(1)).join(',')}))))return vec2(0.0);
  return textureLod(uAbdominalAtlas,(vec3(q,0.0)+vec3(${HEPATIC_DOME.offset.map((v) => v.toFixed(1)).join(',')})+0.5)/vec3(${ABDOMINAL_ATLAS.textureDimensions.map((v) => v.toFixed(1)).join(',')}),0.0).rg;
}
// Labels are categorical metadata;  nearest texel, never interpolated.
// Distance uses WebGL2 RG16F linear filtering of the same source lattice; categorical labels stay nearest.
const vec3 ATLAS_LO[${ABDOMINAL_FIELDS.length}]=vec3[](${ABDOMINAL_FIELDS.map((f) => `vec3(${f.originMm.map((v) => v.toFixed(3)).join(',')})`).join(',')});
const vec3 ATLAS_DIM[${ABDOMINAL_FIELDS.length}]=vec3[](${ABDOMINAL_FIELDS.map((f) => `vec3(${f.dimensions.map((v) => v.toFixed(1)).join(',')})`).join(',')});
const vec3 ATLAS_OFF[${ABDOMINAL_FIELDS.length}]=vec3[](${ABDOMINAL_FIELDS.map((f) => `vec3(${f.offset.map((v) => v.toFixed(1)).join(',')})`).join(',')});
// Tablas y no una cadena de if: cada consulta con campo variable expandía sus once ramas, y con las del riñón (decisión 309)
// el proceso GPU moría con SwiftShader al compilar la clasificación.
vec2 abdominalAtlasValue(vec3 p, int k){
  if(uAbdominalAtlasEnabled==0||k<0||k>=${ABDOMINAL_FIELDS.length})return vec2(16.0,0.0); 
  vec3 lo=ATLAS_LO[k],dim=ATLAS_DIM[k],off=ATLAS_OFF[k]; 
  vec3 q=(p-lo)/1.5; 
  if(any(lessThan(q,vec3(0.0)))||any(greaterThan(q,dim-1.0)))return vec2(16.0,0.0); 
  // Normalized texel-center coordinates; linear filtering stays inside the selected brick.
  float d=textureLod(uAbdominalAtlas,(off+q+0.5)/vec3(${ABDOMINAL_ATLAS.textureDimensions.map((v) => v.toFixed(1)).join(',')}),0.0).r;
  // Cuerpos/discos: conserva el signo de la misma superficie cerca del
  // platillo; el filtro fijo anulaba distancias interiores de ~0,001 mm (223).
  if((k==8||k==10)&&abs(d)<1.5)d=sourceDistancePrecise(uAbdominalAtlas,q,ivec3(dim),ivec3(off));
  float label=texelFetch(uAbdominalAtlas,ivec3(off+floor(q+0.5)),0).g; 
  return vec2(d,label); 
}
float abdominalAtlasSdf(vec3 p, int k){return abdominalAtlasValue(p,k).x; }
vec3 abdominalAtlasGradient(vec3 p, int k){
  vec2 h=vec2(0.25,0.0); 
  return vec3(abdominalAtlasSdf(p+h.xyy,k)-abdominalAtlasSdf(p-h.xyy,k),abdominalAtlasSdf(p+h.yxy,k)-abdominalAtlasSdf(p-h.yxy,k),abdominalAtlasSdf(p+h.yyx,k)-abdominalAtlasSdf(p-h.yyx,k))/0.5; 
}
`;
