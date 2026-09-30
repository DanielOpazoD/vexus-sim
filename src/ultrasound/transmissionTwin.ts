import { CURTAIN_GAS_KIND } from './pleura';
import { IFACE_REACH_MM } from './interfaceEcho';
import {
  APERTURE_SEARCH_LINES,
  REFRACTION_SEARCH_FAR,
  REFRACTION_SEARCH_LINES,
  REFRACTION_SEARCH_STRIDE,
  REFRACTION_TAPS,
  specularPairSpread,
  type ApertureGeometry,
} from './aperture';
import { alongLineMm, steerBeta, steeredElement } from './steering';
import { BONE_ENTRY_DB, type SegmentGrid } from './transmission';

/**
 * Gemelos en TS de A2 y A (decisiones 54, 58 y 86): el prefijo de la mirada 0 y el dirigido sobre la rejilla de segmentos
 * de A1, la penumbra de la apertura y la refracción de las luces. Los usan las pruebas y la paridad con la GPU
 * (`steeredParity.ts`, solo en los ganchos de prueba): viven aparte de `transmission.ts` y `aperture.ts`, cuya GLSL va en
 * el chunk principal, para que este no los lleve (decisión 86: 2,6 kB que la paridad de la mirada 0 metía en él).
 */

/** Impactos de A0 de una línea, derivados de las marcas de A1 con la misma regla (gel previo omitido). */
export function lineHits(g: SegmentGrid, line: number): { mirrorSeg: number; gasSeg: number; boneSeg: number; gasKind: number } {
  let entered = false;
  let gasSeg = -1;
  let boneSeg = -1;
  let gasKind = 0;
  for (let s = 0; s < g.rows; s++) {
    const i = line * g.rows + s;
    if (g.air[i] && !entered) continue;
    entered = true;
    // el pulmón de la cortina no es un impacto de gas (A0 lo lleva aparte, decisión 61)
    if (g.gas[i] && g.gas[i] !== CURTAIN_GAS_KIND && gasSeg < 0) {
      gasSeg = s;
      gasKind = g.gas[i];
    }
    if (g.bone[i] && boneSeg < 0) boneSeg = s;
  }
  return { mirrorSeg: g.mirrorSeg[line], gasSeg, boneSeg, gasKind };
}

/** Prefijo de A2 en la fila k: dB ida y vuelta y primeros impactos (mm; −1 sin ellos). */
export interface PrefixSample {
  db: number;
  gasHit: number;
  boneHit: number;
  mirrorHit: number;
  gasKind: number;
}

/**
 * Gemelo de A2 (`FRAG_TRANS_PREFIX`) de la mirada 0: suma de los segmentos de la línea hasta la fila k
 * inclusive, con las reglas de `rayAttenuationDb` (gel previo sin pérdidas, hueso `BONE_ENTRY_DB` al entrar una vez);
 * el espejo se publica desde la fila cuyo final más el alcance del eco pleural pasa su cruce exacto.
 */
export function prefixDb(g: SegmentGrid, line: number, k: number): PrefixSample {
  let db = 0;
  let entered = false;
  let boneEntered = false;
  for (let s = 0; s <= k; s++) {
    const i = line * g.rows + s;
    if (g.air[i] && !entered) continue;
    entered = true;
    if (g.bone[i] && !boneEntered) {
      db += BONE_ENTRY_DB;
      boneEntered = true;
    }
    db += g.db[i];
  }
  const h = lineHits(g, line);
  const mr = g.mirrorR[line];
  const mirrorHit = h.mirrorSeg >= 0 && mr < (k + 1) * g.stepMm + IFACE_REACH_MM ? mr : -1;
  const gasHit = h.gasSeg >= 0 && h.gasSeg <= k ? (h.gasSeg === h.mirrorSeg ? mr : (h.gasSeg + 0.5) * g.stepMm) : -1;
  const boneHit = h.boneSeg >= 0 && h.boneSeg <= k ? (h.boneSeg + 0.5) * g.stepMm : -1;
  return { db, gasHit, boneHit, mirrorHit, gasKind: gasHit >= 0 ? h.gasKind : 0 };
}

