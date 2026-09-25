import { INTERFACES, Interface, interfaceReflectivity } from '../anatomy/interfaces';
import { LUNG_CURTAIN } from '../anatomy/organs/lungCurtain';
import { cross, normalize, type Vec3 } from '../core/vec3';
import { roughnessCoherence } from './interfaceEcho';
import { RECEIVER_NOISE, glslFloat } from './receiver';
import { scattererField } from './speckleField';

/**
 * Pleura parietal y cortina pulmonar (decisión 61): lo que la pasada B dibuja bajo la pared cuando el haz
 * cruza el pulmón de la cortina. Antes la cortina era el espejo del diafragma (decisión 57): tras ella solo
 * quedaban tres gaussianas finas a múltiplos de la profundidad del gas y el resto era negro. En las
 * imágenes reales (Lee 2017, J Med Ultrasound 25:101, figs. 1B y 5; PMC10132878 fig. 2A) la pleura es la
 * línea más brillante, debajo hay una neblina gris con bandas horizontales y líneas A que se apagan con la
 * profundidad, el pulmón desliza con la respiración y el borde de la cortina es blando y oblicuo (~1 cm).
 *
 * Modelo, a lo largo del camino de la muestra (la línea de la mirada 0 o el camino dirigido, decisión 58),
 * con t la transmisión de amplitud de una vía, T = t² la de ida y vuelta (A, sin el acoplamiento), D la
 * distancia al cruce exacto de la pleura (A0) y E(d) = f(d)·T(d) el eco directo de la pared a la distancia
 * d (f, el campo de la pasada B: moteado anclado, grumos y ecos de interfaz de la pared):
 *
 *  - línea pleural: eco especular de la cara `Interface.PleuraWall` (Fresnel músculo/gas, lóbulo de
 *    Kirchhoff, rugosidad de Ament, perfil de integral unidad del lado del músculo) por T(D);
 *  - cada reflexión especular en la pleura dentro de la serie vale R_p·χ, su reflexión COHERENTE: el
 *    Fresnel por la misma coherencia de Ament que da el nivel de la línea pleural, χ = exp(−2(k0·σz·cosθ)²)
 *    (la parte difusa de la superficie rugosa se va en otras direcciones). Con R_p ≈ 1 a secas, como el
 *    plan, la copia espejo de la pared salía tan brillante como el hígado (gemelo: neblina 0,99 × el hígado);
 *  - copia espejo (sonda → pleura → sube hasta d → dispersa → pleura → sonda), a la distancia aparente
 *    2D − d: E(d)·(R_p·χ)²·(T(D)/T(d))²;
 *  - copia directa (sonda → pleura → cara de la sonda → baja hasta d → dispersa), a D + d: E(d)·G, con
 *    G = R_p·χ·R_t·T(D) la ganancia de una ida y vuelta pleura–sonda; el camino recíproco (sonda → d →
 *    dispersa → cara → pleura → sonda) tiene el mismo retardo y la misma fase y se suma coherente: ×2;
 *  - cada ida y vuelta más multiplica por G y desplaza D, y los caminos del mismo retardo se suman: el orden n
 *    de la copia espejo tiene n + 1 y el de la directa n + 2; espejo y directa se alternan y se solapan en
 *    cada intervalo [nD, (n+1)D], así que cada muestra necesita a lo sumo dos muestras de la pared, en
 *    las distancias d_M = (n+2)D − s y d_F = s − (n+1)D con n = ⌊s/D⌋ − 1;
 *  - líneas A: las réplicas del eco pleural (la copia directa con d = D): orden k a kD, G^(k−1) por la
 *    línea pleural. La copia espejo NO lleva el eco pleural (en d = D su camino es el del eco directo, y
 *    en cualquier orden coincide con una réplica de la directa): sin doble cuenta;
 *  - deslizamiento: un componente incoherente anclado a las coordenadas materiales del pulmón, que baja
 *    con la respiración (el descenso de la propia cortina), con grano alargado a lo largo de la pleura;
 *  - borde blando: la fracción del haz que da en el aire en el cruce de la pleura es
 *    f = Φ(dz/σ), σ² = (σe·|e_z|)² + (σl·|l_z|)² + σ_taper², con dz la distancia al borde caudal de la
 *    cortina, σe y σl las anchuras de dos vías del haz en elevación y lateral a la profundidad de la
 *    pleura y e, l sus direcciones; bajo la pleura la muestra es f·(pulmón) + (1 − f)·(el tejido de
 *    detrás, con la transmisión que ignora la lámina de pulmón).
 *
 * Gemelos: estas funciones (TS, pruebas y banco) y `PLEURA_GLSL` (pasada B, los dos programas), misma
 * fórmula; la geometría del camino dirigido en `steeredSample` (`steering.ts`).
 */

