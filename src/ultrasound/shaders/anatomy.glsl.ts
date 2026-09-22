/**
 * Fragmento GLSL compartido: la misma anatomía implícita que `anatomy/scene.ts`,
 * evaluada en la GPU a partir de los mismos datos declarativos. Los tubos
 * (vasos y conductos) viajan en una textura de datos RGBA32F (`uSceneTex`,
 * decisión 24) y las primitivas en uniformes. Mantener las dos implementaciones
 * sincronizadas es una regla del proyecto (ver docs/DECISIONS.md); el test
 * `anatomy.test.ts` fija la versión TS.
 *
 * Disposición de la textura (índice lineal i → texel (i & 255, i >> 8)):
 *   tubo t, cabecera en 4 texels desde t·4:
 *     H0 = (inicio de nodos, n.º nodos, apScale, escala de radio)
 *     H1 = (espesor de pared mm, tejido de pared, tejido de la luz, tipo: 0 vaso / 1 conducto)
 *     H2 = (u_ref mm/s, r_ref mm, exponente del perfil, 0)
 *     H3 = esfera envolvente (cx, cy, cz, R)
 *   nodos desde NODE_BASE = MAX_TUBES·4: (x, y, z, r)
 */
import { DIAPHRAGM_THICKNESS_MM, LIVER_CAPSULE_MM, TISSUE_GLSL_NAME } from '../../anatomy/tissues';

export const MAX_TUBES = 40;
export const MAX_NODES = 256;
export const NODE_BASE = MAX_TUBES * 4;
export const SCENE_TEX_W = 256;
export const SCENE_TEX_H = Math.ceil((NODE_BASE + MAX_NODES) / SCENE_TEX_W);
export const MAX_GAS = 6;
export const MAX_RIBS = 6;

const TISSUE_DEFINES = Object.entries(TISSUE_GLSL_NAME)
  .map(([index, name]) => `#define ${name} ${index}`)
  .join('\n');

