import { GALLBLADDER_WALL_MM } from '../organs/gallbladder';
import { S0028_BUNDLE as B } from '../people/s0028/descriptor';
import { S0028_RENAL_FACE_MM, s0028FatPages } from '../people/s0028/solidsData';
import { RIGID_BASE } from './anatomy.glsl';

/** Campos P3 de cada atlas, en el orden de los índices GLSL: los doce dueños abdominales y los tres vasos fuente (P5). */
const ABDOMINAL = [
  'liver',
  'spleen',
  'pancreas',
  'kidneyRight',
  'kidneyLeft',
  'gallbladder',
  'bladder',
  'digestiveTract',
  'posteriorMuscle',
  'lumbarSacralBone',
  'sacrum',
  'renalCysts',
  'aorta',
  'inferior_vena_cava',
  'portal_vein_and_splenic_vein',
];
const THORACIC = ['thoracicBone', 'cartilage', 'lung', 'heart'];
const vec = (v: readonly number[]) => `vec3(${v.map((n) => n.toFixed(15)).join(',')})`;
const table = (prefix: string, names: readonly string[]) =>
  (['originMm', 'dimensions', 'offset'] as const)
    .map((key, i) => {
      const fields = names.map((name) => B.fields.find((f) => f.name === name)!);
      if (fields.some((f) => !f || f.pitchMm !== 1.5)) throw new Error('Campo P3 sin procedencia');
      return `const vec3 ${prefix}_${['LO', 'DIM', 'OFF'][i]}[${names.length}]=vec3[](${fields.map((f) => vec(f[key])).join(',')});`;
    })
    .join('\n');

/**
 * Lectores P1 de P3, par GLSL de `s0028SourceValue` (distancia y rótulo); también los usan la pared ligera y la pleura.
 * @twin s0028-lector
 */
export const S0028_READER_GLSL = /* glsl */ `
${table('S28A', ABDOMINAL)}
${table('S28T', THORACIC)}
// Distancia del campo (gemela de sourceDistance: 16 fuera de su caja). El filtro del hardware cuantiza los pesos y puede
// cambiar el signo junto a la frontera: a menos de un vóxel, los mismos ocho nodos que la CPU.
float s28P(highp sampler3D t,vec3 p,vec3 lo,vec3 dim,vec3 off){
  vec3 q=(p-lo)/1.5;
  if(any(lessThan(q,vec3(0.0)))||any(greaterThan(q,dim-1.0)))return 16.0;
  float d=textureLod(t,(off+q+0.5)/vec3(textureSize(t,0)),0.0).r;
  return abs(d)<1.5?sourceDistancePrecise(t,q,ivec3(dim),ivec3(off)):d;
}
float s28PA(vec3 p,int k){return s28P(uAbdominalAtlas,p,S28A_LO[k],S28A_DIM[k],S28A_OFF[k]);}
float s28PT(vec3 p,int k){return s28P(uThoracicAtlas,p,S28T_LO[k],S28T_DIM[k],S28T_OFF[k]);}
// Etiqueta nearest (gemela de sourceLabel): floor(q + 0,5) es Math.round para q ≥ 0.
float s28PLA(vec3 p,int k){return texelFetch(uAbdominalAtlas,ivec3(S28A_OFF[k]+floor((p-S28A_LO[k])/1.5+0.5)),0).g;}
float s28PLT(vec3 p,int k){return texelFetch(uThoracicAtlas,ivec3(S28T_OFF[k]+floor((p-S28T_LO[k])/1.5+0.5)),0).g;}
`;