/**
 * Ψ̃ de A2 en la fila k (decisión 86, gemelo de `FRAG_TRANS_PREFIX` o1.x). Lente delgada paraxial: el rayo de una línea
 * se desvía hacia donde la luz lo retrasa más, con el gradiente lateral de su camino de más, y a la profundidad r_k
 * queda desplazado esa desviación por la distancia que ha recorrido después. Con Ψ̃_l(k) = Σ_{s≤k} e_s·(r_k − r_s)/(R +
 * r_s) (e_s, el camino de más del segmento; R + r_s lleva el gradiente a la separación de las líneas a su
 * profundidad), el rayo de la línea l aterriza en la fila k a (Ψ̃_{l+1} − Ψ̃_{l−1})/(2·(R + r_k)·dφ²) líneas
 * (`refractionGain`).
 *
 * Se suma como la GPU, paso·Σ e_s·(k − s)/(R + r_s): términos ≥ 0 con la distancia en filas enteras, y el de la propia
 * fila k, 0 exacto. La forma r_k·Σe/(R + r) − Σe·r/(R + r) se cancelaba: en la primera fila de una luz dejaba en la GPU
 * un residuo de redondeo de ±10⁻⁹ mm (con FMA) donde aquí sale 0, y la distancia tras la luz saltaba de 0 a un paso
 * (0,01–0,12 dB de desacuerdo con el gemelo en la cara de la vesícula).
 */
export function refractionPsi(g: SegmentGrid, R: number, line: number, k: number): number {
  let psi = 0;
  for (let s = 0; s <= k; s++) psi += (g.excess[line * g.rows + s] / (R + (s + 0.5) * g.stepMm)) * (k - s);
  return g.stepMm * psi;
}

/**
 * Pendiente dΨ̃/dr de la línea en la fila k (A2 o1.y, decisión 86): Σ_{s<k} e_s/(R + r_s), como la GPU, sin restar filas
 * (la resta de Ψ̃_k − Ψ̃_{k−1} en float32 movía la distancia a la luz un 3·10⁻⁵ y con ella el redondeo de los tramos).
 */
export function refractionSlope(g: SegmentGrid, R: number, line: number, k: number): number {
  let slope = 0;
  for (let s = 0; s < k; s++) slope += g.excess[line * g.rows + s] / (R + (s + 0.5) * g.stepMm);
  return slope;
}

/** Prefijo dirigido de A2 (decisión 58): lo mismo a lo largo del camino dirigido, en distancias del camino. */
export interface SteeredPrefix {
  /** dB ida y vuelta a lo largo del camino dirigido que llega a (línea, fila k). */
  db: number;
  /** Distancias a lo largo del camino (mm) del primer gas, del primer hueso y del espejo; −1 sin ellos. */
  sGas: number;
  sBone: number;
  sMirror: number;
  gasKind: number;
  /** Línea cuyo espejo cruza el camino (la que da la dirección reflejada); −1 sin espejo. */
  mirrorLine: number;
  /** Elemento del que sale el camino (rad): su cobertura (`lookCoverage`) decide si la mirada se forma. */
  element: number;
  /** Ψ̃ del camino (decisión 86, `refractionPsi` sobre el camino dirigido): su camino de más, pesado como en A2. */
  psi: number;
  /**
   * Pendiente dΨ̃/dr del camino (decisión 86): Σ_{s<k} e_s/(R + r_s), sin la fila k (su distancia es 0). La distancia
   * recorrida tras la luz es Ψ̃/pendiente (`refractionGain`); los caminos de las filas k y k − 1 cruzan líneas distintas,
   * y su diferencia de Ψ̃ no es la pendiente (en las seis vistas sale ≤ 0 en el 0,8–3,5 % de las muestras tras una luz).
   */
  slope: number;
}

/** Filas que A2 mira más allá de la k para publicar un espejo al alcance del eco pleural. */
export function mirrorLookaheadRows(stepMm: number): number {
  return Math.ceil(IFACE_REACH_MM / stepMm + 0.5);
}

