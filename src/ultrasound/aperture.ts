import { INTERFACES, Interface } from '../anatomy/interfaces';
import { type BeamParams } from './beamModel';
import { glslFloat } from './receiver';

/**
 * Penumbra de la apertura (decisión 54). El eco de un punto a la profundidad r no viaja por un solo
 * rayo: sale de toda la apertura y vuelve a ella. Un obstáculo somero (costilla, borde del pulmón)
 * tapa solo los rayos que lo cruzan; los rayos de un elemento a a un punto p cruzan la profundidad
 * del obstáculo r₀ a una distancia lateral a·(1 − r₀/r) del eje, así que el cono mide
 * D·(1 − r₀/r) a esa profundidad. La transmisión de ida es la media de la de las líneas que caen
 * dentro de ese cono (cada una representa los rayos que cruzan el obstáculo en su posición), y la
 * de ida y vuelta, el producto de la media de emisión (D fija) por la de recepción (apertura
 * dinámica D = min(D_máx, r/F#)). Sin obstáculo por encima de r, un solo rayo.
 *
 * La media es la integral exacta de la ventana de cada cono sobre la transmisión de las líneas, constante en la anchura
 * de cada una ([l − ½, l + ½]; decisión 91): una función continua del semiancho del cono (la profundidad) y de su
 * centro. Con nueve tomas en líneas enteras (decisiones 54 y 86) la media saltaba cada vez que una toma cruzaba el borde
 * de una costilla: bajo el hueso opaco de la decisión 88, escalones de 5–13 dB entre líneas vecinas que seguían toda la
 * profundidad (las costuras de la VCI del flanco en la ronda 5 del juez ciego) y otros en profundidad al abrirse el cono.
 *
 * Consecuencias: bajo una costilla ancha junto a la sonda la sombra es completa; más hondo el cono
 * se estrecha menos que la costilla deja de cubrirlo y la sombra se rellena; su borde es una rampa
 * del ancho del cono, no un escalón de una línea.
 *
 * Ecos especulares (decisión 91, que corrige la regla del rayo central de la decisión 88). El rayo de emisión que cruza
 * el obstáculo en u vuelve de una cara lisa por el simétrico −u (incidencia normal), así que su transmisión es la de los
 * pares, media de T(u)·T(−u) con la ventana de emisión dentro de la recepción: junto al obstáculo, con el cono más
 * estrecho que una línea, la del rayo central; bajo una costilla, casi nula si uno de los dos lados la cruza. Pero las
 * caras no son espejos: sus facetas (pendiente rms s, el lóbulo de Kirchhoff de `INTERFACES`) desvían lo reflejado con
 * rms 2s, que cruza el obstáculo a τ = 2s·(r − r₀) de −u, y τ frente al semiancho del cono, D·(r − r₀)/(2r), da 4s·r/D:
 * no depende de r₀. Cuando τ pasa del ancho del cono, cada rayo de emisión vuelve por toda la recepción y la transmisión
 * de la especular es la de la apertura, la del moteado. La suma doble exacta (emisión × recepción × núcleo gaussiano de
 * los pares) cuesta el cuadrado del cono; se mezclan sus dos límites, los pares y la apertura, con
 * ρ = min(1, k·s·r/D), k = `SPECULAR_PAIR_FIT`, y la s más lisa de las caras (`SPECULAR_PAIR_SLOPE`): con los 26 mm del
 * convexo, ρ ≈ 0,45 en la pleura bajo una costilla y 1 desde 62 mm. Frente a la suma doble, sobre costillas de 5–17 mm a
 * 20–45 mm y hasta 130 mm de profundidad (3–110 mm bajo ellas), 0,6 dB rms y 5 dB en el peor punto (la línea del borde,
 * junto a la costilla); la regla del rayo central, 39 dB rms (`aperture.test.ts`). Bajo el borde de una costilla, junto a
 * ella, los pares de una línea dentro del hueso valen 0 y queda ρ·T_apertura: la fuga de la penumbra que la decisión 88
 * apagaba del todo, y que su banco de ondas sí da (−14 dB a 1 mm dentro del borde). La regla del rayo central apagaba en
 * toda la profundidad el eco especular de las líneas cuyo rayo cruzaba el hueso: la pared anterior de la VCI, 8 cm bajo una
 * costilla, se rompía con bordes verticales en las líneas de la costilla de cada mirada. Las líneas de la cortina pulmonar
 * (decisión 61) conservan el rayo central, con su lámina de pulmón por línea.
 *
 * Gemelos: `apertureEcho` (TS, `transmissionTwin.ts`) y `APERTURE_GLSL` (pasada A), misma fórmula.
 */

