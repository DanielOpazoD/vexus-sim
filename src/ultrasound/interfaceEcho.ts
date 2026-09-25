import { INTERFACES, INTERFACE_COUNT, Interface, interfaceReflectivity } from '../anatomy/interfaces';

/**
 * Eco de interfaz (decisión 57): la reflexión determinista de una cara lisa, sumada en la pasada B de
 * forma COHERENTE, con fase 0 común a toda la cara, al fasor aleatorio del moteado y antes de la
 * transmisión (la envolvente resultante es de Rice). Las pasadas C (pulso) y D (PSF lateral coherente)
 * no cambian. Para una muestra dueña de la cara i, con θ el ángulo entre la normal de la cara y el rayo
 * (el reflejado tras el espejo):
 *
 *   a(r) = A_i · Λ(θ; s_i) · χ(θ; σz,i) · C · g(δ')
 *   A_i  = β · 10^(K/20) · R_ef,i · s_ref/s_i        R_ef = max(|R_Fresnel|, suelo)   (anatomy/interfaces.ts)
 *   Λ    = sec²θ · exp(−tan²θ / (4 s²))               lóbulo de Kirchhoff (óptica geométrica) en amplitud;
 *                                                     con s_ref/s conserva la energía y Λ(0; s_ref) = 1
 *   χ    = exp(−2 (k0 σz cosθ)²)                      rugosidad fina (Ament)
 *   C    = [(1 + (2k0σl²κl)²)(1 + (2k0σe²κe)²)]^(−1/4) coherencia de curvatura de un haz gaussiano (tubos y,
 *                                                     desde la decisión 62, costillas: `hasCurvatureCoherence`)
 *   g    = N(δ'; 0, σh), δ' = ifd/(|∇|·cosθ) − (dos lados ? 0 : 2,5σh), |δ'| ≤ 3,5σh
 *
 * Escala: con S = 1 el pico de la envolvente iguala la envolvente RMS del hígado. K es el de un plano
 * liso frente al moteado del hígado: 56,5 dB (Madsen, Insana y Zagzebski 1984; Chen, Phillips y Parker
 * 1997) menos 1,5 dB de aberración de la pared (K₀ = 55 dB, calibrable en la GPU dentro de [53; 57]).
 * β pasa de S al campo de la pasada B: lo mide el gemelo B→C→D (`interfaceTwin.test.ts`) con una cara en
 * arco a 80 mm y 180 mm de profundidad; si cambian C, D o la retícula del moteado, se re-deriva.
 *
 * g es un perfil de integral unidad en el cruce exacto (δ = ifd/(|∇|·cosθ)), muestreado como el moteado:
 * tras C, eco y moteado escalan los dos con 1/√dr y su cociente no depende de la profundidad
 * seleccionada. `ifd` es el valor de la distancia de la cara y |∇| la norma de su gradiente
 * (`faceGradient`): a lo largo del rayo dδ/dr = 1 aunque la distancia no sea euclídea. Sin |∇| el perfil
 * integraba 1/|∇|: la pared AP de la VCI (|∇| = 1/apScale) perdía 2,1 dB a apScale 0,777 y 6 dB a 0,5,
 * y se apagaba al colapsar la VCI. Sin factor de profundidad: la ganancia coherente natural de D sigue
 * a la de un plano con haces gaussianos coherentes (±1,2 dB entre 40 y 120 mm).
 *
 * Gemelos: `interfaceEchoField` (TS, pruebas y gemelo) e `INTERFACE_ECHO_GLSL` (pasada B), misma fórmula
 * y los mismos uniforms (`interfaceUniforms`).
 */