/** Reflexión de la pleura R_p: |Fresnel| músculo/gas de la tabla de caras (≈ 0,9995). */
export const PLEURA_RP = interfaceReflectivity(Interface.PleuraWall);
/**
 * Reflexión efectiva de la cara de la sonda y la piel, R_t [ESTIMADO 0,3; calibrable 0,2–0,5]: fija la
 * ganancia de cada ida y vuelta de la reverberación (líneas A y copias directas de la pared).
 */
export const PLEURA_RT = 0.3;
export const PLEURA_RT_RANGE = [0.2, 0.5] as const;
/** Estrechamiento del borde del pulmón en el receso, σ_taper (mm) [ESTIMADO 3–5]. */
export const CURTAIN_TAPER_MM = 4;
export const CURTAIN_TAPER_RANGE_MM = [3, 5] as const;
/**
 * A0 registra la pleura de una línea si el cruce está a menos de esto del borde por el lado del hígado
 * (mm): con σ ≤ 5,6 mm (σ_taper 5, el haz más ancho de la imagen) la fracción de aire ya es < 10⁻³.
 */
export const CURTAIN_RECORD_MM = 20;
/** Fracción de aire por debajo de la cual la línea no tiene cortina (y por encima de 1 − esto, ni tejido detrás). */
export const CURTAIN_MIN_AIR = 1e-3;
/**
 * Deslizamiento: nivel mostrado junto a la pleura respecto al moteado del hígado a esa profundidad (dB) [ESTIMADO −8 a
 * −12]. El tope del rango: su grano alargado sostiene la anisotropía de la neblina (gemelo: 2,57 con −8; 2,50 con −9).
 */
export const SLIDING_DB = -8;
export const SLIDING_DB_RANGE = [-12, -8] as const;
/**
 * Ganancia coherente (dB) que las pasadas C y D dan al campo del deslizamiento sobre la que dan al moteado del
 * hígado: su grano es más largo que la PSF (3 mm a lo largo de la pleura frente a ~1,4 mm de FWHM lateral),
 * así que se suma casi en fase dentro de los núcleos de energía unidad [MEDIDO con el gemelo B → C → D,
 * `pleuraTwin.test.ts`: 8,9 dB a 1–3 mm bajo la pleura]. El campo va a SLIDING_DB − esto para que la imagen
 * lo muestre a SLIDING_DB.
 */
export const SLIDING_PSF_GAIN_DB = 9;
/** Deslizamiento: caída con la profundidad bajo la pleura (e-fold, mm) [ESTIMADO 10–20]. */
export const SLIDING_EFOLD_MM = 15;
export const SLIDING_EFOLD_RANGE_MM = [10, 20] as const;
/** Grano del deslizamiento a lo largo de la pleura y en profundidad (mm) [ESTIMADO]: 6 veces más largo que hondo. */
export const SLIDING_LAT_MM = 3;
export const SLIDING_AX_MM = 0.5;
/** Semilla del campo del deslizamiento (otra población que el moteado de los tejidos). */
export const SLIDING_SALT = 23.17;
/** La serie se suma solo mientras su término puede pasar de la décima parte del ruido del receptor. */
export const PLEURA_SERIES_FLOOR = RECEIVER_NOISE / 10;
/**
 * Eco de las caras de la pared en sus copias bajo la pleura (decisión 62) sobre el de la pared directa
 * [ESTIMADO 0,1–0,3]: la imagen coherente de una cara especular se degrada en el camino de la reverberación
 * (cuatro pasos más por la pared, con su aberración de fase, y la pleura, que no es plana a la escala del haz),
 * cosa que χ, la rugosidad fina, no recoge; el moteado es incoherente y no la pierde. Con 1 las copias de las
 * fascias quedaban a +8–12 dB sobre la neblina de entre ellas y la imagen bajo la pleura era un peine de arcos
 * brillantes (captura con SwiftShader, intercostal en inspiración); con 0,15 son las bandas tenues de las
 * referencias (Lee 2017, fig. 5B: +2–5 dB en el gemelo) y el deslizamiento sigue a la vista.
 */
