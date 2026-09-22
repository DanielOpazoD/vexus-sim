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
 *     H1 = (espesor de pared mm, tejido de pared, tejido de la luz, tipo: 0 vaso / 1 conducto)
 *     H2 = (u_ref mm/s, r_ref mm, exponente del perfil, índice original del tubo)
 *     H3 = esfera envolvente (cx, cy, cz, R)
 *   nodos desde NODE_BASE = MAX_TUBES·4: (x, y, z, r)
 */
import { HILUM_NOTCH, PYRAMIDS, RENAL_CAPSULE_MM, RENAL_PELVIS } from '../../anatomy/primitives';
import { DIAPHRAGM_THICKNESS_MM, LIVER_CAPSULE_MM, TISSUE_GLSL_NAME } from '../../anatomy/tissues';

export const MAX_TUBES = 128;
export const MAX_NODES = 640;
export const NODE_BASE = MAX_TUBES * 4;
export const SCENE_TEX_W = 256;
/** Segmentos por tubo que recorre el shader (`tubeQuery`): un tubo con más nodos se truncaría. */
export const MAX_TUBE_SEGMENTS = 8;
export const SCENE_TEX_H = Math.ceil((NODE_BASE + MAX_NODES) / SCENE_TEX_W);
export const MAX_GAS = 6;
export const MAX_RIBS = 6;

const PYRAMID_TABLE = `const vec2 PYR[${PYRAMIDS.length}] = vec2[${PYRAMIDS.length}](${PYRAMIDS.map(([t, u]) => `vec2(${t.toFixed(6)}, ${u.toFixed(1)})`).join(', ')});`;
const PELVIS = `const vec4 PELVIS = vec4(${RENAL_PELVIS.radii[0].toFixed(1)}, ${RENAL_PELVIS.radii[1].toFixed(1)}, ${RENAL_PELVIS.radii[2].toFixed(1)}, ${RENAL_PELVIS.offsetV.toFixed(1)}); const float RENAL_CAPSULE_MM = ${RENAL_CAPSULE_MM.toFixed(2)};`;
const NOTCH = `const vec4 NOTCH = vec4(${HILUM_NOTCH.radii[0].toFixed(1)}, ${HILUM_NOTCH.radii[1].toFixed(1)}, ${HILUM_NOTCH.radii[2].toFixed(1)}, ${HILUM_NOTCH.offsetV.toFixed(1)}); const float NOTCH_ROUND = ${HILUM_NOTCH.roundMm.toFixed(1)};`;

const TISSUE_DEFINES = Object.entries(TISSUE_GLSL_NAME)
  .map(([index, name]) => `#define ${name} ${index}`)
  .join('\n');

