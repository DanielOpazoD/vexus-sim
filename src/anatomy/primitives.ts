import { thoracicAtlas, thoracicValue, thoracicMaterial } from './thoracicAtlas';
import { abdominalAtlas, abdominalAtlasSdf, hepaticDomeValue, registeredDomeHeight } from './abdominalAtlas';
import { referenceCartilage } from './referenceCartilage';
import { bodyDepth, bodyGradient, bodySection } from './referenceBody';
import { DIAPHRAGM_THICKNESS_MM } from './tissues';
import type { Vec3 } from '../core/vec3';

/**
 * Primitivas implícitas declarativas. La misma lista se evalúa en TypeScript
 * (Doppler, mediciones, pruebas) y en GLSL (modo B y color) a partir de estos
 * datos, de modo que no haya dos anatomías distintas. Coordenadas del paciente
 * en mm: +x izquierda del paciente, +y anterior, +z craneal. Origen en el
 * centro del tronco a la altura del apéndice xifoides.
 */

export interface Ellipsoid {
  kind: 'ellipsoid';
  center: Vec3;
  radii: Vec3;
  /** Afilamiento lineal de los semiejes y/z al alejarse en +x (cuña hepática). */
  taperX: number;
}

export interface TubeNode {
  p: Vec3;
  r: number;
}

export interface Tube {
  kind: 'tube';
  /** Nodos ordenados en el sentido fisiológico positivo del flujo. */
  nodes: TubeNode[];
  /** Factor del semieje anteroposterior respecto al lateral (1 = circular). */
  apScale: number;
  /**
   * Forma orgánica (decisión 90): la sección anisótropa y el radio modulado a lo largo del eje. La pone la escena a las
   * suprahepáticas y a la porta (`tubeShapeClassOf`); sin ella, un tubo es circular y de radio lineal (o la elipse de
   * `apScale`, la VCI, cuyo calibre va en sus nodos).
   */
  shape?: TubeShape;
  /**
   * Radio entre nodos con smoothstep (pendiente nula en ellos) en lugar de lineal: la VCI infrahepática (decisión 90), cuyo
   * calibre ondula sin quiebros en sus paredes. Explícito, no deducido de la sección elíptica. La GPU lo recibe como
   * H4.w = −1 (`tubeShapeTexel`), así que un tubo no lleva a la vez `shape` y `smoothRadius`.
   */
  smoothRadius?: boolean;
}

/**
 * Forma orgánica de un tubo (decisión 90). Los vasos del modelo eran cadenas de cápsulas de sección circular y radio
 * lineal entre nodos: el juez ciego (ronda 4) veía «vasos pequeños como círculos perfectos» y «venas de cuerpo redondo con
 * un cono recto». Dos cosas, ancladas al tubo (salen de un hash entero de su índice en la lista de la GPU, `seed`: vasos y
 * después conductos, el H2.w de la textura de escena), el mismo resultado en TS y en GLSL (que recibe la sección hecha en
 * el téxel H4 de la cabecera del tubo, `tubeShapeTexel`, y calcula el ruido con el mismo hash):
 *  - **Sección anisótropa**: la distancia al eje es la de una métrica elíptica fija en el marco material,
 *    f(d) = c·√(|d|² + κ·(d·ŵ)²) con c = (1 + κ)^(−1/4). En un segmento perpendicular a ŵ la sección es una elipse de
 *    semiejes r·(1 + κ)^(±1/4) y de área πr²; la orientación sigue a la proyección de ŵ y gira con el vaso sin saltos en
 *    los codos (f no depende de la tangente del segmento). Donde el segmento se inclina hacia ŵ (ŵ·t ≠ 0) la sección se
 *    redondea y crece: área × √(1 + κ)/√(1 + κ·(1 − (ŵ·t)²)). ŵ es la parte de un vector del hash perpendicular a la cuerda
 *    del tubo (del primer nodo al último), así que ese factor queda ≤ 1,04 en los tubos del modelo (con ŵ perpendicular al
 *    primer segmento llegaba a 1,14 en el codo de una rama portal). κ en reposo se divide por el cuadrado de la dilatación:
 *    la vena distendida por la congestión se redondea, como la VCI (ley de tubo colapsable; Shapiro 1977)
 *    [EXTRAPOLACIÓN PROPIA: los rangos de κ].
 *  - **Radio modulado a lo largo del eje**: r = r_lineal·(1 + amp·N(s)), N un ruido de valor en la longitud de arco desde
 *    el primer nodo (celda de `TUBE_SHAPE.latticeMm`, fundido smoothstep, valores en [−1, 1]) [EXTRAPOLACIÓN PROPIA: la
 *    amplitud y la correlación].
 */
export interface TubeShape {
  /** Índice del tubo en la lista de la GPU (vasos y luego conductos): la semilla del hash. */
  seed: number;
  /** Dirección ŵ de la anisotropía (unitaria, marco material). */
  w: Vec3;
  /** Anisotropía κ en reposo (escala de radio ≤ 1). */
  kappa: number;
  /** Amplitud relativa del ruido del radio a lo largo del eje. */
  amp: number;
}

/** Clase de forma de un vaso: la porta (pared gruesa) o las suprahepáticas (`tubeShapeClassOf`). */
export type TubeShapeClass = 'portal' | 'vein';

/**
 * Parámetros de la forma (decisión 90) [EXTRAPOLACIÓN PROPIA]: por clase, κ mínima y máxima en reposo (semiejes en
 * cociente 1/√(1 + κ): suprahepáticas, de pared fina, 0,91–0,73; porta, de pared gruesa, 0,95–0,85) y la amplitud del
 * ruido del radio (porta 5 %, suprahepáticas 6 %; desviación típica ≈ 0,45 de la amplitud); celda del ruido de 30 mm
 * (correlación de 1–3 cm); sal del hash.
 */
export const TUBE_SHAPE = {
  latticeMm: 30,
  salt: 0x68e31da4,
  /**
   * Más allá de esta distancia a la luz lineal (más amp·r) la GPU no evalúa el ruido: ninguna pared es tan gruesa (la
   * periportal llega a 1,4 mm), así que el tubo no clasifica la muestra con o sin él (`tubeQuery` de la GLSL; TS da
   * siempre la distancia con ruido).
   */
  noiseReachMm: 1.5,
  classes: {
    portal: { kappa: [0.1, 0.4], amp: 0.05 },
    vein: { kappa: [0.2, 0.9], amp: 0.06 },
  },
} as const satisfies {
  latticeMm: number;
  salt: number;
  noiseReachMm: number;
  classes: Record<TubeShapeClass, { kappa: readonly [number, number]; amp: number }>;
};

