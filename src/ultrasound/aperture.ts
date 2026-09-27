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
 * Consecuencias: bajo una costilla ancha junto a la sonda la sombra es completa; más hondo el cono
 * se estrecha menos que la costilla deja de cubrirlo y la sombra se rellena; su borde es una rampa
 * del ancho del cono, no un escalón de una línea.
 *
 * Gemelos: `apertureTransmission` (TS, pruebas) y `APERTURE_GLSL` (pasada A), misma fórmula.
 */

/** Tomas por cono (la media se toma en líneas enteras, como la GPU con `texelFetch`). */
export const APERTURE_TAPS = 9;
/** Líneas a cada lado donde se busca el obstáculo (cubre el cono máximo, D/2 en la cara). */
export const APERTURE_SEARCH_LINES = 40;

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
 * segmentos gruesos). Necesita uLinesF, uHalfSector, uCurvR, uCoarseN y uAperture.
 */
export const APERTURE_GLSL = /* glsl */ `
const int AP_TAPS = ${APERTURE_TAPS};
const int AP_SEARCH = ${APERTURE_SEARCH_LINES};
// Media de la transmisión de ida sobre el cono (pre: el prefijo de A2 de la mirada, dB en .x), en el punto medio de
// cada tramo; la emisión con la ventana de Hann (hann = 1) y la recepción uniforme (decisión 86)
float apConeMean(sampler2D pre, int line, int k, float halfLines, float hann) {
  float sum = 0.0, ws = 0.0;
  for (int j = 0; j < AP_TAPS; j++) {
    float t = (float(j) + 0.5) / float(AP_TAPS) - 0.5;
    float c = cos(3.14159265 * t);
    float w = mix(1.0, c * c, hann);
    int l = clamp(line + int(floor(2.0 * halfLines * t + 0.5)), 0, int(uLinesF) - 1);
    sum += w * pow(10.0, -texelFetch(pre, ivec2(l, k), 0).x / 40.0);
    ws += w;
  }
  return sum / ws;
}
float apertureTransmission(int line, int k, float r, float step, float single) {
  float dTheta = 2.0 * uHalfSector / uLinesF;
  float maxHalf = (0.5 * uAperture.x) / (uCurvR * dTheta);
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
  if (ro > 1e8) return single;
  float spacing = (uCurvR + ro) * dTheta;
  float shrink = 1.0 - ro / r;
  float halfTx = 0.5 * uAperture.x * shrink / spacing;
  float halfRx = 0.5 * min(uAperture.y, r / uAperture.z) * shrink / spacing;
  return apConeMean(uPre0, line, k, halfTx, 1.0) * apConeMean(uPre0, line, k, halfRx, 0.0);
}
`;

/**
 * `steeredApertureTransmission` en GLSL para la pasada A (etapa 2 de la decisión 58). Va detrás de
 * `APERTURE_GLSL` (usa AP_SEARCH y su `apConeMean`). Lee el prefijo dirigido de A2 (`uPreSteer`: dB ida y vuelta,
 * y primer gas y primer hueso a lo largo del camino, −1 sin ellos) en la fila k de cada línea vecina y
 * necesita uLinesF, uHalfSector, uAperture y uSteer (θ, R·sin θ, R·cos θ, k2). `s` es la distancia a lo
 * largo del camino hasta el punto y `single`, la transmisión de su propio rayo dirigido.
 */
export const STEERED_APERTURE_GLSL = /* glsl */ `
float steeredApertureTransmission(int line, int k, float s, float single) {
  float dTheta = 2.0 * uHalfSector / uLinesF;
  float rc = uSteer.z;
  float maxHalf = (0.5 * uAperture.x) / (rc * dTheta);
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
  if (so > 1e8) return single;
  float spacing = (rc + so) * dTheta;
  float shrink = 1.0 - so / s;
  float halfTx = 0.5 * uAperture.x * shrink / spacing;
  float halfRx = 0.5 * min(uAperture.y, s / uAperture.z) * shrink / spacing;
  return apConeMean(uPreSteer, line, k, halfTx, 1.0) * apConeMean(uPreSteer, line, k, halfRx, 0.0);
}
`;