export const ANATOMY_GLSL = /* glsl */ `
#define MAX_TUBES ${MAX_TUBES}
#define MAX_NODES ${MAX_NODES}
#define NODE_BASE ${NODE_BASE}
#define MAX_GAS ${MAX_GAS}
#define MAX_RIBS ${MAX_RIBS}
${TISSUE_DEFINES}
#define DIAPHRAGM_MM ${DIAPHRAGM_THICKNESS_MM.toFixed(3)}
#define CAPSULE_MM ${LIVER_CAPSULE_MM.toFixed(3)}

uniform vec4 uTorso;      // a, b, zMin, zMax
uniform vec3 uWall;       // skin, fat, muscle (mm)
uniform vec4 uDome;       // x0, y0, rx, ry
uniform vec2 uDome2;      // zBase, h
uniform vec3 uSpine;      // x0, y0, r
uniform vec3 uLiverC;
uniform vec3 uLiverR;
uniform float uLiverTaper;
uniform vec3 uLiverLC;
uniform vec3 uLiverLR;
uniform float uLiverLTaper;
uniform float uLiverBlend;
uniform vec4 uVisceral;   // zAtY0, slopeY, edgeRound, renalImpression
uniform vec3 uGbC;
uniform vec3 uGbR;
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

vec4 sceneTexel(int i) { return texelFetch(uSceneTex, ivec2(i & 255, i >> 8), 0); }

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

float domeHeight(float x, float y) {
  float u = (x - uDome.x) / uDome.z;
  float v = (y - uDome.y) / uDome.w;
  float rho2 = u * u + v * v;
  float q = 1.0 - rho2 * rho2;
  return uDome2.x + uDome2.y * sqrt(max(0.0, q));
}

// Distancia con signo a la cúpula (negativa en el tórax) y normal hacia el abdomen.
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
float kidneyOuter(vec3 p, int k, out vec3 n) {
  vec3 q = kidneyLocal(p, k);
  vec3 r = uKidR[k];
  vec3 nl = normalize(q / (r * r) + vec3(1e-6));
  n = normalize(uKidU[k] * nl.x + uKidV[k] * nl.y + uKidW[k] * nl.z);
  return sdEllipsoidLocal(q, r);
}

// Región interna: 0 corteza, 1 médula, 2 seno; devuelve la distancia interna mínima
int kidneyRegion(vec3 p, int k, out float inner, out float dOuter) {
  vec3 q = kidneyLocal(p, k);
  dOuter = sdEllipsoidLocal(q, uKidR[k]);
  vec4 sn = uKidSinus[k];
  vec3 qs = vec3(q.x, q.y - sn.w, q.z);
  float dSinus = sdEllipsoidLocal(qs, sn.xyz);
  float t = clamp(q.y - sn.w, 0.0, uKidR[k].y);
  float dHilum = length(vec3(q.x, q.y - sn.w - t, q.z)) - uKidExtra.x;
  dSinus = min(dSinus, dHilum);
  if (dSinus < 0.0) { inner = min(-dSinus, -dOuter); return 2; }
  bool medulla = false;
  if (dSinus > 1.5 && dSinus < 13.0 && -dOuter > 5.0) {
    float theta = atan(q.z, q.y);
    float halfAng = 0.22 + 0.028 * dSinus;
    float halfU = 4.5 + 0.45 * dSinus;
    for (int i = 0; i < 3; i++) {
      float th = 1.5707963 * float(i + 1);
      float dth = theta - th;
      dth = atan(sin(dth), cos(dth));
      if (abs(dth) > halfAng) continue;
      for (int j = 0; j < 4; j++) {
        float u0 = (j == 0) ? -40.0 : (j == 1 ? -13.0 : (j == 2 ? 13.0 : 40.0));
        if (abs(q.x - u0) < halfU) { medulla = true; }
      }
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
  for (int i = 0; i < 8; i++) {
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
float liverSdf(vec3 m, out vec3 n) {
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
  float dg = sdEllipsoid(m, uGbC, uGbR, 0.0, gn);
  float d4 = smoothMax(d3, -dg, 4.0);
  if (d4 > d3 + 1e-3) n = -gn;
  return d4;
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
  float dSpine = length(m.xy - uSpine.xy) - uSpine.z;
  if (dSpine < 0.0) { c.tissue = T_BONE; c.bd = -dSpine; c.n = normalize(vec3(m.xy - uSpine.xy, 0.0)); c.spec = 0.9; return c; }
  // Vasos y conductos (descarte por esfera envolvente)
  int bestT = -1; float bestD = 1e9; float bRho; vec3 bTan; float bR; vec3 bN;
  for (int t = 0; t < MAX_TUBES; t++) {
    if (t >= uTubeCount) break;
    vec4 bs = sceneTexel(t * 4 + 3);
    if (distance(m, bs.xyz) > bs.w) continue;
    float rho; vec3 tg; float rl; vec3 nn;
    float sd = tubeQuery(m, t, rho, tg, rl, nn);
    float wallMm = sceneTexel(t * 4 + 1).x;
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
    if (bestD < 0.0) { c.tissue = lumenT; c.bd = -bestD; c.vessel = duct ? -1 : bestT; return c; }
    c.tissue = wallT; c.bd = min(bestD, h1.x - bestD); return c;
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
  float dGb = sdEllipsoid(m, uGbC, uGbR, 0.0, gn);
  if (dGb < 0.0) { c.tissue = T_FLUID; c.bd = -dGb; c.n = gn; c.spec = 0.4; return c; }
  // Riñones
  for (int k = 0; k < 2; k++) {
    if (distance(m, uKidC[k]) > uKidR[k].x + uKidExtra.y + 2.0) continue;
    float inner; float dOuter;
    int region = kidneyRegion(m, k, inner, dOuter);
    vec3 kn;
    kidneyOuter(m, k, kn);
    if (dOuter < 0.0) {
      c.tissue = region == 2 ? T_RENAL_SINUS : (region == 1 ? T_RENAL_MEDULLA : T_RENAL_CORTEX);
      c.spec = region == 2 ? 0.6 : (region == 1 ? 0.25 : 0.45);
      c.bd = inner; c.n = kn; return c;
    }
    if (dOuter < uKidExtra.y) {
      c.tissue = T_PERIRENAL; c.bd = min(dOuter, uKidExtra.y - dOuter); c.n = kn; c.spec = 0.6; return c;
    }
  }
  vec3 ln;
  float dLiver = liverSdf(m, ln);
  if (dLiver < 0.0) {
    float inner = min(-dLiver, min(dDome - DIAPHRAGM_MM, -depth - wall));
    c.n = (inner == -dLiver) ? ln : ((inner == dDome - DIAPHRAGM_MM) ? dn : tn);
    c.spec = 0.5;
    c.tissue = inner < CAPSULE_MM ? T_CAPSULE : T_LIVER; c.bd = inner; return c;
  }
  for (int i = 0; i < MAX_GAS; i++) {
    float dg = sdSphere(m, uGas[i], sn);
    if (dg < 0.0) { c.tissue = T_BOWELGAS; c.bd = -dg; c.n = sn; c.spec = 1.0; return c; }
  }
  c.tissue = T_BOWEL; c.bd = 5.0; c.spec = 0.3; c.n = tn;
  return c;
}

// Velocidad de la sangre (mm/s, marco material) para una clasificación de sangre.
vec3 bloodVelocity(Cls c) {
  if (c.vessel < 0) return vec3(0.0);
  float uLocal = c.uRef * (c.rRef * c.rRef) / (c.rLoc * c.rLoc);
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