/**
 * Gemelo de A2 dirigido (decisión 58) sobre la rejilla de segmentos de la mirada 0, sin clasificación
 * nueva: el camino de la mirada θ que llega a (línea j, fila k) cruza la fila s cerca de la línea
 * j + (β(ρ_k) − β(ρ_s))/dφ, y de ella toma el segmento (la línea más cercana). Cada segmento radial se
 * multiplica por ds/dρ = ρ/√(ρ² − a²) (≤ 1,007: el camino cruza la corona en oblicuo). Mismas reglas que
 * A2: gel previo sin pérdidas, hueso `BONE_ENTRY_DB` al entrar una vez, MIRROR_DB en el espejo. Primer gas y primer
 * hueso, de las marcas de A1 a lo largo del camino.
 *
 * Espejo: al llegar a una fila igual o posterior al segmento del espejo de la línea atravesada, el camino
 * se congela en esa línea y sigue su camino reflejado (sus segmentos de A1, sin ds/dρ): el espejo no se
 * dirige tras la reflexión (aproximación declarada). Su distancia es la del cruce exacto de esa línea,
 * s(R + r_espejo), y se publica, como en A2, desde la fila cuyo final más el alcance del eco pleural lo
 * pasa (mirando `mirrorLookaheadRows` filas más allá de k).
 *
 * Las líneas fuera del arreglo se recortan (como `texelFetch` con clamp): solo pasa en caminos cuya
 * cobertura es parcial o nula. Con θ = 0 da exactamente `prefixDb`.
 *
 * `roundBias` (líneas; 0 en el gemelo) desplaza el argumento del redondeo de la línea del camino: la
 * paridad con la GPU (`steeredParity.ts`) lo usa para reconocer las muestras en empate de redondeo.
 */
export function steeredPrefixDb(
  g: SegmentGrid,
  geom: { curvatureRadius: number; halfSector: number },
  theta: number,
  line: number,
  k: number,
  roundBias = 0,
): SteeredPrefix {
  const R = geom.curvatureRadius;
  const step = g.stepMm;
  const dPhi = (2 * geom.halfSector) / g.lines;
  const alpha = -geom.halfSector + (line + 0.5) * dPhi;
  const rhoK = R + (k + 0.5) * step;
  const betaK = steerBeta(rhoK, theta, R);
  const along = (r: number): number => (theta === 0 ? r : alongLineMm(R + r, theta, R));
  const a = R * Math.sin(theta);
  const ahead = mirrorLookaheadRows(step);
  let db = 0;
  let entered = false;
  let boneEntered = false;
  let sGas = -1;
  let sBone = -1;
  let sMirror = -1;
  let gasKind = 0;
  let frozen = -1;
  // Ψ̃ del camino y su pendiente (decisión 86): el camino de más de cada segmento cruzado, con su ds/dρ, como en `refractionPsi`
  let psi = 0;
  let slope = 0;
  for (let s = 0; s <= k + ahead; s++) {
    let l: number;
    let seg = s;
    let scale = 1;
    let crossing = false;
    if (frozen >= 0) l = frozen;
    else {
      const rho = R + (s + 0.5) * step;
      l =
        theta === 0
          ? line
          : Math.min(g.lines - 1, Math.max(0, Math.floor(line + (betaK - steerBeta(rho, theta, R)) / dPhi + 0.5 + roundBias)));
      const m = g.mirrorSeg[l];
      if (m >= 0 && s >= m) {
        // más allá de k, solo si el cruce queda al alcance del eco pleural desde el final de la fila k
        if (s > k && !(g.mirrorR[l] < (k + 1) * step + IFACE_REACH_MM)) break;
        frozen = l;
        seg = m;
        crossing = true;
        sMirror = along(g.mirrorR[l]);
      } else if (theta !== 0) scale = rho / Math.sqrt(rho * rho - a * a);
    }
    if (s > k) {
      if (frozen >= 0) break;
      continue;
    }
    const i = l * g.rows + seg;
    if (g.air[i] && !entered) continue;
    entered = true;
    if (g.bone[i] && !boneEntered) {
      db += BONE_ENTRY_DB;
      boneEntered = true;
    }
    if (g.bone[i] && sBone < 0) sBone = along((s + 0.5) * step);
    if (g.gas[i] && g.gas[i] !== CURTAIN_GAS_KIND && sGas < 0) {
      sGas = crossing ? sMirror : along((s + 0.5) * step);
      gasKind = g.gas[i];
    }
    db += g.db[i] * scale;
    const e = (g.excess[i] * scale) / (R + (s + 0.5) * step);
    psi += e * (k - s);
    if (s < k) slope += e;
  }
  return {
    db,
    sGas,
    sBone,
    sMirror,
    gasKind: sGas >= 0 ? gasKind : 0,
    mirrorLine: sMirror >= 0 ? frozen : -1,
    element: steeredElement(alpha, rhoK, theta, R),
    psi: step * psi,
    slope,
  };
}

