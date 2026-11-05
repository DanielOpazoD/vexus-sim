import { S0028_BUNDLE as B } from '../anatomyBundle';
import { s0028SolidsShader } from './s0028Solids.glsl';

const offsets = (rows: readonly (readonly number[])[]) => rows.map((v) => `ivec3(${v.join(',')})`).join(',');

/**
 * Regla directa P2 (par GLSL de `s0028Wall.ts`, @twin s0028-pared): proyección EDT `p − τ·∇τ/|∇τ|²`, semilla polar y carta bilineal en la
 * reserva P1; identidad nearest independiente de la geometría D/E. La carta y los centros se leen con texelFetch y se
 * interpolan aquí, en el orden de la CPU: los huecos U son NaN y el filtro del hardware mezcla el corte z vecino (otra
 * tesela) aun con peso 0 (NaN·0 = NaN). Consulta: 7 EDT + 2 centros + 8 esquinas = 17 lecturas; el gradiente analítico
 * usa las mismas esquinas. Sin bucles: el Newton S−dN queda offline. El peso respiratorio de una celda U lee además la
 * rampa de su fila (bloque derivado E, una lectura filtrada: 18); el mapa E del contacto sólo vive en la CPU.
 */
const R = B.wallDerived.ramps.placement;
export const S0028_WALL_GLSL = /* glsl */ `
const ivec3 S28_WALL_OFF[16]=ivec3[](${offsets(B.wall.placements)});
vec2 s28Project(vec3 p,out float depth,out vec3 g,out vec3 s,out vec2 xy){
  depth=torsoDepth(p);g=s28DepthGradient(p);
  s=p-depth*g/max(dot(g,g),0.000001);
  float row=clamp((s.z+210.0)/1.5,0.0,180.0),t=row-floor(row);
  int lo=int(floor(row)),hi=min(180,lo+1);
  float c0=texelFetch(uAbdominalAtlas,ivec3(${B.wall.centerOffset[0]},lo,${B.wall.centerOffset[2]}),0).g;
  float c1=texelFetch(uAbdominalAtlas,ivec3(${B.wall.centerOffset[0]},hi,${B.wall.centerOffset[2]}),0).g;
  xy=vec2(s.x,s.y-(c0*(1.0-t)+c1*t));
  return vec2(mod(atan(xy.y,xy.x),6.283185307179586)*81.48733086305042,row);
}
bool s28WallKnown(vec4 codes){
  return all(greaterThan(mod(floor(codes/8.0),4.0),vec4(0.0)))&&
    all(greaterThan(mod(floor(codes/32.0),4.0),vec4(0.0)))&&
    all(greaterThan(mod(floor(codes/128.0),4.0),vec4(0.0)));
}
// Esquinas 00,10,01,11 de la celda: la misma interpolación y la misma pendiente que chartCell (CPU).
float s28Mix(vec4 v,vec2 f){float a=v.x+f.x*(v.y-v.x),b=v.z+f.x*(v.w-v.z);return a+f.y*(b-a);}
vec2 s28Slope(vec4 v,vec2 f){float a=v.x+f.x*(v.y-v.x),b=v.z+f.x*(v.w-v.z);return vec2(v.y-v.x+f.y*((v.w-v.z)-(v.y-v.x)),b-a);}
// xyz=fronteras, w=código nearest; U: w=-1 y fronteras NaN, sin fabricar una superficie.
vec4 s28WallSurface(vec2 rc,out vec4 outer,out vec4 inner,out vec4 iface,out vec2 f){
  float nan=uintBitsToFloat(0x7fc00000u);
  outer=vec4(nan);inner=vec4(nan);iface=vec4(nan);
  rc.x=mod(rc.x,512.0);rc.y=clamp(rc.y,0.0,180.0);
  ivec2 ij=ivec2(floor(rc));ij.y=min(179,ij.y);
  f=rc-vec2(ij);int band=ij.y/90;
  ivec3 at=S28_WALL_OFF[band*8+ij.x/64]+ivec3(ij.x%64,ij.y-band*90,0);
  vec4 e0=texelFetch(uAbdominalAtlas,at+ivec3(0,0,1),0),e1=texelFetch(uAbdominalAtlas,at+ivec3(1,0,1),0);
  vec4 e2=texelFetch(uAbdominalAtlas,at+ivec3(0,1,1),0),e3=texelFetch(uAbdominalAtlas,at+ivec3(1,1,1),0);
  vec4 codes=vec4(e0.g,e1.g,e2.g,e3.g);
  if(!s28WallKnown(codes))return vec4(nan,nan,nan,-1.0);
  vec4 a=texelFetch(uAbdominalAtlas,at,0),b=texelFetch(uAbdominalAtlas,at+ivec3(1,0,0),0);
  vec4 c=texelFetch(uAbdominalAtlas,at+ivec3(0,1,0),0),d=texelFetch(uAbdominalAtlas,at+ivec3(1,1,0),0);
  outer=vec4(a.r,b.r,c.r,d.r);inner=vec4(a.g,b.g,c.g,d.g);iface=vec4(e0.r,e1.r,e2.r,e3.r);
  return vec4(s28Mix(outer,f),s28Mix(inner,f),s28Mix(iface,f),codes[(f.y>=0.5?2:0)+(f.x>=0.5?1:0)]);
}
bool s28Valid(vec3 g,vec3 s,float depth,vec4 b){return dot(g,g)>0.000001&&s.z>=-210.0&&s.z<=60.0&&depth<=6.0&&b.w>=0.0;}
// xyzw = outer/inner/interface/depth; con celda D/E vale a cualquier profundidad, nunca exige identidad muscular.
vec4 s28WallAt(vec3 p,out bool valid){
  float depth;vec3 g,s;vec2 xy,f;vec4 o,i,e;
  vec4 b=s28WallSurface(s28Project(p,depth,g,s,xy),o,i,e,f);
  valid=s28Valid(g,s,depth,b);
  return vec4(b.xyz,-depth);
}
float s28Inside(vec3 m){bool valid;vec4 q=s28WallAt(m,valid);return valid?q.w-q.z:-1000.0;}
// ∇(profundidad − frontera k), k: 0 externa, 1 interna, 2 interfaz: −∇τ − P(∂B/∂c·∇c + ∂B/∂f·∇f), P = I − ∇τ∇τᵀ/|∇τ|²;
// k=3, piel E a 1,5 mm: −∇τ. La pendiente bilineal sale de las mismas cuatro esquinas. Gemelo: s0028WallFaceGradient.
vec3 s28Grad(vec4 v,vec2 f,vec3 g,vec2 xy){
  vec2 slope=s28Slope(v,f);
  vec3 w=vec3(vec2(-xy.y,xy.x)*(81.48733086305042*slope.x/max(dot(xy,xy),0.000001)),slope.y/1.5);
  return -g-w+g*(dot(g,w)/dot(g,g));
}
vec3 s28FaceGradient(vec3 p,int k,out float sd,out bool valid){
  float depth;vec3 g,s;vec2 xy,f;vec4 o,i,e;
  vec2 rc=s28Project(p,depth,g,s,xy);
  if(k==3){sd=-depth-1.5;valid=true;return -g;}
  vec4 b=s28WallSurface(rc,o,i,e,f);
  valid=s28Valid(g,s,depth,b);sd=-1000.0;
  if(!valid)return vec3(0.0);
  vec4 v=k==0?o:k==1?i:e;sd=-depth-s28Mix(v,f);
  return s28Grad(v,f,g,xy);
}
// Rampa respiratoria de las celdas U (bloque derivado E): p10/p90 de la cara interna conocida de la fila, en la columna
// [${R.join(',')}] del atlas. El filtro lineal a lo largo de x interpola las filas lo/hi en una lectura; el halo es relleno
// finito (la tesela 15 acaba dos cortes antes). Gemelo: rampAt (s0028Wall.ts).
vec2 s28Ramp(float row){
  return textureLod(uAbdominalAtlas,(vec3(${R[0]}.0+row,${R[1]}.0,${R[2]}.0)+0.5)/vec3(textureSize(uAbdominalAtlas,0)),0.0).rg;
}
// Peso de pared del enlace respiratorio sin el factor de columna (gemelo: s0028RespiratoryWall). Celda D/E: smoothstep(0,
// 25, profundidad bajo la cara interna); U: rampa por profundidad smoothstep(p10, p90, −τ) de su fila.
float s28RespWall(vec3 m){
  float depth;vec3 g,s;vec2 xy,f;vec4 o,i,e;
  vec2 rc=s28Project(m,depth,g,s,xy);
  vec4 b=s28WallSurface(rc,o,i,e,f);
  if(s28Valid(g,s,depth,b))return smoothstep(0.0,25.0,-depth-b.z);
  vec2 r=s28Ramp(rc.y);
  return smoothstep(r.x,r.y,-depth);
}
`;