/**
 * Política P3 en la GPU (decisión 321, r3), par GLSL de `s0028Owners` y de la rama s0028 de `scene.ts`. Sin bucles en
 * este código ni en lo que llama (las funciones `s28P*`): cada campo se lee por su caja y, a menos de un vóxel de su
 * frontera, con los mismos ocho nodos exactos de la CPU (`sourceDistancePrecise`). Dueños independientes antes de
 * cualquier orden; dos o más son conflicto y U; el riñón es U por dentro con su borde O como cara acústica; la grasa
 * compatible D sale de 77 páginas RG16F subidas a huecos del atlas abdominal (sin textura ni sampler nuevos).
 * @twin s0028-duenos
 * @twin s0028-gradiente-renal
 */
export const S0028_SOLIDS_GLSL = /* glsl */ `
const vec3 S28F_LO[2]=vec3[](${B.solids.boxes.map((b) => vec(b.originMm)).join(',')});
const vec3 S28F_DIM[2]=vec3[](${B.solids.boxes.map((b) => vec(b.dimensions)).join(',')});
const int S28F_AT[2]=int[](${B.solids.boxes.map((b) => b.byteOffset).join(',')});
const ivec3 S28F_PAGE[${s0028FatPages().length}]=ivec3[](${s0028FatPages()
  .map((p) => `ivec3(${p.join(',')})`)
  .join(',')});
// Bit de grasa compatible D del vóxel nearest de la caja b (gemelo: s0028CompatibleFat): un byte exacto por half en
// páginas 32×32 RG16F (2.048 por página), bits little-endian, z rápida.
bool s28PFat(vec3 p,int b){
  vec3 x=(p-S28F_LO[b])/1.5,dim=S28F_DIM[b];
  if(any(lessThan(x,vec3(0.0)))||any(greaterThan(x,dim-1.0)))return false;
  ivec3 v=ivec3(floor(x+0.5)),n=ivec3(dim);
  int bit=(v.x*n.y+v.y)*n.z+v.z,at=S28F_AT[b]+(bit>>3),h=at&2047;
  vec2 t=texelFetch(uAbdominalAtlas,S28F_PAGE[at>>11]+ivec3((h>>1)&31,h>>6,0),0).rg;
  return ((int((h&1)==0?t.x:t.y)>>(bit&7))&1)==1;
}
void s28PAdd(inout int n,inout int k,inout float d,int id,float v){if(v<0.0){if(n==0){k=id;d=v;}n++;}}
// Dueños independientes de un punto material (gemelo: s0028Owners): cuántos hay; k y d, el primero (con un solo dueño,
// el único; ids de la tabla CPU: 9 hueso, 16 banda P2, 17 grasa). b: hueso torácico, lumbosacro, sacro y cartílago;
// e: vesícula y el riñón más cercano (su borde O es la cara acústica).
int s28POwn(vec3 m,vec4 q,bool valid,out int k,out float d,out vec4 b,out vec2 e){
  int n=0;k=-1;d=16.0;
  s28PAdd(n,k,d,0,s28PA(m,0));
  s28PAdd(n,k,d,1,s28PA(m,1));
  s28PAdd(n,k,d,2,s28PA(m,2));
  float kr=s28PA(m,3),kl=s28PA(m,4);
  s28PAdd(n,k,d,3,kr);
  s28PAdd(n,k,d,4,kl);
  e=vec2(s28PA(m,5),min(kr,kl));
  s28PAdd(n,k,d,5,e.x);
  s28PAdd(n,k,d,6,s28PA(m,6));
  s28PAdd(n,k,d,7,s28PA(m,7));
  s28PAdd(n,k,d,8,s28PA(m,8));
  b=vec4(s28PT(m,0),s28PA(m,9),s28PA(m,10),s28PT(m,1));
  // Vértebras, sacro, caderas y costillas: un solo dueño óseo, el primero de la tabla.
  s28PAdd(n,k,d,9,b.y<0.0?b.y:b.z<0.0?b.z:b.x);
  s28PAdd(n,k,d,12,b.w);
  s28PAdd(n,k,d,13,s28PA(m,11));
  s28PAdd(n,k,d,14,s28PT(m,2));
  s28PAdd(n,k,d,15,s28PT(m,3));
  // Banda P2 conocida; el hueso dentro de la pared es contenido del complejo, no un choque.
  if(valid&&q.w<q.z&&b.x>=0.0&&b.y>=0.0&&b.z>=0.0&&b.w>=0.0){if(n==0){k=16;d=-min(q.w-1.5,q.z-q.w);}n++;}
  // Grasa D sólo donde ninguna máscara reclama el punto, ni la lámina de los vasos fuente.
  if(n==(k==16?1:0)&&(s28PFat(m,0)||s28PFat(m,1))&&s28PA(m,12)>=0.0&&s28PA(m,13)>=0.0&&s28PA(m,14)>=0.0){if(n==0){k=17;d=0.0;}n++;}
  return n;
}
// Gradiente analítico de la trilineal del riñón cuya caja contiene p (gemelo: s0028KidneyGradient): los ocho nodos de
// su distancia, sin diferencias finitas.
vec3 s28PGrad(vec3 p){
  int k=p.x<10.0?3:4;
  vec3 dim=S28A_DIM[k],q=(p-S28A_LO[k])/1.5;
  if(any(lessThan(q,vec3(0.0)))||any(greaterThan(q,dim-1.0)))return vec3(0.0);
  ivec3 a=min(ivec3(floor(q)),ivec3(dim)-2),o=a+ivec3(S28A_OFF[k]);
  vec3 t=q-vec3(a);
  vec4 l=vec4(texelFetch(uAbdominalAtlas,o,0).r,texelFetch(uAbdominalAtlas,o+ivec3(1,0,0),0).r,texelFetch(uAbdominalAtlas,o+ivec3(0,1,0),0).r,texelFetch(uAbdominalAtlas,o+ivec3(1,1,0),0).r);
  vec4 h=vec4(texelFetch(uAbdominalAtlas,o+ivec3(0,0,1),0).r,texelFetch(uAbdominalAtlas,o+ivec3(1,0,1),0).r,texelFetch(uAbdominalAtlas,o+ivec3(0,1,1),0).r,texelFetch(uAbdominalAtlas,o+ivec3(1,1,1),0).r);
  return vec3(mix(mix(l.y-l.x,l.w-l.z,t.y),mix(h.y-h.x,h.w-h.z,t.y),t.z),mix(mix(l.z-l.x,l.w-l.y,t.x),mix(h.z-h.x,h.w-h.y,t.x),t.z),
    mix(mix(h.x-l.x,h.y-l.y,t.x),mix(h.z-l.z,h.w-l.w,t.x),t.y))/1.5;
}
`;