/**
 * ∫ de la ventana de un cono de semiancho h (líneas) en [lo, hi] recortado a ±c (`apW` de `APERTURE_GLSL`, decisión 91): la
 * de Hann de la emisión, cos²(π·x/(2h)), con la que va apodizada (decisión 86: su primitiva, x/2 + h·sin(π·x/h)/(2π)), o la
 * uniforme de la recepción (casi uniforme: k = 1,3 frente a 1,21).
 */
export function apertureWindowIntegral(lo: number, hi: number, h: number, c: number, hann: boolean): number {
  const a = Math.min(c, Math.max(-c, lo));
  const b = Math.min(c, Math.max(-c, hi));
  if (!hann) return b - a;
  // desde el borde más cercano (`apG`): ∫ de sin²(π·t/(2h)) de 0 a y, sin la cancelación de la primitiva donde la ventana
  // casi no pesa
  const g = (y: number) => 0.5 * y - (h * Math.sin((Math.PI * y) / h)) / (2 * Math.PI);
  return a >= 0 ? g(h - a) - g(h - b) : b <= 0 ? g(h + b) - g(h + a) : h - g(h - b) - g(h + a);
}

/** Medias de la transmisión de ida sobre los conos de la pasada A (`apCones`, decisión 91). */
export interface ApertureCones {
  /** Cono de emisión, con su ventana de Hann. */
  tx: number;
  /** Cono de recepción, uniforme. */
  rx: number;
  /** Pares especulares: el rayo de emisión por u vuelve por −u (la ventana de emisión dentro de la recepción). */
  pair: number;
}

/**
 * Gemelo de `apCones`: la integral exacta de cada ventana sobre la transmisión de ida de las líneas (`oneWay`), constante
 * en la anchura de cada una ([l − ½, l + ½]); fuera del arreglo, la del borde (como `texelFetch` con clamp). La línea d y
 * su simétrica pesan lo mismo; la central, una vez. Continua en los semianchos y sin redondeos: un cono más estrecho que
 * una línea es el rayo de la línea.
 */
export function apertureCones(lines: number, line: number, hTxIn: number, hRxIn: number, oneWay: (l: number) => number): ApertureCones {
  // un cono de anchura nula (1 − r₀/r redondeado a 0 junto al obstáculo) es el rayo de su línea
  const hTx = Math.max(hTxIn, 1e-4);
  const hRx = Math.max(hRxIn, 1e-4);
  const hP = Math.min(hTx, hRx);
  const hM = Math.max(hTx, hRx);
  const at = (l: number) => oneWay(Math.min(lines - 1, Math.max(0, l)));
  const sum = [0, 0, 0];
  const ws = [0, 0, 0];
  for (let d = 0; d <= APERTURE_SEARCH_LINES; d++) {
    const lo = d - 0.5;
    if (lo >= hM) break;
    const a = at(line + d);
    const b = d === 0 ? a : at(line - d);
    const f = d === 0 ? 0.5 : 1;
    const w = [
      apertureWindowIntegral(lo, lo + 1, hTx, hTx, true),
      apertureWindowIntegral(lo, lo + 1, hRx, hRx, false),
      apertureWindowIntegral(lo, lo + 1, hTx, hP, true),
    ].map((x) => f * x);
    const v = [a + b, a + b, 2 * a * b];
    for (let i = 0; i < 3; i++) {
      sum[i] += w[i] * v[i];
      ws[i] += 2 * w[i];
    }
  }
  const [tx, rx, pair] = sum.map((x, i) => x / Math.max(ws[i], 1e-30));
  return { tx, rx, pair };
}

/** Transmisiones de amplitud ida y vuelta de la pasada A en (línea, r): la del moteado y la difusa, y la de los especulares. */
export interface ApertureEcho {
  diffuse: number;
  specular: number;
}

/**
 * Transmisión de amplitud ida y vuelta con apertura en (línea, profundidad r) (`apertureTransmission` de `APERTURE_GLSL`):
 * la del moteado y de la difusa, el producto de las medias de los conos, y la de los ecos especulares, la de los pares
 * mezclada con ella en ρ = `specularPairSpread` (decisión 91). Sin obstáculo por encima de r, las dos son la del rayo.
 * `oneWay(l)`: transmisión de ida de un rayo por la línea l hasta r (0–1).
 * `firstObstacleMm(l)`: profundidad del primer gas o hueso de la línea l (Infinity si no hay).
 */