/**
 * Líneas a cada lado donde se busca el obstáculo y hasta donde llega la integral de los conos: cubre el cono máximo, el de
 * la mayor de las aperturas de emisión y de recepción, D/2 en la cara (`aperture.test.ts` exige el margen, también con la
 * mirada más dirigida).
 */
export const APERTURE_SEARCH_LINES = 40;

/**
 * Pendiente rms de la cara más lisa de `INTERFACES` (sin `Interface.None`): la que mantiene los pares especulares hasta
 * más hondo. Con una s por cara, la mezcla dependería de la cara, que la pasada A no conoce (limitación
 * `specular-pair-single-slope`).
 */
export const SPECULAR_PAIR_SLOPE = Math.min(
  ...Object.values(INTERFACES)
    .filter((p) => p !== INTERFACES[Interface.None])
    .map((p) => p.slopeRms),
);

/**
 * k de la mezcla de los pares y la apertura en la transmisión especular, ρ = min(1, k·s·r/D) [AJUSTADO a la suma doble
 * con el núcleo gaussiano de los pares, `aperture.test.ts`: k 2 → 1,0–1,1 dB rms, 3 → 0,6, 4 → 0,65].
 */
export const SPECULAR_PAIR_FIT = 3;
/** k·s de la mezcla (1/mm·mm de apertura), redondeado como lo escribe la GLSL. */
const SPECULAR_PAIR_RATE = Number((SPECULAR_PAIR_FIT * SPECULAR_PAIR_SLOPE).toFixed(6));

/**
 * Fracción ρ de la transmisión especular que es la de la apertura (el resto, la de los pares): crece con el reparto de
 * lo reflejado por las facetas frente al cono, τ/h = 4s·r/D, hasta 1. `r`: la distancia del punto a la cara a lo largo
 * del camino; `apertureMm`: la apertura de emisión.
 */
export function specularPairSpread(r: number, apertureMm: number): number {
  return Math.min(1, (SPECULAR_PAIR_RATE * r) / apertureMm);
}

/**
 * Refracción en las luces (decisión 86): el eco de moteado de un haz enfocado cuyos rayos desvía la pantalla de fase de
 * las luces (`refractionPsi`). El eco medio de una muestra es el solape de la intensidad de la emisión y de la recepción,
 * ∫I_tx·I_rx; cada haz es un cono de rayos desde su apertura (la emisión, con su ventana de Hann y su foco F; la
 * recepción, uniforme y enfocada en la muestra) y cada rayo, una mancha gaussiana del ancho de difracción de su haz. El
 * rayo que cruza la luz en x_c aterriza desplazado Δ(x_c), el desplazamiento del rayo radial que la cruza en ese punto
 * (lente delgada paraxial: el gradiente lateral de Ψ̃, (Ψ̃_{m+1} − Ψ̃_{m−1})/(2·dφ) mm); la ganancia de amplitud de ida y
 * vuelta es √(E/E0), E el solape con los desplazamientos y E0 sin ellos. La luz está a la distancia D = Ψ̃/pendiente de la
 * muestra (la de la línea, o la de la vecina con luz más cercana), así que el rayo de recepción de la toma u cruza la luz
 * a u·D/r de la línea, y el de emisión, a u·(1 − (r − D)/F).
 *
 * Lo que da: tras el borde de una luz más lenta (convergente), una sombra, porque los rayos de la parte del cono que la
 * cruza se desvían y dejan de solaparse; tras su centro, la pérdida suave de un haz desenfocado por la lente (ningún foco
 * con el foco del equipo cerca); tras un vaso, casi nada (la sangre refracta 14 veces menos que la bilis de la tabla).
 * Frente a un banco de ondas 2D con este haz (`tools/fidelity/refraction-wave.ts`, `refraction.test.ts`), la sombra de la
 * vesícula sale 1,1–2,4 dB menos honda que la del banco (−8,4 a −8,9 dB en una franja de 6–8 mm centrada en el borde) y
 * con su mínimo 1–2 mm dentro de la luz. La refracción de las luces como origen de las sombras de borde: Sommer, Filly y
 * Minton 1979 (AJR 132:973) y Robinson, Wilson y Kossoff 1981 (J Clin Ultrasound 9:181).
 */
