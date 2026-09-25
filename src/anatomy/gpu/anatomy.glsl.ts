/**
 * Fragmento GLSL compartido: la misma anatomía implícita que `anatomy/scene.ts`,
 * evaluada en la GPU a partir de los mismos datos declarativos. Los tubos
 * (vasos y conductos) viajan en una textura de datos RGBA32F (`uSceneTex`,
 * decisión 24) y las primitivas en uniformes. Mantener las dos implementaciones
 * sincronizadas es una regla del proyecto (ver docs/DECISIONS.md); el test
 * `anatomy.test.ts` fija la versión TS.
 *
 * Disposición de la textura (índice lineal i → texel (i & 255, i >> 8)):
 *   tubo t (lista COMPACTA del cuadro: solo los que cortan la losa del plano), cabecera en 4 texels desde t·4:
 *     H0 = (inicio de nodos, n.º nodos, apScale, escala de radio)
 *     H1 = (espesor de pared mm, tejido de pared, tejido de la luz, cara de la luz: `Interface`, decisión 57)
 *     H2 = (u_ref mm/s, r_ref mm, exponente del perfil, índice original del tubo)
 *     H3 = esfera envolvente (cx, cy, cz, R)
 *   nodos desde NODE_BASE = MAX_TUBES·4: (x, y, z, r)
 *   tabla de la compresión de la sonda desde COMPRESSION_BASE = NODE_BASE + MAX_NODES (decisión 63,
 *   `anatomy/compression.ts`): un téxel por nodo de la cara, (s₀ mm, b − 1, 0, 0)
 */
import { BOWEL_BD_CAP_MM, DIAPHRAGM_THICKNESS_MM, LIVER_CAPSULE_MM, TISSUE_GLSL_NAME } from '../tissues';
import {
  FACE_GRADIENT_EPS_MM,
  FIRST_WALL_INTERFACE,
  INTERFACE_COUNT,
  INTERFACE_GLSL_NAME,
  LAST_TUBE_INTERFACE,
  LAST_WALL_INTERFACE,
  MORISON_CONTACT_MM,
} from '../interfaces';
import { COMPRESSION_GLSL, PROBE_COMPRESSION } from '../compression';
import { ORGAN_MODULES } from '../organs';
import { RIB_ANTERIOR_END } from '../primitives';
import { MAX_GAS, MAX_RIBS, SCENE_UNIFORMS_GLSL } from './sceneUniforms';

export const MAX_TUBES = 128;
export const MAX_NODES = 640;
export const NODE_BASE = MAX_TUBES * 4;
export const SCENE_TEX_W = 256;
/** Segmentos por tubo que recorre el shader (`tubeQuery`): un tubo con más nodos se truncaría. */
export const MAX_TUBE_SEGMENTS = 8;
/** Primer téxel de la tabla de compresión de la sonda (decisión 63): tras los nodos de los tubos. */
export const COMPRESSION_BASE = NODE_BASE + MAX_NODES;
export const SCENE_TEX_H = Math.ceil((COMPRESSION_BASE + PROBE_COMPRESSION.nodes) / SCENE_TEX_W);
export { MAX_GAS, MAX_RIBS } from './sceneUniforms';

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
#define COMP_BASE ${NODE_BASE + MAX_NODES}
#define MAX_GAS ${MAX_GAS}
#define MAX_RIBS ${MAX_RIBS}
${TISSUE_DEFINES}
${INTERFACE_DEFINES}
#define IFACE_COUNT ${INTERFACE_COUNT}
#define IF_LAST_TUBE ${LAST_TUBE_INTERFACE}
#define IF_FIRST_WALL ${FIRST_WALL_INTERFACE}
#define IF_LAST_WALL ${LAST_WALL_INTERFACE}
#define MORISON_CONTACT_MM ${MORISON_CONTACT_MM.toFixed(3)}
#define FACE_GRAD_EPS ${FACE_GRADIENT_EPS_MM.toFixed(3)}
#define DIAPHRAGM_MM ${DIAPHRAGM_THICKNESS_MM.toFixed(3)}
#define CAPSULE_MM ${LIVER_CAPSULE_MM.toFixed(3)}
#define BOWEL_BD_CAP_MM ${BOWEL_BD_CAP_MM.toFixed(3)}

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

