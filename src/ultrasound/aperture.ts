import { alongLineMm } from './steering';

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

export interface ApertureGeometry {
  lines: number;
  halfSector: number;
  curvatureRadius: number;
  /** Apertura de emisión (mm). */
  apertureTxMm: number;
  /** Apertura de recepción máxima (mm) y F# mínimo de recepción. */
  apertureRxMaxMm: number;
  fNumberRxMin: number;
}

/**
 * Transmisión de amplitud ida y vuelta con apertura en (línea, profundidad r).
 * `oneWay(l)`: transmisión de ida de un rayo por la línea l hasta r (0–1).
 * `firstObstacleMm(l)`: profundidad del primer gas o hueso de la línea l (Infinity si no hay).
 * `roundBias` (líneas; 0 en el gemelo) desplaza el redondeo de las tomas del cono: la paridad con la GPU
 * (`steeredParity.ts`) lo usa para reconocer las muestras en empate de redondeo.
 */
export function apertureTransmission(
  geom: ApertureGeometry,
  line: number,
  r: number,
  oneWay: (l: number) => number,
  firstObstacleMm: (l: number) => number,
  roundBias = 0,
): number {
  const single = oneWay(line) ** 2;
  const dTheta = (2 * geom.halfSector) / geom.lines;
  const maxHalf = (0.5 * geom.apertureTxMm) / (geom.curvatureRadius * dTheta);
  let ro = Infinity;
  for (let d = -APERTURE_SEARCH_LINES; d <= APERTURE_SEARCH_LINES; d++) {
    if (d < -Math.ceil(maxHalf) || d > Math.ceil(maxHalf)) continue;
    const l = line + d;
    if (l < 0 || l >= geom.lines) continue;
    const o = firstObstacleMm(l);
    if (o < r) ro = Math.min(ro, o);
  }
  if (!Number.isFinite(ro)) return single;
  const spacing = (geom.curvatureRadius + ro) * dTheta;
  const shrink = 1 - ro / r;
  const halfTx = (0.5 * geom.apertureTxMm * shrink) / spacing;
  const halfRx = (0.5 * Math.min(geom.apertureRxMaxMm, r / geom.fNumberRxMin) * shrink) / spacing;
  const coneMean = (halfLines: number): number => {
    let sum = 0;
    for (let j = 0; j < APERTURE_TAPS; j++) {
      const off = halfLines * ((2 * j) / (APERTURE_TAPS - 1) - 1);
      const l = Math.min(geom.lines - 1, Math.max(0, line + Math.floor(off + 0.5 + roundBias)));
      sum += oneWay(l);
    }
    return sum / APERTURE_TAPS;
  };
  return coneMean(halfTx) * coneMean(halfRx);
}

/**
 * Penumbra de una mirada dirigida θ (composición espacial, decisión 58): el mismo cono, pero de los
 * caminos dirigidos. Las líneas vecinas de una mirada son paralelas desplazadas un elemento, y la que
 * llega a la línea l de la rejilla común en la fila del punto es la del elemento φ_l − θ + β(ρ): el
 * cono se toma sobre esas líneas (recentrado en el cruce del camino dirigido con el obstáculo), con el
 * paso entre ellas a la distancia s del camino, (R·cos θ + s)·dφ, y las distancias a lo largo del camino.
 * Es `apertureTransmission` con radio efectivo R·cos θ (la búsqueda del obstáculo, D/2 en la cara, se
 * ensancha con él) y r → s(ρ). `oneWay(l)` y `firstObstacleMm(l)` son los del camino dirigido que llega
 * a la línea l (el prefijo dirigido de A2: `steeredPrefixDb`), con el obstáculo a lo largo del camino.
 * Con θ = 0 es exactamente `apertureTransmission`.
 */
export function steeredApertureTransmission(
  geom: ApertureGeometry,
  theta: number,
  line: number,
  r: number,
  oneWay: (l: number) => number,
  firstObstacleMm: (l: number) => number,
  roundBias = 0,
): number {
  if (theta === 0) return apertureTransmission(geom, line, r, oneWay, firstObstacleMm, roundBias);
  const R = geom.curvatureRadius;
  const steered: ApertureGeometry = { ...geom, curvatureRadius: R * Math.cos(theta) };
  return apertureTransmission(steered, line, alongLineMm(R + r, theta, R), oneWay, firstObstacleMm, roundBias);
}

/**
 * La misma fórmula en GLSL para la pasada A (`FRAG_TRANSMISSION`): lee la atenuación ida y vuelta
 * de un rayo (uPre0.x, dB) y los primeros impactos por línea (uHits0: gas en .y, hueso en .z, en
 * segmentos gruesos). Necesita uLinesF, uHalfSector, uCurvR, uCoarseN y uAperture.
 */
export const APERTURE_GLSL = /* glsl */ `
const int AP_TAPS = ${APERTURE_TAPS};
const int AP_SEARCH = ${APERTURE_SEARCH_LINES};
float apOneWay(int l, int k) {
  l = clamp(l, 0, int(uLinesF) - 1);
  return pow(10.0, -texelFetch(uPre0, ivec2(l, k), 0).x / 40.0);
}
float apConeMean(int line, int k, float halfLines) {
  float sum = 0.0;
  for (int j = 0; j < AP_TAPS; j++) {
    float off = halfLines * (2.0 * float(j) / float(AP_TAPS - 1) - 1.0);
    sum += apOneWay(line + int(floor(off + 0.5)), k);
  }
  return sum / float(AP_TAPS);
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
  return apConeMean(line, k, halfTx) * apConeMean(line, k, halfRx);
}
`;

/**
 * `steeredApertureTransmission` en GLSL para la pasada A (etapa 2 de la decisión 58). Va detrás de
 * `APERTURE_GLSL` (usa AP_TAPS y AP_SEARCH). Lee el prefijo dirigido de A2 (`uPreSteer`: dB ida y vuelta,
 * y primer gas y primer hueso a lo largo del camino, −1 sin ellos) en la fila k de cada línea vecina y
 * necesita uLinesF, uHalfSector, uAperture y uSteer (θ, R·sin θ, R·cos θ, k2). `s` es la distancia a lo
 * largo del camino hasta el punto y `single`, la transmisión de su propio rayo dirigido.
 */
export const STEERED_APERTURE_GLSL = /* glsl */ `
float apOneWaySteer(int l, int k) {
  l = clamp(l, 0, int(uLinesF) - 1);
  return pow(10.0, -texelFetch(uPreSteer, ivec2(l, k), 0).x / 40.0);
}
float apConeMeanSteer(int line, int k, float halfLines) {
  float sum = 0.0;
  for (int j = 0; j < AP_TAPS; j++) {
    float off = halfLines * (2.0 * float(j) / float(AP_TAPS - 1) - 1.0);
    sum += apOneWaySteer(line + int(floor(off + 0.5)), k);
  }
  return sum / float(AP_TAPS);
}
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
  return apConeMeanSteer(line, k, halfTx) * apConeMeanSteer(line, k, halfRx);
}
`;