/** Hash entero de 32 bits («lowbias32», C. Wellons): gemelo exacto de `tubeHash` (GLSL, `uint`). */
export function tubeHash(x: number): number {
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Hash del tubo `seed` con la clave `k` (las celdas del ruido; 0xffff, los parámetros de la sección). */
const tubeKey = (seed: number, k: number): number => tubeHash(((seed << 16) ^ k ^ TUBE_SHAPE.salt) >>> 0);
/** Uniforme en [0, 1) con los 24 bits altos: exacto en float32. */
const tubeUnit = (h: number): number => (h >>> 8) / 16777216;

/**
 * Forma del tubo `seed` de una clase con los nodos `nodes`. ŵ es la parte perpendicular a la cuerda del tubo (del primer
 * nodo al último) de un vector del hash (sus componentes, (2b − 255)/255 con b un byte, nunca son 0, así que no es paralelo
 * a un eje), y κ, un byte más del mismo hash. La GPU la recibe hecha (`tubeShapeTexel`).
 */
export function tubeShapeOf(seed: number, cls: TubeShapeClass, nodes: readonly TubeNode[]): TubeShape {
  const c = TUBE_SHAPE.classes[cls];
  const h = tubeKey(seed, 0xffff);
  const v: Vec3 = [((h & 255) * 2) / 255 - 1, (((h >>> 8) & 255) * 2) / 255 - 1, (((h >>> 16) & 255) * 2) / 255 - 1];
  const [p0, p1] = [nodes[0].p, nodes[nodes.length - 1].p];
  const axis: Vec3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const la = Math.hypot(axis[0], axis[1], axis[2]);
  const t: Vec3 = [axis[0] / la, axis[1] / la, axis[2] / la];
  const vt = v[0] * t[0] + v[1] * t[1] + v[2] * t[2];
  const w: Vec3 = [v[0] - t[0] * vt, v[1] - t[1] * vt, v[2] - t[2] * vt];
  const l = Math.hypot(w[0], w[1], w[2]);
  return { seed, w: [w[0] / l, w[1] / l, w[2] / l], kappa: c.kappa[0] + (c.kappa[1] - c.kappa[0]) * ((h >>> 24) / 255), amp: c.amp };
}

/**
 * Mayor radio de la luz sobre el radio lineal de sus nodos que puede dar la forma de una clase con la escala de radio
 * `radiusScale`: (1 + amp)·(1 + κ_máx/s²)^(1/4) con s = max(1, escala). La contención de las ramas procedurales la cuenta.
 */
export function tubeShapeMaxFactor(cls: TubeShapeClass, radiusScale: number): number {
  const c = TUBE_SHAPE.classes[cls];
  const s = Math.max(1, radiusScale);
  return (1 + c.amp) * Math.pow(1 + c.kappa[1] / (s * s), 0.25);
}

/** Métrica de la sección con la escala de radio del instante: wt = ŵ·√κ_ef y c = (1 + κ_ef)^(−1/4), κ_ef = κ/max(1, s)². */
function shapeMetric(shape: TubeShape, radiusScale: number): { wt: Vec3; c: number } {
  const s = Math.max(1, radiusScale);
  const k = shape.kappa / (s * s);
  const q = Math.sqrt(k);
  return { wt: [shape.w[0] * q, shape.w[1] * q, shape.w[2] * q], c: Math.pow(1 + k, -0.25) };
}

/**
 * Téxel H4 de la cabecera del tubo en la textura de escena (decisión 90): (wt, amplitud del ruido del radio) con la escala de
 * radio del instante; la GPU saca c = (1 + |wt|²)^(−1/4) y lee la semilla del ruido en H2.w. Sin forma, ceros, y con
 * `smoothRadius` (la VCI infrahepática) (0, 0, 0, −1): la amplitud negativa es la marca del radio smoothstep.
 */
export function tubeShapeTexel(tube: Pick<Tube, 'shape' | 'smoothRadius'>, radiusScale: number): [number, number, number, number] {
  const { shape } = tube;
  if (shape && tube.smoothRadius) throw new Error('Un tubo con forma orgánica no lleva radio smoothstep (téxel H4)');
  if (!shape) return [0, 0, 0, tube.smoothRadius ? -1 : 0];
  const { wt } = shapeMetric(shape, radiusScale);
  return [wt[0], wt[1], wt[2], shape.amp];
}

/**
 * Ruido de valor del radio a lo largo del eje del tubo `seed` en la longitud de arco `arcMm` (≥ 0): su valor en [−1, 1] y
 * su derivada (1/mm). Gemelo de `tubeNoise` (GLSL).
 */
export function tubeNoise(seed: number, arcMm: number): [number, number] {
  const x = arcMm / TUBE_SHAPE.latticeMm;
  const c = Math.floor(x);
  const f = x - c;
  const v0 = tubeUnit(tubeKey(seed, c)) * 2 - 1;
  const v1 = tubeUnit(tubeKey(seed, c + 1)) * 2 - 1;
  return [v0 + (v1 - v0) * f * f * (3 - 2 * f), ((v1 - v0) * 6 * f * (1 - f)) / TUBE_SHAPE.latticeMm];
}

export interface Sphere {
  kind: 'sphere';
  center: Vec3;
  r: number;
}

/**
 * Hemicúpula diafragmática: elipse (x0, y0, rx, ry) con altura `apex` en su centro que
 * desciende con perfil superelíptico (1 − ρ⁴) hasta la altura del reborde costal.
 */
export interface Dome {
  kind: 'dome';
  x0: number;
  y0: number;
  rx: number;
  ry: number;
  apex: number;
}

/**
 * Campo diafragmático de dos hemicúpulas (la derecha, más alta, con el hígado debajo) sobre
 * la línea de inserción costal. z = 0 en el xifoides: la inserción está a 0 en la línea
 * media anterior y desciende a −50 mm en los flancos y la espalda (10.º–12.º arcos).
 */
export interface Diaphragm {
  right: Dome;
  left: Dome;
  /** Altura de la inserción en el flanco/espalda y ascenso hacia el xifoides (mm). */
  edgeZ: number;
  edgeRise: number;
  /** Estimated apposition to the registered hepatic superior surface; atlas only. */
  hepaticContact?: boolean;
}

/** Altura de la línea de inserción costal en el ángulo φ del tronco. */
export function diaphragmEdgeZ(phi: number, d: Diaphragm): number {
  return d.edgeZ + d.edgeRise * Math.pow(Math.max(0, Math.sin(phi)), 1.5);
}

function domeLift(x: number, y: number, dome: Dome): number {
  const u = (x - dome.x0) / dome.rx;
  const v = (y - dome.y0) / dome.ry;
  const rho2 = u * u + v * v;
  return Math.sqrt(Math.max(0, 1 - rho2 * rho2));
}

/** Anchura en altura de la unión C1 entre cúpulas [ESTIMADO]; eleva la unión como máximo 1 mm. */
export const DIAPHRAGM_JOIN_MM = 4;

/** Núcleo normalizado que extingue la dependencia angular en el eje [ESTIMADO].
 * Fuera del 10 % del radio corporal conserva la inserción heredada; no representa un tendón.
 */
export const DIAPHRAGM_AXIS_CORE = 0.1;
export function diaphragmInteriorEdgeZ(x: number, y: number, d: Diaphragm, t: Torso): number {
  const u = x / t.a,
    v = (y - (t.y0 ?? 0)) / t.b,
    rho = Math.hypot(u, v),
    q = Math.min(1, rho / DIAPHRAGM_AXIS_CORE);
  return d.edgeZ + d.edgeRise * q * q * (3 - 2 * q) * Math.pow(Math.max(0, v) / Math.max(rho, 1e-20), 1.5);
}

/** Altura del mismo diafragma continuo: mezcla local de cúpulas, sin mover sus ápices ni sus parámetros. */
export function diaphragmHeight(x: number, y: number, d: Diaphragm, torso: Torso): number {
  if (d.hepaticContact) {
    const registered = registeredDomeHeight(x, y);
    if (registered !== undefined) return registered;
  }
  const edge = diaphragmInteriorEdgeZ(x, y, d, torso);
  const zr = edge + Math.max(0, d.right.apex - edge) * domeLift(x, y, d.right);
  const zl = edge + Math.max(0, d.left.apex - edge) * domeLift(x, y, d.left);
  // Los dos levantamientos se anulan juntos fuera de las cúpulas: conservar ahí la inserción,
  // sin añadir el k/4 que smoothMax produciría entre dos ceros.
  const t = Math.min(1, Math.max(0, ((zr + zl) * 0.5 - edge) / (2 * DIAPHRAGM_JOIN_MM)));
  const join = DIAPHRAGM_JOIN_MM * t * t * (3 - 2 * t);
  const height = join > 0 ? smoothMax(zr, zl, join) : edge;
  if (!d.hepaticContact) return height;
  const [contactHeight, support] = hepaticDomeValue(x, y);
  return height + support * (contactHeight - height);
}

/**
 * Distancia con signo al diafragma (negativa en el tórax) y la pendiente √(1 + |∇z|²) que la divide (la de diferencias
 * centrales de 0,5 mm; en el borde de una hemicúpula, cuya altura sube con tangente vertical, se dispara).
 */
export function sdDiaphragmSlope(p: Vec3, d: Diaphragm, torso: Torso): [number, number] {
  const zd = diaphragmHeight(p[0], p[1], d, torso),
    h = 0.5;
  const gx = (diaphragmHeight(p[0] + h, p[1], d, torso) - diaphragmHeight(p[0] - h, p[1], d, torso)) / (2 * h),
    gy = (diaphragmHeight(p[0], p[1] + h, d, torso) - diaphragmHeight(p[0], p[1] - h, d, torso)) / (2 * h),
    slope = Math.sqrt(1 + gx * gx + gy * gy);
  let tangentDistance = (zd - p[2]) / slope;
  if (d.hepaticContact && registeredDomeHeight(p[0], p[1]) !== undefined) {
    // Candidate points remain ON the shared graph, unlike an infinite tangent
    // plane. Central height slopes are continuous across lattice cells; exact
    // cell slopes produced discontinuous projections and failed the rim gate.
    // Three projections give a conservative upper bound, not a global SDF.
    let x = p[0],
      y = p[1],
      height = zd,
      dx = gx,
      dy = gy,
      best = Math.abs(zd - p[2]);
    for (let i = 0; i < 3; i++) {
      const delta = height - p[2] + dx * (p[0] - x) + dy * (p[1] - y),
        scale = delta / (1 + dx * dx + dy * dy);
      x = p[0] - dx * scale;
      y = p[1] - dy * scale;
      height = diaphragmHeight(x, y, d, torso);
      best = Math.min(best, Math.hypot(x - p[0], y - p[1], height - p[2]));
      if (i < 2) {
        dx = (diaphragmHeight(x + h, y, d, torso) - diaphragmHeight(x - h, y, d, torso)) / (2 * h);
        dy = (diaphragmHeight(x, y + h, d, torso) - diaphragmHeight(x, y - h, d, torso)) / (2 * h);
      }
    }
    tangentDistance = zd < p[2] ? -best : best;
  }
  if (!d.hepaticContact) return [tangentDistance, slope];
  // Close to the superior contact, the diaphragm is the 2.5 mm shell of the
  // actual hepatic distance field. A tangent-plane offset alone separates or
  // cuts curved liver surfaces. Outside this bounded shell keep the height field.
  const [, support] = hepaticDomeValue(p[0], p[1]),
    t = Math.min(1, Math.max(0, (zd - p[2] - 6) / 6)),
    contact = support * (1 - t * t * (3 - 2 * t));
  const liverDistance = abdominalAtlasSdf(p, 4);
  const distance = tangentDistance + contact * (DIAPHRAGM_THICKNESS_MM - liverDistance - tangentDistance);
  // A normalized tangent approximation is not a global distance. Near a steep
  // roof it can put muscle deep inside the source liver. The organ remains the
  // obstacle, including outside the normal-contact blend.
  const tObstacle = Math.min(1, Math.max(0, (liverDistance - DIAPHRAGM_THICKNESS_MM) / 1.5));
  const obstacleWeight = 1 - tObstacle * tObstacle * (3 - 2 * tObstacle);
  const obstacleDistance = Math.max(distance, DIAPHRAGM_THICKNESS_MM - liverDistance);
  return [distance + obstacleWeight * (obstacleDistance - distance), slope];
}

/** Distancia con signo al diafragma: negativa en el tórax (por encima). */
export function sdDiaphragm(p: Vec3, d: Diaphragm, torso: Torso): number {
  return sdDiaphragmSlope(p, d, torso)[0];
}

/** Navigator samples the zero of the same acoustic shell, not a separate smoothed roof. */
export function diaphragmSurfaceZ(x: number, y: number, d: Diaphragm, torso: Torso): number {
  const height = diaphragmHeight(x, y, d, torso);
  if (!d.hepaticContact || Math.abs(sdDiaphragm([x, y, height], d, torso)) <= 1e-8) return height;
  // At −12 mm the shell support vanishes by construction; above the sheet both
  // distances are negative. This bracket follows the contact support, not a fit.
  let lo = height - 12,
    // The liver obstacle also operates where normal-contact support is zero.
    // Its upper level is bounded by the same hepatic parallel-surface table.
    hi = Math.max(height, hepaticDomeValue(x, y)[0]) + 12;
  if (sdDiaphragm([x, y, lo], d, torso) < 0 || sdDiaphragm([x, y, hi], d, torso) > 0)
    throw new Error('Diaphragm surface exceeds its registered contact bracket');
  // Numerical root precision keeps the body/rim solve stable; it adds no source resolution.
  for (let i = 0; i < 24; i++) {
    const z = (lo + hi) / 2;
    if (sdDiaphragm([x, y, z], d, torso) > 0) lo = z;
    else hi = z;
  }
  return (lo + hi) / 2;
}

export interface CylinderZ {
  kind: 'cylinderZ';
  x0: number;
  y0: number;
  r: number;
}

/**
 * Columna: cuerpos vertebrales (`SPINE_SHAPE`: sección elíptica de la misma área que el círculo de radio `r`, con los
 * discos entre ellos, PR119; recuperación provisional de la decisión 103) + arco posterior con apófisis transversas (caja de semiancho `archHalfWidth`, entre
 * `archY0` y `archY1`, por detrás del cuerpo, continua: láminas imbricadas). Las costillas se articulan con las
 * apófisis transversas: no existen por detrás de la columna (`sdRib` las excluye en |x| < archHalfWidth + margen). `r`
 * es también el radio del peso respiratorio (`respiratoryWeight`), que no depende de la forma del cuerpo.
 */
export interface Spine extends CylinderZ {
  archHalfWidth: number;
  archY0: number;
  archY1: number;
}

/** Elipse del tronco (sección transversal) y sus capas parietales. */
export interface Torso {
  /** Centro anteroposterior del registro común (mm); 0 en fixtures antiguos. */
  y0?: number;
  /** Perfil polar del adulto de referencia; ausente en el modelo previo. */
  profile?: Float32Array;
  a: number; // semieje x (mm)
  b: number; // semieje y (mm)
  zMin: number;
  zMax: number;
  skinMm: number;
  fatMm: number;
  /** Capa musculoaponeurótica del hábito, con la grasa preperitoneal de su cara interna (decisión 62). */
  muscleMm: number;
  /** Grasa preperitoneal (mm): la parte más honda de `muscleMm`, entre la transversalis y el peritoneo. */
  preperitonealMm: number;
}

export interface Rib {
  /** Número anatómico explícito; el orden de almacenamiento no identifica la costilla. */
  number?: number;
  /** Ángulo anterior del extremo libre (rad, π/2 anterior → 3π/2 posterior), solo 11/12. */
  frontPhi?: number;
  /** Only the source seventh cartilage has measured sections. */
  sourceCartilage?: boolean;
  /** Altura z del arco costal en la línea anterior (φ = π/2) en mm. */
  zAnterior: number;
  /** Semiejes, centro Y y término coseno del ajuste costal de referencia. */
  shape?: [number, number, number, number];
  /** Extremo óseo anterior medido en la fuente; no prolongarlo como cartílago inventado. */
  anteriorEndX?: number;
  /** Inclinación: cuánto sube el arco al ir hacia posterior (mm). */
  tilt: number;
  /** Semiancho craneocaudal (mm) y semiespesor radial (mm). */
  halfWidth: number;
  halfThickness: number;
  /** Escala de la elipse del tronco a la que corre la costilla (0–1). */
  scale: number;
  /**
   * El arco es cartílago a menos de π/2 − cartilageFromPhi de la línea media anterior (φ = π/2), a cada lado
   * (con π/4: ±45°, hasta la línea medioclavicular); NaN = todo hueso.
   */
  cartilageFromPhi: number;
  /** Registro derecho únicamente; false refleja el arco para representar un par bilateral. */
  rightOnly: boolean;
}

// --- Funciones SDF (distancias con signo, negativas dentro) ---------------

export function sdEllipsoid(p: Vec3, e: Ellipsoid): number {
  const dx = p[0] - e.center[0];
  const taper = Math.max(0.15, 1 - e.taperX * (dx / e.radii[0]));
  const kx = dx / e.radii[0];
  const ky = (p[1] - e.center[1]) / (e.radii[1] * taper);
  const kz = (p[2] - e.center[2]) / (e.radii[2] * taper);
  const k1 = Math.sqrt(kx * kx + ky * ky + kz * kz);
  // Aproximación estándar de distancia para elipsoides.
  const k2 = Math.sqrt(
    (kx * kx) / (e.radii[0] * e.radii[0]) +
      (ky * ky) / (e.radii[1] * taper * (e.radii[1] * taper)) +
      (kz * kz) / (e.radii[2] * taper * (e.radii[2] * taper)),
  );
  return k2 > 0 ? (k1 * (k1 - 1)) / k2 : -Math.min(e.radii[0], e.radii[1], e.radii[2]);
}

export function sdSphere(p: Vec3, s: Sphere): number {
  return Math.hypot(p[0] - s.center[0], p[1] - s.center[1], p[2] - s.center[2]) - s.r;
}

/**
 * Cuerpos vertebrales y discos (PR119; recuperación provisional de la decisión 103) [LITERATURA aprox.: Panjabi y cols., Spine 1991;16:888 y 1992;17:299, platillos
 * de T11–L1 de 37–42 mm de ancho y 29–33 de fondo, cuerpos de 22–25 mm de alto y discos de 5–8 mm en la unión
 * toracolumbar]. La sección es una elipse de semiejes r·`aspect` (transverso) y r/`aspect` (anteroposterior), la misma
 * área que el círculo de radio r de la escena: 40 × 29 mm con r 17 (antes un círculo de 34 mm, más estrecho y más hondo
 * que un cuerpo real, cuya cara anterolateral quedaba a 44–58° del haz de la subxifoidea en lugar de 26–36°). Cuerpos de
 * `bodyMm` cada `levelMm`, el de T12 centrado en `z0Mm` (el plano de la transversa epigástrica lo corta por la mitad; el
 * celíaco queda en T12, la mesentérica superior en L1 y las renales en L1–L2) [ESTIMADO], con el borde del platillo
 * (anillo apofisario) redondeado con `rimMm`. Entre dos cuerpos, el disco intervertebral (`sdSpineDisc`).
 */
export const SPINE_SHAPE = { aspect: 1.1765, levelMm: 31, bodyMm: 24, z0Mm: -20, rimMm: 1.5 } as const;

/** Distancia (la aproximada de `sdEllipsoidLocal`, |∇| = 1 en la cara) al cilindro elíptico de los cuerpos, sin discos. */
export function spineEllipseSd(p: Vec3, sp: Spine): number {
  const k = SPINE_SHAPE.aspect;
  return sdEllipsoidLocal([p[0] - sp.x0, p[1] - sp.y0, 0], [sp.r * k, sp.r / k, 1e3]);
}

/** Distancia en z a los cuerpos vertebrales: negativa dentro de un cuerpo, positiva en un disco (mm). */
export function spineSlabSd(z: number): number {
  const { levelMm, bodyMm, z0Mm } = SPINE_SHAPE;
  const t = z - z0Mm;
  return Math.abs(t - levelMm * Math.floor(t / levelMm + 0.5)) - 0.5 * bodyMm;
}

/** Distancia con signo a la caja del arco posterior (con las apófisis transversas). */
export function spineArchSd(p: Vec3, sp: Spine): number {
  if (thoracicAtlas && abdominalAtlas) return 16;
  const dx = Math.abs(p[0] - sp.x0) - sp.archHalfWidth;
  const cy = 0.5 * (sp.archY0 + sp.archY1);
  const dy = Math.abs(p[1] - cy) - 0.5 * (sp.archY1 - sp.archY0);
  const d = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
  return abdominalAtlas ? Math.max(d, -60 - p[2]) : d;
}

/** Distancia con signo a los cuerpos vertebrales (el borde del platillo redondeado): la cara de su cortical. */
export function spineBodySd(p: Vec3, sp: Spine): number {
  if (thoracicAtlas && abdominalAtlas) {
    const q = thoracicValue(p);
    return Math.min(thoracicMaterial(q.label) === 'vertebra' ? q.d : 16, abdominalAtlasSdf(p, 8));
  }
  const d = smoothMax(spineEllipseSd(p, sp), spineSlabSd(p[2]), SPINE_SHAPE.rimMm);
  return abdominalAtlas ? Math.min(Math.max(d, -60 - p[2]), abdominalAtlasSdf(p, 8)) : d;
}

/**
 * Distancias con signo de la columna en p (PR119; recuperación provisional de la decisión 103; negativas dentro): a los cuerpos (`spineBodySd`), al hueso (cuerpos ∪
 * arco posterior) y al disco intervertebral, el cilindro de los cuerpos fuera del hueso de un cuerpo: cuerpos y discos
 * llenan el cilindro, también en el borde redondeado del platillo (con el corte recto del disco quedaba ahí un surco de
 * hasta 0,375 mm que tomaba el tejido vecino, pulmón junto a T11–T12). `classify` las calcula una vez; gemelo del bloque
 * de la columna de `classifyWith` (GLSL).
 */
export function spineDistances(p: Vec3, sp: Spine): { body: number; bone: number; disc: number } {
  const e = spineEllipseSd(p, sp);
  const original = smoothMax(e, spineSlabSd(p[2]), SPINE_SHAPE.rimMm);
  const body = spineBodySd(p, sp);
  const disc =
    thoracicAtlas && abdominalAtlas
      ? abdominalAtlasSdf(p, 10)
      : abdominalAtlas
        ? Math.min(Math.max(e, -original, -60 - p[2]), abdominalAtlasSdf(p, 10))
        : Math.max(e, -body);
  return { body, bone: Math.min(body, spineArchSd(p, sp)), disc };
}

/** Distancia a cuerpos ∪ arco. blendMm=0 conserva el hueso; >0 solo suaviza la envolvente de exclusión de órganos. */
export function sdSpine(p: Vec3, sp: Spine, blendMm = 0): number {
  const body = spineBodySd(p, sp);
  const arch = spineArchSd(p, sp);
  return blendMm > 0 ? smoothMin(body, arch, blendMm) : Math.min(body, arch);
}

/** Disco intervertebral (PR119; recuperación provisional de la decisión 103, `spineDistances`): negativa dentro. */
export function sdSpineDisc(p: Vec3, sp: Spine): number {
  return spineDistances(p, sp).disc;
}

/**
 * Curvatura (1/mm) de la cara de un cuerpo vertebral más cercana a p: la de la elipse en su costado
 * (ab/(a²·sen²t + b²·cos²t)^(3/2), con t el ángulo paramétrico de p), 0 en los platillos (planos). El eje del
 * cilindro es z. Gemelo de `spineFaceCurvature` (GLSL): la coherencia de curvatura de su eco (decisión 57).
 */
export function spineFaceCurvature(p: Vec3, sp: Spine): number {
  const e = spineEllipseSd(p, sp);
  if (spineSlabSd(p[2]) > e) return 0;
  const a = sp.r * SPINE_SHAPE.aspect;
  const b = sp.r / SPINE_SHAPE.aspect;
  const kx = (p[0] - sp.x0) / a;
  const ky = (p[1] - sp.y0) / b;
  const k = Math.hypot(kx, ky);
  // (en el eje no hay dirección: dentro del hueso, sin cara)
  if (k < 1e-6) return 0;
  const q = Math.hypot(a * ky, b * kx) / k;
  return (a * b) / (q * q * q);
}

export interface TubeHit {
  /** Distancia con signo a la superficie luminal (mm). */
  d: number;
  /** Fracción radial 0 (eje) – 1 (pared) – >1 (fuera). */
  rho: number;
  /** Tangente unitaria en el sentido positivo del flujo. */
  tangent: Vec3;
  /** Radio local (mm). */
  r: number;
  /** Índice del segmento y parámetro a lo largo de él. */
  segment: number;
  s: number;
  /** Longitud de arco (mm) del punto del eje más cercano desde el primer nodo: la del ruido del radio (decisión 90). */
  arc: number;
}

/**
 * Peso del radio del nodo final a lo largo del segmento: lineal (s) o, con `Tube.smoothRadius` (la VCI infrahepática),
 * smoothstep, con pendiente nula en los nodos: su calibre (decisión 90) ondula sin quiebros en sus paredes.
 */
function radiusWeight(s: number, smooth: boolean): number {
  return smooth ? s * s * (3 - 2 * s) : s;
}

/**
 * Distancia a una cadena de cápsulas con radio interpolado y sección elíptica
 * (semieje AP = r·apScale). `radiusScale` multiplica los radios (fisiología). Con forma (decisión 90, `Tube.shape`),
 * la distancia al eje es la de la métrica elíptica del tubo (si su sección no es la de `apScale`) y el radio lleva el
 * ruido a lo largo del eje; el segmento se elige sin ese ruido (continuo en la longitud de arco, así que en las uniones no
 * hay escalón) y se aplica una vez, como en la GLSL (que lo aplica con cualquier `apScale`, igual que aquí).
 */
export function tubeQuery(p: Vec3, tube: Tube, radiusScale = 1): TubeHit {
  const nodes = tube.nodes;
  const shape = tube.apScale === 1 && tube.shape ? shapeMetric(tube.shape, radiusScale) : null;
  const smooth = tube.smoothRadius === true;
  let bestD = Infinity;
  let bestDist = 0;
  let bestR = 1;
  let bestI = 0;
  let bestS = 0;
  let bestArc = 0;
  let bestT: Vec3 = [0, 0, 1];
  let arc = 0;
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i].p;
    const b = nodes[i + 1].p;
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const abz = b[2] - a[2];
    const apx = p[0] - a[0];
    const apy = p[1] - a[1];
    const apz = p[2] - a[2];
    const len2 = abx * abx + aby * aby + abz * abz;
    const len = Math.sqrt(len2);
    let s = len2 > 0 ? (apx * abx + apy * aby + apz * abz) / len2 : 0;
    s = s < 0 ? 0 : s > 1 ? 1 : s;
    const cx = a[0] + abx * s;
    const cy = a[1] + aby * s;
    const cz = a[2] + abz * s;
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    const dz = p[2] - cz;
    // Sección elíptica (VCI): el semieje anteroposterior es r·apScale. Se
    // escala la componente y del desplazamiento perpendicular al eje; válido
    // para tubos cuyo eje es aproximadamente perpendicular a +y (vertical o
    // lateral), que es el caso de la cava. La componente axial (más allá de
    // los extremos del segmento) se conserva: sin ella el tubo no tenía tapa.
    let dist: number;
    if (tube.apScale !== 1) {
      const l = len || 1;
      const tx = abx / l;
      const ty = aby / l;
      const tz = abz / l;
      const along = dx * tx + dy * ty + dz * tz;
      const px = dx - tx * along;
      const py = (dy - ty * along) / tube.apScale;
      const pz = dz - tz * along;
      dist = Math.sqrt(px * px + py * py + pz * pz + along * along);
    } else if (shape) {
      const q = dx * shape.wt[0] + dy * shape.wt[1] + dz * shape.wt[2];
      dist = shape.c * Math.sqrt(dx * dx + dy * dy + dz * dz + q * q);
    } else {
      dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    const r = (nodes[i].r + (nodes[i + 1].r - nodes[i].r) * radiusWeight(s, smooth)) * radiusScale;
    const d = dist - r;
    if (d < bestD) {
      const l = len || 1;
      bestD = d;
      bestDist = dist;
      bestR = r;
      bestI = i;
      bestS = s;
      bestArc = arc + s * len;
      bestT = [abx / l, aby / l, abz / l];
    }
    arc += len;
  }
  const amp = tube.shape?.amp ?? 0;
  const r = amp > 0 ? bestR * (1 + amp * tubeNoise(tube.shape!.seed, bestArc)[0]) : bestR;
  return { d: bestDist - r, rho: bestDist / Math.max(1e-6, r), tangent: bestT, r, segment: bestI, s: bestS, arc: bestArc };
}