export const WALL_COPY_FACE_GAIN = 0.15;
export const WALL_COPY_FACE_GAIN_RANGE = [0.1, 0.3] as const;
/**
 * Cota del campo de la pared en una muestra (moteado de la piel a 3σ, 1,4·3, más el pico de una cara de
 * la pared con |R| ≤ 0,05; desde la decisión 62, el de la piel en las copias: ≈ 11 con su variación máxima y
 * `WALL_COPY_FACE_GAIN`): decide cuándo se deja de sumar la serie (`PLEURA_SERIES_FLOOR`).
 */
export const PLEURA_WALL_FIELD_BOUND = 16;
/** Pasos del punto fijo que busca la línea cuyo cruce de la pleura corta un camino dirigido. */
export const PLEURA_STEER_ITERATIONS = 3;
/** Profundidad de la pleura (mm) con que empieza ese punto fijo si la línea de la muestra no tiene pleura. */
export const PLEURA_STEER_GUESS_MM = 30;
/** Pulmón de la cortina en la marca de gas de A1 (decisión 61): no es un impacto de gas para A2 ni A. */
export const CURTAIN_GAS_KIND = 3;
/** σ elevacional de una vía de la pasada B en el foco de la lente (mm) y su rango de Rayleigh: `elevSigma`. */
export const ELEV_SIGMA0_MM = 1.6;
export const ELEV_RAYLEIGH_MM = 45;

/** σ elevacional de una vía de la pasada B a la profundidad r (`elevSigma`, mm). */
export function elevSigmaMm(r: number, elevationFocusMm: number): number {
  return ELEV_SIGMA0_MM * Math.sqrt(1 + ((r - elevationFocusMm) / ELEV_RAYLEIGH_MM) ** 2);
}