/**
 * El resto de la clasificación s0028 con los dueños P3 (par GLSL de `classify`/`classifyInside` de `scene.ts`). Un solo
 * dueño da su material actual; los tubos, el tórax E y la vesícula conservan su código; se retiran el riñón, la grasa
 * perirrenal/Gerota y el ligamento venoso analíticos de la otra persona.
 * @twin clasificacion
 */
const S0028_CLASSIFY_GLSL = (tubes: string) => /* glsl */ `
void classifyInside(vec3 m,int k,float od,vec3 e,inout Cls c){
  if(k==14){c.tissue=T_LUNG;c.bd=-od;return;}
  if(k==15){float dome=sdDome(m,c.n),ifd;c.tissue=thorax(m,dome,c.bd,ifd,c.n);return;}
  bool renal=k==3||k==4||k==13;
  vec3 gn;float dGb=e.x+${GALLBLADDER_WALL_MM.toFixed(3)};
  ${tubes}
  if(dGb<0.0||dGb<uGbExtra.y)gn=abdominalAtlasGradient(m,7);
  if(dGb<0.0){c.tissue=T_FLUID;c.bd=-dGb;c.n=gn;c.iface=IF_GALLBLADDER;c.ifd=-dGb;return;}
  if(dGb<uGbExtra.y){c.tissue=T_BILEWALL;c.bd=min(dGb,uGbExtra.y-dGb);c.n=gn;c.iface=IF_GALLBLADDER;c.ifd=dGb;return;}
  // Riñón: interior U (el quiste izquierdo, líquido E), sin corteza, seno, cápsula ni vasos dentro.
  if(renal){c.tissue=k==13?T_FLUID:T_UNSEGMENTED;c.bd=-od;}
  else if(s28PAbdomen(m,k==2?0:k==7?1:k==6?2:k==1?3:-1,od,c))return;
  else if(k==0){
    c.n=abdominalAtlasGradient(m,4);c.bd=-od;
    if(-od<CAPSULE_MM){c.tissue=T_CAPSULE;if(dGb-uGbExtra.y>GALLBLADDER_CONTACT_MM-od){c.iface=IF_LIVER_CAPSULE;c.ifd=-od;}return;}
    c.tissue=T_LIVER;return;
  }
  else if(k==8&&s28PLA(m,8)>0.0){c.tissue=s28PLA(m,8)<=2.0?T_PSOAS:T_MUSCLE;c.bd=-od;return;}
  else if(k==17){c.tissue=T_FAT;c.bd=0.0;}
  else{
    vec3 dn;float dome=sdDome(m,dn);
    if(dome>=0.0&&dome<DIAPHRAGM_MM){c.tissue=T_DIAPHRAGM;c.bd=min(min(dome,DIAPHRAGM_MM-dome),e.z);c.n=dn;
      if(dome>0.5*DIAPHRAGM_MM){c.iface=IF_DIAPHRAGM_LIVER;c.ifd=DIAPHRAGM_MM-dome;}}
    else{c.tissue=T_UNSEGMENTED;c.bd=0.0;}
  }
  // Contorno acústico renal: el borde O de la máscara, a ambos lados aunque los dos sean U.
  if(abs(e.y)<${S0028_RENAL_FACE_MM.toFixed(1)}&&abs(e.y)<c.ifd){c.iface=IF_RENAL_CAPSULE;c.ifd=abs(e.y);}
}
Cls classifyWith(vec3 m,bool withCurtain){
  Cls c;
  c.tissue=T_AIR;c.bd=1e3;c.n=vec3(0,1,0);c.iface=IF_NONE;c.ifd=1e3;c.vessel=-1;
  c.rho=10.0;c.tangent=vec3(0,0,1);c.kc=0.0;c.uRef=0.0;c.rRef=1.0;c.profN=2.0;
  float depth=torsoDepth(m);
  if(m.z<uTorso.z||m.z>uTorso.w||depth>0.0)return c;
  float d=-depth;
  if(d<1.5){c.tissue=T_SKIN;c.bd=min(d,1.5-d);c.iface=IF_SKIN_FAT;c.ifd=1.5-d;return c;}
  bool valid;vec4 q=s28WallAt(m,valid);
  int k;float od;vec4 b;vec2 e;
  // P3: dos o más dueños son conflicto, U sin material elegido.
  if(s28POwn(m,q,valid,k,od,b,e)>1){c.tissue=T_UNSEGMENTED;c.bd=0.0;return c;}
  if(k==9||k==12){
    if(b.x<0.0){c.tissue=thoracicMaterial(s28PLT(m,0))==2?T_VERTEBRA:T_BONE;c.bd=-b.x;}
    else if(b.y<0.0){c.tissue=s28PLA(m,9)<=5.0?T_VERTEBRA:T_BONE;c.bd=-b.y;}
    else if(b.z<0.0){c.tissue=T_BONE;c.bd=-b.z;}
    else{c.tissue=T_CARTILAGE;c.bd=-b.w;c.iface=IF_PERICHONDRIUM;c.ifd=-b.w;}
    return c;
  }
  if(k==16){
    bool fat=q.w<q.x;float outer=fat?1.5:q.x,inner=fat?q.x:q.y;
    c.tissue=fat?T_FAT:T_UNSEGMENTED;c.bd=max(0.0,min(q.w-outer,inner-q.w));
    c.iface=fat?IF_DEEP_FASCIA:IF_PERITONEUM;c.ifd=abs(inner-q.w);return c;
  }
  classifyInside(m,k,od,vec3(e,valid?q.w-q.z:1e3),c);
  if(b.x>=0.0&&b.x<1.3&&b.x<c.ifd&&c.tissue!=T_LUNG&&c.tissue!=T_FLUID&&c.tissue!=T_BLOOD&&thoracicMaterial(s28PLT(m,0))==0){
    c.bd=min(c.bd,b.x);c.iface=IF_RIB;c.ifd=b.x;thoracicFrame(m,c.tangent,c.kc);}
  return c;
}`;