/**
 * Gradiente de la distancia con signo del tubo (sd = dist − r(s)) en el segmento de `hit` y curvatura
 * circunferencial de su cara: gemelo de `tubeQuery` en la GLSL, que deja el primero en `Cls.n` (sin
 * normalizar) y la segunda en `Cls.kc` (decisión 57). En la sección elíptica el gradiente escala dos
 * veces la componente AP, así que su norma es 1/apScale en las paredes anterior y posterior: la pasada B
 * divide por ella `ifd` (el valor de sd) para tener la distancia por la normal. Dentro del segmento se
 * resta el crecimiento del radio a lo largo del eje. La curvatura de la cara en su dirección
 * circunferencial ĉ (normal a la cara y al eje) es ĉᵀQĉ/(r·|∇dist|), con Q la matriz de la métrica de la sección
 * (dist = √(dᵀQd) en el plano de la sección): S² = diag(1, 1/apScale², 1) en la VCI (1/r en la sección circular,
 * apScale/r en las paredes AP y 1/(apScale²·r) en las laterales) y c²·(I + wt·wtᵀ) con la forma de la decisión 90. Con
 * forma, el crecimiento del radio a lo largo del eje incluye el del ruido (r·amp·N′).
 */
export function tubeFaceGradient(p: Vec3, tube: Tube, radiusScale: number, hit: TubeHit): { gradient: Vec3; curvature: number } {
  const a = tube.nodes[hit.segment];
  const b = tube.nodes[hit.segment + 1];
  const ab: Vec3 = [b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]];
  const len = Math.hypot(ab[0], ab[1], ab[2]) || 1;
  const tg: Vec3 = [ab[0] / len, ab[1] / len, ab[2] / len];
  const s = hit.s;
  const inside = s > 0 && s < 1;
  const d: Vec3 = [p[0] - (a.p[0] + ab[0] * s), p[1] - (a.p[1] + ab[1] * s), p[2] - (a.p[2] + ab[2] * s)];
  const dot = (x: Vec3, y: Vec3) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  const ap = tube.apScale;
  const shape = ap === 1 && tube.shape ? shapeMetric(tube.shape, radiusScale) : null;
  let dist: number;
  // gradiente de dist (sin la parte del radio)
  let gd: Vec3;
  if (ap !== 1) {
    const along = dot(d, tg);
    const perp: Vec3 = [d[0] - tg[0] * along, (d[1] - tg[1] * along) / ap, d[2] - tg[2] * along];
    dist = Math.hypot(perp[0], perp[1], perp[2], along);
    const q: Vec3 = [perp[0], perp[1] / ap, perp[2]];
    const qt = dot(q, tg);
    const inv = 1 / Math.max(dist, 1e-6);
    gd = [(q[0] - tg[0] * qt + tg[0] * along) * inv, (q[1] - tg[1] * qt + tg[1] * along) * inv, (q[2] - tg[2] * qt + tg[2] * along) * inv];
  } else if (shape) {
    // f = c·√(|d|² + q²), q = d·wt: ∇_d f = c·(d + q·wt)/√(…); dentro del segmento el punto del eje se mueve con p y el
    // gradiente queda en el plano de la sección (en la tapa, el nodo está fijo)
    const q = dot(d, shape.wt);
    const F = Math.sqrt(dot(d, d) + q * q);
    dist = shape.c * F;
    const k = shape.c / Math.max(F, 1e-6);
    gd = [(d[0] + q * shape.wt[0]) * k, (d[1] + q * shape.wt[1]) * k, (d[2] + q * shape.wt[2]) * k];
    if (inside) {
      const t = dot(gd, tg);
      gd = [gd[0] - tg[0] * t, gd[1] - tg[1] * t, gd[2] - tg[2] * t];
    }
  } else {
    dist = Math.hypot(d[0], d[1], d[2]);
    const inv = 1 / Math.max(dist, 1e-6);
    gd = [d[0] * inv, d[1] * inv, d[2] * inv];
  }
  const smooth = tube.smoothRadius === true;
  const rLin = (a.r + (b.r - a.r) * radiusWeight(s, smooth)) * radiusScale;
  const amp = tube.shape?.amp ?? 0;
  const [n, dn] = amp > 0 ? tubeNoise(tube.shape!.seed, hit.arc) : [0, 0];
  const r = rLin * (1 + amp * n);
  const dw = smooth ? 6 * s * (1 - s) : 1;
  const taper = inside ? ((radiusScale * (b.r - a.r) * dw) / len) * (1 + amp * n) + rLin * amp * dn : 0;
  const gn: Vec3 = [gd[0] - tg[0] * taper, gd[1] - tg[1] * taper, gd[2] - tg[2] * taper];
  const gradient: Vec3 = dist > 0 && dot(gn, gn) > 0 ? gn : [0, 1, 0];
  let curvature = 1 / r;
  const c: Vec3 = [gd[1] * tg[2] - gd[2] * tg[1], gd[2] * tg[0] - gd[0] * tg[2], gd[0] * tg[1] - gd[1] * tg[0]];
  const cl = Math.hypot(c[0], c[1], c[2]);
  if ((ap !== 1 || shape) && dist > 0 && cl > 1e-6) {
    const ch: Vec3 = [c[0] / cl, c[1] / cl, c[2] / cl];
    const cq = shape ? shape.c * shape.c * (1 + dot(ch, shape.wt) ** 2) : 1 + ch[1] * ch[1] * (1 / (ap * ap) - 1);
    curvature = cq / (r * Math.hypot(gd[0], gd[1], gd[2]));
  }
  return { gradient, curvature };
}

