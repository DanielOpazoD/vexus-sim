import { S0028_BUNDLE as B } from '../anatomyBundle';

const offsets = (rows: readonly (readonly number[])[]) => rows.map((v) => `ivec3(${v.join(',')})`).join(',');

/**
 * Regla directa P2 (gemela de `s0028Wall.ts`): proyección EDT `p − τ·∇τ/|∇τ|²`, semilla polar y carta bilineal en la
 * reserva P1; identidad nearest independiente de la geometría D/E. Consulta: 7 EDT + 1 centro + 4 códigos + 2 fronteras
 * = 14 lecturas; con gradiente analítico, 2 más. Sin bucles: el Newton S−dN queda offline.
 */
export const S0028_WALL_GLSL = /* glsl */ `
const ivec3 S28_WALL_OFF[16]=ivec3[](${offsets(B.wall.placements)});
vec2 s28Project(vec3 p,out float depth,out vec3 g,out vec3 s,out vec2 xy){
  depth=torsoDepth(p);g=s28DepthGradient(p);
  s=p-depth*g/max(dot(g,g),0.000001);
  float row=clamp((s.z+210.0)/1.5,0.0,180.0);
  xy=vec2(s.x,s.y-textureLod(uAbdominalAtlas,(vec3(${B.wall.centerOffset[0]}.0,row,${B.wall.centerOffset[2]}.0)+0.5)/vec3(textureSize(uAbdominalAtlas,0)),0.0).g);
  return vec2(mod(atan(xy.y,xy.x),6.283185307179586)*81.48733086305042,row);
}
bool s28WallKnown(vec4 codes){
  return all(greaterThan(mod(floor(codes/8.0),4.0),vec4(0.0)))&&
    all(greaterThan(mod(floor(codes/32.0),4.0),vec4(0.0)))&&
    all(greaterThan(mod(floor(codes/128.0),4.0),vec4(0.0)));
}
ivec3 s28Cell(vec2 rc,out vec2 f){
  rc.x=mod(rc.x,512.0);ivec2 ij=ivec2(floor(rc));ij.y=min(179,ij.y);
  f=rc-vec2(ij);int band=ij.y/90;
  return S28_WALL_OFF[band*8+ij.x/64]+ivec3(ij.x%64,ij.y-band*90,0);
}
// xyz=fronteras, w=código nearest; U: w=-1 y fronteras NaN, sin fabricar una superficie.
vec4 s28WallSurface(vec2 rc){
  float nan=uintBitsToFloat(0x7fc00000u);
  if(rc.y<0.0||rc.y>180.0)return vec4(nan,nan,nan,-1.0);
  vec2 f;ivec3 at=s28Cell(rc,f),inside=at+ivec3(0,0,1);
  vec4 codes=vec4(texelFetch(uAbdominalAtlas,inside,0).g,texelFetch(uAbdominalAtlas,inside+ivec3(1,0,0),0).g,
    texelFetch(uAbdominalAtlas,inside+ivec3(0,1,0),0).g,texelFetch(uAbdominalAtlas,inside+ivec3(1,1,0),0).g);
  if(!s28WallKnown(codes))return vec4(nan,nan,nan,-1.0);
  vec3 size=vec3(textureSize(uAbdominalAtlas,0)),uv=(vec3(at)+vec3(f,0.0)+0.5)/size;
  vec2 ft=textureLod(uAbdominalAtlas,uv,0.0).rg;
  float pe=textureLod(uAbdominalAtlas,uv+vec3(0.0,0.0,1.0/size.z),0.0).r;
  return vec4(ft,pe,codes[(f.y>=0.5?2:0)+(f.x>=0.5?1:0)]);
}
bool s28Valid(vec3 g,vec3 s,float depth,vec4 b){return dot(g,g)>0.000001&&s.z>=-210.0&&s.z<=60.0&&depth<=6.0&&b.w>=0.0;}
// xyzw = outer/inner/interface/depth; con celda D/E vale a cualquier profundidad, nunca exige identidad muscular.
vec4 s28WallAt(vec3 p,out bool valid){
  float depth;vec3 g,s;vec2 xy;
  vec4 b=s28WallSurface(s28Project(p,depth,g,s,xy));
  valid=s28Valid(g,s,depth,b);
  return vec4(b.xyz,-depth);
}
float s28Inside(vec3 m){bool valid;vec4 q=s28WallAt(m,valid);return valid?q.w-q.z:-1000.0;}
// ∇(profundidad − frontera k), k: 0 externa, 1 interna, 2 interfaz: −∇τ − P(∂B/∂c·∇c + ∂B/∂f·∇f), P = I − ∇τ∇τᵀ/|∇τ|²;
// k=3, piel E a 1,5 mm: −∇τ. La celda es bilineal: medio texel dentro de ella da su derivada exacta con dos lecturas.
// Gemelo: s0028WallFaceGradient.
vec3 s28FaceGradient(vec3 p,int k,out float sd,out bool valid){
  float depth;vec3 g,s;vec2 xy;
  vec2 rc=s28Project(p,depth,g,s,xy);
  if(k==3){sd=-depth-1.5;valid=true;return -g;}
  vec4 b=s28WallSurface(rc);
  valid=s28Valid(g,s,depth,b);sd=-1000.0;
  if(!valid)return vec3(0.0);
  float v=k==0?b.x:k==1?b.y:b.z;sd=-depth-v;
  vec2 f;ivec3 at=s28Cell(rc,f)+ivec3(0,0,k/2);
  vec3 size=vec3(textureSize(uAbdominalAtlas,0)),uv=vec3(at)+vec3(f,0.0)+0.5;
  vec2 h=mix(vec2(0.5),vec2(-0.5),greaterThanEqual(f,vec2(0.5)));
  vec2 dc=textureLod(uAbdominalAtlas,(uv+vec3(h.x,0.0,0.0))/size,0.0).rg,dr=textureLod(uAbdominalAtlas,(uv+vec3(0.0,h.y,0.0))/size,0.0).rg;
  vec2 slope=(vec2(k==1?dc.y:dc.x,k==1?dr.y:dr.x)-v)/h;
  vec3 w=vec3(vec2(-xy.y,xy.x)*(81.48733086305042*slope.x/max(dot(xy,xy),0.000001)),slope.y/1.5);
  return -g-w+g*(dot(g,w)/dot(g,g));
}
`;