type Replace = (source: string, type: string, name: string, replacement: string) => string;
/**
 * Especializa la fuente por defecto para s0028: pared P2 (regla directa, rampas U), su clasificación ligera, la cortina
 * pulmonar retirada, la pleura y el hígado sobre los lectores P1, y los sólidos P3 (`s0028SolidsShader`, r3).
 * @twin clasificacion
 * @twin pared-interna
 * @twin deformacion
 * @twin organo-pared
 * @twin organo-cortina
 * @twin organo-higado
 * @twin s0028-pared
 * @twin textura-pared
 */
export function s0028WallShader(source: string, replace: Replace): string {
  let changed = replace(
    source,
    'float',
    'respWeight',
    S0028_WALL_GLSL +
      `
float respWeight(vec3 m){return s28RespWall(m)*smoothstep(uSpine.z+5.0,uSpine.z+35.0,length(m.xy-uSpine.xy));}`,
  );
  changed = replace(changed, 'float', 'insideWallMm', 'float insideWallMm(vec3 m){return s28Inside(m);}');
  changed = replace(
    changed,
    'vec3',
    'respWeightGradient',
    `
vec3 respWeightGradient(vec3 m){
 float depth;vec3 g,s;vec2 xy,f;vec4 o,i,e;
 vec2 rc=s28Project(m,depth,g,s,xy);
 vec4 b=s28WallSurface(rc,o,i,e,f);
 // Celda D/E: la cara interna regional (gradiente analítico); U: la rampa por profundidad de su fila y −∇τ.
 vec2 ramp=vec2(0.0,25.0);float inside=-depth-b.z;vec3 gi;
 if(s28Valid(g,s,depth,b))gi=s28Grad(e,f,g,xy);
 else{ramp=s28Ramp(rc.y);inside=-depth;gi=-g;}
 vec2 delta=m.xy-uSpine.xy;float r=length(delta);
 float a=smoothstep(uSpine.z+5.0,uSpine.z+35.0,r)*smoothstepSlope(ramp.x,ramp.y,inside);
 float w=smoothstep(ramp.x,ramp.y,inside)*smoothstepSlope(uSpine.z+5.0,uSpine.z+35.0,r)/max(r,1e-9);
 return a*gi+vec3(w*delta,0.0);
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
 float s=s28PA(m,10);if(s<0.0){c.tissue=T_BONE;c.bd=-s;return true;}
 s=s28PT(m,1);
 if(s<0.0){c.tissue=T_CARTILAGE;c.bd=-s;c.iface=IF_PERICHONDRIUM;c.ifd=-s;return true;}
 bool valid;vec4 q=s28WallAt(m,valid);
 if(!valid||q.w>=q.z)return false;
 bool fat=q.w<q.x;float outer=fat?1.5:q.x,inner=fat?q.x:q.y;
 c.tissue=fat?T_FAT:T_UNSEGMENTED;c.bd=max(0.0,min(q.w-outer,inner-q.w));
 c.iface=fat?IF_DEEP_FASCIA:IF_PERITONEUM;c.ifd=abs(inner-q.w);return true;
}`,
  );
  // P3 (decisión 321, r3): dueños independientes, conflicto U, riñón U con su contorno O, grasa D y tubos; sin cortina
  // ni tórax/cúpula procedurales (dDome = 1000) y sin segunda consulta de pared.
  changed = s0028SolidsShader(changed, replace);
  changed = replace(changed, 'float', 'liverInner', 'float liverInner(vec3 m){return -abdominalAtlasSdf(m,4);}');
  changed = replace(changed, 'vec3', 'visceralHeight', 'vec3 visceralHeight(vec2 p){return vec3(0.0);}');
  changed = replace(
    changed,
    'float',
    'wallFaceDepth',
    'float wallFaceDepth(float u,float z,int face){return uintBitsToFloat(0x7fc00000u);}',
  );
  // Sin capas procedurales en s0028: ningún consumidor encuentra una frontera. Antes NaN: la estriación del músculo
  // posterior lo llevaba al eco del paso B y los filtros de la imagen apagaban bloques enteros (láminas r2b).
  changed = replace(changed, 'vec4', 'wallDepths', 'vec4 wallDepths(float u,float z){return vec4(1000.0);}');
  // Como la CPU s0028 (r2a, @twin organo-cortina): sin cortina pulmonar procedural. lungEdgeMm es null y el receso es el
  // pulmón fuente; con el modelo por defecto A0 tomaba el cruce de la pared regional por pleura y B ponía aire bajo
  // ella (láminas r2b).
  if (/float\s+lungCurtainEdgeMm\s*\(/.test(changed))
    changed = replace(changed, 'float', 'lungCurtainEdgeMm', 'float lungCurtainEdgeMm(vec3 m){return -1000.0;}');
  if (/bool\s+inLungRecess\s*\(/.test(changed))
    changed = replace(changed, 'bool', 'inLungRecess', 'bool inLungRecess(vec3 m,float insideWall){return s28PT(m,2)<0.0;}');
  // Reverberación tras gas: pow con base negativa (r < k·gasHit) no está definido en GLSL ES y Metal devuelve NaN desde
  // el gas hasta el final de la línea. El pulmón y el gas fuente de s0028 lo disparan en casi todas las ventanas; el
  // cuadrado explícito es la misma gaussiana. El default no se toca (sus programas siguen idénticos a main).
  changed = changed.replace(
    /exp\(\s*-0\.5\s*\*\s*pow\(\s*\(r\s*-\s*rk\)\s*\/\s*1\.2\s*,\s*2\.0\s*\)\s*\)/g,
    'exp(-0.5*((r-rk)/1.2)*((r-rk)/1.2))',
  );
  if (/pow\(\s*\(r\s*-\s*rk\)/.test(changed)) throw new Error('Reverberación s0028 con pow de base negativa');
  // La banda D/E no es músculo identificado y el músculo posterior fuente no tiene capas: sin estriación.
  if (/vec4\s+muscleStriation\s*\(/.test(changed))
    changed = replace(changed, 'vec4', 'muscleStriation', 'vec4 muscleStriation(vec3 m){return vec4(0.0,1.0,0.0,0.0);}');
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
    g=vec3(s28PT(m+h.xyy,1)-s28PT(m-h.xyy,1),s28PT(m+h.yxy,1)-s28PT(m-h.yxy,1),s28PT(m+h.yyx,1)-s28PT(m-h.yyx,1));
  } else if(c.iface==IF_RIB){`,
  );
  changed = changed.replace(/float\s+lg\s*=\s*length\(g\);/, 'if(any(isnan(g)))return vec4(0.0);\n  float lg = length(g);');
  if (/uWall\.x\s*\+\s*uWall\.y\s*\+\s*uWall\.z|skin\s*\+\s*uWall\.y\s*\+\s*uWall\.z/.test(changed))
    throw new Error('Consumidor s0028 conserva W global');
  return changed;
}