export const REFRACTION_SEARCH_LINES = 8;
/**
 * Más allá de `REFRACTION_SEARCH_LINES`, la búsqueda de la luz sigue de `REFRACTION_SEARCH_STRIDE` en
 * `REFRACTION_SEARCH_STRIDE` líneas hasta `REFRACTION_SEARCH_FAR`: el cono cruza la luz hasta a ±D_rx·D/(2·r) de la línea
 * (unas 26 líneas con una luz somera y la muestra honda) y un corte en ±8 dejaba un escalón radial de 0,6–1,2 dB tras la
 * vesícula. Con el paso, una luz de menos de 4 líneas a más de 8 puede escaparse: la de un vaso, que ahí no cambia nada.
 */
export const REFRACTION_SEARCH_STRIDE = 4;
export const REFRACTION_SEARCH_FAR = 32;
/** Tomas de cada cono (en el punto medio de cada tramo, como la penumbra). */
export const REFRACTION_TAPS = 7;
/**
 * σ de la mancha en intensidad por unidad de la anchura a −6 dB de la amplitud de una vía que da el modelo del haz
 * (`beamFwhmMm`): la de una gaussiana, 1/(2,355·√2) [DERIVADO].
 */
export const REFRACTION_SPOT = 1 / (2.3548 * Math.SQRT2);
/**
 * Difracción de lo refractado: la mancha de cada rayo se ensancha σ² += c·λ·D en cada haz tras recorrer D desde la luz
 * (la zona de Fresnel, √(λD); sin ella, los rayos que la luz cruza forman cáusticas de +1 dB tras un vaso y la sombra
 * de la vesícula sale 2–4 dB más honda que en el banco de ondas). c 0,07 [AJUSTADO al banco de ondas,
 * `refraction.test.ts`: error medio 0,5 dB en sus nueve casos].
 */
export const REFRACTION_DIFFRACTION = 0.07;

/**
 * Lo que la refracción necesita del haz de la imagen B (uniforms `uRefr` y `uRefrK` de la pasada A): el foco F, la
 * escala de la emisión (1 en fundamental, 1/√2 en armónica), las manchas σ_tx = cTx·(1 + κ_tx·r)·F/D_tx y
 * σ_rx = cRx·(1 + κ_rx·r)·r/D_rx (con la bajada de la frecuencia, κ), la difracción c·(λ_tx + λ_rx) (mm) y las
 * aperturas de `ApertureGeometry`.
 */
export interface RefractionBeam {
  focusMm: number;
  txScale: number;
  cTxMm: number;
  cRxMm: number;
  kappaTx: number;
  kappaRx: number;
  diffractionMm: number;
}

/**
 * `RefractionBeam` del haz de la imagen B (`bmodeBeam`) con el foco F del equipo. En armónica la emisión (a λ_tx = 2λ) va
 * con la escala 1/√2 de su haz (la fuente va como p1²) en la mancha, en su cono y en su difracción (λ_tx·escala², la de
 * la fundamental).
 */
export function refractionBeam(beam: BeamParams, focusMm: number): RefractionBeam {
  return {
    focusMm: Math.max(10, focusMm),
    txScale: beam.txScale,
    cTxMm: REFRACTION_SPOT * beam.txScale * beam.kTx * beam.lambdaTxMm,
    cRxMm: REFRACTION_SPOT * beam.k * beam.lambdaMm,
    kappaTx: beam.downshiftTxPerMm,
    kappaRx: beam.downshiftRxPerMm,
    diffractionMm: REFRACTION_DIFFRACTION * (beam.lambdaTxMm * beam.txScale ** 2 + beam.lambdaMm),
  };
}