/** Anchura del perfil de la cara (mm): ≥ 0,6·dr hasta 240 mm, así su integral muestreada es 1 a < 1 %. */
export const IFACE_SIGMA_H_MM = 0.14;
/** Desplazamiento del perfil de una cara de un solo lado, dentro de su dueño (mm). */
export const IFACE_SHIFT_MM = 2.5 * IFACE_SIGMA_H_MM;
/** Alcance del perfil a cada lado de su centro (mm): pérdida en el borde −39 dB. */
export const IFACE_REACH_MM = 3.5 * IFACE_SIGMA_H_MM;
/** Pendiente rms de referencia: Λ(0; s_ref) = 1 (la de la VSH, cuyo nivel no cambia con el lóbulo). */
export const IFACE_SLOPE_REF = 0.14;
/** K (dB): cara Γ = 1, s = s_ref, plana y normal, sobre la envolvente RMS del hígado. */
export const IFACE_K_DB = 55;
/** Rango de calibración de K en la GPU (dB): fuera de él es un error de modelo, no de calibración. */
export const IFACE_K_RANGE_DB = [53, 57] as const;
/** Campo de la pasada B por unidad de S (β, campo·mm): gemelo, 180 mm de profundidad, cara a 80 mm. */
export const IFACE_BETA = 0.2903;
/** Por debajo de este |cosθ| la cara no devuelve nada (rasante). */
export const IFACE_MIN_COS = 0.05;
/**
 * Cota de la norma del gradiente de las caras que no son tubos (cápsula, riñón, diafragma, vesícula) para
 * la salida barata de la pasada B, que descarta ifd > alcance·cota antes de calcular el gradiente. Es
 * exacta si toda muestra descartada tiene ifd/|∇| > alcance (`faceGradient.test.ts` lo comprueba a ≤ 3 mm
 * de cada cara): el riñón y la grasa descartados tienen |∇| ≤ 1,02 y la vesícula, hasta 2 con ifd/|∇|
 * lejos del alcance; la cápsula (0,8 mm) y la mitad hepática del diafragma (1,25 mm) no llegan a la cota
 * (1,26 mm en una cara de un lado). Más hondo, la estimación de primer orden no vale (|∇| ~50 en el centro
 * de la vesícula) y es la salida barata la que evita un eco allí. Los tubos usan su |∇| exacta.
 */
export const IFACE_GRADIENT_MAX = 1.5;

/**
 * Distancia por la normal al cruce de la cara, a lo largo del rayo (mm): ifd/(|∇|·cosθ), con ifd el valor
 * de la distancia de la cara y |∇| la norma de su gradiente. Gemelo de la línea de `interfaceEcho` (GLSL).
 */
export function faceDelta(ifd: number, gradNorm: number, cosI: number): number {
  return ifd / (gradNorm * cosI);
}

/** Lóbulo de Kirchhoff en amplitud con conservación de energía: (s_ref/s)·sec²θ·exp(−tan²θ/(4s²)). */
export function facetLobe(cosI: number, s: number): number {
  const c2 = Math.max(cosI * cosI, 1e-6);
  return ((IFACE_SLOPE_REF / s) * Math.exp(-(1 - c2) / c2 / (4 * s * s))) / c2;
}

/** Coherencia de una superficie con rugosidad fina σz (Ament): exp(−2(k0·σz·cosθ)²). */
export function roughnessCoherence(cosI: number, sigmaZMm: number, k0: number): number {
  return Math.exp(-2 * (k0 * sigmaZMm * cosI) ** 2);
}

/**
 * Coherencia de curvatura de un haz gaussiano de dos vías (σl lateral, σe elevacional) sobre una cara
 * de curvaturas κl y κe en esas direcciones (fase estacionaria): [(1+(2k0σl²κl)²)(1+(2k0σe²κe)²)]^(−1/4).
 */
export function curvatureCoherence(sigmaLatMm: number, sigmaElevMm: number, kappaLat: number, kappaElev: number, k0: number): number {
  const al = 2 * k0 * sigmaLatMm * sigmaLatMm * kappaLat;
  const ae = 2 * k0 * sigmaElevMm * sigmaElevMm * kappaElev;
  return ((1 + al * al) * (1 + ae * ae)) ** -0.25;
}

/** Perfil de integral unidad de la cara a la distancia δ del cruce (mm), desplazado si es de un lado. */
export function faceProfile(delta: number, twoSided: boolean): number {
  const d = delta - (twoSided ? 0 : IFACE_SHIFT_MM);
  if (Math.abs(d) > IFACE_REACH_MM) return 0;
  return Math.exp(-0.5 * (d / IFACE_SIGMA_H_MM) ** 2) / (IFACE_SIGMA_H_MM * Math.sqrt(2 * Math.PI));
}