/** Ángulo alrededor del tronco: 0 = lado izquierdo del paciente (+x), π/2 = anterior (+y). */
export function torsoPhi(x: number, y: number, t: Torso): number {
  return Math.atan2((y - (t.y0 ?? 0)) / t.b, x / t.a);
}

/** Distancia radial (mm, aproximada) desde la piel: negativa dentro del cuerpo. */
export function torsoDepth(p: Vec3, t: Torso): number {
  if (t.profile) return bodyDepth(p, t.profile);
  const y = p[1] - (t.y0 ?? 0);
  const u = p[0] / t.a;
  const v = y / t.b;
  const rho = Math.sqrt(u * u + v * v);
  // Escala local aproximada de la elipse en esa dirección
  const localR = rho > 0 ? Math.hypot(p[0], y) / rho : Math.min(t.a, t.b);
  return (rho - 1) * localR;
}

/**
 * Gradiente de `torsoDepth` (su métrica radial: no es unitario salvo en un tronco circular), analítico:
 * ∂d/∂x = (x/r)(1 − 1/ρ) + r·x/(a²ρ³), igual en y con b; 0 en z. Da la normal y la norma del gradiente de las
 * caras de las capas de la pared sin su ondulación (el eco de cara plana de la serie de la pleura, decisión 62).
 */