export const ANATOMY_GLSL = /* glsl */ `
#define MAX_TUBES ${MAX_TUBES}
#define MAX_NODES ${MAX_NODES}
#define SCENE_TEX_W ${SCENE_TEX_W}
#define MAX_TUBE_SEGMENTS ${MAX_TUBE_SEGMENTS}
#define NODE_BASE ${NODE_BASE}
#define MAX_GAS ${MAX_GAS}
#define MAX_RIBS ${MAX_RIBS}
${TISSUE_DEFINES}
#define DIAPHRAGM_MM ${DIAPHRAGM_THICKNESS_MM.toFixed(3)}
#define N_PYR ${PYRAMIDS.length}
#define CAPSULE_MM ${LIVER_CAPSULE_MM.toFixed(3)}

uniform vec4 uTorso;      // a, b, zMin, zMax
uniform vec3 uWall;       // skin, fat, muscle (mm)
uniform vec4 uDomeR;      // hemicúpula derecha: x0, y0, rx, ry
uniform vec4 uDomeL;      // hemicúpula izquierda
uniform vec4 uDiaphragm;  // apexR, apexL, edgeZ, edgeRise
uniform vec3 uSpine;      // x0, y0, r (cuerpo vertebral)
uniform vec4 uSpineArch;  // semiancho, y0, y1 del arco posterior con apófisis transversas, 0
uniform vec3 uLiverC;
uniform vec3 uLiverR;
uniform float uLiverTaper;
uniform vec3 uLiverLC;
uniform vec3 uLiverLR;
uniform float uLiverLTaper;
uniform float uLiverBlend;
uniform vec4 uVisceral;   // zAtY0, slopeY, edgeRound, renalImpression
uniform vec4 uFissure;
uniform vec4 uLigVen;     // normal.xyz del plano del ligamento venoso, d (n·a)
uniform vec4 uLigVenBox;  // xMin, xMax, zMin, zMax (semiespesor 1,2 mm)    // x, semiancho, profundidad, zMax de la fisura umbilical (redondeo 3 mm)
uniform vec3 uGbC;
uniform vec3 uGbR;
uniform vec3 uGbU;
uniform vec3 uGbV;
uniform vec3 uGbW;
uniform vec2 uGbExtra;    // afilamiento en +u, espesor de pared (mm)
uniform vec4 uRA;
uniform vec4 uGas[MAX_GAS];
uniform vec4 uRibs[MAX_RIBS];   // zAnterior, tilt, halfWidth, halfThickness
uniform vec2 uRibParams;        // scale, cartilageFromPhi
// Riñones: centro, semiejes, base (u, v, w), seno (semiejes, desplazamiento), radio del hilio
uniform vec3 uKidC[2];
uniform vec3 uKidR[2];
uniform vec3 uKidU[2];
uniform vec3 uKidV[2];
uniform vec3 uKidW[2];
uniform vec4 uKidSinus[2];      // semiejes xyz, desplazamiento
uniform vec2 uKidExtra;         // radio del hilio, grasa perirrenal (mm)
uniform sampler2D uSceneTex;
uniform int uTubeCount;
uniform vec4 uResp;       // amplitude (mm), dir.xyz
uniform vec4 uCurtain;    // borde caudal z de la cortina pulmonar (mm), espesor, xMax, yMax
uniform float uRespVel;   // velocidad del diafragma (mm/s)

struct Cls {
  int tissue;
  float bd;       // distancia a la interfaz (mm)
  vec3 n;         // normal de la interfaz
  float spec;     // reflectividad especular relativa
  int vessel;     // índice de tubo o -1
  float rho;      // fracción radial
  vec3 tangent;
  float rLoc;
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

vec3 toMaterial(vec3 p) {
  vec3 m = p;
  for (int i = 0; i < 2; i++) m = p - respDisplacement(m);
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
  cartilage = phi > uRibParams.y;
  if (p.x > 15.0) return 1e3;
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

// --- Riñón (misma construcción que primitives.kidneyQuery) --------------------
vec3 kidneyLocal(vec3 p, int k) {
  vec3 d = p - uKidC[k];
  return vec3(dot(d, uKidU[k]), dot(d, uKidV[k]), dot(d, uKidW[k]));
}

// Distancia externa del riñón k y normal en el mundo
${PYRAMID_TABLE}
${PELVIS}
${NOTCH}

// Contorno externo: elipsoide con escotadura hiliar (forma de judía; primitives.kidneyOuterSdf)
float kidneyOuterLocal(vec3 q, vec3 r) {
  float ell = sdEllipsoidLocal(q, r);
  float notch = sdEllipsoidLocal(vec3(q.x, q.y - (r.y + NOTCH.w), q.z), NOTCH.xyz);
  return smoothMax(ell, -notch, NOTCH_ROUND);
}

float kidneyOuter(vec3 p, int k, out vec3 n) {
  vec3 q = kidneyLocal(p, k);
  vec3 r = uKidR[k];
  vec3 nl = normalize(q / (r * r) + vec3(1e-6));
  n = normalize(uKidU[k] * nl.x + uKidV[k] * nl.y + uKidW[k] * nl.z);
  return kidneyOuterLocal(q, r);
}

// Región interna: 0 corteza, 1 médula, 2 seno, 3 pelvis; devuelve la distancia interna mínima
int kidneyRegion(vec3 p, int k, out float inner, out float dOuter) {
  vec3 q = kidneyLocal(p, k);
  dOuter = kidneyOuterLocal(q, uKidR[k]);
  vec4 sn = uKidSinus[k];
  vec3 qs = vec3(q.x, q.y - sn.w, q.z);
  float dSinus = sdEllipsoidLocal(qs, sn.xyz);
  float t = clamp(q.y - sn.w, 0.0, uKidR[k].y);
  float dHilum = length(vec3(q.x, q.y - sn.w - t, q.z)) - uKidExtra.x;
  dSinus = min(dSinus, dHilum);
  if (dSinus < 0.0) {
    float dPelvis = sdEllipsoidLocal(vec3(qs.x, qs.y - PELVIS.w, qs.z), PELVIS.xyz);
    if (dPelvis < 0.0) { inner = min(-dPelvis, -dOuter); return 3; }
    inner = min(min(-dSinus, -dOuter), dPelvis); return 2;
  }
  bool medulla = false;
  if (dSinus > 1.5 && dSinus < 12.0 && -dOuter > 5.0) {
    float theta = atan(q.z, q.y);
    float halfAng = 0.12 + 0.012 * dSinus;
    float halfU = 3.5 + 0.38 * dSinus;
    for (int i = 0; i < N_PYR; i++) {
      float dth = theta - PYR[i].x;
      dth = atan(sin(dth), cos(dth));
      if (abs(dth) <= halfAng && abs(q.x - PYR[i].y) < halfU) { medulla = true; break; }
    }
  }
  inner = min(-dOuter, dSinus);
  return medulla ? 1 : 0;
}

// Consulta de tubo: distancia con signo, rho, tangente, radio local, normal.
float tubeQuery(vec3 p, int t, out float rho, out vec3 tangent, out float rLoc, out vec3 n) {
  vec4 h0 = sceneTexel(t * 4);
  int start = int(h0.x + 0.5);
  int count = int(h0.y + 0.5);
  float apScale = h0.z;
  float rs = h0.w;
  float best = 1e9;
  rho = 10.0; tangent = vec3(0.0, 0.0, 1.0); rLoc = 1.0; n = vec3(0.0, 1.0, 0.0);
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
    if (apScale != 1.0) {
      // Sección elíptica: se escala la componente perpendicular; la axial se conserva (tapa)
      float along = dot(d, tg);
      vec3 perp = d - tg * along;
      perp.y /= apScale;
      dist = sqrt(dot(perp, perp) + along * along);
      d = perp + tg * along;
    } else {
      dist = length(d);
    }
    float r = (a.w + (b.w - a.w) * s) * rs;
    float sd = dist - r;
    if (sd < best) {
      best = sd;
      rho = dist / max(1e-6, r);
      tangent = tg;
      rLoc = r;
      n = dist > 0.0 ? d / dist : vec3(0.0, 1.0, 0.0);
    }
  }
  return best;
}

// Hígado sin recortes de cúpula/pared: lóbulos, cara visceral, impresión renal, fosa vesicular
float fissureSdf(vec3 m, float dBase) {
  return max(max(abs(m.x - uFissure.x) - uFissure.y, -(dBase + uFissure.z)), max(m.z - uFissure.w, -m.y));
}

// Hígado con la fisura umbilical; dBase = sin fisura (lo excavado es ligamento redondo).
float liverSdf(vec3 m, out vec3 n, out float dBase) {
  vec3 ln; vec3 ln2;
  float dR = sdEllipsoid(m, uLiverC, uLiverR, uLiverTaper, ln);
  float dL = sdEllipsoid(m, uLiverLC, uLiverLR, uLiverLTaper, ln2);
  float d = smoothMin(dR, dL, uLiverBlend);
  n = dL < dR ? ln2 : ln;
  float plane = (m.z - uVisceral.x + uVisceral.y * m.y) / length(vec2(uVisceral.y, 1.0));
  float d2 = smoothMax(d, -plane, uVisceral.z);
  if (d2 > d + 1e-3) n = normalize(vec3(0.0, -uVisceral.y, -1.0));
  vec3 kn;
  float dk = kidneyOuter(m, 0, kn) - uVisceral.w;
  float d3 = smoothMax(d2, -dk, 8.0);
  if (d3 > d2 + 1e-3) n = -kn;
  vec3 gn;
  float dg = sdOrientedEllipsoid(m, uGbC, uGbR, uGbU, uGbV, uGbW, uGbExtra.x, gn) - uGbExtra.y;
  float d4 = smoothMax(d3, -dg, 2.0);
  if (d4 > d3 + 1e-3) n = -gn;
  dBase = d4;
  float d5 = smoothMax(d4, -fissureSdf(m, d4), 3.0);
  if (d5 > d4 + 1e-3 && abs(m.x - uFissure.x) > uFissure.y - 1.0) n = vec3(sign(m.x - uFissure.x), 0.0, 0.0);
  return d5;
}

Cls classify(vec3 m) {
  Cls c;
  c.tissue = T_AIR; c.bd = 1e3; c.n = vec3(0.0, 1.0, 0.0); c.spec = 0.0; c.vessel = -1;
  c.rho = 10.0; c.tangent = vec3(0.0, 0.0, 1.0); c.rLoc = 1.0; c.uRef = 0.0; c.rRef = 1.0; c.profN = 2.0;
  float depth = torsoDepth(m);
  if (m.z < uTorso.z || m.z > uTorso.w || depth > 0.0) return c;
  float skin = uWall.x;
  float fat = skin + uWall.y;
  float wall = fat + uWall.z;
  float d = -depth;
  vec3 tn = torsoNormal(m);
  if (d < skin) { c.tissue = T_SKIN; c.bd = skin - d; c.n = tn; c.spec = 0.1; return c; }
  if (d < fat) { c.tissue = T_FAT; c.bd = min(d - skin, fat - d); c.n = tn; c.spec = 0.15; return c; }
  bool inMuscle = d < wall;
  // Costillas
  for (int i = 0; i < MAX_RIBS; i++) {
    bool cart; vec3 rn;
    float rd = sdRib(m, uRibs[i], cart, rn);
    if (rd < 0.0) {
      c.tissue = cart ? T_CARTILAGE : T_BONE; c.bd = -rd; c.n = rn; c.spec = cart ? 0.3 : 0.9; return c;
    }
  }
  if (inMuscle) { c.tissue = T_MUSCLE; c.bd = min(d - fat, wall - d); c.n = tn; c.spec = 0.2; return c; }
  // Columna
  float dBody = length(m.xy - uSpine.xy) - uSpine.z;
  float ax = abs(m.x - uSpine.x) - uSpineArch.x;
  float acy = 0.5 * (uSpineArch.y + uSpineArch.z);
  float ay = abs(m.y - acy) - 0.5 * (uSpineArch.z - uSpineArch.y);
  float dArch = length(max(vec2(ax, ay), 0.0)) + min(max(ax, ay), 0.0);
  float dSpine = min(dBody, dArch);
  if (dSpine < 0.0) {
    c.tissue = T_VERTEBRA; c.bd = -dSpine; c.spec = 0.9;
    c.n = dBody < dArch ? normalize(vec3(m.xy - uSpine.xy, 0.0)) : (ax > ay ? vec3(sign(m.x - uSpine.x), 0.0, 0.0) : vec3(0.0, sign(m.y - acy), 0.0));
    return c;
  }
  // Vasos y conductos (descarte por esfera envolvente)
  // Cortina pulmonar: lámina bajo la pared en el receso costofrénico derecho (misma regla que classifyLungCurtain)
  {
    float insideWall = -depth - wall;
    if (insideWall < uCurtain.y && m.x <= uCurtain.z && m.y <= uCurtain.w && m.z >= uCurtain.x) {
      c.tissue = T_LUNG; c.bd = min(min(insideWall, uCurtain.y - insideWall), m.z - uCurtain.x); c.n = torsoNormal(m); c.spec = 1.0; return c;
    }
  }
  int bestT = -1; float bestD = 1e9; float bRho; vec3 bTan; float bR; vec3 bN;
  for (int t = 0; t < MAX_TUBES; t++) {
    if (t >= uTubeCount) break;
    vec4 bs = sceneTexel(t * 4 + 3);
    if (distance(m, bs.xyz) > bs.w) continue;
    float rho; vec3 tg; float rl; vec3 nn;
    float sd = tubeQuery(m, t, rho, tg, rl, nn);
    vec4 hw = sceneTexel(t * 4 + 1);
    // pared periportal proporcional al calibre local (misma fórmula que wallThicknessMm)
    float wallMm = int(hw.y + 0.5) == T_WALL_PORTAL ? clamp(0.24 * rl, 0.5, 1.4) : hw.x;
    if (sd < wallMm && sd < bestD) { bestD = sd; bestT = t; bRho = rho; bTan = tg; bR = rl; bN = nn; }
  }
  if (bestT >= 0) {
    vec4 h1 = sceneTexel(bestT * 4 + 1);
    vec4 h2 = sceneTexel(bestT * 4 + 2);
    int wallT = int(h1.y + 0.5);
    int lumenT = int(h1.z + 0.5);
    bool duct = h1.w > 0.5;
    float spec = duct ? 0.6 : (wallT == T_WALL_PORTAL ? 0.7 : (wallT == T_ARTERYWALL ? 0.6 : 0.35));
    c.n = bN; c.spec = spec; c.rho = bRho; c.tangent = bTan; c.rLoc = bR;
    c.uRef = h2.x; c.rRef = h2.y; c.profN = h2.z;
    if (bestD < 0.0) { c.tissue = lumenT; c.bd = -bestD; c.vessel = duct ? -1 : int(h2.w + 0.5); return c; }
    float wallBest = wallT == T_WALL_PORTAL ? clamp(0.24 * bR, 0.5, 1.4) : h1.x;
    c.tissue = wallT; c.bd = min(bestD, wallBest - bestD); return c;
  }
  // Aurícula derecha
  vec3 sn;
  float dRa = sdSphere(m, uRA, sn);
  if (dRa < 0.0) { c.tissue = T_BLOOD; c.bd = -dRa; c.n = sn; c.spec = 0.5; return c; }
  // Tórax y diafragma
  vec3 dn;
  float dDome = sdDome(m, dn);
  if (dDome < 0.0) { c.tissue = T_LUNG; c.bd = -dDome; c.n = dn; c.spec = 1.0; return c; }
  if (dDome < DIAPHRAGM_MM) { c.tissue = T_DIAPHRAGM; c.bd = min(dDome, DIAPHRAGM_MM - dDome); c.n = dn; c.spec = 0.9; return c; }
  vec3 gn;
  float dGb = sdOrientedEllipsoid(m, uGbC, uGbR, uGbU, uGbV, uGbW, uGbExtra.x, gn);
  if (dGb < 0.0) { c.tissue = T_FLUID; c.bd = -dGb; c.n = gn; c.spec = 0.4; return c; }
  if (dGb < uGbExtra.y) { c.tissue = T_BILEWALL; c.bd = min(dGb, uGbExtra.y - dGb); c.n = gn; c.spec = 0.5; return c; }
  // Riñones
  for (int k = 0; k < 2; k++) {
    if (distance(m, uKidC[k]) > uKidR[k].x + uKidExtra.y + 2.0) continue;
    float inner; float dOuter;
    int region = kidneyRegion(m, k, inner, dOuter);
    vec3 kn;
    kidneyOuter(m, k, kn);
    if (dOuter < 0.0) {
      if (-dOuter < RENAL_CAPSULE_MM) { c.tissue = T_RENAL_CAPSULE; c.bd = min(-dOuter, RENAL_CAPSULE_MM + dOuter); c.n = kn; c.spec = 0.9; return c; }
      c.tissue = region == 3 ? T_RENAL_PELVIS : (region == 2 ? T_RENAL_SINUS : (region == 1 ? T_RENAL_MEDULLA : T_RENAL_CORTEX));
      c.spec = region == 3 ? 0.5 : (region == 2 ? 0.6 : (region == 1 ? 0.25 : 0.45));
      c.bd = inner; c.n = kn; return c;
    }
    if (dOuter < uKidExtra.y) {
      c.tissue = T_PERIRENAL; c.bd = min(dOuter, uKidExtra.y - dOuter); c.n = kn; c.spec = 0.6; return c;
    }
  }
  vec3 ln; float dLiverBase;
  float dLiver = liverSdf(m, ln, dLiverBase);
  if (dLiver >= 0.0 && dLiverBase < 0.0) {
    c.tissue = T_LIG_TERES; c.bd = min(-dLiverBase, dLiver); c.n = ln; c.spec = 0.6; return c;
  }
  if (dLiver < 0.0) {
    float inner = min(-dLiver, min(dDome - DIAPHRAGM_MM, -depth - wall));
    c.n = (inner == -dLiver) ? ln : ((inner == dDome - DIAPHRAGM_MM) ? dn : tn);
    c.spec = 0.5;
    if (inner < CAPSULE_MM) { c.tissue = T_CAPSULE; c.bd = inner; return c; }
    // lámina del ligamento venoso (misma fórmula que ligamentumVenosumSdf)
    float dPl = dot(m, uLigVen.xyz) - uLigVen.w;
    float dLv = max(max(abs(dPl) - 1.2, uLigVenBox.x - m.x), max(max(m.x - uLigVenBox.y, uLigVenBox.z - m.z), m.z - uLigVenBox.w));
    if (dLv < 0.0 && inner > 2.0) { c.tissue = T_LIG_VENOSUM; c.bd = min(-dLv, inner); c.n = uLigVen.xyz; c.spec = 0.7; return c; }
    c.tissue = T_LIVER; c.bd = inner; return c;
  }
  for (int i = 0; i < MAX_GAS; i++) {
    float dg = sdSphere(m, uGas[i], sn);
    if (dg < 0.0) { c.tissue = T_BOWELGAS; c.bd = -dg; c.n = sn; c.spec = 1.0; return c; }
  }
  c.tissue = T_BOWEL; c.bd = 5.0; c.spec = 0.3; c.n = tn;
  return c;
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

// Interpolación trilineal del campo complejo en una retícula de paso h (mm).
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