export function apertureEcho(
  geom: ApertureGeometry,
  line: number,
  r: number,
  oneWay: (l: number) => number,
  firstObstacleMm: (l: number) => number,
): ApertureEcho {
  const single = oneWay(line) ** 2;
  const dTheta = (2 * geom.halfSector) / geom.lines;
  // el obstáculo se busca hasta el mayor de los dos conos: con el foco somero la emisión es más estrecha que la recepción
  const maxHalf = (0.5 * Math.max(geom.apertureTxMm, geom.apertureRxMaxMm)) / (geom.curvatureRadius * dTheta);
  let ro = Infinity;
  for (let d = -APERTURE_SEARCH_LINES; d <= APERTURE_SEARCH_LINES; d++) {
    if (d < -Math.ceil(maxHalf) || d > Math.ceil(maxHalf)) continue;
    const l = line + d;
    if (l < 0 || l >= geom.lines) continue;
    const o = firstObstacleMm(l);
    if (o < r) ro = Math.min(ro, o);
  }
  if (!Number.isFinite(ro)) return { diffuse: single, specular: single };
  const spacing = (geom.curvatureRadius + ro) * dTheta;
  const shrink = 1 - ro / r;
  const halfTx = (0.5 * geom.apertureTxMm * shrink) / spacing;
  const halfRx = (0.5 * Math.min(geom.apertureRxMaxMm, r / geom.fNumberRxMin) * shrink) / spacing;
  const c = apertureCones(geom.lines, line, halfTx, halfRx, oneWay);
  const diffuse = c.tx * c.rx;
  return { diffuse, specular: c.pair + (diffuse - c.pair) * specularPairSpread(r, geom.apertureTxMm) };
}

/** La del moteado y de la difusa de `apertureEcho` (la penumbra de la decisión 54). */
export function apertureTransmission(
  geom: ApertureGeometry,
  line: number,
  r: number,
  oneWay: (l: number) => number,
  firstObstacleMm: (l: number) => number,
): number {
  return apertureEcho(geom, line, r, oneWay, firstObstacleMm).diffuse;
}

/**
 * Penumbra de una mirada dirigida θ (composición espacial, decisión 58): el mismo cono, pero de los
 * caminos dirigidos. Las líneas vecinas de una mirada son paralelas desplazadas un elemento, y la que
 * llega a la línea l de la rejilla común en la fila del punto es la del elemento φ_l − θ + β(ρ): el
 * cono se toma sobre esas líneas (recentrado en el cruce del camino dirigido con el obstáculo), con el
 * paso entre ellas a la distancia s del camino, (R·cos θ + s)·dφ, y las distancias a lo largo del camino.
 * Es `apertureEcho` con radio efectivo R·cos θ (la búsqueda del obstáculo, D/2 en la cara, se
 * ensancha con él) y r → s(ρ). `oneWay(l)` y `firstObstacleMm(l)` son los del camino dirigido que llega
 * a la línea l (el prefijo dirigido de A2: `steeredPrefixDb`), con el obstáculo a lo largo del camino.
 * Con θ = 0 es exactamente `apertureEcho`.
 */
export function steeredApertureEcho(
  geom: ApertureGeometry,
  theta: number,
  line: number,
  r: number,
  oneWay: (l: number) => number,
  firstObstacleMm: (l: number) => number,
): ApertureEcho {
  if (theta === 0) return apertureEcho(geom, line, r, oneWay, firstObstacleMm);
  const R = geom.curvatureRadius;
  const steered: ApertureGeometry = { ...geom, curvatureRadius: R * Math.cos(theta) };
  return apertureEcho(steered, line, alongLineMm(R + r, theta, R), oneWay, firstObstacleMm);
}

/** La del moteado y de la difusa de `steeredApertureEcho`. */
export function steeredApertureTransmission(
  geom: ApertureGeometry,
  theta: number,
  line: number,
  r: number,
  oneWay: (l: number) => number,
  firstObstacleMm: (l: number) => number,
): number {
  return steeredApertureEcho(geom, theta, line, r, oneWay, firstObstacleMm).diffuse;
}