/** Cara renal s0028: la normal es el gradiente analítico del riñón (`s28PGrad`). @twin s0028-gradiente-renal */
const RENAL_FACE_GLSL = /* glsl */ `vec3 renalAtlasFaceGradient(vec3 m,bool fat){return (2.0*FACE_GRAD_EPS)*s28PGrad(m);}`;
// Zonas rígidas por dueño en la compresión (par GLSL de `rigidDepth` y `tableAt`): (κ, d₁, L) por nodo, interpolados
// como la CPU entre los dos nodos del tramo; la pared (d < D) no cambia; bajo ella
// σ = D + κ·(d − D − clamp(d − d₁, 0, L)).
// Orden requerido: compressionSpline escribe s28R para la línea actual antes de cada llamada al perfil. El perfil
// sólo lee esa global; no se puede adelantar ni intercalar una consulta de otra línea entre las dos llamadas.
// @twin s0028-compresion-rigida
const RIGID_FETCH = (i: string, t: string) =>
  /* glsl */ `s28R=mix(sceneTexel(${RIGID_BASE}+${i}).xyz,sceneTexel(${RIGID_BASE}+${i}+1).xyz,${t});`;
const RIGID_PROFILE = (f: string) => /* glsl */ `
float ${f}(float depth,vec3 v,out float gd,out vec3 gp){
  bool wall=depth<v.z;
  float g=${f}0(wall?depth:v.z+s28R.x*(depth-v.z-clamp(depth-s28R.y,0.0,s28R.z)),v,gd,gp);
  gd*=wall?1.0:depth>s28R.y&&depth<s28R.y+s28R.z?0.0:s28R.x;
  return g;
}`;