float torsoDepth(vec3 p) {
  float u = p.x / uTorso.x;
  float v = p.y / uTorso.y;
  float rho = sqrt(u * u + v * v);
  float localR = rho > 0.0 ? length(p.xy) / rho : min(uTorso.x, uTorso.y);
  return (rho - 1.0) * localR;
}

vec3 torsoNormal(vec3 p) {
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

vec3 respDisplacement(vec3 m) {
  return uResp.yzw * (uResp.x * respWeight(m));
}

${COMPRESSION_GLSL}
// Mundo → material: la compresión de la sonda (decisión 63) y después la respiración (deformation.ts)
vec3 toMaterial(vec3 p) {
  vec3 q = uncompress(p);
  vec3 m = q;
  for (int i = 0; i < 2; i++) m = q - respDisplacement(m);
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
float domeHeight(float x, float y) {
  float phi = atan(y / uTorso.y, x / uTorso.x);
  float edge = uDiaphragm.z + uDiaphragm.w * pow(max(0.0, sin(phi)), 1.5);
  float zr = edge + max(0.0, uDiaphragm.x - edge) * domeLift(x, y, uDomeR);
  float zl = edge + max(0.0, uDiaphragm.y - edge) * domeLift(x, y, uDomeL);
  return max(edge, max(zr, zl));
}

// Distancia con signo al diafragma (negativa en el tórax) y normal hacia el abdomen.
float sdDome(vec3 p, out vec3 n) {
  float zd = domeHeight(p.x, p.y);
  float h = 0.5;
  float gx = (domeHeight(p.x + h, p.y) - domeHeight(p.x - h, p.y)) / (2.0 * h);
  float gy = (domeHeight(p.x, p.y + h) - domeHeight(p.x, p.y - h)) / (2.0 * h);
  float slope = sqrt(1.0 + gx * gx + gy * gy);
  n = normalize(vec3(gx, gy, -1.0)); // apunta hacia abajo (hacia el hígado)
  return (zd - p.z) / slope;
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

// Elipsoide con base propia y afilamiento en +u (vesícula en pera); n en el mundo
float sdOrientedEllipsoid(vec3 p, vec3 c, vec3 r, vec3 U, vec3 V, vec3 W, float taperU, out vec3 n) {
  vec3 d = p - c;
  vec3 q = vec3(dot(d, U), dot(d, V), dot(d, W));
  float taper = max(0.15, 1.0 - taperU * (q.x / r.x));
  vec3 rr = vec3(r.x, r.y * taper, r.z * taper);
  vec3 k = q / rr;
  float k1 = length(k);
  float k2 = length(k / rr);
  vec3 nl = normalize(k / rr + vec3(1e-6));
  n = normalize(U * nl.x + V * nl.y + W * nl.z);
  return k2 > 0.0 ? (k1 * (k1 - 1.0)) / k2 : -min(rr.x, min(rr.y, rr.z));
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

float sdSphere(vec3 p, vec4 s, out vec3 n) {
  vec3 d = p - s.xyz;
  float l = length(d);
  n = l > 0.0 ? d / l : vec3(0.0, 1.0, 0.0);
  return l - s.w;
}

// Costilla: devuelve distancia y si es cartílago (φ anterior)
float sdRib(vec3 p, vec4 rib, out bool cartilage, out vec3 n) {
  float phi = atan(p.y / uTorso.y, p.x / uTorso.x);
  // extremo anterior: el esternón (5.ª–7.ª) o el reborde costal (8.ª–10.ª; primitives.ribAnteriorEndX)
  float endX = min(${RIB_ANTERIOR_END.xMm.toFixed(4)}, ${RIB_ANTERIOR_END.xMm.toFixed(4)} + ${RIB_ANTERIOR_END.marginSlope.toFixed(4)} * rib.x);
  // cartílago: el arco anterior y los últimos mm antes del extremo (primitives.sdRib, decisión 62)
  cartilage = abs(phi - 1.5707963) < 1.5707963 - uRibParams.y || (p.y > 0.0 && p.x > endX - ${RIB_ANTERIOR_END.cartilageTailMm.toFixed(4)});
  if (p.x > endX) return 1e3;
  // el arco costal termina en la apófisis transversa: nada por detrás de la columna
  if (p.y < uSpine.y && abs(p.x - uSpine.x) < uSpineArch.x + 6.0) return 1e3;
  float sc = uRibParams.x;
  float u = p.x / (uTorso.x * sc);
  float v = p.y / (uTorso.y * sc);
  float rho = sqrt(u * u + v * v);
  float localR = rho > 0.0 ? length(p.xy) / rho : 1.0;
  float dRadial = (rho - 1.0) * localR;
  float zRib = rib.x + rib.y * (0.5 - 0.5 * sin(phi));
  float dz = p.z - zRib;
  float qx = abs(dRadial) / rib.w;
  float qz = abs(dz) / rib.z;
  float q = sqrt(qx * qx + qz * qz) - 1.0;
  n = normalize(vec3(torsoNormal(p).xy * sign(dRadial) * qx, qz * sign(dz)) + vec3(1e-4));
  return q * min(rib.w, rib.z);
}

// Consulta de tubo: distancia con signo, rho, tangente, radio local, gradiente de la distancia (SIN
// normalizar: su norma pasa ifd a distancia por la normal) y curvatura circunferencial de la cara.
// Gemelos TS: tubeQuery y tubeFaceGradient (anatomy/primitives.ts).
float tubeQuery(vec3 p, int t, out float rho, out vec3 tangent, out float rLoc, out vec3 n, out float kc) {
  vec4 h0 = sceneTexel(t * 4);
  int start = int(h0.x + 0.5);
  int count = int(h0.y + 0.5);
  float apScale = h0.z;
  float rs = h0.w;
  float best = 1e9;
  rho = 10.0; tangent = vec3(0.0, 0.0, 1.0); rLoc = 1.0; n = vec3(0.0, 1.0, 0.0); kc = 1.0;
  for (int i = 0; i < MAX_TUBE_SEGMENTS; i++) {
    if (i >= count - 1) break;
    vec4 a = sceneTexel(NODE_BASE + start + i);
    vec4 b = sceneTexel(NODE_BASE + start + i + 1);
    vec3 ab = b.xyz - a.xyz;
    vec3 ap = p - a.xyz;
    float len2 = dot(ab, ab);
    float s = len2 > 0.0 ? clamp(dot(ap, ab) / len2, 0.0, 1.0) : 0.0;
    vec3 c = a.xyz + ab * s;
    vec3 d = p - c;
    vec3 tg = normalize(ab);
    float dist;
    // g = gradiente de dist × dist: la normal de la cara es el gradiente de sd = dist − r(s)
    vec3 g;
    if (apScale != 1.0) {
      // Sección elíptica: se escala la componente perpendicular; la axial se conserva (tapa)
      float along = dot(d, tg);
      vec3 perp = d - tg * along;
      perp.y /= apScale;
      dist = sqrt(dot(perp, perp) + along * along);
      // el gradiente escala la componente AP DOS veces (no una, como d/dist): la normal del cuerpo de
      // la VCI se apartaba 6–10° del gradiente (e2e de normales del PR 5a)
      vec3 q = perp;
      q.y /= apScale;
      g = q - tg * dot(q, tg) + tg * along;
    } else {
      dist = length(d);
      g = d;
    }
    float r = (a.w + (b.w - a.w) * s) * rs;
    float sd = dist - r;
    if (sd < best) {
      best = sd;
      rho = dist / max(1e-6, r);
      tangent = tg;
      rLoc = r;
      // dentro del segmento el radio crece con s: ∇r = rs·(b.w − a.w)/|ab| a lo largo del eje
      float taper = s > 0.0 && s < 1.0 ? rs * (b.w - a.w) * inversesqrt(len2) : 0.0;
      vec3 gn = g / max(dist, 1e-6) - tg * taper;
      n = dist > 0.0 && dot(gn, gn) > 0.0 ? gn : vec3(0.0, 1.0, 0.0);
      // curvatura circunferencial de la cara: 1/r en la sección circular; en la elíptica, |S·ĉ|²/(r·|∇dist|)
      // con ĉ normal a la cara y al eje y S = diag(1, 1/apScale, 1): apScale/r en las paredes AP y
      // 1/(apScale²·r) en las laterales (con 1/r la pared lateral de una VCI aplanada salía 2 dB brillante)
      kc = 1.0 / r;
      vec3 cc = cross(g, tg);
      float cl = length(cc);
      if (apScale != 1.0 && dist > 0.0 && cl > 1e-6) {
        float cy = cc.y / cl;
        kc = (1.0 + cy * cy * (1.0 / (apScale * apScale) - 1.0)) * dist / (r * length(g));
      }
    }
  }
  return best;
}

// Módulos de órgano (anatomy/organs/*): gemelos GLSL de sus funciones TS
${ORGAN_MODULES.map((o) => o.glsl).join('\n')}

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
  if (d >= ribSearchDepth()) {
    for (int i = 0; i < MAX_RIBS; i++) {
      bool cart; vec3 rn;
      float rd = sdRib(m, uRibs[i], cart, rn);
      if (rd < 0.0) {
        c.tissue = cart ? T_CARTILAGE : T_BONE; c.bd = -rd; c.n = rn;
        if (cart) { c.iface = IF_PERICHONDRIUM; c.ifd = -rd; c.tangent = ribTangent(m, uRibs[i]); c.kc = ribCurvature(m, uRibs[i]); }
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
    vec2 wf = wallFace(d, u, m.z, ribD);
    c.iface = int(wf.x + 0.5); c.ifd = wf.y;
    if (c.iface == IF_RIB) { c.tangent = ribTangent(m, uRibs[ribI]); c.kc = ribCurvature(m, uRibs[ribI]); }
    return true;
  }
  return false;
}

// withCurtain = false: sin la cortina (decisión 61), lo de detrás de la lámina; gemelo classify(m, cal, false)
Cls classifyWith(vec3 m, bool withCurtain) {
  Cls c;
  float depth;
  vec3 tn;
  if (classifyWall(m, c, depth, tn)) return c;
  float wall = uWall.x + uWall.y + uWall.z;
  // Columna
  float dBody = length(m.xy - uSpine.xy) - uSpine.z;
  float ax = abs(m.x - uSpine.x) - uSpineArch.x;
  float acy = 0.5 * (uSpineArch.y + uSpineArch.z);
  float ay = abs(m.y - acy) - 0.5 * (uSpineArch.z - uSpineArch.y);
  float dArch = length(max(vec2(ax, ay), 0.0)) + min(max(ax, ay), 0.0);
  float dSpine = min(dBody, dArch);
  if (dSpine < 0.0) {
    c.tissue = T_VERTEBRA; c.bd = -dSpine;
    c.n = dBody < dArch ? normalize(vec3(m.xy - uSpine.xy, 0.0)) : (ax > ay ? vec3(sign(m.x - uSpine.x), 0.0, 0.0) : vec3(0.0, sign(m.y - acy), 0.0));
    return c;
  }
  // Cortina pulmonar (módulo de órgano: anatomy/organs/lungCurtain.ts)
  if (withCurtain) {
    float dCurtain = lungCurtainDistance(m, -depth - wall);
    if (dCurtain >= 0.0) { c.tissue = T_LUNG; c.bd = dCurtain; c.n = torsoNormal(m); return c; }
  }
  // Vasos y conductos (descarte por esfera envolvente)
  int bestT = -1; float bestD = 1e9; float bRho; vec3 bTan; float bR; vec3 bN; float bKc;
  for (int t = 0; t < MAX_TUBES; t++) {
    if (t >= uTubeCount) break;
    vec4 bs = sceneTexel(t * 4 + 3);
    if (distance(m, bs.xyz) > bs.w) continue;
    float rho; vec3 tg; float rl; vec3 nn; float kk;
    float sd = tubeQuery(m, t, rho, tg, rl, nn, kk);
    vec4 hw = sceneTexel(t * 4 + 1);
    // pared periportal proporcional al calibre local (misma fórmula que wallThicknessMm)
    float wallMm = int(hw.y + 0.5) == T_WALL_PORTAL ? clamp(0.24 * rl, 0.5, 1.4) : hw.x;
    if (sd < wallMm && sd < bestD) { bestD = sd; bestT = t; bRho = rho; bTan = tg; bR = rl; bN = nn; bKc = kk; }
  }
  // la aurícula derecha se mide antes que los tubos: dentro de ella no hay cara de tubo
  vec3 sn;
  float dRa = sdSphere(m, uRA, sn);
  if (bestT >= 0) {
    vec4 h1 = sceneTexel(bestT * 4 + 1);
    vec4 h2 = sceneTexel(bestT * 4 + 2);
    int wallT = int(h1.y + 0.5);
    int lumenT = int(h1.z + 0.5);
    int iface = int(h1.w + 0.5);
    bool duct = iface == IF_DUCT;
    c.n = bN; c.rho = bRho; c.tangent = bTan; c.kc = bKc;
    c.uRef = h2.x; c.rRef = h2.y; c.profN = h2.z;
    // la cara de la luz: la pared y la luz (sangre o bilis) conocen la misma, a |bestD|; dentro de la
    // aurícula no hay pared que dibujar (el tramo de la VCI que entra en ella, con su tapa)
    bool inRa = dRa < 0.0;
    c.iface = inRa ? IF_NONE : iface; c.ifd = inRa ? 1e3 : abs(bestD);
    if (bestD < 0.0) { c.tissue = lumenT; c.bd = -bestD; c.vessel = duct ? -1 : int(h2.w + 0.5); return c; }
    float wallBest = wallT == T_WALL_PORTAL ? clamp(0.24 * bR, 0.5, 1.4) : h1.x;
    c.tissue = wallT; c.bd = min(bestD, wallBest - bestD); return c;
  }
  // Aurícula derecha (dRa, antes de los tubos)
  if (dRa < 0.0) { c.tissue = T_BLOOD; c.bd = -dRa; c.n = sn; return c; }
  // Tórax y diafragma
  vec3 dn;
  float dDome = sdDome(m, dn);
  if (dDome < 0.0) { c.tissue = T_LUNG; c.bd = -dDome; c.n = dn; return c; }
  if (dDome < DIAPHRAGM_MM) {
    c.tissue = T_DIAPHRAGM; c.bd = min(dDome, DIAPHRAGM_MM - dDome); c.n = dn;
    // la mitad abdominal dibuja la cara hepática; la pleural la dibuja el espejo exacto de la pasada A
    if (dDome > 0.5 * DIAPHRAGM_MM) { c.iface = IF_DIAPHRAGM_LIVER; c.ifd = DIAPHRAGM_MM - dDome; }
    return c;
  }
  vec3 gn;
  float dGb = gallbladderSdf(m, gn);
  if (dGb < 0.0) { c.tissue = T_FLUID; c.bd = -dGb; c.n = gn; c.iface = IF_GALLBLADDER; c.ifd = -dGb; return c; }
  if (dGb < uGbExtra.y) { c.tissue = T_BILEWALL; c.bd = min(dGb, uGbExtra.y - dGb); c.n = gn; c.iface = IF_GALLBLADDER; c.ifd = dGb; return c; }
  // Riñones; dPeri = distancia a la cara externa de la grasa perirrenal (la cápsula hepática que la
  // toca no dibuja su cara: Morison es de la grasa)
  float dPeri = 1e3;
  for (int k = 0; k < 2; k++) {
    if (distance(m, uKidC[k]) > uKidR[k].x + uKidExtra.y + 2.0) continue;
    float inner; float dOuter;
    int region = kidneyQuery(m, k, inner, dOuter);
    dPeri = min(dPeri, dOuter - uKidExtra.y);
    vec3 kn;
    kidneyOuter(m, k, kn);
    if (dOuter < 0.0) {
      if (-dOuter < RENAL_CAPSULE_MM) {
        c.tissue = T_RENAL_CAPSULE; c.bd = min(-dOuter, RENAL_CAPSULE_MM + dOuter); c.n = kn;
        c.iface = IF_RENAL_CAPSULE; c.ifd = -dOuter;
        return c;
      }
      c.tissue = region == 3 ? T_RENAL_PELVIS : (region == 2 ? T_RENAL_SINUS : (region == 1 ? T_RENAL_MEDULLA : T_RENAL_CORTEX));
      c.bd = inner; c.n = kn; return c;
    }
    if (dOuter < uKidExtra.y) {
      c.tissue = T_PERIRENAL; c.bd = min(dOuter, uKidExtra.y - dOuter); c.n = kn;
      // mitad externa: cara hígado/grasa; mitad interna: la de la cápsula renal (dos lados)
      bool outerFace = dOuter > 0.5 * uKidExtra.y;
      c.iface = outerFace ? IF_PERIRENAL : IF_RENAL_CAPSULE;
      c.ifd = outerFace ? uKidExtra.y - dOuter : dOuter;
      return c;
    }
  }
  vec3 ln; float dLiverBase;
  float dLiver = liverSdf(m, ln, dLiverBase);
  if (dLiver >= 0.0 && dLiverBase < 0.0) {
    c.tissue = T_LIG_TERES; c.bd = min(-dLiverBase, dLiver); c.n = ln; return c;
  }
  if (dLiver < 0.0) {
    float dDia = dDome - DIAPHRAGM_MM;
    float inner = min(-dLiver, min(dDia, -depth - wall));
    c.n = (inner == -dLiver) ? ln : ((inner == dDia) ? dn : tn);
    if (inner < CAPSULE_MM) {
      c.tissue = T_CAPSULE; c.bd = inner;
      // la cara hacia el diafragma es del diafragma; la de Morison, de la grasa perirrenal
      bool other = inner == dDia || dPeri <= inner + MORISON_CONTACT_MM;
      if (!other) { c.iface = IF_LIVER_CAPSULE; c.ifd = inner; }
      return c;
    }
    // lámina del ligamento venoso (misma fórmula que ligamentumVenosumSdf)
    float dLv = ligamentumVenosumSdf(m);
    if (dLv < 0.0 && inner > 2.0) { c.tissue = T_LIG_VENOSUM; c.bd = min(-dLv, inner); c.n = uLigVen.xyz; return c; }
    c.tissue = T_LIVER; c.bd = inner; return c;
  }
  // Intestino: distancia a las interfaces que ganan antes (misma fórmula que scene.classify)
  float bdBowel = min(min(BOWEL_BD_CAP_MM, dDome - DIAPHRAGM_MM), min(dGb - uGbExtra.y, dRa));
  bdBowel = min(bdBowel, min(dLiverBase, -depth - wall));
  for (int k = 0; k < 2; k++) bdBowel = min(bdBowel, kidneyOuterSdf(kidneyLocal(m, k), uKidR[k]) - uKidExtra.y);
  for (int i = 0; i < MAX_GAS; i++) {
    float dg = sdSphere(m, uGas[i], sn);
    if (dg < 0.0) { c.tissue = T_BOWELGAS; c.bd = -dg; c.n = sn; return c; }
    bdBowel = min(bdBowel, dg);
  }
  c.tissue = T_BOWEL; c.bd = max(bdBowel, 0.0); c.n = tn;
  return c;
}

Cls classify(vec3 m) { return classifyWith(m, true); }

// −faceSdf('liverSurface') de TS: margen hacia dentro del parénquima (hígado, cúpula y pared), la
// misma cantidad que decide la cápsula en classify
float liverInner(vec3 m) {
  vec3 ln; float dLiverBase; vec3 dn;
  float dLiver = liverSdf(m, ln, dLiverBase);
  return min(-dLiver, min(sdDome(m, dn) - DIAPHRAGM_MM, -torsoDepth(m) - (uWall.x + uWall.y + uWall.z)));
}

// Contorno externo del riñón más cercano (el menor dOuter, como faceSdf('kidneyOuter') de TS):
// gradiente por diferencias centrales en su marco local, devuelto en el mundo
vec3 kidneyOuterGradient(vec3 m) {
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

// Distancias de la cúpula y de la vesícula sin su normal (el gradiente numérico de faceGradient)
float domeSd(vec3 m) { vec3 n; return sdDome(m, n); }
float gallbladderSd(vec3 m) { vec3 n; return gallbladderSdf(m, n); }

// Gradiente de la distancia de la cara que dibuja una muestra (decisión 57): xyz es su dirección, la
// normal de la cara, y w su norma, que pasa ifd (el valor de esa distancia) a distancia por la normal,
// ifd/w. En los tubos, el gradiente analítico de tubeQuery (c.n sin normalizar: 1/apScale en las paredes
// AP de la VCI). En la cápsula hepática, el contorno renal, el diafragma y la vesícula, diferencias
// centrales de FACE_GRAD_EPS mm (las del banco) de la misma distancia que decide la clasificación: allí
// c.n es la de una de las superficies que funde liverSdf, la del elipsoide sin escotadura hiliar (e2e de
// normales del PR 5a: p05 de 0,45 en la impresión renal, p01 de 0,61 junto al hilio) o la de la altura
// de la cúpula, y la norma de la distancia se aparta de 1 en las fusiones, junto al hilio y lejos de la
// pleura. Cuesta 6–8 evaluaciones: la pasada B solo lo pide en las muestras al alcance de su cara.
// Gemelo TS: AnatomyScene.faceGradient.
vec4 faceGradient(Cls c, vec3 m) {
  vec2 h = vec2(FACE_GRAD_EPS, 0.0);
  vec3 g;
  if (c.tissue == T_CAPSULE) {
    g = vec3(liverInner(m + h.xyy) - liverInner(m - h.xyy),
             liverInner(m + h.yxy) - liverInner(m - h.yxy),
             liverInner(m + h.yyx) - liverInner(m - h.yyx));
  } else if (c.tissue == T_RENAL_CAPSULE || c.tissue == T_PERIRENAL) {
    g = kidneyOuterGradient(m);
  } else if (c.tissue == T_DIAPHRAGM) {
    g = vec3(domeSd(m + h.xyy) - domeSd(m - h.xyy),
             domeSd(m + h.yxy) - domeSd(m - h.yxy),
             domeSd(m + h.yyx) - domeSd(m - h.yyx));
  } else if (c.iface == IF_GALLBLADDER) {
    g = vec3(gallbladderSd(m + h.xyy) - gallbladderSd(m - h.xyy),
             gallbladderSd(m + h.yxy) - gallbladderSd(m - h.yxy),
             gallbladderSd(m + h.yyx) - gallbladderSd(m - h.yyx));
  } else if (c.iface >= IF_FIRST_WALL && c.iface <= IF_LAST_WALL) {
    // capas de la pared (decisión 62): la distancia de su capa (wallFaceSd)
    g = vec3(wallFaceSd(m + h.xyy, c.iface) - wallFaceSd(m - h.xyy, c.iface),
             wallFaceSd(m + h.yxy, c.iface) - wallFaceSd(m - h.yxy, c.iface),
             wallFaceSd(m + h.yyx, c.iface) - wallFaceSd(m - h.yyx, c.iface));
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

vec2 latticeValue(vec3 cell, float salt) {
  float a = hash13(cell + vec3(salt, 0.0, 0.0));
  float b = hash13(cell + vec3(0.0, salt + 17.1, 0.0));
  // Gaussiana aproximada (Box–Muller) para estadística de speckle plenamente desarrollada.
  float r = sqrt(-2.0 * log(max(1e-6, a)));
  float ph = 6.2831853 * b;
  return r * vec2(cos(ph), sin(ph));
}

// Interpolación trilineal del campo complejo en una retícula de paso h (mm), con fundido
// smoothstep (derivada nula en los nodos, como el ruido de valor clásico).
vec2 scattererField(vec3 m, float h, float salt) {
  vec3 q = m / h;
  vec3 c0 = floor(q);
  vec3 f = q - c0;
  f = f * f * (3.0 - 2.0 * f);
  vec2 v000 = latticeValue(c0 + vec3(0,0,0), salt);
  vec2 v100 = latticeValue(c0 + vec3(1,0,0), salt);
  vec2 v010 = latticeValue(c0 + vec3(0,1,0), salt);
  vec2 v110 = latticeValue(c0 + vec3(1,1,0), salt);
  vec2 v001 = latticeValue(c0 + vec3(0,0,1), salt);
  vec2 v101 = latticeValue(c0 + vec3(1,0,1), salt);
  vec2 v011 = latticeValue(c0 + vec3(0,1,1), salt);
  vec2 v111 = latticeValue(c0 + vec3(1,1,1), salt);
  vec2 x00 = mix(v000, v100, f.x);
  vec2 x10 = mix(v010, v110, f.x);
  vec2 x01 = mix(v001, v101, f.x);
  vec2 x11 = mix(v011, v111, f.x);
  vec2 y0 = mix(x00, x10, f.y);
  vec2 y1 = mix(x01, x11, f.y);
  return mix(y0, y1, f.z);
}
`;
