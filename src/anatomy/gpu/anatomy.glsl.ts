import { THORACIC_GLSL } from '../thoracicAtlas';
import { SCENE_TUBE_CAPACITY } from '../tubeCapacity';
import { RESPIRATORY_INVERSE_STEPS } from '../deformation';
import { BOWEL_TEXELS } from '../organs/bowel';
import { CARTILAGE_GLSL } from './referenceCartilage.glsl';
import { CARTILAGE_ROWS } from '../referenceCartilageData';
import { BODY_MAX_ROWS, BODY_STRIDE } from '../referenceBody';
/**
 * Fragmento GLSL compartido: la misma anatomía implícita que `anatomy/scene.ts`,
 * evaluada en la GPU a partir de los mismos datos declarativos. Los tubos
 * (vasos y conductos) viajan en una textura de datos RGBA32F (`uSceneTex`,
 * decisión 24) y las primitivas en uniformes. Mantener las dos implementaciones
 * sincronizadas es una regla del proyecto (ver docs/DECISIONS.md); el test
 * `anatomy.test.ts` fija la versión TS.
 *
 * Disposición de la textura (índice lineal i → texel (i & 255, i >> 8)):
 *   tubo t (lista COMPACTA del cuadro: solo los que cortan la losa del plano), cabecera en TUBE_HEADER_TEXELS (5) texels
 *   desde t·5:
 *     H0 = (inicio de nodos, n.º nodos, apScale, escala de radio)
 *     H1 = (espesor de pared mm, tejido de pared, tejido de la luz, cara de la luz: `Interface`, decisión 57)
 *     H2 = (u_ref mm/s, r_ref mm, exponente del perfil, índice original del tubo: la semilla del ruido de su radio)
 *     H3 = esfera envolvente (cx, cy, cz, R)
 *     H4 = forma orgánica del instante (decisión 90, `tubeShapeTexel`): (wt = ŵ·√κ_ef, amplitud del ruido del radio);
 *          0 sin forma y (0, 0, 0, −1) con el radio smoothstep entre nodos (la VCI infrahepática, `Tube.smoothRadius`)
 *   nodos desde NODE_BASE = MAX_TUBES·5: (x, y, z, r)
 *   tabla de la compresión de la sonda desde COMPRESSION_BASE = NODE_BASE + MAX_NODES (decisión 63,
 *   `anatomy/compression.ts`): un téxel por nodo de la cara, (s₀ mm, s_D mm, D mm, R mm)
 */
import { BOWEL_BD_CAP_MM, DIAPHRAGM_THICKNESS_MM, LIVER_CAPSULE_MM, TISSUE_GLSL_NAME } from '../tissues';
import {
  VERTEBRAL_FIELD_REACH_MM,
  FACE_GRADIENT_EPS_MM,
  FIRST_WALL_INTERFACE,
  INTERFACE_COUNT,
  INTERFACE_GLSL_NAME,
  LAST_TUBE_INTERFACE,
  LAST_WALL_INTERFACE,
  GALLBLADDER_CONTACT_MM,
  MORISON_CONTACT_MM,
  MORISON_SLIVER_MM,
} from '../interfaces';
import { COMPRESSION_GLSL, PROBE_COMPRESSION } from '../compression';
import { ORGAN_GLSL } from '../organs';
import { DIAPHRAGM_AXIS_CORE, DIAPHRAGM_JOIN_MM, RIB_ANTERIOR_END, SPINE_SHAPE, TUBE_SHAPE } from '../primitives';
import { MAX_RIBS, SCENE_UNIFORMS_GLSL } from './sceneUniforms';

export const MAX_TUBES = SCENE_TUBE_CAPACITY;
export const MAX_NODES = 640;
/** Texels de la cabecera de cada tubo (H0–H4; H4, la forma orgánica, desde la decisión 90). */
export const TUBE_HEADER_TEXELS = 5;
export const NODE_BASE = MAX_TUBES * TUBE_HEADER_TEXELS;
export const SCENE_TEX_W = 256;
/** Segmentos por tubo que recorre el shader (`tubeQuery`): un tubo con más nodos se truncaría. */
export const MAX_TUBE_SEGMENTS = 8;

/** Primer téxel de la tabla de compresión de la sonda (decisión 63): tras los nodos de los tubos. */
export const COMPRESSION_BASE = NODE_BASE + MAX_NODES;
export const BODY_BASE = COMPRESSION_BASE + PROBE_COMPRESSION.nodes;
export const RIB_BASE = BODY_BASE + Math.ceil((BODY_MAX_ROWS * BODY_STRIDE) / 4);
/** Tres téxeles por par: z/tilt/sección, forma transversal, extremo y flags. */
export const RIB_TEXELS = 3;
export const CARTILAGE_BASE = RIB_BASE + MAX_RIBS * RIB_TEXELS;
export const BOWEL_BASE = CARTILAGE_BASE + CARTILAGE_ROWS.length;
export const SCENE_TEX_H = Math.ceil((BOWEL_BASE + BOWEL_TEXELS) / SCENE_TEX_W);
export { MAX_RIBS } from './sceneUniforms';

const TISSUE_DEFINES = Object.entries(TISSUE_GLSL_NAME)
  .map(([index, name]) => `#define ${name} ${index}`)
  .join('\n');
/** Caras de interfaz (`anatomy/interfaces.ts`): `#define IF_… índice`. */
const INTERFACE_DEFINES = Object.entries(INTERFACE_GLSL_NAME)
  .map(([index, name]) => `#define ${name} ${index}`)
  .join('\n');