export function torsoDepthGradient(p: Vec3, t: Torso): Vec3 {
  if (t.profile) return bodyGradient(p, t.profile);
  p = [p[0], p[1] - (t.y0 ?? 0), p[2]];
  const r = Math.hypot(p[0], p[1]);
  if (r < 1e-6) return [0, 1, 0];
  const rho = Math.hypot(p[0] / t.a, p[1] / t.b);
  const k = 1 - 1 / rho;
  const c = r / (rho * rho * rho);
  return [(p[0] / r) * k + (c * p[0]) / (t.a * t.a), (p[1] / r) * k + (c * p[1]) / (t.b * t.b), 0];
}

/** Normal exterior aproximada de la piel en el punto. */
export function torsoNormal(p: Vec3, t: Torso): Vec3 {
  if (t.profile) {
    const g = bodyGradient(p, t.profile);
    const n = Math.hypot(...g);
    return g.map((v) => v / n) as Vec3;
  }
  p = [p[0], p[1] - (t.y0 ?? 0), p[2]];
  const nx = p[0] / (t.a * t.a);
  const ny = p[1] / (t.b * t.b);
  const n = Math.hypot(nx, ny) || 1;
  return [nx / n, ny / n, 0];
}

/** Punto de la piel para un ángulo φ y altura z. */
export function torsoSkinPoint(phi: number, z: number, t: Torso): Vec3 {
  if (t.profile) {
    const [r, , , cy] = bodySection(phi, z, t.profile);
    return [r * Math.cos(phi), cy + r * Math.sin(phi), z];
  }
  return [t.a * Math.cos(phi), (t.y0 ?? 0) + t.b * Math.sin(phi), z];
}