/** Amplitud de incidencia normal de la cara en el campo de la pasada B: β·10^(K/20)·R_ef·s_ref/s. */
export function interfaceAmplitude(id: Interface, kDb = IFACE_K_DB): number {
  if (id === Interface.None) return 0;
  return IFACE_BETA * 10 ** (kDb / 20) * interfaceReflectivity(id) * (IFACE_SLOPE_REF / INTERFACES[id].slopeRms);
}

/**
 * Uniform `uIface` de la pasada B: un vec4 por cara, (A, 2·k0·σz, 1/(4s²), dos lados), con A la
 * amplitud de `interfaceAmplitude`; ceros para `Interface.None`.
 */
export function interfaceUniforms(k0: number, kDb = IFACE_K_DB): Float32Array {
  const out = new Float32Array(4 * INTERFACE_COUNT);
  for (let i = 1; i < INTERFACE_COUNT; i++) {
    const id: Interface = i;
    const p = INTERFACES[id];
    out.set([interfaceAmplitude(id, kDb), 2 * k0 * p.roughnessMm, 1 / (4 * p.slopeRms * p.slopeRms), p.twoSided ? 1 : 0], 4 * i);
  }
  return out;
}

/** Uniforms del último (k0, K) pedido: el gemelo evalúa el eco en cientos de miles de muestras. */
let uniformCache: { k0: number; kDb: number; u: Float32Array } | null = null;

/**
 * Gemelo exacto de `interfaceProfileEcho` (GLSL): el eco de la cara `id` con incidencia cosI, coherencia
 * de curvatura `curv` y la muestra a δ = ifd/(|∇|·cosθ) del cruce (`faceDelta`). Lee los mismos números
 * que el uniform.
 */
export function interfaceEchoField(id: Interface, cosI: number, curv: number, delta: number, k0: number, kDb = IFACE_K_DB): number {
  if (!uniformCache || uniformCache.k0 !== k0 || uniformCache.kDb !== kDb) uniformCache = { k0, kDb, u: interfaceUniforms(k0, kDb) };
  const u = uniformCache.u.subarray(4 * id, 4 * id + 4);
  const d = delta - (u[3] > 0.5 ? 0 : IFACE_SHIFT_MM);
  if (Math.abs(d) > IFACE_REACH_MM || cosI < IFACE_MIN_COS) return 0;
  const c2 = cosI * cosI;
  const lobe = Math.exp((-(1 - c2) / c2) * u[2]) / c2;
  const x = u[1] * cosI;
  const chi = Math.exp(-0.5 * x * x);
  const prof = Math.exp((-0.5 * d * d) / (IFACE_SIGMA_H_MM * IFACE_SIGMA_H_MM)) * (0.39894228 / IFACE_SIGMA_H_MM);
  return u[0] * lobe * chi * curv * prof;
}

/**
 * Coseno de incidencia de la pleura a partir de la reflexión que calcula la pasada A: con d_R = d0 −
 * 2(d0·n)n, d0·d_R = 1 − 2cos²θ.
 */
export function reflectionCosine(d0: readonly number[], dR: readonly number[]): number {
  return Math.sqrt(Math.max(0, 0.5 * (1 - (d0[0] * dR[0] + d0[1] * dR[1] + d0[2] * dR[2]))));
}

/**
 * Pasada B: eco de interfaz de una muestra (necesita `Cls`, `faceGradient` y `uElev` de la anatomía y del
 * haz, `lateralSigmaMm` de `LATERAL_PSF_GLSL` y `wallFaceGain` de `WALL_TEXTURE_GLSL`). `se` es la σ elevacional de UNA vía (`elevSigma`).
 */