export const ANATOMY_GLSL = /* glsl */ `
#define MAX_TUBES ${MAX_TUBES}
#define MAX_NODES ${MAX_NODES}
#define SCENE_TEX_W ${SCENE_TEX_W}
#define MAX_TUBE_SEGMENTS ${MAX_TUBE_SEGMENTS}
#define NODE_BASE ${NODE_BASE}
#define TUBE_HDR ${TUBE_HEADER_TEXELS}
#define COMP_BASE ${NODE_BASE + MAX_NODES}
#define BOWEL_BASE ${BOWEL_BASE}
#define MAX_RIBS ${MAX_RIBS}
${TISSUE_DEFINES}
${INTERFACE_DEFINES}
#define IFACE_COUNT ${INTERFACE_COUNT}
#define IF_LAST_TUBE ${LAST_TUBE_INTERFACE}
#define IF_FIRST_WALL ${FIRST_WALL_INTERFACE}
#define IF_LAST_WALL ${LAST_WALL_INTERFACE}
#define MORISON_CONTACT_MM ${MORISON_CONTACT_MM.toFixed(3)}
#define MORISON_SLIVER_MM ${MORISON_SLIVER_MM.toFixed(3)}
#define GALLBLADDER_CONTACT_MM ${GALLBLADDER_CONTACT_MM.toFixed(3)}
#define VERTEBRAL_REACH ${VERTEBRAL_FIELD_REACH_MM.toFixed(1)}
#define FACE_GRAD_EPS ${FACE_GRADIENT_EPS_MM.toFixed(3)}
#define DIAPHRAGM_MM ${DIAPHRAGM_THICKNESS_MM.toFixed(3)}
#define CAPSULE_MM ${LIVER_CAPSULE_MM.toFixed(3)}
#define BOWEL_BD_CAP_MM ${BOWEL_BD_CAP_MM.toFixed(3)}
#define SPINE_ASPECT ${SPINE_SHAPE.aspect.toFixed(4)}
#define SPINE_LEVEL ${SPINE_SHAPE.levelMm.toFixed(3)}
#define SPINE_BODY ${SPINE_SHAPE.bodyMm.toFixed(3)}
#define SPINE_Z0 ${SPINE_SHAPE.z0Mm.toFixed(3)}
#define SPINE_RIM ${SPINE_SHAPE.rimMm.toFixed(3)}

${SCENE_UNIFORMS_GLSL}

struct Cls {
  int tissue;
  float bd;       // distancia a la interfaz (mm)
  vec3 n;         // normal de la interfaz; en los tubos, el gradiente de su distancia SIN normalizar
  int iface;      // cara que dibuja esta muestra (Interface, decisión 57) o IF_NONE
  float ifd;      // valor (mm) de la distancia de esa cara en la muestra; 1e3 sin cara. Por la normal es
                  // ifd/|∇| (faceGradient): la VCI elíptica tiene |∇| = 1/apScale en sus paredes AP
  int vessel;     // índice de tubo o -1
  float rho;      // fracción radial
  vec3 tangent;   // eje del tubo o, en la cara de una costilla, de la costilla (decisión 62)
  float kc;       // curvatura circunferencial (1/mm) de la cara de un tubo (tubeQuery) o de la sección costal
  float uRef;
  float rRef;
  float profN;
};

vec4 sceneTexel(int i) { return texelFetch(uSceneTex, ivec2(i % SCENE_TEX_W, i / SCENE_TEX_W), 0); }

${THORACIC_GLSL}
vec4 ribData(int k) { return sceneTexel(${RIB_BASE} + k * ${RIB_TEXELS}); }
vec4 ribShapeData(int k) { return sceneTexel(${RIB_BASE} + k * ${RIB_TEXELS} + 1); }
vec4 ribEndData(int k) { return sceneTexel(${RIB_BASE} + k * ${RIB_TEXELS} + 2); }
float bodyValue(int i) { return sceneTexel(${BODY_BASE} + i / 4)[i % 4]; }
vec4 bodyInfo(float phi, float z, out float dc) {
  float step = (120.0 - uBodyMinZ) / float(uBodyRows - 1);
  float zz = clamp((z - uBodyMinZ) / step, 0.0, float(uBodyRows-1));
  int row = min(uBodyRows-2, int(floor(zz))); float f = zz - float(row);
  float angle = fract(phi / 6.28318530718) * 64.0;
  int i = int(floor(angle)), j = (i + 1) % 64; float g = fract(angle);
  float a = bodyValue(row * 65 + 1 + i), b = bodyValue(row * 65 + 1 + j);
  float c = bodyValue((row + 1) * 65 + 1 + i), d = bodyValue((row + 1) * 65 + 1 + j);
  float r0 = mix(a, b, g), r1 = mix(c, d, g);
  float cy0 = bodyValue(row * 65), cy1 = bodyValue((row + 1) * 65);
  bool inside = z >= uBodyMinZ && z <= 120.0;
  dc = inside ? (cy1 - cy0) / step : 0.0;
  return vec4(mix(r0, r1, f), mix(b - a, d - c, f) * 64.0 / 6.28318530718, inside ? (r1 - r0) / step : 0.0, mix(cy0, cy1, f));
}
vec3 bodyGradient(vec3 p) {
  float dc; vec4 centre = bodyInfo(0.0, p.z, dc);
  vec2 xy = vec2(p.x, p.y - centre.w); float radius = length(xy);
  if (radius < 1e-6) return vec3(0,1,0);
  vec4 info = bodyInfo(atan(xy.y, xy.x), p.z, dc);
  vec2 gradient = xy / radius + info.y * vec2(xy.y, -xy.x) / (radius * radius);
  return vec3(gradient, -info.z - dc * gradient.y);
}
float torsoDepth(vec3 p) {
  if (uReferenceBody == 1) { float dc; vec4 centre = bodyInfo(0.0, p.z, dc); vec2 xy = vec2(p.x, p.y - centre.w); return length(xy) - bodyInfo(atan(xy.y, xy.x), p.z, dc).x; }
  p.y -= uTorsoY;
  float u = p.x / uTorso.x;
  float v = p.y / uTorso.y;
  float rho = sqrt(u * u + v * v);
  float localR = rho > 0.0 ? length(p.xy) / rho : min(uTorso.x, uTorso.y);
  return (rho - 1.0) * localR;
}

vec3 torsoNormal(vec3 p) {
  if (uReferenceBody == 1) return normalize(bodyGradient(p));
  p.y -= uTorsoY;
  vec2 n = vec2(p.x / (uTorso.x * uTorso.x), p.y / (uTorso.y * uTorso.y));
  float l = length(n);
  return l > 0.0 ? vec3(n / l, 0.0) : vec3(0.0, 1.0, 0.0);
}

float respWeight(vec3 m) {
  float inside = -torsoDepth(m) - (uWall.x + uWall.y + uWall.z);
  float wWall = smoothstep(0.0, 25.0, inside);
  float dSpine = length(m.xy - uSpine.xy);
  float wSpine = smoothstep(uSpine.z + 5.0, uSpine.z + 35.0, dSpine);
  return wWall * wSpine;
}

${COMPRESSION_GLSL}
// Mundo → material: la compresión de la sonda (decisión 63) y después la respiración (deformation.ts)
vec3 toMaterial(vec3 p) {
  vec3 q = uncompress(p);
  vec3 m = q;
  float D = uResp.x;
  if (D != 0.0) {
    float first = respWeight(q);
    if (first > 0.0) {
      m = q - D * uResp.yzw;
      float last = respWeight(m);
      if (last < 1.0) {
        float lo = 0.0, hi = 1.0, flo = -first, fhi = 1.0 - last;
        for (int i = 0; i < ${RESPIRATORY_INVERSE_STEPS}; i++) {
          float a = 0.5 * (lo + hi);
          m = q - (D * a) * uResp.yzw;
          float f = a - respWeight(m);
          if (f < 0.0) { lo = a; flo = f; } else { hi = a; fhi = f; }
        }
        float a = clamp((lo * fhi - hi * flo) / max(fhi - flo, 1e-20), lo, hi);
        m = q - (D * a) * uResp.yzw;
      }
    }
  }
  return m;
}

vec3 tissueVelocity(vec3 m) {
  return uResp.yzw * (uRespVel * respWeight(m));
}

float domeLift(float x, float y, vec4 dome) {
  float u = (x - dome.x) / dome.z;
  float v = (y - dome.y) / dome.w;
  float rho2 = u * u + v * v;
  return sqrt(max(0.0, 1.0 - rho2 * rho2));
}

// Altura del diafragma: inserción costal (0 en el xifoides, −50 en flancos y espalda) +
// la hemicúpula más alta (misma construcción que primitives.diaphragmHeight)
vec2 hepaticDomeValue(vec2 p);
vec2 registeredDomeValue(vec2 p);
vec4 registeredDomeSample(vec2 p);
float abdominalAtlasSdf(vec3 p, int k);
float domeHeight(float x, float y) {
  vec2 registered = registeredDomeValue(vec2(x,y));
  if(registered.y>0.0)return registered.x;
  vec2 uv = vec2(x / uTorso.x, (y - uTorsoY) / uTorso.y);
  float rho = length(uv);
  float edge = uDiaphragm.z + uDiaphragm.w * smoothstep(0.0, ${DIAPHRAGM_AXIS_CORE.toFixed(3)}, rho) * pow(max(0.0, uv.y) / max(rho, 1e-20), 1.5);
  float zr = edge + max(0.0, uDiaphragm.x - edge) * domeLift(x, y, uDomeR);
  float zl = edge + max(0.0, uDiaphragm.y - edge) * domeLift(x, y, uDomeL);
  float k = ${DIAPHRAGM_JOIN_MM.toFixed(3)} * smoothstep(0.0, ${(2 * DIAPHRAGM_JOIN_MM).toFixed(3)}, 0.5 * (zr + zl) - edge);
  // Branchless: esta función se expande dentro del clasificador y sus gradientes.
  float h = max(k - abs(zr - zl), 0.0) / max(k, 1e-20);
  float height = max(zr, zl) + h * h * k * 0.25;
  vec2 contact = hepaticDomeValue(vec2(x,y));
  return mix(height,contact.x,contact.y);
}

// Distancia con signo al diafragma (negativa en el tórax) y normal hacia el abdomen.
float sdDome(vec3 p, out vec3 n) {
  vec4 registered=registeredDomeSample(p.xy);
  float zd=registered.w>0.0?registered.x:domeHeight(p.x,p.y),h=0.5;
  float gx=registered.w>0.0?registered.y:(domeHeight(p.x+h,p.y)-domeHeight(p.x-h,p.y))/(2.0*h);
  float gy=registered.w>0.0?registered.z:(domeHeight(p.x,p.y+h)-domeHeight(p.x,p.y-h))/(2.0*h);
  float slope=sqrt(1.0+gx*gx+gy*gy);n=normalize(vec3(gx,gy,-1.0));
  float tangentDistance=(zd-p.z)/slope;
  if(registered.w>0.0){
    vec2 xy=p.xy,g=vec2(gx,gy);float height=zd,best=abs(zd-p.z);
    for(int i=0;i<3;i++){
      float delta=height-p.z+dot(g,p.xy-xy);xy=p.xy-g*delta/(1.0+dot(g,g));
      vec4 sample=registeredDomeSample(xy);
      if(sample.w>0.0){height=sample.x;g=sample.yz;}
      else{
        height=domeHeight(xy.x,xy.y);
        g=vec2(domeHeight(xy.x+h,xy.y)-domeHeight(xy.x-h,xy.y),domeHeight(xy.x,xy.y+h)-domeHeight(xy.x,xy.y-h))/(2.0*h);
      }
      best=min(best,length(vec3(xy-p.xy,height-p.z)));
    }
    tangentDistance=zd<p.z?-best:best;
  }
  if(uAbdominalAtlasEnabled==0)return tangentDistance;
  float contact=hepaticDomeValue(p.xy).y*(1.0-smoothstep(6.0,12.0,zd-p.z));
  // faceGradient evaluates the actual shell for interface echoes. Keep the
  // finite height normal here, including above the source brick (zero gradient).
  float liverDistance=abdominalAtlasSdf(p,4);
  float distance=mix(tangentDistance,DIAPHRAGM_MM-liverDistance,contact);
  float obstacleWeight=1.0-smoothstep(DIAPHRAGM_MM,DIAPHRAGM_MM+1.5,liverDistance);
  return mix(distance,max(distance,DIAPHRAGM_MM-liverDistance),obstacleWeight);
}

float sdEllipsoid(vec3 p, vec3 c, vec3 r, float taperX, out vec3 n) {
  float dx = p.x - c.x;
  float taper = max(0.15, 1.0 - taperX * (dx / r.x));
  vec3 rr = vec3(r.x, r.y * taper, r.z * taper);
  vec3 k = (p - c) / rr;
  float k1 = length(k);
  float k2 = length(k / rr);
  n = normalize(k / rr);
  return k2 > 0.0 ? (k1 * (k1 - 1.0)) / k2 : -min(r.x, min(r.y, r.z));
}

float sdEllipsoidLocal(vec3 q, vec3 r) {
  vec3 k = q / r;
  float k1 = length(k);
  float k2 = length(k / r);
  return k2 > 0.0 ? (k1 * (k1 - 1.0)) / k2 : -min(r.x, min(r.y, r.z));
}

float smoothMin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

float smoothMax(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return max(a, b) + h * h * k * 0.25;
}

float abdominalAtlasSdf(vec3 p, int k);

// Columna (PR119; recuperación provisional de la decisión 103, primitives.SPINE_SHAPE): semiejes de la elipse de los cuerpos (la misma área que el círculo de
// radio uSpine.z) y (distancia al cilindro elíptico, a los cuerpos en z: positiva en un disco)
vec2 spineRadii() { return vec2(uSpine.z * SPINE_ASPECT, uSpine.z / SPINE_ASPECT); }
vec2 spineBodyParts(vec3 m) {
  float t = m.z - SPINE_Z0;
  return vec2(sdEllipsoidLocal(vec3(m.xy - uSpine.xy, 0.0), vec3(spineRadii(), 1e3)), abs(t - SPINE_LEVEL * floor(t / SPINE_LEVEL + 0.5)) - 0.5 * SPINE_BODY);
}
// los cuerpos, con el borde del platillo redondeado (spineBodySd de TS): la cara de su cortical
float spineBodySd(vec3 m) { vec2 d = spineBodyParts(m);float b=smoothMax(d.x,d.y,SPINE_RIM);if(uAbdominalAtlasEnabled!=0){vec2 q=thoracicValue(m);return min(thoracicMaterial(q.y)==2?q.x:16.0,abdominalAtlasSdf(m,8));}return b; }
// el arco posterior (spineArchSd de TS)
float spineArchSd(vec3 m) {
  float ax = abs(m.x - uSpine.x) - uSpineArch.x;
  float ay = abs(m.y - 0.5 * (uSpineArch.y + uSpineArch.z)) - 0.5 * (uSpineArch.z - uSpineArch.y);
  float d=length(max(vec2(ax,ay),0.0))+min(max(ax,ay),0.0);return uAbdominalAtlasEnabled!=0?16.0:d;
}
// curvatura de la cara de un cuerpo (spineFaceCurvature de TS): la de la elipse en su costado, 0 en los platillos
float spineFaceCurvature(vec3 m) {
  vec2 d = spineBodyParts(m);
  if (d.y > d.x) return 0.0;
  vec2 r = spineRadii();
  vec2 k = (m.xy - uSpine.xy) / r;
  float kl = length(k);
  if (kl < 1e-6) return 0.0;
  float q = length(vec2(r.x * k.y, r.y * k.x)) / kl;
  return r.x * r.y / (q * q * q);
}

float sdSphere(vec3 p, vec4 s, out vec3 n) {
  vec3 d = p - s.xyz;
  float l = length(d);
  n = l > 0.0 ? d / l : vec3(0.0, 1.0, 0.0);
  return l - s.w;
}

${CARTILAGE_GLSL(CARTILAGE_BASE)}

// Cota inferior del arco óseo; el cartílago registrado no comparte su intervalo z.
float ribDistanceLowerBound(vec3 p, int k) {
  vec4 rib = ribData(k), shape = ribShapeData(k);
  float amplitude = length(vec2(rib.y * 0.5, shape.w));
  float dz = max(0.0, abs(p.z - rib.x - rib.y * 0.5) - amplitude);
  return min(1e3, (dz / rib.z - 1.0) * min(rib.z, rib.w));
}

// Costilla: devuelve distancia y si es cartílago (φ anterior)
float sdRibBone(vec3 p, int k, out bool cartilage, out vec3 n) {
  vec4 rib = ribData(k), shape = ribShapeData(k);
  float mirror = p.x > 0.0 ? -1.0 : 1.0;
  p.x = -abs(p.x);
  vec2 xy = vec2(p.x, p.y - shape.z);
  vec2 uv = xy / shape.xy;
  float rho = length(uv);
  float phi = atan(uv.y, uv.x);
  float endX = ribEndData(k).x;
  cartilage = ribEndData(k).y < 0.5 && (abs(phi - 1.5707963) < 1.5707963 - uRibParams.y || (xy.y > 0.0 && p.x > endX - ${RIB_ANTERIOR_END.cartilageTailMm.toFixed(4)}));
  if ((xy.y > 0.0 && p.x > endX) || (p.y < uSpine.y && abs(p.x - uSpine.x) < uSpineArch.x + 6.0)) return 1e3;
  float radius = length(xy);
  float dRadial = rho > 0.0 ? radius * (1.0 - 1.0 / rho) : -min(shape.x, shape.y);
  float zRib = rib.x + rib.y * (0.5 - 0.5 * sin(phi)) + shape.w * cos(phi);
  float dz = p.z - zRib;
  vec2 q = vec2(dRadial / rib.w, dz / rib.z);
  vec2 gr = rho > 1e-6 ? xy / max(radius, 1e-6) * (1.0 - 1.0 / rho) + radius * xy / (shape.xy * shape.xy * rho * rho * rho) : vec2(0,1);
  vec2 gp = vec2(-xy.y, xy.x) / (shape.x * shape.y * max(rho * rho, 1e-6));
  float zp = -0.5 * rib.y * cos(phi) - shape.w * sin(phi);
  vec3 gradient = vec3(dRadial / (rib.w * rib.w) * gr - dz / (rib.z * rib.z) * zp * gp, dz / (rib.z * rib.z));
  gradient.x *= mirror;
  n = length(gradient) > 1e-6 ? normalize(gradient) : vec3(0,1,0);
  float sectionD = (length(q) - 1.0) * min(rib.w, rib.z);
  float frontPhi = ribEndData(k).w;
  float angle = phi < 0.0 ? phi + 6.28318530718 : phi;
  float capD = (frontPhi - angle) * (rho > 0.0 ? radius / rho : 1.0);
  if (frontPhi > 0.0 && capD > sectionD) n = normalize(vec3(-gp.x * mirror, -gp.y, 0.0));
  return frontPhi > 0.0 ? max(sectionD, capD) : sectionD;
}

float sdRib(vec3 p, int k, out bool cartilage, out vec3 n) {
  float d = sdRibBone(p, k, cartilage, n);
  if (ribEndData(k).z > 0.5) {
    vec3 tangent; float curvature;
    float cd = referenceCartilage(p, tangent, curvature);
    if (cd < d) {
      cartilage = true;
      if (cd < 0.0) {
      vec3 ex = vec3(0.001,0,0), ey = vec3(0,0.001,0), ez = vec3(0,0,0.001);
      vec3 gradient = vec3(referenceCartilage(p+ex,tangent,curvature)-referenceCartilage(p-ex,tangent,curvature), referenceCartilage(p+ey,tangent,curvature)-referenceCartilage(p-ey,tangent,curvature), referenceCartilage(p+ez,tangent,curvature)-referenceCartilage(p-ez,tangent,curvature));
      n = length(gradient) > 1e-6 ? normalize(gradient) : vec3(0,1,0);
      }
      return cd;
    }
  }
  return d;
}

// Ruido del radio a lo largo del eje de un tubo (decisión 90; gemelos TS tubeHash, tubeNoise en anatomy/primitives.ts): hash
// entero de la semilla del tubo (su índice original, H2.w) y de la celda de la longitud de arco
uint tubeHash(uint x) { x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u; return x; }
float tubeCell(uint seed, float c) { return float(tubeHash((seed << 16u) ^ uint(c) ^ ${TUBE_SHAPE.salt >>> 0}u) >> 8u) / 8388608.0 - 1.0; }
float tubeNoise(uint seed, float arc, out float dN) {
  float x = arc / ${TUBE_SHAPE.latticeMm.toFixed(4)};
  float c = floor(x);
  float f = x - c;
  float v0 = tubeCell(seed, c);
  float v1 = tubeCell(seed, c + 1.0);
  dN = (v1 - v0) * 6.0 * f * (1.0 - f) / ${TUBE_SHAPE.latticeMm.toFixed(4)};
  return v0 + (v1 - v0) * f * f * (3.0 - 2.0 * f);
}

// Consulta de tubo, la del bucle de tubos de classifyWith: distancia con signo, rho y radio local, y el mejor segmento
// (índice, parámetro y longitud de arco) para su cara. El segmento se elige por la distancia sin el ruido del radio
// (continuo en la longitud de arco) y el ruido se aplica una vez, en él, y solo con la muestra a menos de 1,5 mm (+ amp·r,
// el ruido máximo) de la luz lineal: más allá ninguna pared la alcanza (ninguna pasa de ese grosor), así que el tubo no la
// clasifica y su distancia solo sirve para descartarlo. La cara, tubeFace, solo la del tubo que gana y fuera de los
// bucles (decisión 90). Gemelos TS: tubeQuery y tubeFaceGradient (anatomy/primitives.ts), con la distancia siempre con ruido.
float tubeQuery(vec3 p, int t, out float rho, out float rLoc, out int seg, out float segS, out float segArc) {
  vec4 h0 = sceneTexel(t * TUBE_HDR);
  int start = int(h0.x + 0.5);
  int count = int(h0.y + 0.5);
  float apScale = h0.z;
  float rs = h0.w;
  // la forma orgánica del instante (H4, decisión 90): la métrica de la sección (wt = h4.xyz, cK = (1 + |wt|²)^(−1/4)) y la
  // amplitud del ruido del radio (h4.w); sin forma, 0, y −1 con el radio smoothstep (la VCI infrahepática)
  vec4 h4 = sceneTexel(t * TUBE_HDR + 4);
  float cK = inversesqrt(sqrt(1.0 + dot(h4.xyz, h4.xyz)));
  bool smoothR = h4.w < 0.0;
  // cada nodo se lee una vez: el extremo b de un segmento es el origen a del siguiente. El número de vueltas es el del tubo:
  // con la cota constante y un cuerpo tan corto, el JIT de SwiftShader desenrollaba el bucle dentro de cada copia de
  // classify y el arranque de la e2e se duplicaba (decisión 90)
  vec4 a = sceneTexel(NODE_BASE + start);
  float best = 1e9; float arc = 0.0; float bDist = 1.0; float bR = 1.0;
  seg = 0; segS = 0.0; segArc = 0.0;
  int segments = min(count - 1, MAX_TUBE_SEGMENTS);
  for (int i = 0; i < segments; i++) {
    vec4 b = sceneTexel(NODE_BASE + start + i + 1);
    vec3 ab = b.xyz - a.xyz;
    float len2 = dot(ab, ab);
    float s = len2 > 0.0 ? clamp(dot(p - a.xyz, ab) / len2, 0.0, 1.0) : 0.0;
    vec3 d = p - a.xyz - ab * s;
    float dist;
    if (apScale != 1.0) {
      // Sección elíptica: se escala la componente perpendicular; la axial se conserva (tapa)
      vec3 tg = ab * inversesqrt(len2);
      float along = dot(d, tg);
      vec3 perp = d - tg * along;
      perp.y /= apScale;
      dist = sqrt(dot(perp, perp) + along * along);
    } else {
      float q = dot(d, h4.xyz);
      dist = cK * sqrt(dot(d, d) + q * q);
    }
    // el radio entre nodos: lineal, y en la VCI infrahepática smoothstep, sin quiebros (decisión 90)
    float r = (a.w + (b.w - a.w) * (smoothR ? s * s * (3.0 - 2.0 * s) : s)) * rs;
    float len = sqrt(len2);
    if (dist - r < best) { best = dist - r; seg = i; segS = s; segArc = arc + s * len; bDist = dist; bR = r; }
    arc += len;
    a = b;
  }
  // el ruido del radio a lo largo del eje (sin él en los tubos sin forma: amp ≤ 0)
  float dN;
  bool near = bDist - bR < ${TUBE_SHAPE.noiseReachMm.toFixed(4)} + h4.w * bR;
  float r = bR * (1.0 + (h4.w > 0.0 && near ? h4.w * tubeNoise(uint(sceneTexel(t * TUBE_HDR + 2).w + 0.5), segArc, dN) : 0.0));
  rho = bDist / max(1e-6, r);
  rLoc = r;
  return bDist - r;
}

// Cara del tubo t en su segmento seg (parámetro s, longitud de arco arc), la del que gana en classifyWith: su eje (la
// tangente del flujo), el gradiente de su distancia (SIN normalizar: su norma pasa ifd a distancia por la normal; dentro
// del segmento el radio crece con s y con el ruido: ∇r a lo largo del eje) y la curvatura circunferencial de la cara,
// ĉᵀQĉ/(r·|∇dist|) con ĉ normal a la cara y al eje y Q la métrica de la sección: en la VCI S² = diag(1, 1/apScale², 1)
// (apScale/r en las paredes AP y 1/(apScale²·r) en las laterales; con 1/r la pared lateral de una VCI aplanada salía 2 dB
// brillante); con la forma, cK²·(I + wt·wtᵀ). Gemelo TS: tubeFaceGradient.
void tubeFace(vec3 p, int t, int seg, float s, float arc, out vec3 tangent, out vec3 n, out float kc) {
  vec4 h0 = sceneTexel(t * TUBE_HDR);
  int start = int(h0.x + 0.5);
  float apScale = h0.z;
  float rs = h0.w;
  vec4 h4 = sceneTexel(t * TUBE_HDR + 4);
  vec3 wt = h4.xyz;
  float amp = max(h4.w, 0.0);
  bool smoothR = h4.w < 0.0;
  float cK = inversesqrt(sqrt(1.0 + dot(wt, wt)));
  vec4 a = sceneTexel(NODE_BASE + start + seg);
  vec4 b = sceneTexel(NODE_BASE + start + seg + 1);
  vec3 ab = b.xyz - a.xyz;
  float len = length(ab);
  vec3 tg = ab / max(len, 1e-6);
  vec3 d = p - a.xyz - ab * s;
  float dN = 0.0;
  float nz = amp > 0.0 ? tubeNoise(uint(sceneTexel(t * TUBE_HDR + 2).w + 0.5), arc, dN) : 0.0;
  float rLin = (a.w + (b.w - a.w) * (smoothR ? s * s * (3.0 - 2.0 * s) : s)) * rs;
  float r = rLin * (1.0 + amp * nz);
  bool inside = s > 0.0 && s < 1.0;
  vec3 gd;
  float dist;
  float cq;
  if (apScale != 1.0) {
    // el gradiente escala la componente AP DOS veces (no una, como d/dist): la normal del cuerpo de
    // la VCI se apartaba 6–10° del gradiente (e2e de normales del PR 5a)
    float along = dot(d, tg);
    vec3 q = d - tg * along;
    q.y /= apScale;
    dist = sqrt(dot(q, q) + along * along);
    q.y /= apScale;
    gd = (q - tg * dot(q, tg) + tg * along) / max(dist, 1e-6);
  } else {
    float q = dot(d, wt);
    float F = sqrt(dot(d, d) + q * q);
    dist = cK * F;
    gd = cK * (d + q * wt) / max(F, 1e-6);
    if (inside) gd -= tg * dot(gd, tg);
  }
  float taper = inside ? rs * (b.w - a.w) * (smoothR ? 6.0 * s * (1.0 - s) : 1.0) / max(len, 1e-6) * (1.0 + amp * nz) + rLin * amp * dN : 0.0;
  vec3 gn = gd - tg * taper;
  tangent = tg;
  n = dist > 0.0 && dot(gn, gn) > 0.0 ? gn : vec3(0.0, 1.0, 0.0);
  kc = 1.0 / r;
  vec3 cc = cross(gd, tg);
  float cl = length(cc);
  if (dist > 0.0 && cl > 1e-6) {
    vec3 ch = cc / cl;
    cq = apScale != 1.0 ? 1.0 + ch.y * ch.y * (1.0 / (apScale * apScale) - 1.0) : cK * cK * (1.0 + dot(ch, wt) * dot(ch, wt));
    kc = cq / (r * length(gd));
  }
}

// Módulos de órgano (anatomy/organs/*): gemelos GLSL de sus funciones TS
// Misma unión cuerpo/arco que sdSpine en primitives.ts.
float spineSd(vec3 m, float blend) {
  float body = spineBodySd(m);
  float arch = spineArchSd(m);
  return blend > 0.0 ? smoothMin(body, arch, blend) : min(body, arch);
}

float spineSd(vec3 m) { return spineSd(m, 0.0); }

${ORGAN_GLSL.join('\n')}
// Exact differential of the shared respiratory weight, where the thoracic profile is differentiable.
vec3 respWeightGradient(vec3 m) {
  float inside = -torsoDepth(m) - (uWall.x + uWall.y + uWall.z);
  vec2 delta = m.xy - uSpine.xy;
  float r = length(delta);
  float a = -smoothstep(uSpine.z + 5.0, uSpine.z + 35.0, r) * smoothstepSlope(0.0, 25.0, inside);
  float b = smoothstep(0.0, 25.0, inside) * smoothstepSlope(uSpine.z + 5.0, uSpine.z + 35.0, r) / max(r, 1e-9);
  if (a == 0.0) return vec3(b * delta, 0.0);
  return a * torsoDepthGrad(m) + vec3(b * delta, 0.0);
}
// Sherman–Morrison: material covectors pass through respiration first, compression second.
Warp anatomyWarpAt(vec3 p, vec3 m) {
  Warp w = warpAt(p);
  if (uResp.x != 0.0) {
    vec3 g = respWeightGradient(m);
    w.respiratory = uResp.x * g / (1.0 + uResp.x * dot(uResp.yzw, g));
  }
  return w;
}


// Profundidad bajo la cara interna de la pared (mm; 0 en la pleura parietal). Gemelo: AnatomyScene.insideWallMm
float insideWallMm(vec3 m) { return -torsoDepth(m) - (uWall.x + uWall.y + uWall.z); }

// La pared de classify: fuera del torso (aire), piel, costillas y las capas de la pared con sus caras (grasa
// subcutánea, músculo y grasa preperitoneal, decisión 62). true si la muestra queda decidida (en c); si no,
// depth y tn (profundidad y normal del torso) sirven al resto de classifyWith. La serie de la pleura (decisión
// 61) remuestrea la pared solo con ella: sin órganos ni tubos. Gemelo: la classifyWall privada de AnatomyScene
bool classifyWall(vec3 m, out Cls c, out float depth, out vec3 tn) {
  c.tissue = T_AIR; c.bd = 1e3; c.n = vec3(0.0, 1.0, 0.0); c.iface = IF_NONE; c.ifd = 1e3; c.vessel = -1;
  c.rho = 10.0; c.tangent = vec3(0.0, 0.0, 1.0); c.kc = 0.0; c.uRef = 0.0; c.rRef = 1.0; c.profN = 2.0;
  depth = torsoDepth(m);
  tn = vec3(0.0, 1.0, 0.0);
  if (m.z < uTorso.z || m.z > uTorso.w || depth > 0.0) return true;
  float skin = uWall.x;
  float wall = skin + uWall.y + uWall.z;
  float d = -depth;
  tn = torsoNormal(m);
  // Capas de la pared (decisión 62, organs/wall.ts): cada muestra dibuja la cara de su capa más cercana
  if (d < skin) { c.tissue = T_SKIN; c.bd = skin - d; c.n = tn; c.iface = IF_SKIN_FAT; c.ifd = skin - d; return true; }
  // Costillas, antes de la grasa subcutánea donde una puede llegar (la grasa no las corta); la ósea más
  // cercana da la cortical al tejido blando de fuera, el cartílago su pericondrio
  float ribD = 1e3; float ribAny = 1e3; int ribI = 0;
  if(uAbdominalAtlasEnabled!=0){
    vec2 q=thoracicValue(m);int material=thoracicMaterial(q.y);ribAny=q.x;ribD=material==1?1e3:q.x;
    if(q.x<0.0){c.tissue=material==1?T_CARTILAGE:material==2?T_VERTEBRA:T_BONE;c.bd=-q.x;c.n=thoracicGradient(m);if(material==1){c.iface=IF_PERICHONDRIUM;c.ifd=-q.x;thoracicFrame(m,c.tangent,c.kc);}return true;}
  } else if (d >= ribSearchDepth()) {
    float sternumD = sternumSd(m);
    if (sternumD < 0.0) {
      c.tissue = m.z < STERNUM_JUNCTION ? T_CARTILAGE : T_BONE; c.bd = -sternumD; c.n = tn;
      if (m.z < STERNUM_JUNCTION) { c.iface = IF_PERICHONDRIUM; c.ifd = -sternumD; c.tangent = vec3(0,0,1); c.kc = 0.0; }
      return true;
    }
    ribAny = sternumD;
    if (m.z >= STERNUM_JUNCTION) { ribD = sternumD; ribI = MAX_RIBS; }
    for (int i = 0; i < MAX_RIBS; i++) {
      if (ribEndData(i).z < 0.5 && ribDistanceLowerBound(m, i) > max(ribAny, ribD) + 0.01) continue;
      bool cart; vec3 rn;
      float rd = sdRib(m, i, cart, rn);
      if (rd < 0.0) {
        c.tissue = cart ? T_CARTILAGE : T_BONE; c.bd = -rd; c.n = rn;
        if (cart) { c.iface = IF_PERICHONDRIUM; c.ifd = -rd; c.tangent = ribTangent(m, i); c.kc = ribCurvature(m, i); }
        return true;
      }
      ribAny = min(ribAny, rd);
      if (!cart && rd < ribD) { ribD = rd; ribI = i; }
    }
  }
  if (d < wall) {
    // coordenadas de la pared solo dentro de ella: fascia profunda y transversalis onduladas en (u, z);
    // debajo de la fascia, músculo hasta la transversalis y la grasa preperitoneal hasta el peritoneo
    float u = wallArc(m);
    vec4 wd = wallDepths(u, m.z);
    c.tissue = d < wd.y ? T_FAT : (d < wd.z ? T_MUSCLE : T_FAT);
    c.bd = d < wd.y ? min(d - skin, wd.y - d) : (d < wd.z ? min(d - wd.y, wd.z - d) : min(d - wd.z, wall - d));
    c.bd = min(c.bd, ribAny / 1.1);
    c.n = tn;
    vec2 wf = wallFace(d, u, m.z, ribD, wd);
    c.iface = int(wf.x + 0.5); c.ifd = wf.y;
    if (c.iface == IF_RIB) { c.tangent = ribTangent(m, ribI); c.kc = ribCurvature(m, ribI); }
    return true;
  }
  return false;
}

// El resto de classifyWith dentro de la cavidad y fuera de la columna (PR119, recuperación provisional de la decisión
// 103): cortina, tubos, tórax, diafragma y vísceras, sobre la c que dejó classifyWall. Gemelo: classifyInside de AnatomyScene
void classifyInside(vec3 m, bool withCurtain, float depth, vec3 tn, float dSpine, inout Cls c) {
  float wall = uWall.x + uWall.y + uWall.z;
  // Cortina pulmonar (módulo de órgano: anatomy/organs/lungCurtain.ts)
  if (withCurtain) {
    float dCurtain = lungCurtainDistance(m, -depth - wall);
    if (dCurtain >= 0.0) { c.tissue = T_LUNG; c.bd = dCurtain; c.n = torsoNormal(m); return; }
  }
  // Vasos y conductos (descarte por esfera envolvente)
  int bestT = -1; float bestD = 1e9; float bRho; float bR; int bSeg = 0; float bSegS = 0.0; float bSegArc = 0.0;
  for (int t = 0; t < MAX_TUBES; t++) {
    if (t >= uTubeCount) break;
    vec4 bs = sceneTexel(t * TUBE_HDR + 3);
    if (distance(m, bs.xyz) > bs.w) continue;
    float rho; float rl; int sg; float ss; float sa;
    float sd = tubeQuery(m, t, rho, rl, sg, ss, sa);
    vec4 hw = sceneTexel(t * TUBE_HDR + 1);
    // pared periportal proporcional al calibre local (misma fórmula que wallThicknessMm)
    float wallMm = int(hw.y + 0.5) == T_WALL_PORTAL ? clamp(0.24 * rl, 0.5, 1.4) : hw.x;
    if (sd < wallMm && sd < bestD) { bestD = sd; bestT = t; bRho = rho; bR = rl; bSeg = sg; bSegS = ss; bSegArc = sa; }
  }
  // la cara del tubo que gana (eje, gradiente y curvatura), una vez y fuera del bucle (decisión 90)
  vec3 bTan = vec3(0.0, 0.0, 1.0); vec3 bN = vec3(0.0, 1.0, 0.0); float bKc = 1.0;
  if (bestT >= 0) tubeFace(m, bestT, bSeg, bSegS, bSegArc, bTan, bN, bKc);
  vec3 sn;
  vec3 dn;
  float dDome = sdDome(m, dn);
  // la VCI que entra en la aurícula derecha (decisión 85, heart.ts): dentro de ella no hay pared (su pared es sangre de la
  // aurícula) ni cara; fuera de la aurícula, por encima de su suelo, no hay VCI (gana el corazón)
  vec4 h1 = vec4(0.0);
  vec3 ivc = vec3(1e3, 0.0, 1e3);
  if (bestT >= 0) {
    h1 = sceneTexel(bestT * TUBE_HDR + 1);
    if (int(h1.w + 0.5) == IF_IVC) ivc = ivcAtrium(m, dDome * max(1.0, -0.5 / dn.z));
  }
  if (bestT >= 0 && ivc.y < 0.5) {
    int iface = int(h1.w + 0.5);
    vec4 h2 = sceneTexel(bestT * TUBE_HDR + 2);
    int wallT = int(h1.y + 0.5);
    int lumenT = int(h1.z + 0.5);
    bool duct = iface == IF_DUCT;
    c.n = bN; c.rho = bRho; c.tangent = bTan; c.kc = bKc;
    c.uRef = h2.x; c.rRef = h2.y; c.profN = h2.z;
    // la cara de la luz: la pared y la luz (sangre o bilis) conocen la misma, a |bestD|
    bool inRa = ivc.x < 0.0;
    c.iface = inRa ? IF_NONE : iface; c.ifd = inRa ? 1e3 : abs(bestD);
    // la VCI: la frontera cuenta la cavidad de la aurícula y, fuera de ella, el suelo por encima del cual no existe
    float cut = inRa ? -ivc.x : ivc.z;
    if (bestD < 0.0) { c.tissue = lumenT; c.bd = min(-bestD, cut); c.vessel = duct ? -1 : int(h2.w + 0.5); return; }
    if (inRa) { c.tissue = T_BLOOD; c.bd = -ivc.x; return; }
    float wallBest = wallT == T_WALL_PORTAL ? clamp(0.24 * bR, 0.5, 1.4) : h1.x;
    c.tissue = wallT; c.bd = min(min(bestD, wallBest - bestD), cut); return;
  }
  // Tórax (corazón, pericardio, mediastino o pulmón: heart.ts, decisión 85) y diafragma
  if (dDome < 0.0) {
    float ifd;
    c.n = dn;
    c.tissue = thorax(m, dDome, c.bd, ifd, c.n);
    // su distancia a la frontera cuenta también la columna y la pared (como el retroperitoneo)
    c.bd = min(c.bd, min(dSpine, -depth - wall));
    if (ifd < 1e3) { c.iface = IF_PERICARDIUM; c.ifd = ifd; }
    return;
  }
  if (dDome < DIAPHRAGM_MM) {
    c.tissue = T_DIAPHRAGM; c.bd = min(dDome, DIAPHRAGM_MM - dDome); c.n = dn;
    // la mitad abdominal dibuja la cara hepática; la pleural la dibuja el espejo exacto de la pasada A
    if (dDome > 0.5 * DIAPHRAGM_MM) { c.iface = IF_DIAPHRAGM_LIVER; c.ifd = DIAPHRAGM_MM - dDome; }
    return;
  }
  vec3 gn;
  float dGb = gallbladderSdf(m, gn);
  if (dGb < 0.0) { c.tissue = T_FLUID; c.bd = -dGb; c.n = gn; c.iface = IF_GALLBLADDER; c.ifd = -dGb; return; }
  if (dGb < uGbExtra.y) { c.tissue = T_BILEWALL; c.bd = min(dGb, uGbExtra.y - dGb); c.n = gn; c.iface = IF_GALLBLADDER; c.ifd = dGb; return; }
  // Riñones; dPeri = distancia a la cara externa de la grasa perirrenal y periThin, si esa grasa es fina (la cápsula
  // hepática que la toca, o que está a una lámina de una fina, no dibuja su cara: Morison es de la grasa)
  float dPeri = 1e3;
  bool periThin = false;
  bool thickFat = false;
  for (int k = 0; k < 2; k++) {
    if (distance(m, uKidC[k]) > uKidR[k].x + uKidExtra.y + 2.0) continue;
    float inner; float dOuter;
    int region = kidneyQuery(m, k, inner, dOuter);
    float fat = perirenalThicknessMm(kidneyLocal(m, k), k);
    float dFat=uAbdominalAtlasEnabled!=0?perirenalOuterSdf(kidneyLocal(m,k),k):dOuter-fat;
    if (dFat < dPeri) { dPeri = dFat; periThin = fat <= PERI.z; }
    vec3 kn;
    kidneyOuter(m, k, kn);
    if (dOuter < 0.0) {
      // 4: los vasos arcuatos (decisión 87), pared arterial sin luz
      c.tissue = region == 4 ? T_ARTERYWALL : (region == 3 ? T_RENAL_PELVIS : (region == 2 ? T_RENAL_SINUS : (region == 1 ? T_RENAL_MEDULLA : T_RENAL_CORTEX)));
      c.bd = min(inner, -dOuter - RENAL_CAPSULE_MM); c.n = kn;
      // la cápsula, salvo en la boca del hilio: dentro del canal del seno su grasa sigue en la perirrenal (decisión 87), y
      // el mismo canal decide la cara de la grasa de fuera
      if (-dOuter < RENAL_CAPSULE_MM) {
        float hcIn = hilumChannelSdf(kidneyLocal(m, k), k);
        if (hcIn > 0.0) {
          c.tissue = T_RENAL_CAPSULE; c.bd = min(min(-dOuter, RENAL_CAPSULE_MM + dOuter), min(inner, hcIn));
          c.iface = IF_RENAL_CAPSULE; c.ifd = -dOuter;
          return;
        }
        c.bd = min(inner, -hcIn);
      }
      return;
    }
    if (dFat < 0.0) {
      // frente a la boca del hilio, sin cápsula que dibujar (decisión 87): el cambio de dueño de la cara cuenta en bd
      float hc = hilumChannelSdf(kidneyLocal(m, k), k);
      c.tissue = T_PERIRENAL; c.bd = min(min(dOuter, -dFat), abs(hc)); c.n = kn;
      // mitad externa de la gruesa: la cara de Morison; la interna y toda la fina (decisión 81: sus dos caras, a 1–2,5 mm,
      // eran dos líneas paralelas), la de la cápsula renal
      bool outerFace = dOuter > 0.5 * fat && fat > PERI.z;
      c.iface = outerFace ? IF_PERIRENAL : (hc > 0.0 ? IF_RENAL_CAPSULE : IF_NONE);
      c.ifd = outerFace ? -dFat : (hc > 0.0 ? dOuter : 1e3);
      if (!outerFace) return;
      // grasa gruesa: su cara externa solo si apoya el hígado (se decide con liverSdf, tras el bucle)
      thickFat = true;
      break;
    }
  }
  if (!thickFat && abdomenQuery(m, c)) return;
  vec3 ln; float dLiverBase;
  float dLiver = liverSdf(m, ln, dLiverBase);
  // la mitad externa de la grasa gruesa dibuja su cara solo contra el hígado (Morison, a ≤ MORISON_CONTACT_MM de ella);
  // si no, se funde sin línea con la grasa retroperitoneal
  if (thickFat) {
    if (dLiver > c.ifd + MORISON_CONTACT_MM) { c.iface = IF_NONE; c.ifd = 1e3; }
    return;
  }
  if (dLiver >= 0.0 && dLiverBase < 0.0) {
    c.tissue = T_LIG_TERES; c.bd = min(-dLiverBase, dLiver); c.n = ln; return;
  }
  if (dLiver < 0.0) {
    float dDia = dDome - DIAPHRAGM_MM;
    float inner = min(-dLiver, min(dDia, -depth - wall));
    // la frontera real del hígado en Morison es la cara externa de la grasa (la impresión renal la solapa 1 mm)
    float bd = min(inner, dPeri);
    c.n = (inner == -dLiver) ? ln : ((inner == dDia) ? dn : tn);
    if (inner < CAPSULE_MM) {
      c.tissue = T_CAPSULE; c.bd = bd;
      // la cara hacia el diafragma es del diafragma; la de Morison, de la grasa perirrenal (en contacto, o a una lámina
      // de una grasa fina); la de la fosa vesicular, de la pared de la vesícula (una sola línea)
      bool morison = dPeri <= inner + (periThin ? MORISON_SLIVER_MM : MORISON_CONTACT_MM);
      bool other = inner == dDia || morison || dGb - uGbExtra.y <= inner + GALLBLADDER_CONTACT_MM;
      if (!other) { c.iface = IF_LIVER_CAPSULE; c.ifd = inner; }
      return;
    }
    // lámina del ligamento venoso (misma fórmula que ligamentumVenosumSdf)
    float dLv = ligamentumVenosumSdf(m);
    if (dLv < 0.0 && inner > 2.0) { c.tissue = T_LIG_VENOSUM; c.bd = min(-dLv, bd); c.n = uLigVen.xyz; return; }
    c.tissue = T_LIVER; c.bd = bd; return;
  }
  // Intestino: distancia a las interfaces que ganan antes (misma fórmula que scene.classify)
  float bdBowel = min(min(BOWEL_BD_CAP_MM, dDome - DIAPHRAGM_MM), dGb - uGbExtra.y);
  bdBowel = min(bdBowel, min(dLiverBase, -depth - wall));
  for (int k = 0; k < 2; k++) bdBowel = min(bdBowel, perirenalOuterSdf(kidneyLocal(m, k), k));
  // detrás del peritoneo parietal posterior, el retroperitoneo (decisión 81): psoas, cuadrado lumbar y grasa; la
  // distancia a la frontera cuenta también la columna, que se clasifica antes
  float bdRetro;
  vec3 retroPoint = m - vec3(0.0, uSpine.y + 46.0, 0.0);
  c.tissue = retroperitoneum(retroPoint, uAbdominalAtlasEnabled!=0 ? m : retroPoint, -depth - wall, dPeri, bdRetro);
  c.bd = max(min(min(bdBowel, bdRetro), dSpine), 0.0); c.n = tn;
  if(c.tissue!=T_BOWEL)return;
  if(uAbdominalAtlasEnabled!=0){vec2 gut=abdominalAtlasValue(m,1);c.tissue= gut.y==3.0 && gut.x<16.0 && gut.x<dLiverBase ? T_MESENTERIC_FAT:T_UNSEGMENTED;c.bd=min(c.bd,1.0);return;}
  vec3 bn,ba,bowelLumenNormal;float dl,br;float d=bowelQuery(m,bn,ba,dl,bowelLumenNormal,br);
  if(d>=BOWEL_REACH){c.tissue=T_MESENTERIC_FAT;c.bd=min(c.bd,d/2.0);return;}
  c.tangent=ba;
  c.iface=abs(d)<abs(dl)?IF_BOWEL_SEROSA:IF_BOWEL_LUMEN;
  c.n=c.iface==IF_BOWEL_SEROSA?bn:bowelLumenNormal;
  c.ifd=abs(c.iface==IF_BOWEL_SEROSA?d:dl);
  c.kc=1.0/(c.iface==IF_BOWEL_SEROSA?br:br-BOWEL_WALL);
  if(d>=0.0){c.tissue=T_MESENTERIC_FAT;c.bd=min(c.bd,d/2.0);}
  else if(dl>=0.0){c.tissue=T_BOWEL;c.bd=min(c.bd,min(-d,dl)/2.0);}
  else {float dg=bowelGasSdf(m,dl);c.tissue=dg<0.0?T_BOWELGAS:T_FLUID;c.bd=min(c.bd,min(-dl,abs(dg))/2.0);if(dg<0.0){c.iface=IF_NONE;c.ifd=1e3;}}
  return;
}

// withCurtain = false: sin la cortina (decisión 61), lo de detrás de la lámina; gemelo classify(m, cal, false)
Cls classifyWith(vec3 m, bool withCurtain) {
  Cls c;
  float depth;
  vec3 tn;
  if (classifyWall(m, c, depth, tn)) return c;
  // Columna (PR119; recuperación provisional de la decisión 103): el hueso de los cuerpos y del arco, el disco entre dos cuerpos y, en el tejido de alrededor,
  // la cara de su cortical
  vec2 sb = spineBodyParts(m);
  float originalBody=smoothMax(sb.x,sb.y,SPINE_RIM);
  float dBody=spineBodySd(m);
  float dSpine = min(dBody, spineArchSd(m));
  if (dSpine < 0.0) { c.tissue = T_VERTEBRA; c.bd = -dSpine; return c; }
  // el disco: el cilindro de los cuerpos fuera del hueso de un cuerpo (spineDistances de TS), también en el borde redondeado
  float dDisc=uAbdominalAtlasEnabled!=0?abdominalAtlasSdf(m,10):max(sb.x,-dBody);
  if (dDisc < 0.0) { c.tissue = T_CARTILAGE; c.bd = -dDisc; } else classifyInside(m, withCurtain, depth, tn, dSpine, c);
  // la cortical de los cuerpos en el tejido de fuera del hueso (withSpineFace de TS): su distancia a la frontera cuenta el
  // hueso y el disco; conserva dueños de PR139 y añade solo el disco de PR119 junto al platillo.
  c.bd = min(c.bd, min(dSpine, abs(dDisc)));
  bool owner = c.tissue == T_RETROFAT || c.tissue == T_PSOAS || c.tissue == T_QUADRATUS || c.tissue == T_MEDIASTINUM || (c.tissue == T_CARTILAGE && dDisc < 0.0);
  if (c.iface == IF_NONE && owner && dBody <= dSpine && dBody < VERTEBRAL_REACH && dBody < c.ifd) {
    c.iface = IF_VERTEBRAL_CORTEX; c.ifd = dBody; c.tangent = vec3(0.0, 0.0, 1.0); c.kc = spineFaceCurvature(m);
  }
  if (uAbdominalAtlasEnabled != 0) {
    vec2 q = thoracicValue(m);
    if (thoracicMaterial(q.y) == 0 && q.x >= 0.0 && q.x < 1.3 && q.x < c.ifd && c.tissue != T_LUNG && c.tissue != T_FLUID && c.tissue != T_BLOOD) {
      c.bd = min(c.bd, q.x); c.iface = IF_RIB; c.ifd = q.x; thoracicFrame(m, c.tangent, c.kc);
    }
  }
  return c;
}

Cls classify(vec3 m) { return classifyWith(m, true); }

// −faceSdf('liverSurface') de TS: margen hacia dentro del parénquima (hígado, cúpula y pared), la
// misma cantidad que decide la cápsula en classify
float liverInner(vec3 m) {
  float dLiverBase; vec3 dn;
  float dLiver = liverSdf(m, dLiverBase);
  return min(-dLiver, min(sdDome(m, dn) - DIAPHRAGM_MM, -torsoDepth(m) - (uWall.x + uWall.y + uWall.z)));
}

// Contorno externo del riñón más cercano (el menor dOuter, como faceSdf('kidneyOuter') de TS):
// gradiente por diferencias centrales en su marco local, devuelto en el mundo
vec3 kidneyOuterGradient(vec3 m) {
  if(uAbdominalAtlasEnabled!=0){int k=abdominalAtlasSdf(m,5)<abdominalAtlasSdf(m,6)?5:6;return abdominalAtlasGradient(m,k)*(2.0*FACE_GRAD_EPS);}
  vec3 q0 = kidneyLocal(m, 0);
  vec3 q1 = kidneyLocal(m, 1);
  int k = kidneyOuterSdf(q0, uKidR[0]) <= kidneyOuterSdf(q1, uKidR[1]) ? 0 : 1;
  vec3 q = k == 0 ? q0 : q1;
  vec3 r = uKidR[k];
  vec2 h = vec2(FACE_GRAD_EPS, 0.0);
  vec3 g = vec3(kidneyOuterSdf(q + h.xyy, r) - kidneyOuterSdf(q - h.xyy, r),
                kidneyOuterSdf(q + h.yxy, r) - kidneyOuterSdf(q - h.yxy, r),
                kidneyOuterSdf(q + h.yyx, r) - kidneyOuterSdf(q - h.yyx, r));
  return uKidU[k] * g.x + uKidV[k] * g.y + uKidW[k] * g.z;
}

// Cara externa de la grasa perirrenal más cercana (el menor perirenalOuterSdf, como faceSdf('perirenalOuter') de TS):
// la superficie es el contorno menos el grosor local, no el contorno: su propio gradiente por diferencias centrales en
// el marco local, devuelto en el mundo (antes, el del contorno renal: 9° de error en el p90 y 15,9° en el máximo)
vec3 perirenalOuterGradient(vec3 m) {
  vec3 q0 = kidneyLocal(m, 0);
  vec3 q1 = kidneyLocal(m, 1);
  int k = perirenalOuterSdf(q0, 0) <= perirenalOuterSdf(q1, 1) ? 0 : 1;
  vec3 q = k == 0 ? q0 : q1;
  vec2 h = vec2(FACE_GRAD_EPS, 0.0);
  vec3 g = vec3(perirenalOuterSdf(q + h.xyy, k) - perirenalOuterSdf(q - h.xyy, k),
                perirenalOuterSdf(q + h.yxy, k) - perirenalOuterSdf(q - h.yxy, k),
                perirenalOuterSdf(q + h.yyx, k) - perirenalOuterSdf(q - h.yyx, k));
  return uKidU[k] * g.x + uKidV[k] * g.y + uKidW[k] * g.z;
}

// Distancia de la cúpula sin su normal (el gradiente numérico de faceGradient; la vesícula tiene su sobrecarga
// gallbladderSdf(m), sin normal)
float domeSd(vec3 m) { vec3 n; return sdDome(m, n); }

// Gradiente de la distancia de la cara que dibuja una muestra (decisión 57): xyz es su dirección, la
// normal de la cara, y w su norma, que pasa ifd (el valor de esa distancia) a distancia por la normal,
// ifd/w. En los tubos, el gradiente analítico de tubeQuery (c.n sin normalizar: 1/apScale en las paredes
// AP de la VCI). En la cápsula hepática, el contorno renal, la cara externa de la grasa perirrenal, el diafragma y
// la vesícula, diferencias centrales de FACE_GRAD_EPS mm (las del banco) de la misma distancia que decide la
// clasificación: allí c.n es la de una de las superficies que funde liverSdf, la del elipsoide sin escotadura hiliar
// (e2e de normales del PR 5a: p05 de 0,45 en la impresión renal, p01 de 0,61 junto al hilio), la del contorno renal
// en la grasa o la de la altura de la cúpula, y la norma de la distancia se aparta de 1 en las fusiones, junto al
// hilio y lejos de la pleura. Cuesta 6–8 evaluaciones: la pasada B solo lo pide en las muestras al alcance de su cara.
// Gemelo TS: AnatomyScene.faceGradient.
vec4 faceGradient(Cls c, vec3 m) {
  vec2 h = vec2(FACE_GRAD_EPS, 0.0);
  vec3 g;
  if (c.iface == IF_VERTEBRAL_CORTEX) {
    // Gradiente del cuerpo segmentado, también junto al platillo dentro de un disco.
    g = vec3(spineBodySd(m + h.xyy) - spineBodySd(m - h.xyy), spineBodySd(m + h.yxy) - spineBodySd(m - h.yxy), spineBodySd(m + h.yyx) - spineBodySd(m - h.yyx));
  } else if (c.tissue == T_CAPSULE) {
    g = vec3(liverInner(m + h.xyy) - liverInner(m - h.xyy),
             liverInner(m + h.yxy) - liverInner(m - h.yxy),
             liverInner(m + h.yyx) - liverInner(m - h.yyx));
  } else if (c.iface == IF_PERIRENAL) {
    g = perirenalOuterGradient(m);
  } else if (c.tissue == T_RENAL_CAPSULE || c.tissue == T_PERIRENAL) {
    g = kidneyOuterGradient(m);
  } else if (c.tissue == T_DIAPHRAGM) {
    g = vec3(domeSd(m + h.xyy) - domeSd(m - h.xyy),
             domeSd(m + h.yxy) - domeSd(m - h.yxy),
             domeSd(m + h.yyx) - domeSd(m - h.yyx));
  } else if (c.iface == IF_GALLBLADDER) {
    // El gradiente exacto ya salió de classify; conserva su norma y evita seis consultas.
    float l = length(c.n);
    return l > 0.0 ? vec4(c.n / l, l) : vec4(0.0, 1.0, 0.0, 1.0);
  } else if (c.iface >= IF_FIRST_WALL && c.iface <= IF_LAST_WALL) {
    // capas de la pared (decisión 62): el gradiente de la distancia de su capa con su pendiente (wallFaceGradient,
    // decisión 88: tres evaluaciones de su profundidad en lugar de las seis de wallFaceSd), en la escala de las demás
    g = wallFaceGradient(m, c.iface) * (2.0 * FACE_GRAD_EPS);
  } else if (c.iface == IF_RIB || c.iface == IF_PERICHONDRIUM) {
    // cortical o pericondrio: la distancia de la costilla más cercana (ribSd)
    int k = nearestRib(m);
    g = vec3(ribSd(m + h.xyy, k) - ribSd(m - h.xyy, k),
             ribSd(m + h.yxy, k) - ribSd(m - h.yxy, k),
             ribSd(m + h.yyx, k) - ribSd(m - h.yyx, k));
  } else {
    // tubos (gradiente sin normalizar) y tejidos sin cara (normal unitaria)
    float l = length(c.n);
    return l > 0.0 ? vec4(c.n / l, l) : vec4(0.0, 1.0, 0.0, 1.0);
  }
  float lg = length(g);
  if (lg > 0.0) return vec4(g / lg, lg / (2.0 * FACE_GRAD_EPS));
  float ln = length(c.n);
  return ln > 0.0 ? vec4(c.n / ln, 1.0) : vec4(0.0, 1.0, 0.0, 1.0);
}

// Velocidad de la sangre (mm/s, marco material) para una clasificación de sangre.
// Velocidad media UNIFORME a lo largo del vaso (decisión 6, misma ley que
// AnatomyQuery.classifyWorld): Q = cte en un tubo afilado dispararía la periferia.
vec3 bloodVelocity(Cls c) {
  if (c.vessel < 0) return vec3(0.0);
  float uLocal = c.uRef;
  float n = c.profN;
  float rho = min(1.0, c.rho);
  float profile = ((n + 2.0) / n) * (1.0 - pow(rho, n));
  return c.tangent * (uLocal * profile);
}

// Hash espacial → campo complejo de dispersores persistente en coordenadas materiales.
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

// Nodo de la retícula: Gaussiana aproximada (Box–Muller) para estadística de speckle plenamente desarrollada. Con
// s = (p, a, k) (dispersores fuertes, decisión 89, speckleField.ts) los nodos con b ≥ 1 − p llevan la amplitud ×a y el
// resto ×k, y la fase de cada grupo se reparte en toda la vuelta ((b − 1 + p)/p y b/(1 − p)); s = (0, 1, 1) es el nodo de
// siempre, bit a bit.
vec2 latticeValueS(vec3 cell, float salt, vec3 s) {
  float a = hash13(cell + vec3(salt, 0.0, 0.0));
  float b = hash13(cell + vec3(0.0, salt + 17.1, 0.0));
  bool strong = b >= 1.0 - s.x;
  float r = sqrt(-2.0 * log(max(1e-6, a))) * (strong ? s.y : s.z);
  float ph = 6.2831853 * (strong ? (b - (1.0 - s.x)) / s.x : b / (1.0 - s.x));
  return r * vec2(cos(ph), sin(ph));
}

// Interpolación trilineal del campo complejo en una retícula de paso h (mm), con fundido
// smoothstep (derivada nula en los nodos, como el ruido de valor clásico).
vec2 scattererFieldS(vec3 m, float h, float salt, vec3 s) {
  vec3 q = m / h;
  vec3 c0 = floor(q);
  vec3 f = q - c0;
  f = f * f * (3.0 - 2.0 * f);
  vec2 v000 = latticeValueS(c0 + vec3(0,0,0), salt, s);
  vec2 v100 = latticeValueS(c0 + vec3(1,0,0), salt, s);
  vec2 v010 = latticeValueS(c0 + vec3(0,1,0), salt, s);
  vec2 v110 = latticeValueS(c0 + vec3(1,1,0), salt, s);
  vec2 v001 = latticeValueS(c0 + vec3(0,0,1), salt, s);
  vec2 v101 = latticeValueS(c0 + vec3(1,0,1), salt, s);
  vec2 v011 = latticeValueS(c0 + vec3(0,1,1), salt, s);
  vec2 v111 = latticeValueS(c0 + vec3(1,1,1), salt, s);
  vec2 x00 = mix(v000, v100, f.x);
  vec2 x10 = mix(v010, v110, f.x);
  vec2 x01 = mix(v001, v101, f.x);
  vec2 x11 = mix(v011, v111, f.x);
  vec2 y0 = mix(x00, x10, f.y);
  vec2 y1 = mix(x01, x11, f.y);
  return mix(y0, y1, f.z);
}
vec2 scattererField(vec3 m, float h, float salt) { return scattererFieldS(m, h, salt, vec3(0.0, 1.0, 1.0)); }
`;