/**
 * Extremo anterior de las costillas derechas (decisión 62): la 5.ª–7.ª llegan al esternón (x ≤ 15 mm); las
 * 8.ª–10.ª acaban en el reborde costal, que baja desde el xifoides hacia fuera: x ≤ 15 + pendiente·z anterior
 * (la 8.ª a −23 mm y la 9.ª a −62, mediales a la línea medioclavicular, x ≈ −96 en la elipse de la costilla; la
 * 10.ª a −100, en ella). Antes todas cruzaban la línea media y la ventana subxifoidea pasaba por los cartílagos
 * de la 8.ª y la 9.ª. `cartilageTailMm`: los últimos milímetros (en x, en la mitad anterior) antes del extremo son
 * cartílago aunque caigan fuera de ±45° de la línea media (la 10.ª, cuyo extremo queda en la línea medioclavicular, conserva así
 * su cartílago corto, unido al de la 9.ª en el reborde).
 */
export const RIB_ANTERIOR_END = { xMm: 15, marginSlope: 1.53, cartilageTailMm: 25 } as const;

/** x máxima (mm) de la costilla: su extremo anterior (`RIB_ANTERIOR_END`). */
export function ribAnteriorEndX(rib: Pick<Rib, 'zAnterior' | 'anteriorEndX'>): number {
  return rib.anteriorEndX ?? Math.min(RIB_ANTERIOR_END.xMm, RIB_ANTERIOR_END.xMm + RIB_ANTERIOR_END.marginSlope * rib.zAnterior);
}