type Replace = (source: string, type: string, name: string, replacement: string) => string;
export function s0028WallShader(source: string, replace: Replace): string {
  let changed = replace(
    source,
    'float',
    'respWeight',
    S0028_WALL_GLSL +
      `
float respWeight(vec3 m){float inside=s28Inside(m);return smoothstep(0.0,25.0,inside)*smoothstep(uSpine.z+5.0,uSpine.z+35.0,length(m.xy-uSpine.xy));}`,
  );
  changed = replace(changed, 'float', 'insideWallMm', 'float insideWallMm(vec3 m){return s28Inside(m);}');
  changed = replace(
    changed,
    'vec3',
    'respWeightGradient',
    `
vec3 respWeightGradient(vec3 m){
 float inside;bool valid;vec3 gi=s28FaceGradient(m,2,inside,valid);
 if(!valid)return vec3(0.0);
 vec2 delta=m.xy-uSpine.xy;float r=length(delta);
 float a=smoothstep(uSpine.z+5.0,uSpine.z+35.0,r)*smoothstepSlope(0.0,25.0,inside);
 float b=smoothstep(0.0,25.0,inside)*smoothstepSlope(uSpine.z+5.0,uSpine.z+35.0,r)/max(r,1e-9);
 return a*gi+vec3(b*delta,0.0);
}`,
  );
  changed = replace(
    changed,
    'float',
    'wallFaceSd',
    `
float wallFaceSd(vec3 m,int face){
 if(face==IF_SKIN_FAT)return -torsoDepth(m)-1.5;
 bool valid;vec4 q=s28WallAt(m,valid);
 float nan=uintBitsToFloat(0x7fc00000u);
 if(!valid)return nan;
 return q.w-(face==IF_DEEP_FASCIA?q.x:face==IF_TRANSVERSALIS?q.y:face==IF_PERITONEUM?q.z:nan);
}`,
  );
  changed = replace(
    changed,
    'vec3',
    'wallFaceGradient',
    `
vec3 wallFaceGradient(vec3 m,int face){
 int k=face==IF_SKIN_FAT?3:face==IF_DEEP_FASCIA?0:face==IF_TRANSVERSALIS?1:face==IF_PERITONEUM?2:-1;
 float sd;bool valid;vec3 g=s28FaceGradient(m,max(k,0),sd,valid);
 return valid&&k>=0?g:vec3(uintBitsToFloat(0x7fc00000u));
}`,
  );
  changed = replace(
    changed,
    'bool',
    'classifyWall',
    `
bool classifyWall(vec3 m,out Cls c,out float depth,out vec3 tn){
 c.tissue=T_AIR;c.bd=1e3;c.n=vec3(0,1,0);c.iface=IF_NONE;c.ifd=1e3;c.vessel=-1;
 c.rho=10.0;c.tangent=vec3(0,0,1);c.kc=0.0;c.uRef=0.0;c.rRef=1.0;c.profN=2.0;
 depth=torsoDepth(m);tn=vec3(0,1,0);
 if(m.z<uTorso.z||m.z>uTorso.w||depth>0.0)return true;
 float d=-depth;
 if(d<1.5){c.tissue=T_SKIN;c.bd=min(d,1.5-d);c.iface=IF_SKIN_FAT;c.ifd=1.5-d;return true;}
 vec2 bone=thoracicValue(m);
 if(bone.x<0.0){c.tissue=thoracicMaterial(bone.y)==2?T_VERTEBRA:T_BONE;c.bd=-bone.x;return true;}
 bone=abdominalAtlasValue(m,8);
 if(bone.x<0.0){c.tissue=bone.y<=5.0?T_VERTEBRA:T_BONE;c.bd=-bone.x;return true;}
 bone=s28_sacrum(m);if(bone.x<0.0){c.tissue=T_BONE;c.bd=-bone.x;return true;}
 vec2 cart=s28_cartilage(m);
 if(cart.x<0.0){c.tissue=T_CARTILAGE;c.bd=-cart.x;c.iface=IF_PERICHONDRIUM;c.ifd=-cart.x;return true;}
 bool valid;vec4 q=s28WallAt(m,valid);
 if(!valid||q.w>=q.z)return false;
 bool fat=q.w<q.x;float outer=fat?1.5:q.x,inner=fat?q.x:q.y;
 c.tissue=fat?T_FAT:T_UNSEGMENTED;c.bd=max(0.0,min(q.w-outer,inner-q.w));
 c.iface=fat?IF_DEEP_FASCIA:IF_PERITONEUM;c.ifd=abs(inner-q.w);return true;
}`,
  );
  const start = changed.search(/void\s+classifyInside\s*\(/);
  const body = changed.indexOf('{', start),
    tailRelative = changed.slice(body).search(/float\s+bdBowel\s*=/);
  if (start < 0 || body < 0 || tailRelative < 0) throw new Error('Falta clasificación interior s0028');
  const tail = body + tailRelative;
  let end = body + 1,
    depth = 1;
  for (; depth && end < changed.length; end++) depth += changed[end] === '{' ? 1 : changed[end] === '}' ? -1 : 0;
  if (depth || tail >= end) throw new Error('Clasificación interior s0028 incompleta');
  end--;
  changed =
    changed.slice(0, tail) +
    `
  vec2 muscle=s28_posteriorMuscle(m);
  if(muscle.x<0.0&&muscle.y>0.0){c.tissue=muscle.y<=2.0?T_PSOAS:T_MUSCLE;c.bd=-muscle.x;return;}
  float dome=sdDome(m,dn);
  if(dome>=0.0&&dome<DIAPHRAGM_MM){c.tissue=T_DIAPHRAGM;c.bd=min(dome,DIAPHRAGM_MM-dome);c.n=dn;
    if(dome>0.5*DIAPHRAGM_MM){c.iface=IF_DIAPHRAGM_LIVER;c.ifd=DIAPHRAGM_MM-dome;}return;}
  c.tissue=T_UNSEGMENTED;c.bd=0.0;return;
` +
    changed.slice(end);
  // Sin cortina ni tórax/cúpula procedurales (dDome=1000) nada vivo de classifyInside lee `wall`: sin segunda
  // consulta de pared; −depth−wall=1000 es el «sin límite» de la CPU (wallMm de U).
  changed = changed.replace(
    /float\s+wall\s*=\s*uWall\.x\s*\+\s*uWall\.y\s*\+\s*uWall\.z\s*;/,
    `
  vec2 lung=s28_lung(m);if(lung.x<0.0){c.tissue=T_LUNG;c.bd=-lung.x;return;}
  if(s28_heart(m).x<0.0){vec3 normal;float dome=sdDome(m,normal),ifd;c.tissue=thorax(m,dome,c.bd,ifd,c.n);return;}
  float wall=-depth-1000.0;`,
  );
  changed = changed.replace(
    /if\s*\(withCurtain\)\s*\{\s*float\s+dCurtain\s*=\s*lungCurtainDistance\(m,\s*-depth\s*-\s*wall\);\s*if\s*\(dCurtain\s*>=\s*0\.0\)\s*\{[^}]+\}\s*\}/,
    '',
  );
  changed = changed.replace(/float\s+dDome\s*=\s*sdDome\(m,\s*dn\);/, 'dn=vec3(0.0,0.0,-0.5);float dDome=1000.0;');
  changed = changed.replace(/float\s+inner\s*=\s*min\(-dLiver,\s*min\(dDia,\s*-depth\s*-\s*wall\)\);/, 'float inner = -dLiver;');
  changed = replace(
    changed,
    'Cls',
    'classifyWith',
    `
Cls classifyWith(vec3 m,bool withCurtain){
 Cls c;float depth;vec3 tn;if(classifyWall(m,c,depth,tn))return c;
 classifyInside(m,withCurtain,depth,tn,1000.0,c);
 vec2 q=thoracicValue(m);
 if(thoracicMaterial(q.y)==0&&q.x>=0.0&&q.x<1.3&&q.x<c.ifd&&c.tissue!=T_LUNG&&c.tissue!=T_FLUID&&c.tissue!=T_BLOOD){
   c.bd=min(c.bd,q.x);c.iface=IF_RIB;c.ifd=q.x;thoracicFrame(m,c.tangent,c.kc);}
 return c;
}`,
  );
  changed = replace(changed, 'float', 'liverInner', 'float liverInner(vec3 m){return -abdominalAtlasSdf(m,4);}');
  changed = replace(changed, 'vec3', 'visceralHeight', 'vec3 visceralHeight(vec2 p){return vec3(0.0);}');
  changed = replace(
    changed,
    'float',
    'wallFaceDepth',
    'float wallFaceDepth(float u,float z,int face){return uintBitsToFloat(0x7fc00000u);}',
  );
  changed = replace(changed, 'vec4', 'wallDepths', 'vec4 wallDepths(float u,float z){return vec4(uintBitsToFloat(0x7fc00000u));}');
  changed = replace(
    changed,
    'float',
    'domeSd',
    'float domeSd(vec3 m){vec3 n;bool valid;vec4 q=s28WallAt(m,valid);float d=sdDome(m,n);return valid?max(d,q.z-q.w):d;}',
  );
  changed = replace(changed, 'float', 'ribSd', 'float ribSd(vec3 m,int k){return thoracicSdf(m);}');
  // El pericondrio pertenece al campo de cartílago, no al SDF óseo.
  changed = changed.replace(
    /}\s*else\s+if\s*\(c\.iface\s*==\s*IF_RIB\s*\|\|\s*c\.iface\s*==\s*IF_PERICHONDRIUM\)\s*\{/,
    `} else if(c.iface==IF_PERICHONDRIUM){
    g=vec3(s28_cartilage(m+h.xyy).x-s28_cartilage(m-h.xyy).x,s28_cartilage(m+h.yxy).x-s28_cartilage(m-h.yxy).x,s28_cartilage(m+h.yyx).x-s28_cartilage(m-h.yyx).x);
  } else if(c.iface==IF_RIB){`,
  );
  changed = changed.replace(/float\s+lg\s*=\s*length\(g\);/, 'if(any(isnan(g)))return vec4(0.0);\n  float lg = length(g);');
  if (/uWall\.x\s*\+\s*uWall\.y\s*\+\s*uWall\.z|skin\s*\+\s*uWall\.y\s*\+\s*uWall\.z/.test(changed))
    throw new Error('Consumidor s0028 conserva W global');
  return changed;
}