/**
 * La ganancia en GLSL para la pasada A (gemelo: `refractionGain` de `transmissionTwin.ts`, fuera del chunk principal):
 * `pre` es el prefijo de A2 con Ψ̃ en su canal `ch` y su pendiente en `sch` (o1.x/o1.y en la mirada 0, o3.z/o3.w en la
 * dirigida, cada una a lo largo de su camino). Fuera del arreglo se toma la Ψ̃ del borde (`texelFetch` con clamp). Sin
 * luz en la búsqueda (±`REFRACTION_SEARCH_LINES` y, de `REFRACTION_SEARCH_STRIDE` en `REFRACTION_SEARCH_STRIDE`, hasta
 * ±`REFRACTION_SEARCH_FAR`) la ganancia es 1
 * exacto. Necesita uLinesF, uHalfSector, uCurvR, uAperture (D_tx, D_rx máx., F# de recepción, cRx), uRefr (F, escala de
 * la emisión, cTx, difracción) y uRefrK (κ_tx, κ_rx).
 */
export const REFRACTION_GLSL = /* glsl */ `
float rfPsi(sampler2D pre, int ch, int m, int k) {
  return texelFetch(pre, ivec2(clamp(m, 0, int(uLinesF) - 1), k), 0)[ch];
}
// Δ̄ (mm) de los rayos del tramo [j, j + 1]/n de una apertura, que cruzan la luz entre las líneas line + t·g: el gradiente
// medio de Ψ̃ entre sus bordes; si el tramo cabe en una línea, el central de la de su centro
float rfSlab(sampler2D pre, int ch, int k, int line, int j, float g, float dp) {
  int a = line + int(floor((float(j) / ${glslFloat(REFRACTION_TAPS)} - 0.5) * g + 0.5));
  int b = line + int(floor((float(j + 1) / ${glslFloat(REFRACTION_TAPS)} - 0.5) * g + 0.5));
  int c = line + int(floor(((float(j) + 0.5) / ${glslFloat(REFRACTION_TAPS)} - 0.5) * g + 0.5));
  return b != a ? (rfPsi(pre, ch, b, k) - rfPsi(pre, ch, a, k)) / (float(b - a) * dp) : (rfPsi(pre, ch, c + 1, k) - rfPsi(pre, ch, c - 1, k)) / (2.0 * dp);
}
float refractionGain(sampler2D pre, int ch, int sch, int line, int k, float r) {
  // la distancia a la luz, Ψ̃ sobre su pendiente: la de la línea o la de la vecina con luz más cercana
  float D = 0.0;
  for (int i = 0; i <= ${REFRACTION_SEARCH_LINES + (REFRACTION_SEARCH_FAR - REFRACTION_SEARCH_LINES) / REFRACTION_SEARCH_STRIDE}; i++) {
    int d = i <= ${REFRACTION_SEARCH_LINES} ? i : ${REFRACTION_SEARCH_LINES} + ${REFRACTION_SEARCH_STRIDE} * (i - ${REFRACTION_SEARCH_LINES});
    for (int sg = -1; sg <= 1; sg += 2) {
      vec4 q = texelFetch(pre, ivec2(clamp(line + sg * d, 0, int(uLinesF) - 1), k), 0);
      if (D == 0.0 && q[ch] > 0.0) D = q[sch] > 0.0 ? q[ch] / q[sch] : -1.0;
    }
    if (D != 0.0) break;
  }
  if (D <= 0.0) return 1.0;
  float dp = 2.0 * uHalfSector / uLinesF;
  float spL = (uCurvR + r - D) * dp;
  float F = uRefr.x;
  float Drx = min(uAperture.y, r / uAperture.z);
  float sTx = uRefr.z * (1.0 + uRefrK.x * r) * F / uAperture.x;
  float sRx = uAperture.w * (1.0 + uRefrK.y * r) * r / Drx;
  float inv = 0.5 / (sTx * sTx + sRx * sRx + uRefr.w * D);
  // la recepción converge en la muestra: su tramo cruza la luz a t·D_rx·D/r de la línea
  float Y[${REFRACTION_TAPS}];
  for (int j = 0; j < ${REFRACTION_TAPS}; j++) Y[j] = rfSlab(pre, ch, k, line, j, Drx * D / (r * spL), dp);
  // la emisión, con su ventana de Hann, va hacia su foco: cruza la luz a t·D_tx·(1 − (r − D)/F) y, sin ella, aterriza
  // en X0 = t·D_tx·(1 − r/F)
  float gTx = uAperture.x * (1.0 - (r - D) / F) / spL;
  float e = 0.0, e0 = 0.0;
  for (int i = 0; i < ${REFRACTION_TAPS}; i++) {
    float tc = (float(i) + 0.5) / ${glslFloat(REFRACTION_TAPS)} - 0.5;
    float c = cos(3.14159265 * tc);
    float X0 = uRefr.y * tc * uAperture.x * (1.0 - r / F);
    float X = X0 + rfSlab(pre, ch, k, line, i, gTx, dp);
    float s = 0.0;
    for (int j = 0; j < ${REFRACTION_TAPS}; j++) s += exp(-(X - Y[j]) * (X - Y[j]) * inv);
    e += c * c * s;
    e0 += c * c * ${glslFloat(REFRACTION_TAPS)} * exp(-X0 * X0 * inv);
  }
  return sqrt(e / e0);
}
`;