type Replace = (source: string, type: string, name: string, replacement: string) => string;
/** Sustituye en la fuente s0028 la clasificación interior y la de entrada por la política P3; el resto no cambia. */
export function s0028SolidsShader(source: string, replace: Replace): string {
  const start = source.search(/void\s+classifyInside\s*\(/);
  const body = source.slice(start);
  // Los tubos (bucle preexistente de vasos y conductos, la VCI y su cara) se conservan letra a letra.
  const from = body.search(/int\s+\w+\s*=\s*-1\s*;\s*float\s+\w+\s*=\s*1e9\s*;/),
    to = body.search(/if\s*\(\s*dDome\s*<\s*0\.0\s*\)/);
  if (start < 0 || from < 0 || to < from) throw new Error('Falta la clasificación interior que P3 sustituye');
  let tubes = body.slice(from, to).replace(/float\s+dDome\s*=\s*sdDome\(m,\s*dn\);/, 'dn=vec3(0.0,0.0,-0.5);float dDome=1000.0;');
  // La única ivec2 del tramo es la lista de candidatos de la rejilla de tubos.
  tubes = tubes.replace(/(ivec2\s+(\w+)\s*=\s*\w+\(\w+\);)/, '$1if(renal)$2.y=0;');
  if (!tubes.includes('dDome=1000.0') || !tubes.includes('if(renal)')) throw new Error('Tubos s0028 sin cúpula o sin riñón');
  // El material del páncreas, el bazo, el tubo digestivo y la vejiga sale del dueño P3: sin el bucle de cuatro campos.
  const loop =
    /for\s*\(\s*int\s+(\w+)\s*=\s*0\s*;\s*\1\s*<\s*4\s*;\s*\1\s*\+\+\s*\)\s*\{\s*vec2\s+(\w+)\s*=\s*abdominalAtlasValue\s*\(\s*\w+\s*,\s*\1\s*\)\s*;\s*if\s*\(\s*\2\.x\s*<\s*(\w+)\s*\)\s*\{\s*(\w+)\s*=\s*\1\s*;\s*\3\s*=\s*\2\.x\s*;\s*(\w+)\s*=\s*\2\.y\s*;\s*\}\s*\}/;
  // Su función: la última cabecera bool f(vec3, inout Cls) antes de la búsqueda (sin escribir su nombre, que el build acorta).
  const at = source.search(loop),
    abdomen = [...source.slice(0, at).matchAll(/bool\s+\w+\s*\(\s*vec3\s+(\w+)\s*,\s*inout\s+Cls\s+(\w+)\s*\)\s*\{/g)].pop();
  if (at < 0 || !abdomen) throw new Error('Falta la búsqueda de cuatro campos del abdomen');
  let open = source.indexOf('{', abdomen.index),
    end = open + 1;
  for (let depth = 1; depth; end++) depth += source[end] === '{' ? 1 : source[end] === '}' ? -1 : 0;
  const query = source.slice(open, end);
  if (!loop.test(query)) throw new Error('La búsqueda de cuatro campos no está en su función');
  const s28Abdomen =
    `bool s28PAbdomen(vec3 ${abdomen[1]},int s28f,float s28d,inout Cls ${abdomen[2]})` +
    query.replace(loop, `$4=s28f;$3=s28d;$5=s28f==1?mod(s28PLA(${abdomen[1]},7),128.0):0.0;`);
  open = source.search(/void\s+classifyInside\s*\(/);
  let changed = source.slice(0, open) + S0028_SOLIDS_GLSL + s28Abdomen + '\n' + source.slice(open);
  changed = replace(changed, 'void', 'classifyInside', '');
  changed = replace(changed, 'Cls', 'classifyWith', S0028_CLASSIFY_GLSL(tubes));
  // La cara renal es el borde O de la máscara de esta persona: su gradiente analítico, no el del riñón de la otra.
  changed = replace(changed, 'vec3', 'renalAtlasFaceGradient', RENAL_FACE_GLSL);
  // Compresión rígida: la tabla del tramo de nodos con la B-spline y el perfil sobre σ(d), sin escribir sus nombres.
  const spline = changed.match(/vec4\s+\w+\s*\(\s*int\s+(\w+)\s*,\s*float\s+(\w+)\s*,\s*out\s+vec3\s+\w+\s*\)\s*\{/),
    profile = changed.match(/float\s+(\w+)\s*\(\s*float\s+\w+\s*,\s*vec3\s+\w+\s*,\s*out\s+float\s+\w+\s*,\s*out\s+vec3\s+\w+\s*\)\s*\{/);
  if (!spline || !profile) throw new Error('Falta el perfil de compresión que P3 hace rígido');
  changed = changed.replace(spline[0], 'vec3 s28R;\n' + spline[0] + RIGID_FETCH(spline[1], spline[2]));
  let close = changed.indexOf(profile[0]) + profile[0].length;
  for (let depth = 1; depth; close++) depth += changed[close] === '{' ? 1 : changed[close] === '}' ? -1 : 0;
  changed =
    changed.slice(0, close).replace(profile[0], profile[0].replace(profile[1], profile[1] + '0')) +
    RIGID_PROFILE(profile[1]) +
    changed.slice(close);
  return changed;
}