export const INTERFACE_ECHO_GLSL = /* glsl */ `
uniform vec4 uIface[${INTERFACE_COUNT}]; // (A, 2·k0·σz, 1/(4s²), dos lados) — interfaceEcho.ts
uniform float uIfaceK0;                 // 2π/λ (1/mm)
#define IFACE_SIGMA_H ${IFACE_SIGMA_H_MM.toFixed(4)}
#define IFACE_SHIFT ${IFACE_SHIFT_MM.toFixed(4)}
#define IFACE_REACH ${IFACE_REACH_MM.toFixed(4)}
#define IFACE_MIN_COS ${IFACE_MIN_COS.toFixed(4)}
#define IFACE_GRAD_MAX ${IFACE_GRADIENT_MAX.toFixed(4)}
// Perfil de integral unidad en el cruce exacto (o 2,5σh dentro del dueño si solo un lado conoce la
// cara): muestreado como el moteado, el cociente eco/moteado no depende de dr (decisión 57).
float interfaceProfileEcho(int id, float cosI, float curv, float delta) {
  vec4 P = uIface[id];
  float d = delta - (P.w > 0.5 ? 0.0 : IFACE_SHIFT);
  if (abs(d) > IFACE_REACH || cosI < IFACE_MIN_COS) return 0.0;
  float c2 = cosI * cosI;
  float lobe = exp(-(1.0 - c2) / c2 * P.z) / c2;   // Kirchhoff en amplitud: sec²θ·exp(−tan²θ/4s²)
  float x = P.y * cosI;
  float chi = exp(-0.5 * x * x);                    // exp(−2(k0·σz·cosθ)²)
  float prof = exp(-0.5 * d * d / (IFACE_SIGMA_H * IFACE_SIGMA_H)) * (0.39894228 / IFACE_SIGMA_H);
  return P.x * lobe * chi * curv * prof;
}
// Coherencia de curvatura de un haz gaussiano sobre un tubo (fase estacionaria): la curvatura del
// tubo (c.kc, la local de su sección) va por la dirección circunferencial; se proyecta sobre el lateral
// y la elevación del haz
float tubeCurvature(Cls c, vec3 n, vec3 dir, float r, float se) {
  vec3 circ = cross(n, c.tangent);
  float cl = length(circ);
  if (cl < 1e-4) return 1.0;
  circ /= cl;
  vec3 lat = normalize(cross(uElev, dir));
  float sl = lateralSigmaMm(r);                       // dos vías (beamModel)
  float sE = se * 0.70710678;                         // elevSigma es de una vía
  float kl = dot(lat, circ); kl = kl * kl * c.kc;
  float ke = dot(uElev, circ); ke = ke * ke * c.kc;
  float al = 2.0 * uIfaceK0 * sl * sl * kl;
  float ae = 2.0 * uIfaceK0 * sE * sE * ke;
  return inversesqrt(sqrt((1.0 + al * al) * (1.0 + ae * ae)));
}
// Eco de la cara que dibuja la muestra (material m, rayo dir, profundidad r)
float interfaceEcho(Cls c, vec3 m, vec3 dir, float r, float se) {
  if (c.iface == IF_NONE) return 0.0;
  // salida barata sin gradiente: δ = ifd/(|∇|·cosθ) ≥ ifd/|∇|; la norma de un tubo ya está en c.n, la
  // del resto se acota (IFACE_GRAD_MAX)
  float gBound = c.iface <= IF_LAST_TUBE ? length(c.n) : IFACE_GRAD_MAX;
  if (c.ifd > (uIface[c.iface].w > 0.5 ? IFACE_REACH : IFACE_SHIFT + IFACE_REACH) * gBound) return 0.0;
  vec4 fg = faceGradient(c, m);
  float cosI = abs(dot(fg.xyz, dir));
  if (cosI < IFACE_MIN_COS) return 0.0;
  // tubos y costillas (decisión 62): cilindros con la curvatura de su sección en c.kc y su eje en c.tangent
  float curv = c.iface <= IF_LAST_TUBE || c.iface == IF_RIB || c.iface == IF_PERICHONDRIUM ? tubeCurvature(c, fg.xyz, dir, r, se) : 1.0;
  // las caras de la pared: la variación anclada de su reflectividad a lo largo de la cara (wallTexture.ts)
  if (c.iface >= IF_FIRST_WALL && c.iface <= IF_LAST_WALL) curv *= wallFaceGain(m, c.iface);
  // perfil en la distancia por la normal (faceDelta): integra 1 a lo largo del rayo aunque |∇| ≠ 1
  return interfaceProfileEcho(c.iface, cosI, curv, c.ifd / (fg.w * cosI));
}
// Pleura: su eco se centra en el cruce exacto del espejo de la pasada A (no sale de classify), una vez
// por línea; el coseno sale de la reflexión (reflectionCosine)
float pleuraEcho(float delta, vec3 d0, vec3 dR) {
  return interfaceProfileEcho(IF_PLEURA, sqrt(max(0.0, 0.5 * (1.0 - dot(d0, dR)))), 1.0, delta);
}
`;