export interface ApertureGeometry {
  lines: number;
  halfSector: number;
  curvatureRadius: number;
  /** Apertura de emisión (mm). */
  apertureTxMm: number;
  /** Apertura de recepción máxima (mm) y F# mínimo de recepción. */
  apertureRxMaxMm: number;
  fNumberRxMin: number;
  /** El haz de la imagen en la refracción de las luces (decisión 86). */
  refraction: RefractionBeam;
}

/**
 * La misma fórmula en GLSL para la pasada A (`FRAG_TRANSMISSION`): lee la atenuación ida y vuelta
 * de un rayo (uPre0.x, dB) y los primeros impactos por línea (uHits0: gas en .y, hueso en .z, en
 * segmentos gruesos). Necesita uLinesF, uHalfSector, uCurvR, uCoarseN y uAperture. Devuelve la transmisión del moteado
 * y de la difusa (la de la apertura) y, en `spec`, la de los ecos especulares (decisión 91).
 */
export const APERTURE_GLSL = /* glsl */ `
const int AP_SEARCH = ${APERTURE_SEARCH_LINES};
// ∫ de sin²(π·t/(2h)) de 0 a y: la ventana de Hann medida desde su borde, sin la cancelación de su primitiva donde casi no
// pesa (en float32, hasta un 12 % de error en la última loncha de un cono)
float apG(float y, float h) { return 0.5 * y - h * sin(3.14159265 * y / h) / 6.2831853; }
// ∫ de la ventana de un cono de semiancho h (líneas) en [lo, hi] recortado a ±c: la de Hann de la emisión, cos²(π·x/(2h))
// (hann = 1), desde el borde más cercano, o la uniforme de la recepción (decisión 86)
float apW(float lo, float hi, float h, float c, float hann) {
  float a = clamp(lo, -c, c), b = clamp(hi, -c, c);
  if (hann < 0.5) return b - a;
  return a >= 0.0 ? apG(h - a, h) - apG(h - b, h) : b <= 0.0 ? apG(h + b, h) - apG(h + a, h) : h - apG(h - b, h) - apG(h + a, h);
}
// Medias de la transmisión de ida (pre: el prefijo de la mirada, dB ida y vuelta en .x) sobre el cono de emisión (x, con su
// ventana de Hann), el de recepción (y, uniforme) y los pares especulares (z: el rayo de emisión por u vuelve por −u, la
// ventana de emisión dentro de la recepción): la integral exacta con la transmisión de cada línea constante en su anchura,
// [l − ½, l + ½] (decisión 91). La línea d y su simétrica pesan lo mismo; la central, una vez
vec3 apCones(sampler2D pre, int line, int k, float hTx, float hRx) {
  // un cono de anchura nula (1 − r₀/r redondeado a 0 junto al obstáculo) es el rayo de su línea
  hTx = max(hTx, 1e-4);
  hRx = max(hRx, 1e-4);
  float hP = min(hTx, hRx);
  float hM = max(hTx, hRx);
  int last = int(uLinesF) - 1;
  vec3 sum = vec3(0.0), ws = vec3(0.0);
  for (int d = 0; d <= AP_SEARCH; d++) {
    float lo = float(d) - 0.5;
    if (lo >= hM) break;
    float a = pow(10.0, -texelFetch(pre, ivec2(clamp(line + d, 0, last), k), 0).x / 40.0);
    float b = d == 0 ? a : pow(10.0, -texelFetch(pre, ivec2(clamp(line - d, 0, last), k), 0).x / 40.0);
    float f = d == 0 ? 0.5 : 1.0;
    vec3 w = f * vec3(apW(lo, lo + 1.0, hTx, hTx, 1.0), apW(lo, lo + 1.0, hRx, hRx, 0.0), apW(lo, lo + 1.0, hTx, hP, 1.0));
    sum += w * vec3(a + b, a + b, 2.0 * a * b);
    ws += 2.0 * w;
  }
  return sum / max(ws, vec3(1e-30));
}
// La del moteado (x·y) y, en spec, la de los especulares: los pares mezclados con la de la apertura en ρ = min(1, k·s·r/D)
// (specularPairSpread: las facetas de la cara reparten lo reflejado; r, la distancia del punto a la cara a lo largo del camino)
float apEcho(vec3 c, float r, out float spec) {
  float t = c.x * c.y;
  spec = mix(c.z, t, min(1.0, ${glslFloat(SPECULAR_PAIR_RATE)} * r / uAperture.x));
  return t;
}
float apertureTransmission(int line, int k, float r, float step, float single, out float spec) {
  float dTheta = 2.0 * uHalfSector / uLinesF;
  float maxHalf = (0.5 * max(uAperture.x, uAperture.y)) / (uCurvR * dTheta);
  int W = int(ceil(maxHalf));
  float ro = 1e9;
  for (int d = -AP_SEARCH; d <= AP_SEARCH; d++) {
    if (d < -W || d > W) continue;
    int l = line + d;
    if (l < 0 || l >= int(uLinesF)) continue;
    vec4 h = texelFetch(uHits0, ivec2(l, 0), 0);
    float seg = h.y >= 0.0 ? (h.z >= 0.0 ? min(h.y, h.z) : h.y) : h.z;
    if (seg >= 0.0) {
      float rr = (seg + 0.5) * step;
      if (rr < r) ro = min(ro, rr);
    }
  }
  spec = single;
  if (ro > 1e8) return single;
  float spacing = (uCurvR + ro) * dTheta;
  float shrink = 1.0 - ro / r;
  float halfTx = 0.5 * uAperture.x * shrink / spacing;
  float halfRx = 0.5 * min(uAperture.y, r / uAperture.z) * shrink / spacing;
  return apEcho(apCones(uPre0, line, k, halfTx, halfRx), r, spec);
}
`;