/** Φ(x) con la erf de Abramowitz y Stegun 7.1.26 (error ≤ 1,5·10⁻⁷): la misma cuenta que la GLSL. */
export function normalCdf(x: number): number {
  const z = Math.abs(x) * Math.SQRT1_2;
  const t = 1 / (1 + 0.3275911 * z);
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const erf = 1 - poly * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/**
 * σ del borde blando (mm): σ² = (σe·|e_z|)² + (σl·|l_z|)² + σ_taper², con σe y σl las anchuras de DOS
 * vías del haz en elevación y lateral a la profundidad de la pleura y e_z, l_z las componentes
 * craneocaudales de esas direcciones.
 */
export function curtainEdgeSigmaMm(
  sigmaElev2Mm: number,
  sigmaLatMm: number,
  elevZ: number,
  latZ: number,
  taperMm = CURTAIN_TAPER_MM,
): number {
  return Math.sqrt((sigmaElev2Mm * elevZ) ** 2 + (sigmaLatMm * latZ) ** 2 + taperMm * taperMm);
}

/** Fracción del haz que da en el pulmón: Φ(dz/σ); dz, distancia al borde caudal (positiva hacia el pulmón). */
export function curtainAirFraction(dzMm: number, sigmaMm: number): number {
  return normalCdf(dzMm / sigmaMm);
}

/**
 * Fracción de aire de una línea (gemelo de `curtainAirFraction` de la GLSL): el haz de dos vías a la
 * profundidad D de la pleura, con la dirección `dir` de la línea, el eje de elevación del marco y la PSF
 * lateral de dos vías del equipo (`lateralSigmaMm` de `beamModel.ts` con su foco).
 */
export function curtainAirFractionAt(
  dz: number,
  D: number,
  dir: Vec3,
  elevation: Vec3,
  elevationFocusMm: number,
  lateralSigma: (r: number) => number,
): { fAir: number; sigmaMm: number } {
  const lat = normalize(cross(elevation, dir));
  const sigmaMm = curtainEdgeSigmaMm(elevSigmaMm(D, elevationFocusMm) * Math.SQRT1_2, lateralSigma(D), elevation[2], lat[2]);
  return { fAir: curtainAirFraction(dz, sigmaMm), sigmaMm };
}

/**
 * Peso de las miradas dirigidas en K bajo la cortina (decisión 61): cada mirada reverbera bajo la pleura a
 * múltiplos de su propio camino, y la media de tres dejaba cada línea A partida en tres arcos (los equipos no
 * componen en pulmón). Bajo la pleura de la mirada 0 (r > D, fAir ≥ CURTAIN_MIN_AIR) la dirigida pesa 1 − fAir
 * (0 en la cortina entera, sin costura en el borde blando); fuera, 1. Gemelo de `curtainSteerWeight` (GLSL).
 */
export function curtainSteerWeight(r: number, D: number, fAir: number): number {
  return D > 0 && fAir >= CURTAIN_MIN_AIR && r > D ? 1 - fAir : 1;
}

/** Anchura 10–90 % (mm) de un borde gaussiano de σ: 2·1,2816·σ. */
export function edgeWidth1090Mm(sigmaMm: number): number {
  return 2 * 1.2815516 * sigmaMm;
}

/**
 * Centro de la fila de la pasada A más honda que no toca el pulmón (mm): la fila k lleva la pérdida de su
 * segmento, clasificado en su centro, así que la transmisión hasta la pleura, sin la del gas, es la de la
 * fila k_D = ⌈D/paso − ½⌉ − 1. Interpolar entre filas mezclaba hasta 6,75 dB de gas (un segmento) según
 * dónde cayera la pleura en su fila.
 */
export function pleuraCapMm(D: number, step: number): number {
  return (Math.max(Math.ceil(D / step - 0.5) - 1, 0) + 0.5) * step;
}

/**
 * χ de la pleura parietal con la incidencia de la línea (Ament, la de su cara en la tabla): la parte coherente
 * de su reflexión especular, la que forma las imágenes de la serie (`pleuraCoherence`).
 */
export function pleuraCoherence(cosI: number, k0: number): number {
  return roughnessCoherence(cosI, INTERFACES[Interface.PleuraWall].roughnessMm, k0);
}

/**
 * G = R_p·χ·R_t·T(D): ganancia de una ida y vuelta pleura–cara de la sonda con la reflexión coherente de la
 * pleura (T sin el acoplamiento).
 */
export function pleuraRoundTrip(tD: number, chi: number, rt = PLEURA_RT): number {
  return PLEURA_RP * chi * rt * tD;
}

/**
 * Distancias de la pared que muestrea la serie a la distancia s del camino (s > D): el orden n = ⌊s/D⌋ − 1
 * de las idas y vueltas, la copia espejo d_M = (n+2)D − s y la directa d_F = s − (n+1)D, las dos en [0, D].
 */
export function pleuraSeriesDepths(s: number, D: number): { n: number; mirror: number; forward: number } {
  const n = Math.max(Math.floor(s / D) - 1, 0);
  return { n, mirror: (n + 2) * D - s, forward: s - (n + 1) * D };
}

/** Orden de la réplica del eco pleural más cercana a s: k = max(1, redondeo(s/D)); 1 es la línea pleural. */
export function aLineOrder(s: number, D: number): number {
  return Math.max(1, Math.floor(s / D + 0.5));
}

/** Gⁿ con G⁰ = 1 aunque G sea 0 (en GLSL pow(0, 0) no está definido): `seriesPow`. */
export function seriesPow(G: number, n: number): number {
  return n < 0.5 ? 1 : Math.max(G, 1e-30) ** n;
}

/**
 * Ganancia de la copia espejo de orden n sobre el campo de la pared f(d): (n + 1)·(R_p·χ)²·T(D)²/T(d)·Gⁿ
 * (= E(d)·(R_p·χ)²·(T(D)/T(d))²·Gⁿ / f por cada camino). Las n idas y vueltas pleura–sonda más pueden ir antes o
 * después de la dispersión: n + 1 caminos del mismo retardo y la misma fase, que se suman coherentes.
 */
export function mirrorGain(tD: number, td: number, chi: number, G: number, n: number): number {
  const rp = PLEURA_RP * chi;
  return (n + 1) * ((rp * rp * tD * tD) / Math.max(td, 1e-6)) * seriesPow(G, n);
}

/**
 * Ganancia de la copia directa de orden n sobre f(d): (n + 2)·T(d)·G^(n+1) (= E(d)·G^(n+1) / f por camino). La
 * dispersión puede ir en cualquiera de las n + 2 posiciones de la secuencia de rebotes (con n = 0: sonda → pleura
 * → cara → d y sonda → d → cara → pleura), caminos del mismo retardo y la misma fase.
 */
export function forwardGain(td: number, G: number, n: number): number {
  return (n + 2) * td * G * seriesPow(G, n);
}

/** Ganancia de la réplica k del eco pleural (k = 1: la línea pleural). */
export function aLineGain(G: number, k: number): number {
  return seriesPow(G, k - 1);
}

/**
 * Un término de lo que la pasada B suma bajo la pleura a la distancia s del camino, sobre el campo de la
 * pared f en `depth` (espejo y directa) o sobre el perfil de la pleura en δ = `depth` (líneas A): la
 * amplitud es `gain`·f(depth) o `gain`·eco pleural(δ), sin el acoplamiento ni la fracción de aire.
 */
export interface PleuraTerm {
  family: 'pleura' | 'mirror' | 'forward';
  order: number;
  depth: number;
  gain: number;
}

/**
 * Los términos del pulmón a la distancia s del camino (gemelo de la rama de la cortina de la pasada B): la
 * réplica del eco pleural más cercana (siempre; k = 1 es la línea pleural, que también dibuja el músculo
 * por encima de D) y, bajo la pleura, las dos copias de la pared con su orden, salvo si la serie ya cae
 * bajo la décima del ruido (`fieldBound`: cota de |f|·acoplamiento). `chi`: la coherencia de la pleura con la
 * incidencia de la línea (`pleuraCoherence`); `tAt(d)`: T(d) sin acoplamiento, con la fila de la pleura por
 * tope (`pleuraCapMm`).
 */
export function pleuraTerms(
  s: number,
  D: number,
  tD: number,
  chi: number,
  tAt: (d: number) => number,
  fieldBound = PLEURA_WALL_FIELD_BOUND,
): PleuraTerm[] {
  const G = pleuraRoundTrip(tD, chi);
  const k = aLineOrder(s, D);
  const out: PleuraTerm[] = [{ family: 'pleura', order: k, depth: k * D - s, gain: aLineGain(G, k) * tD }];
  if (s <= D) return out;
  const { n, mirror, forward } = pleuraSeriesDepths(s, D);
  const gn = seriesPow(G, n);
  if (!(gn * tD * fieldBound > PLEURA_SERIES_FLOOR)) return out;
  out.push({ family: 'mirror', order: n, depth: mirror, gain: mirrorGain(tD, tAt(mirror), chi, G, n) });
  out.push({ family: 'forward', order: n, depth: forward, gain: forwardGain(tAt(forward), G, n) });
  return out;
}

/**
 * Amplitud del campo del deslizamiento a h mm bajo la pleura (respecto al moteado del hígado antes de la PSF,
 * sin transmisión): 10^((SLIDING_DB − SLIDING_PSF_GAIN_DB)/20)·e^(−h/e-fold).
 */
export function slidingAmplitude(h: number): number {
  return 10 ** ((SLIDING_DB - SLIDING_PSF_GAIN_DB) / 20) * Math.exp(-h / SLIDING_EFOLD_MM);
}

/**
 * Coordenada de retícula del deslizamiento: el punto material de la pleura con la z del pulmón (que ha
 * bajado `caudalMm`: el pulmón que estaba en z + descenso en espiración) a escala del grano a lo largo de
 * la pleura, más h mm hacia dentro (−normal de la piel) a escala del grano en profundidad.
 */
export function slidingLattice(pD: Vec3, outwardNormal: Vec3, caudalMm: number, h: number): Vec3 {
  const a = h / SLIDING_AX_MM;
  return [
    pD[0] / SLIDING_LAT_MM - outwardNormal[0] * a,
    pD[1] / SLIDING_LAT_MM - outwardNormal[1] * a,
    (pD[2] + caudalMm) / SLIDING_LAT_MM - outwardNormal[2] * a,
  ];
}

/** Campo del deslizamiento (`slidingField` de la pasada B, sin transmisión): `seed` es el uSeed del cuadro. */
export function slidingField(pD: Vec3, outwardNormal: Vec3, caudalMm: number, h: number, seed: number, salt = 0): [number, number] {
  const f = scattererField(slidingLattice(pD, outwardNormal, caudalMm, h), 1, seed + SLIDING_SALT + salt);
  const a = slidingAmplitude(h);
  return [f[0] * a, f[1] * a];
}

/**
 * Fracción de aire del haz en el cruce de la pleura y peso de las miradas dirigidas bajo la cortina, en GLSL:
 * los comparten B (el borde blando) y K. Usa `elevSigma`, `lateralSigmaMm` (`LATERAL_PSF_GLSL`) y `uElev`, y
 * declara `uHits2`, la salida de la pleura de A0: (D, dz, ΔL dB, tipo) por línea.
 */
export const CURTAIN_AIR_GLSL = /* glsl */ `
uniform sampler2D uHits2; // A0 h2 (decisión 61): pleura parietal de cada línea
const float CURTAIN_TAPER_MM = ${glslFloat(CURTAIN_TAPER_MM)};
const float CURTAIN_MIN_AIR = ${glslFloat(CURTAIN_MIN_AIR)};
// Φ(x), erf de Abramowitz y Stegun 7.1.26
float normalCdf(float x) {
  float z = abs(x) * 0.70710678;
  float t = 1.0 / (1.0 + 0.3275911 * z);
  float poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  float e = 1.0 - poly * exp(-z * z);
  return x >= 0.0 ? 0.5 * (1.0 + e) : 0.5 * (1.0 - e);
}
float curtainEdgeSigmaMm(float se2, float sl, float ez, float lz) {
  return sqrt(se2 * se2 * ez * ez + sl * sl * lz * lz + CURTAIN_TAPER_MM * CURTAIN_TAPER_MM);
}
// Fracción del haz de dos vías (elevSigma es de una vía) que da en el pulmón en el cruce de la pleura
float curtainAirFraction(float dz, float dRow, vec3 dir) {
  vec3 lat = normalize(cross(uElev, dir));
  return normalCdf(dz / curtainEdgeSigmaMm(elevSigma(dRow) * 0.70710678, lateralSigmaMm(dRow), uElev.z, lat.z));
}
// Peso de las miradas dirigidas en K: 1 − fAir bajo la pleura de la cortina de la mirada 0, 1 fuera
float curtainSteerWeight(float r, float D, float fAir) { return D > 0.0 && fAir >= CURTAIN_MIN_AIR && r > D ? 1.0 - fAir : 1.0; }
`;

/**
 * La misma física en GLSL, común a los dos programas de la pasada B (va detrás de `sampleSide`: usa
 * `elevSigma`, `lateralSigmaMm`, `fieldFor`, `anchoredClump`, `interfaceEcho`, `wallFaceEchoFlat`,
 * `scattererField`, `uSeed`, `uElev` y `uCurtain`). Lleva `CURTAIN_AIR_GLSL` (y con él `uHits2`).
 */
export const PLEURA_GLSL = /* glsl */ `${CURTAIN_AIR_GLSL}
uniform sampler2D uTrans2; // A o2: rayo único (x la mirada 0, y la dirigida): tope de la transmisión sin la lámina
const float PLEURA_RP = ${glslFloat(PLEURA_RP)};
const float PLEURA_RT = ${glslFloat(PLEURA_RT)};
const float CURTAIN_Z0 = ${glslFloat(LUNG_CURTAIN.z0)};
const float SLIDING_AMP = ${glslFloat(slidingAmplitude(0))};
const float SLIDING_EFOLD_MM = ${glslFloat(SLIDING_EFOLD_MM)};
const float SLIDING_LAT_MM = ${glslFloat(SLIDING_LAT_MM)};
const float SLIDING_AX_MM = ${glslFloat(SLIDING_AX_MM)};
const float SLIDING_SALT = ${glslFloat(SLIDING_SALT)};
const float PLEURA_SERIES_FLOOR = ${glslFloat(PLEURA_SERIES_FLOOR)};
const float PLEURA_WALL_FIELD_BOUND = ${glslFloat(PLEURA_WALL_FIELD_BOUND)};
const float WALL_COPY_FACE_GAIN = ${glslFloat(WALL_COPY_FACE_GAIN)};
float pleuraCapMm(float D, float step) { return (max(ceil(D / step - 0.5) - 1.0, 0.0) + 0.5) * step; }
// χ de Ament de la pleura parietal: la parte coherente de su reflexión especular
float pleuraCoherence(float cosI) { float x = uIface[IF_PLEURA_WALL].y * cosI; return exp(-0.5 * x * x); }
float pleuraRoundTrip(float tD, float chi) { return PLEURA_RP * chi * PLEURA_RT * tD; }
float seriesPow(float g, float n) { return n < 0.5 ? 1.0 : pow(max(g, 1e-30), n); }
// (n, d espejo, d directa) a la distancia s > D
vec3 pleuraSeriesDepths(float s, float D) {
  float n = max(floor(s / D) - 1.0, 0.0);
  return vec3(n, (n + 2.0) * D - s, s - (n + 1.0) * D);
}
float aLineOrder(float s, float D) { return max(1.0, floor(s / D + 0.5)); }
float slidingAmplitude(float h) { return SLIDING_AMP * exp(-h / SLIDING_EFOLD_MM); }
// Deslizamiento anclado al pulmón (bajado CURTAIN_Z0 − uCurtain.x), grano alargado a lo largo de la pleura
vec2 slidingField(vec3 pD, float h, float salt) {
  vec3 m = toMaterial(pD);
  vec3 q = (m + vec3(0.0, 0.0, CURTAIN_Z0 - uCurtain.x)) / SLIDING_LAT_MM - torsoNormal(m) * (h / SLIDING_AX_MM);
  return scattererField(q, 1.0, uSeed + SLIDING_SALT + salt) * slidingAmplitude(h);
}
// Campo del medio de la imagen en p (mirada 0): clasificación (withCurtain = false bajo la pleura de la cortina:
// lo de detrás de la lámina), tres planos de elevación (¼ ½ ¼, fasor del central), grumos (decisión 56) y eco de
// interfaz (decisión 57: coherente, fase 0 común a la cara, antes de la transmisión). Una llamada por programa y
// fuera de bucles: faceGradient, en el eco, es el código más pesado de B.
vec2 mediumField(vec3 p, vec3 dir, float r, float se, bool withCurtain) {
  vec3 m = toMaterial(p);
  Cls c = classifyWith(m, withCurtain);
  vec2 f0 = fieldFor(m, se, c.tissue);
  vec2 f1 = sampleSide(p + uElev * se, se, c, withCurtain);
  vec2 f2 = sampleSide(p - uElev * se, se, c, withCurtain);
  float sideMag = 0.5 * length(f0) + 0.25 * (length(f1) + length(f2));
  vec2 field = length(f0) > 1e-6 ? f0 * (sideMag / length(f0)) : f0;
  float clump = uTissueClump4[c.tissue / 4][c.tissue % 4];
  if (clump > 0.0) field *= anchoredClump(m, se, clump, float(c.tissue) * TISSUE_SALT_STEP);
  return field + vec2(interfaceEcho(c, m, dir, r, se), 0.0);
}
// La pared que copia la serie (decisión 61) en p, con el camino en dir: el prefijo de la pared de classify (piel,
// costillas y las capas de la decisión 62, sin órganos ni tubos: la muestra está antes de la pleura), moteado
// anclado con la textura de la pared (fieldFor), grumos del plano central y el eco de cara plana de su capa
// (wallFaceEchoFlat por WALL_COPY_FACE_GAIN: las bandas horizontales tenues de la neblina). Si la muestra pasa
// de la cara interna (en una
// mirada dirigida, ≤ 0,3 mm al final de la copia, junto a la réplica de la pleura), es la capa más honda: la
// grasa preperitoneal, sin cara. Barata a propósito: va en el bucle de la serie, y el JIT de SwiftShader se
// dispara con código pesado en un bucle (faceGradient no puede ir aquí).
vec2 wallField(vec3 p, vec3 dir, float se) {
  vec3 m = toMaterial(p);
  Cls c;
  float depth;
  vec3 tn;
  if (!classifyWall(m, c, depth, tn)) { c.tissue = T_FAT; c.n = tn; }
  vec2 field = fieldFor(m, se, c.tissue);
  float clump = uTissueClump4[c.tissue / 4][c.tissue % 4];
  if (clump > 0.0) field *= anchoredClump(m, se, clump, float(c.tissue) * TISSUE_SALT_STEP);
  return field + vec2(WALL_COPY_FACE_GAIN * wallFaceEchoFlat(c, m, dir), 0.0);
}
`;