/** Parámetros en el mismo marco físico que la piel y la columna. */
export function ribShape(rib: Rib, t: Torso): [number, number, number, number] {
  return rib.shape ?? [t.a * rib.scale, t.b * rib.scale, t.y0 ?? 0, 0];
}
export function ribCentre(phi: number, rib: Rib, t: Torso): Vec3 {
  const [a, b, y, c] = ribShape(rib, t);
  return [a * Math.cos(phi), y + b * Math.sin(phi), rib.zAnterior + rib.tilt * (0.5 - 0.5 * Math.sin(phi)) + c * Math.cos(phi)];
}
/** Cota inferior al arco óseo. El cartílago registrado tiene otro campo: no se descarta. */
export function ribDistanceLowerBound(p: Vec3, rib: Rib): number {
  const amplitude = Math.sqrt((rib.tilt / 2) ** 2 + (rib.shape?.[3] ?? 0) ** 2);
  const dz = Math.max(0, Math.abs(p[2] - rib.zAnterior - rib.tilt / 2) - amplitude);
  return Math.min(1e3, (dz / rib.halfWidth - 1) * Math.min(rib.halfWidth, rib.halfThickness));
}
/** Distancia con signo a una costilla (negativa dentro del hueso). */
export function sdRib(p: Vec3, rib: Rib, torso: Torso, spine?: Spine): { d: number; cartilage: boolean } {
  const bone = sdRibBone(p, rib, torso, spine);
  if (rib.sourceCartilage) {
    const cart = referenceCartilage(p);
    if (cart.d < bone.d) return { d: cart.d, cartilage: true };
  }
  return bone;
}
function sdRibBone(p: Vec3, rib: Rib, torso: Torso, spine?: Spine): { d: number; cartilage: boolean } {
  // Un registro describe el arco derecho y su reflejo izquierdo cuando es bilateral.
  if (!rib.rightOnly) p = [-Math.abs(p[0]), p[1], p[2]];
  const [a, b, y, c] = ribShape(rib, torso);
  const phi = Math.atan2((p[1] - y) / b, p[0] / a);
  if (p[1] > y && p[0] > ribAnteriorEndX(rib)) return { d: 1e3, cartilage: false };
  // El arco costal termina en la apófisis transversa: nada por detrás de la columna
  if (spine && p[1] < spine.y0 && Math.abs(p[0] - spine.x0) < spine.archHalfWidth + 6) return { d: 1e3, cartilage: false };
  // radio local de la costilla a lo largo de su elipse escalada
  const u = p[0] / a;
  const v = (p[1] - y) / b;
  const rho = Math.sqrt(u * u + v * v);
  const localR = rho > 0 ? Math.hypot(p[0], p[1] - y) / rho : 1;
  const dRadial = (rho - 1) * localR;
  // altura del arco: más alto hacia posterior (φ → −π/2)
  const zRib = rib.zAnterior + rib.tilt * (0.5 - 0.5 * Math.sin(phi)) + c * Math.cos(phi);
  const dz = p[2] - zRib;
  const qx = Math.abs(dRadial) / rib.halfThickness;
  const qz = Math.abs(dz) / rib.halfWidth;
  const q = Math.sqrt(qx * qx + qz * qz) - 1;
  const sectionD = q * Math.min(rib.halfThickness, rib.halfWidth);
  const angle = phi < 0 ? phi + 2 * Math.PI : phi;
  // Extremo libre: impide que 11/12 reaparezcan delante del cabo costal.
  const d = rib.frontPhi === undefined ? sectionD : Math.max(sectionD, (rib.frontPhi - angle) * localR);
  // cartílago solo en el arco anterior, a menos de π/2 − cartilageFromPhi de la línea media (φ = π/2), a los
  // dos lados (antes `φ > cartilageFromPhi`, que en las costillas derechas, φ ∈ (π/2, π], hacía cartílago todo
  // el arco anterolateral: la ventana intercostal sin cortical ni sombra; decisión 62)
  const cartilage =
    !rib.shape &&
    Number.isFinite(rib.cartilageFromPhi) &&
    (Math.abs(phi - Math.PI / 2) < Math.PI / 2 - rib.cartilageFromPhi ||
      (p[1] > y && p[0] > ribAnteriorEndX(rib) - RIB_ANTERIOR_END.cartilageTailMm));
  return { d, cartilage };
}