/**
 * Gemelo en TS de la refracción en las luces de la pasada A (decisión 86, `REFRACTION_GLSL` de `aperture.ts`), con las
 * mismas cuentas: el solape de los conos de emisión y de recepción cuyos rayos desvía la luz, √(E/E0).
 *
 * `pre(l)`: Ψ̃ y su pendiente dΨ̃/dr en la línea l, en la fila k de la muestra (la mirada 0, `refractionPsi` y
 * `refractionSlope`; la dirigida, el `psi` y el `slope` de `steeredPrefixDb`); fuera del arreglo se toma la del borde, como
 * `texelFetch` con clamp. `roundBias` (líneas; 0 en el gemelo) desplaza el redondeo de las líneas de las tomas: la
 * paridad con la GPU (`steeredParity.ts`) lo usa para reconocer las muestras en empate.
 */
export function refractionGain(
  ap: ApertureGeometry,
  stepMm: number,
  line: number,
  k: number,
  pre: (l: number) => { psi: number; slope: number },
  roundBias = 0,
): number {
  const n = ap.lines - 1;
  const at = (l: number) => pre(Math.min(n, Math.max(0, l)));
  // la distancia a la luz: la de la línea o la de la vecina con luz más cercana (de una en una hasta ±REFRACTION_SEARCH_LINES
  // y luego de REFRACTION_SEARCH_STRIDE en REFRACTION_SEARCH_STRIDE)
  let D = 0;
  const far = REFRACTION_SEARCH_LINES + (REFRACTION_SEARCH_FAR - REFRACTION_SEARCH_LINES) / REFRACTION_SEARCH_STRIDE;
  for (let i = 0; i <= far && D === 0; i++) {
    const d = i <= REFRACTION_SEARCH_LINES ? i : REFRACTION_SEARCH_LINES + REFRACTION_SEARCH_STRIDE * (i - REFRACTION_SEARCH_LINES);
    for (const sg of [-1, 1]) {
      const q = at(line + sg * d);
      if (D === 0 && q.psi > 0) D = q.slope > 0 ? q.psi / q.slope : -1;
    }
  }
  if (D <= 0) return 1;
  const r = (k + 0.5) * stepMm;
  const dp = (2 * ap.halfSector) / ap.lines;
  const spL = (ap.curvatureRadius + r - D) * dp;
  const b = ap.refraction;
  const F = b.focusMm;
  const Drx = Math.min(ap.apertureRxMaxMm, r / ap.fNumberRxMin);
  const sTx = (b.cTxMm * (1 + b.kappaTx * r) * F) / ap.apertureTxMm;
  const sRx = (b.cRxMm * (1 + b.kappaRx * r) * r) / Drx;
  const inv = 0.5 / (sTx * sTx + sRx * sRx + b.diffractionMm * D);
  const n7 = REFRACTION_TAPS;
  // Δ̄ (mm a la profundidad r) de los rayos del tramo [j, j + 1]/n de una apertura, que cruzan la luz entre las líneas
  // line + t·g (g: líneas de la luz por unidad de t): el gradiente medio de Ψ̃ entre sus bordes; si el tramo cabe en una
  // línea, el central de la de su centro
  const slab = (j: number, g: number): number => {
    const lineAt = (t: number): number => line + Math.floor(t * g + 0.5 + roundBias);
    const a = lineAt(j / n7 - 0.5);
    const z = lineAt((j + 1) / n7 - 0.5);
    const c = lineAt((j + 0.5) / n7 - 0.5);
    return z !== a ? (at(z).psi - at(a).psi) / ((z - a) * dp) : (at(c + 1).psi - at(c - 1).psi) / (2 * dp);
  };
  // la recepción converge en la muestra: su tramo cruza la luz a t·D_rx·D/r de la línea
  const gRx = (Drx * D) / (r * spL);
  const Y = Array.from({ length: n7 }, (_, j) => slab(j, gRx));
  // la emisión, con su ventana de Hann, va hacia su foco: cruza la luz a t·D_tx·(1 − (r − D)/F) y, sin ella, aterriza en
  // X0 = t·D_tx·(1 − r/F)
  const gTx = (ap.apertureTxMm * (1 - (r - D) / F)) / spL;
  let e = 0;
  let e0 = 0;
  for (let i = 0; i < n7; i++) {
    const tc = (i + 0.5) / n7 - 0.5;
    const w = Math.cos(Math.PI * tc) ** 2;
    const X0 = b.txScale * tc * ap.apertureTxMm * (1 - r / F);
    const X = X0 + slab(i, gTx);
    let sum = 0;
    for (const y of Y) sum += Math.exp(-(X - y) * (X - y) * inv);
    e += w * sum;
    e0 += w * n7 * Math.exp(-X0 * X0 * inv);
  }
  return Math.sqrt(e / e0);
}
