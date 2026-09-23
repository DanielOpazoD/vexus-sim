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
 */
export function apertureTransmission(
  geom: ApertureGeometry,
  line: number,
  r: number,
  oneWay: (l: number) => number,
  firstObstacleMm: (l: number) => number,
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
      const l = Math.min(geom.lines - 1, Math.max(0, line + Math.floor(off + 0.5)));
      sum += oneWay(l);
    }
    return sum / APERTURE_TAPS;
  };
  return coneMean(halfTx) * coneMean(halfRx);
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