/** Unión suave (polinómica) de dos distancias con signo; k = radio de mezcla (mm). */
export function smoothMin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** Intersección suave: max(a, b) con arista redondeada de radio k (mm). */
export function smoothMax(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}

/** Distancia aproximada a un elipsoide centrado y alineado con los ejes (marco local). */
export function sdEllipsoidLocal(q: Vec3, r: Vec3): number {
  const kx = q[0] / r[0];
  const ky = q[1] / r[1];
  const kz = q[2] / r[2];
  const k1 = Math.sqrt(kx * kx + ky * ky + kz * kz);
  const k2 = Math.sqrt((kx * kx) / (r[0] * r[0]) + (ky * ky) / (r[1] * r[1]) + (kz * kz) / (r[2] * r[2]));
  return k2 > 0 ? (k1 * (k1 - 1)) / k2 : -Math.min(r[0], r[1], r[2]);
}

/** Base ortonormal a partir de un eje largo y una dirección aproximada del hilio. */
export function orthonormalBasis(long: Vec3, hilumHint: Vec3): { u: Vec3; v: Vec3; w: Vec3 } {
  const n = (a: Vec3): Vec3 => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const u = n(long);
  const dotUH = hilumHint[0] * u[0] + hilumHint[1] * u[1] + hilumHint[2] * u[2];
  const v = n([hilumHint[0] - u[0] * dotUH, hilumHint[1] - u[1] * dotUH, hilumHint[2] - u[2] * dotUH]);
  // w = u × v (anterior si u es craneal y v medial-derecha… se corrige por signo en la escena)
  const w: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  return { u, v, w };
}