/**
 * `steeredApertureTransmission` en GLSL para la pasada A (etapa 2 de la decisión 58). Va detrás de
 * `APERTURE_GLSL` (usa AP_SEARCH, `apCones` y `apEcho`). Lee el prefijo dirigido de A2 (`uPreSteer`: dB ida y vuelta,
 * y primer gas y primer hueso a lo largo del camino, −1 sin ellos) en la fila k de cada línea vecina y
 * necesita uLinesF, uHalfSector, uAperture y uSteer (θ, R·sin θ, R·cos θ, k2). `s` es la distancia a lo
 * largo del camino hasta el punto y `single`, la transmisión de su propio rayo dirigido; `spec`, la de sus especulares.
 */
export const STEERED_APERTURE_GLSL = /* glsl */ `
float steeredApertureTransmission(int line, int k, float s, float single, out float spec) {
  float dTheta = 2.0 * uHalfSector / uLinesF;
  float rc = uSteer.z;
  float maxHalf = (0.5 * max(uAperture.x, uAperture.y)) / (rc * dTheta);
  int W = int(ceil(maxHalf));
  float so = 1e9;
  for (int d = -AP_SEARCH; d <= AP_SEARCH; d++) {
    if (d < -W || d > W) continue;
    int l = line + d;
    if (l < 0 || l >= int(uLinesF)) continue;
    vec4 h = texelFetch(uPreSteer, ivec2(l, k), 0);
    float o = h.y >= 0.0 ? (h.z >= 0.0 ? min(h.y, h.z) : h.y) : h.z;
    if (o >= 0.0 && o < s) so = min(so, o);
  }
  spec = single;
  if (so > 1e8) return single;
  float spacing = (rc + so) * dTheta;
  float shrink = 1.0 - so / s;
  float halfTx = 0.5 * uAperture.x * shrink / spacing;
  float halfRx = 0.5 * min(uAperture.y, s / uAperture.z) * shrink / spacing;
  return apEcho(apCones(uPreSteer, line, k, halfTx, halfRx), s, spec);
}
`;
