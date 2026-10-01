import type { Vec3 } from '../../core/vec3';
import { Interface } from '../interfaces';
import { sdRib, ribShape, torsoDepth, torsoDepthGradient, type Rib, type Spine, type Torso } from '../primitives';

/**
 * Pared torácica y abdominal en capas (decisión 62) como módulo de órgano (decisión 46): la geometría de
 * sus capas y de sus caras, en TS y en GLSL con los mismos nombres. Antes la pared eran tres bandas de
 * moteado uniforme (piel, grasa, músculo) sin ninguna cara; en un convexo de 3,5 MHz es una pila de líneas
 * finas brillantes que siguen la curvatura de la sonda (piel, septos, fascias, peritoneo) con huecos
 * hipoecoicos (referencias de la decisión 62).
 *
 * Coordenadas de la pared, todas del marco MATERIAL (la pared no respira: `respiratoryWeight` = 0), así
 * que lo que se construye con ellas está anclado y no hierve al mover la sonda:
 *  - d: profundidad bajo la piel, −`torsoDepth` (radial desde el eje del tronco, la métrica de las capas);
 *  - u: longitud de arco de la piel desde la línea media anterior, con signo (+x, izquierda del paciente),
 *    `wallArc` (el corte del ángulo queda en la línea media posterior, sobre la columna);
 *  - z: la craneocaudal.
 *
 * Capas, de fuera adentro (espesores del hábito): piel `skinMm`; grasa subcutánea `fatMm`, con la fascia
 * de Scarpa al 40 % de su profundidad; músculo, `muscleMm` menos la grasa preperitoneal, con dos planos
 * intermusculares ondulados en la pared lateral (oblicuo externo, interno y transverso) que se funden con
 * las vainas del recto hacia la línea media; y la grasa preperitoneal (extraperitoneal) `preperitonealMm`
 * entre la fascia transversalis y el peritoneo parietal, la cara interna de la pared. Scarpa, la fascia
 * profunda y la transversalis ondulan suavemente (`wallWave`); la piel y el peritoneo no. El espesor total no
 * cambia (el hígado, la cortina y los vasos siguen en su sitio): la grasa preperitoneal sale del músculo.
 */

/** Parámetros de las capas [ESTIMADO salvo donde se cita]. */
export const WALL = {
  /** Fascia de Scarpa: fracción de la profundidad de la grasa subcutánea (anatomía de superficie, PMC7441131). */
  scarpaFraction: 0.4,
  /**
   * Planos intermusculares de la pared lateral: distancia del primero a la fascia profunda y del segundo a
   * la transversalis, en fracción del músculo (oblicuo externo, interno y transverso: ~35/35/30 %).
   */
  planeFractions: [0.35, 0.3] as const,
  /**
   * Relieve fino de las caras internas (mm, `wallWave`): los planos, Scarpa y la fascia profunda, y la transversalis en
   * fracción de (grasa preperitoneal − 1 mm) para que la capa no baje de 1 mm. Piel y peritoneo no ondulan: el espesor
   * de la pared, y con él el hígado, no cambia. Hasta la decisión 88, dos senos de 17–60 mm con 0,8–1,2 mm: en la
   * imagen, arcos concéntricos y equidistantes como curvas de nivel.
   */
  planeWaveMm: 0.35,
  scarpaWaveMm: 0.5,
  fasciaWaveMm: 0.5,
  transversalisWaveFraction: 0.25,
  /**
   * Relieve lento (`wallSwell`, decisión 88): el espesor de las capas cambia a lo largo de la pared. La grasa subcutánea
   * ±11 % (con 14–18 mm de grasa, la fascia profunda sube y baja hasta ±1,5–2 mm en 2–5 cm y el músculo absorbe el cambio), la
   * fracción de Scarpa en ella ±0,06 y el reparto del músculo entre sus tres vientres ±0,06 de su espesor, cada uno por
   * su lado: las caras se acercan, se separan y se funden [ESTIMADO]. Con el relieve fino, la inclinación de Scarpa, la
   * fascia y los planos sobre la piel queda en 6–9° de mediana y ≤ 15–23° en el 1 % más inclinado en los siete casos
   * (`wall.test.ts`): |∇| de su distancia ≤ 1,48, bajo la cota de la salida barata del eco (`IFACE_GRADIENT_MAX`, 1,5).
   */
  fatSwell: 0.11,
  /**
   * Tope (mm) del relieve lento de la grasa: ±11 % hasta 18 mm de grasa (los casos de hoy), ±2 mm con más. Con la
   * pendiente del relieve proporcional al espesor, una grasa de 20–30 mm llevaba |∇| de la fascia y del plano oblicuo a
   * 1,5–1,7, sobre la cota de la salida barata del eco (revisión adversarial de la decisión 88).
   */
  fatSwellMaxMm: 2,
  scarpaSwell: 0.06,
  planeSwell: 0.06,
  /** Transición del recto (línea media) a la pared lateral: |u| en mm (línea semilunar a 5–8 cm). */
  rectusMm: [50, 80] as const,
  /** Un plano a menos de esto (mm) de su vaina, o del otro plano, se ha fundido con él: no dibuja cara. */
  planeMinMm: 1,
  /** Grasa preperitoneal: 15 % de la subcutánea, entre 1,5 y 4 mm. */
  preperitonealFraction: 0.15,
  preperitonealRangeMm: [1.5, 4] as const,
  /**
   * La cortical costal manda sobre las capas en el tejido blando a menos de esto (mm) de la costilla: cubre
   * el perfil de una cara de un lado (desplazamiento + alcance, 0,84 mm) con la cota de su gradiente (×1,5;
   * `wall.test.ts` lo comprueba contra `interfaceEcho.ts`, que esta capa no puede importar).
   */
  ribFacePriorityMm: 1.3,
  /**
   * Las costillas se buscan (y mandan sobre la grasa subcutánea) desde (1 − escala)·min(a, b) − este margen
   * bajo la piel: la línea media de una costilla corre a (1 − 0,85)·R_local ≥ 15,75 mm y su semiespesor es
   * ≤ 3,5 mm (`RIB_SECTIONS`; en la métrica radial, ≤ 4,2), así que ningún punto más somero puede estar dentro de una.
   */
  ribSearchMarginMm: 8,
} as const;

/**
 * Profundidad bajo la piel (mm) desde la que se buscan las costillas: más somera, ningún punto puede estar
 * dentro de una (`ribSearchMarginMm`). Así la grasa subcutánea no corta las costillas y no se paga su bucle
 * en toda la grasa.
 */
export function ribSearchDepth(t: Pick<Torso, 'a' | 'b' | 'y0'>, ribScale: number): number {
  return (1 - ribScale) * Math.min(t.a, t.b) - WALL.ribSearchMarginMm;
}

/** Grasa preperitoneal (mm) de un hábito: una parte del espesor muscular del hábito. */
export function preperitonealMm(fatMm: number): number {
  const [lo, hi] = WALL.preperitonealRangeMm;
  return Math.min(hi, Math.max(lo, WALL.preperitonealFraction * fatMm));
}

/** Profundidades (mm bajo la piel) de las caras de la pared en un punto (u, z) de la piel. */
export interface WallDepths {
  skin: number;
  scarpa: number;
  /** Fascia profunda: fin de la grasa subcutánea. */
  fascia: number;
  /** Fascia transversalis: fin del músculo. */
  transversalis: number;
  /** Peritoneo parietal: cara interna de la pared. */
  peritoneum: number;
}

/** Perímetro de la piel (mm): 2π·M·(1 − ε²/16), el de la serie de `wallArc` (841 mm en el tronco de referencia). */
export function wallPerimeter(t: Pick<Torso, 'a' | 'b' | 'y0'>): number {
  const a2 = t.a * t.a;
  const b2 = t.b * t.b;
  const e = (a2 - b2) / (a2 + b2);
  return 2 * Math.PI * Math.sqrt(0.5 * (a2 + b2)) * (1 - (e * e) / 16);
}

/**
 * Número de onda (rad/mm) del armónico del perímetro más cercano a 1/λ, con λ una escala (mm; la longitud de onda es
 * 2π·λ): una onda en u con él es periódica en la vuelta, sin costura donde u salta de +P/2 a −P/2 (línea media
 * posterior). Con una longitud de onda cualquiera, la profundidad de las capas saltaba allí y la diferencia central del
 * gradiente de la GPU daba un eco espurio (lo halló la prueba de la salida barata de `faceGradient.test.ts`). Hasta la
 * decisión 88 se documentaba λ como la longitud de onda: las ondas de las capas medían 2π veces lo escrito (57–400 mm).
 */
export function wallWavenumber(lambda: number, t: Pick<Torso, 'a' | 'b' | 'y0'>): number {
  const P = wallPerimeter(t);
  return (2 * Math.PI * Math.floor(P / (2 * Math.PI * lambda) + 0.5)) / P;
}

/**
 * Tronco con el que se fijan los armónicos del relieve (decisión 88): el de todos los casos (`AnatomyScene`). Con otro
 * tronco valen los mismos: el relieve sigue periódico en la vuelta y su longitud de onda cambia con el perímetro.
 */
const RELIEF_TORSO = { a: 160, b: 105 } as const;

/**
 * Término de un relieve de la pared: w·sin(n·2π/P·u + k_z·z + φ), con n el armónico del perímetro (con el signo de
 * cos ψ) más cercano a la componente en u de una onda de longitud λ en la dirección ψ: frentes oblicuos en (u, z),
 * periódicos en la vuelta. n es un entero fijo (el del tronco de referencia): la GLSL lo lleva escrito y solo calcula
 * 2π/P, en lugar de redondear P/λ en cada término de cada evaluación.
 */
interface ReliefTerm {
  /** Armónico del perímetro a lo largo de u (entero con signo; 0 sin componente en u). */
  harmonic: number;
  /** Número de onda en z (rad/mm): 2π·sen ψ/λ. */
  kz: number;
  phase: number;
  weight: number;
}

function reliefTerms(
  lambdas: readonly number[],
  psis: readonly number[],
  phases: readonly number[],
  weights: readonly number[],
): ReliefTerm[] {
  const P = wallPerimeter(RELIEF_TORSO);
  return lambdas.map((lambda, j) => {
    const c = Math.cos(psis[j]);
    return {
      harmonic: Math.sign(c) * Math.floor((P * Math.abs(c)) / lambda + 0.5),
      kz: (2 * Math.PI * Math.sin(psis[j])) / lambda,
      phase: phases[j],
      weight: weights[j],
    };
  });
}

/**
 * Relieve fino de la cara k (0 y 1 los planos intermusculares, 2 Scarpa, 3 la fascia profunda, 4 la transversalis):
 * tres senos oblicuos de 6,5–25 mm con pesos 0,25 / 0,35 / 0,40 (amplitud ≤ 1), direcciones, longitudes y fases propias
 * de cada cara (decisión 88). Antes eran dos senos de 17–60 mm casi a lo largo de u, y la ondulación apenas movía las
 * capas en el sector: arcos concéntricos.
 */
export const WALL_WAVE_TERMS: readonly (readonly ReliefTerm[])[] = [0, 1, 2, 3, 4].map((k) => {
  // tres direcciones a 60° (una a ≤ 30° de u y otra de z: la cara ondula a lo largo de cualquier plano de corte), con las
  // longitudes rotadas entre caras
  const lambdas = [6.5 + 0.9 * k, 10.5 + 1.3 * k, 17 + 2.1 * k];
  return reliefTerms(
    [0, 1, 2].map((j) => lambdas[(j + k) % 3]),
    [0, 1, 2].map((j) => 0.3 + 0.7 * k + (j * Math.PI) / 3),
    [1.3 + 2.1 * k, 0.7 + 1.9 * k, 2.9 + 0.8 * k],
    [0, 1, 2].map((j) => [0.25, 0.35, 0.4][(j + k) % 3]),
  );
});
/**
 * Relieve lento de la cara k (0 y 1 el reparto del músculo entre los planos, 2 la fracción de Scarpa, 3 el espesor de
 * la grasa subcutánea): dos senos oblicuos de 24–52 mm con pesos 0,55 / 0,45 (amplitud ≤ 1), decisión 88.
 */
export const WALL_SWELL_TERMS: readonly (readonly ReliefTerm[])[] = [0, 1, 2, 3].map((k) =>
  reliefTerms([24 + 3 * k, 37 + 5 * k], [0.4 + 1.7 * k, 2 + 1.1 * k], [0.3 + 1.3 * k, 1.1 + 0.9 * k], [0.55, 0.45]),
);

function relief(terms: readonly ReliefTerm[], u: number, z: number, t: Pick<Torso, 'a' | 'b' | 'y0'>): number {
  const iP = (2 * Math.PI) / wallPerimeter(t);
  let s = 0;
  for (const r of terms) s += r.weight * Math.sin(r.harmonic * iP * u + r.kz * z + r.phase);
  return s;
}

/** Relieve fino de la cara k de la pared en (u, z) (mm de arco y craneocaudal), amplitud ≤ 1, periódico en u. */
export function wallWave(u: number, z: number, k: number, t: Pick<Torso, 'a' | 'b' | 'y0'>): number {
  return relief(WALL_WAVE_TERMS[k], u, z, t);
}

/** Relieve lento de la cara k de la pared en (u, z), amplitud ≤ 1, periódico en u (decisión 88). */
export function wallSwell(u: number, z: number, k: number, t: Pick<Torso, 'a' | 'b' | 'y0'>): number {
  return relief(WALL_SWELL_TERMS[k], u, z, t);
}

/** Espesor local de la grasa subcutánea (mm): el del hábito con el relieve lento de la fascia profunda (decisión 88). */
export function wallFatMm(t: Torso, u: number, z: number): number {
  return t.fatMm + Math.min(WALL.fatSwell * t.fatMm, WALL.fatSwellMaxMm) * wallSwell(u, z, 3, t);
}

export function wallDepths(t: Torso, u: number, z: number): WallDepths {
  const peritoneum = t.skinMm + t.fatMm + t.muscleMm;
  const fat = wallFatMm(t, u, z);
  return {
    skin: t.skinMm,
    scarpa: t.skinMm + (WALL.scarpaFraction + WALL.scarpaSwell * wallSwell(u, z, 2, t)) * fat + WALL.scarpaWaveMm * wallWave(u, z, 2, t),
    fascia: t.skinMm + fat + WALL.fasciaWaveMm * wallWave(u, z, 3, t),
    transversalis: peritoneum - t.preperitonealMm + WALL.transversalisWaveFraction * (t.preperitonealMm - 1) * wallWave(u, z, 4, t),
    peritoneum,
  };
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * Longitud de arco de la piel (mm) desde la línea media anterior hasta el ángulo elíptico del punto, con
 * signo. Serie de ∫√(a²cos²τ + b²sin²τ)dτ hasta ε³ (ε = (a² − b²)/(a² + b²)): |du/ds| = 1 a ±0,5 % en el
 * tronco de 160 × 105 mm (el cuarto de perímetro sale 210,4 mm, el de Ramanujan).
 */
export function wallArc(m: Vec3, t: Pick<Torso, 'a' | 'b' | 'y0'>): number {
  const tau = Math.atan2(m[0] / t.a, (m[1] - (t.y0 ?? 0)) / t.b);
  const a2 = t.a * t.a;
  const b2 = t.b * t.b;
  const M = Math.sqrt(0.5 * (a2 + b2));
  const e = (a2 - b2) / (a2 + b2);
  return (
    M *
    (tau * (1 - (e * e) / 16) +
      Math.sin(2 * tau) * (e / 4 + (3 * e * e * e) / 128) -
      ((e * e) / 64) * Math.sin(4 * tau) +
      ((e * e * e) / 384) * Math.sin(6 * tau))
  );
}

/**
 * Profundidad (mm bajo la piel) del plano intermuscular `i` (0: oblicuo externo/interno, 1: interno/
 * transverso) en (u, z), continua: hacia el recto se acerca a su vaina, y donde queda a menos de
 * `planeMinMm` de ella (`wallPlaneGap`) se ha fundido con ella y no dibuja cara. El reparto del músculo entre sus
 * vientres cambia a lo largo de la pared (relieve lento, decisión 88): los dos planos se acercan o se separan.
 */
export function wallPlaneDepth(u: number, z: number, i: number, t: Torso, w: WallDepths = wallDepths(t, u, z)): number {
  const M = w.transversalis - w.fascia;
  const L = smooth(WALL.rectusMm[0], WALL.rectusMm[1], Math.abs(u));
  const f = WALL.planeFractions[i] + WALL.planeSwell * wallSwell(u, z, i, t);
  const wave = WALL.planeWaveMm * wallWave(u, z, i, t);
  return i === 0 ? w.fascia + f * L * M + wave : w.transversalis - f * L * M + wave;
}

/** Distancia (mm) del plano `i` a su vaina (la fascia profunda o la transversalis): < `planeMinMm`, fundido. */
export function wallPlaneGap(depth: number, i: number, w: WallDepths): number {
  return i === 0 ? depth - w.fascia : w.transversalis - depth;
}

/**
 * Cara que dibuja una muestra de la pared a la profundidad d (piel, grasa, músculo o grasa preperitoneal) y
 * el valor de su distancia: la capa más cercana (a igualdad, la de fuera). `ribD` es la distancia a la
 * costilla ósea más cercana (1e3 si no hay): en el tejido blando bajo la fascia profunda manda la cortical. `w`, las
 * profundidades de las capas en (u, z) si ya se calcularon (la clasificación las tiene: con el relieve de la decisión
 * 88 son 13 senos).
 */
export function wallFace(
  d: number,
  u: number,
  z: number,
  ribD: number,
  t: Torso,
  w: WallDepths = wallDepths(t, u, z),
): [Interface, number] {
  if (d < w.skin) return [Interface.SkinFat, w.skin - d];
  // el tejido blando junto a una costilla ósea dibuja su cortical, también la grasa subcutánea
  if (ribD < WALL.ribFacePriorityMm) return [Interface.RibCortex, ribD];
  let face = Interface.SkinFat;
  let best = 1e3;
  const offer = (f: Interface, dist: number): void => {
    if (dist < best) {
      face = f;
      best = dist;
    }
  };
  if (d < w.fascia) {
    offer(Interface.SkinFat, d - w.skin);
    offer(Interface.Scarpa, Math.abs(d - w.scarpa));
    offer(Interface.DeepFascia, w.fascia - d);
  } else if (d < w.transversalis) {
    offer(Interface.DeepFascia, d - w.fascia);
    offer(Interface.Transversalis, w.transversalis - d);
    // el plano profundo que se acerca a menos de planeMinMm de la cara de encima (el plano superficial o, si este se ha
    // fundido con la fascia, la fascia) se funde con ella (decisión 88)
    const p0 = wallPlaneDepth(u, z, 0, t, w);
    const p1 = wallPlaneDepth(u, z, 1, t, w);
    const p0Drawn = wallPlaneGap(p0, 0, w) >= WALL.planeMinMm;
    if (p0Drawn) offer(Interface.ObliquePlane, Math.abs(d - p0));
    if (wallPlaneGap(p1, 1, w) >= WALL.planeMinMm && p1 - (p0Drawn ? p0 : w.fascia) >= WALL.planeMinMm)
      offer(Interface.TransversusPlane, Math.abs(d - p1));
  } else {
    offer(Interface.Transversalis, d - w.transversalis);
    offer(Interface.Peritoneum, w.peritoneum - d);
  }
  return [face, best];
}

/** Profundidad (mm bajo la piel) de la cara de pared `face` en (u, z): la de su capa. Gemelo de la GLSL. */
export function wallFaceDepth(u: number, z: number, face: Interface, t: Torso): number {
  const w = wallDepths(t, u, z);
  switch (face) {
    case Interface.SkinFat:
      return w.skin;
    case Interface.Scarpa:
      return w.scarpa;
    case Interface.DeepFascia:
      return w.fascia;
    case Interface.Transversalis:
      return w.transversalis;
    case Interface.Peritoneum:
      return w.peritoneum;
    default:
      return wallPlaneDepth(u, z, face === Interface.ObliquePlane ? 0 : 1, t, w);
  }
}

/**
 * Distancia con signo a la cara de pared `face` (su gradiente es la normal que usa el eco): la profundidad
 * menos la de la capa, continua (los planos intermusculares, sin el corte de su fusión: el gradiente de la
 * GPU es una diferencia central y un salto en la distancia lo dispararía). Gemelo de la GLSL.
 */
export function wallFaceSd(m: Vec3, face: Interface, t: Torso): number {
  return -torsoDepth(m, t) - wallFaceDepth(wallArc(m, t), m[2], face, t);
}

/**
 * Gradiente analítico de `wallArc` (1/mm·mm = adimensional en xy, 0 en z): du/dτ·∇τ con τ = atan2(x/a, y/b). Lo usa el
 * eco de cara de las copias de la pared (decisión 88) para llevar la pendiente de cada capa a su normal sin
 * `faceGradient`.
 */
export function wallArcGradient(m: Vec3, t: Pick<Torso, 'a' | 'b' | 'y0'>): Vec3 {
  const X = m[0] / t.a;
  const Y = (m[1] - (t.y0 ?? 0)) / t.b;
  const q = X * X + Y * Y;
  if (q < 1e-12) return [0, 0, 0];
  const tau = Math.atan2(X, Y);
  const a2 = t.a * t.a;
  const b2 = t.b * t.b;
  const M = Math.sqrt(0.5 * (a2 + b2));
  const e = (a2 - b2) / (a2 + b2);
  const du =
    M *
    (1 -
      (e * e) / 16 +
      2 * Math.cos(2 * tau) * (e / 4 + (3 * e * e * e) / 128) -
      ((4 * e * e) / 64) * Math.cos(4 * tau) +
      ((6 * e * e * e) / 384) * Math.cos(6 * tau));
  return [(du * Y) / (t.a * q), (-du * X) / (t.b * q), 0];
}

/**
 * Pendiente de la cara de pared `face` en el punto: (∂f/∂u, ∂f/∂z) de su profundidad, por diferencias adelantadas de
 * `WALL_SLOPE_STEP_MM` (tres evaluaciones de la capa, sin la clasificación). Gemelo de la GLSL.
 */
export const WALL_SLOPE_STEP_MM = 0.05;
export function wallFaceSlope(u: number, z: number, face: Interface, t: Torso): [number, number] {
  const h = WALL_SLOPE_STEP_MM;
  const f0 = wallFaceDepth(u, z, face, t);
  return [(wallFaceDepth(u + h, z, face, t) - f0) / h, (wallFaceDepth(u, z + h, face, t) - f0) / h];
}

/**
 * Gradiente de la distancia de la cara de pared `face` (`wallFaceSd`), decisión 88: −∇τ − ∂f/∂u·∇u − ∂f/∂z·ẑ, con τ la
 * profundidad del tronco (`torsoDepthGradient`), u el arco (`wallArcGradient`, analítico) y la pendiente de la capa
 * (`wallFaceSlope`): tres evaluaciones de su profundidad en lugar de las seis de `wallFaceSd` por diferencias centrales
 * (con el relieve, cada una son 13–23 senos). Lo usan `faceGradient` (TS y GLSL) y el eco de las copias de la pared.
 */
export function wallFaceGradient(m: Vec3, face: Interface, t: Torso): Vec3 {
  const [fu, fz] = wallFaceSlope(wallArc(m, t), m[2], face, t);
  const gu = wallArcGradient(m, t);
  const g0 = torsoDepthGradient(m, t);
  return [-(g0[0] + fu * gu[0]), -(g0[1] + fu * gu[1]), -(g0[2] + fz)];
}

/** Distancia (mm, no euclídea) de `sdRib` a la costilla k: la de la clasificación. */
export function ribSd(m: Vec3, rib: Rib, t: Torso, spine: Spine): number {
  return sdRib(m, rib, t, spine).d;
}

/** Índice de la costilla más cercana (la menor `ribSd`; dentro de una costilla, esa). */
export function nearestRib(m: Vec3, ribs: readonly Rib[], t: Torso, spine: Spine): number {
  let best = 0;
  let bd = 1e9;
  ribs.forEach((rib, i) => {
    const d = ribSd(m, rib, t, spine);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/**
 * Eje de la costilla en el punto: derivada en φ de su línea media (la elipse del tronco escalada, con la
 * altura que sube hacia atrás). Es la tangente que usa la coherencia de curvatura del eco de su cara.
 */
export function ribTangent(p: Vec3, rib: Rib, t: Torso): Vec3 {
  const [a, b, y, c] = ribShape(rib, t);
  const mirror = !rib.rightOnly && p[0] > 0 ? -1 : 1;
  const phi = Math.atan2((p[1] - y) / b, (p[0] * mirror) / a);
  const v: Vec3 = [-a * Math.sin(phi) * mirror, b * Math.cos(phi), -0.5 * rib.tilt * Math.cos(phi) - c * Math.sin(phi)];
  const l = Math.hypot(...v);
  return v.map((x) => x / l) as Vec3;
}

/**
 * Curvatura (1/mm) de la sección elíptica de la costilla (semiejes radial `halfThickness` y craneocaudal
 * `halfWidth`) en el punto del contorno en la dirección del punto: a·b/(a²sin²t + b²cos²t)^{3/2}. En la
 * cresta que mira a la piel, halfThickness/halfWidth² (0,089/mm: radio de 11 mm).
 */
export function ribCurvature(p: Vec3, rib: Rib, t: Torso): number {
  const [ax, by, y, c0] = ribShape(rib, t);
  const x = !rib.rightOnly ? -Math.abs(p[0]) : p[0];
  const dy = p[1] - y;
  const rho = Math.hypot(x / ax, dy / by);
  const dRadial = rho > 0 ? Math.hypot(x, dy) * (1 - 1 / rho) : -Math.min(ax, by);
  const phi = Math.atan2(dy / by, x / ax);
  const dz = p[2] - (rib.zAnterior + rib.tilt * (0.5 - 0.5 * Math.sin(phi)) + c0 * Math.cos(phi));
  const qx = Math.abs(dRadial) / rib.halfThickness;
  const qz = Math.abs(dz) / rib.halfWidth;
  const l = Math.hypot(qx, qz);
  const c = l > 0 ? qx / l : 1;
  const s = l > 0 ? qz / l : 0;
  const a = rib.halfThickness,
    b = rib.halfWidth;
  return (a * b) / Math.pow(a * a * s * s + b * b * c * c, 1.5);
}

const f6 = (x: number): string => x.toFixed(6);
/** Un relieve en GLSL: la suma de sus términos, cada uno con su armónico entero del perímetro por iP = 2π/P. */
function glslRelief(name: string, terms: readonly ReliefTerm[]): string {
  const term = (r: ReliefTerm): string =>
    `${f6(r.weight)} * sin(${r.harmonic !== 0 ? `${r.harmonic.toFixed(1)} * iP * u + ` : ''}${f6(r.kz)} * z + ${f6(r.phase)})`;
  return `float ${name}(float u, float z, float iP) { return ${terms.map(term).join(' + ')}; }`;
}

/** Gemelo GLSL (usa uTorso, uWall = (piel, grasa, músculo, preperitoneal), uRibs, uRibParams, sdRib, torsoDepth). */
export const WALL_GLSL = /* glsl */ `
#define WALL_SCARPA_FRACTION ${WALL.scarpaFraction.toFixed(4)}
#define WALL_PLANE_F0 ${WALL.planeFractions[0].toFixed(4)}
#define WALL_PLANE_F1 ${WALL.planeFractions[1].toFixed(4)}
#define WALL_PLANE_WAVE_MM ${WALL.planeWaveMm.toFixed(4)}
#define WALL_SCARPA_WAVE_MM ${WALL.scarpaWaveMm.toFixed(4)}
#define WALL_FASCIA_WAVE_MM ${WALL.fasciaWaveMm.toFixed(4)}
#define WALL_TR_WAVE_FRACTION ${WALL.transversalisWaveFraction.toFixed(4)}
#define WALL_FAT_SWELL ${WALL.fatSwell.toFixed(4)}
#define WALL_FAT_SWELL_MAX_MM ${WALL.fatSwellMaxMm.toFixed(4)}
#define WALL_SCARPA_SWELL ${WALL.scarpaSwell.toFixed(4)}
#define WALL_PLANE_SWELL ${WALL.planeSwell.toFixed(4)}
#define WALL_SLOPE_STEP ${WALL_SLOPE_STEP_MM.toFixed(4)}
#define WALL_RECTUS_MM0 ${WALL.rectusMm[0].toFixed(4)}
#define WALL_RECTUS_MM1 ${WALL.rectusMm[1].toFixed(4)}
#define WALL_PLANE_MIN_MM ${WALL.planeMinMm.toFixed(4)}
#define WALL_RIB_PRIORITY_MM ${WALL.ribFacePriorityMm.toFixed(4)}
#define WALL_RIB_SEARCH_MARGIN_MM ${WALL.ribSearchMarginMm.toFixed(4)}
float ribSearchDepth() { return (1.0 - uRibParams.x) * min(uTorso.x, uTorso.y) - WALL_RIB_SEARCH_MARGIN_MM; }
float wallArc(vec3 m) {
  float tau = atan(m.x / uTorso.x, (m.y - uTorsoY) / uTorso.y);
  float a2 = uTorso.x * uTorso.x;
  float b2 = uTorso.y * uTorso.y;
  float M = sqrt(0.5 * (a2 + b2));
  float e = (a2 - b2) / (a2 + b2);
  return M * (tau * (1.0 - e * e / 16.0) + sin(2.0 * tau) * (e / 4.0 + 3.0 * e * e * e / 128.0)
    - e * e / 64.0 * sin(4.0 * tau) + e * e * e / 384.0 * sin(6.0 * tau));
}
float wallPerimeter() {
  float a2 = uTorso.x * uTorso.x;
  float b2 = uTorso.y * uTorso.y;
  float e = (a2 - b2) / (a2 + b2);
  return 6.2831853 * sqrt(0.5 * (a2 + b2)) * (1.0 - e * e / 16.0);
}
float wallWavenumber(float lambda, float P) {
  return 6.2831853 * floor(P / (6.2831853 * lambda) + 0.5) / P;
}
// relieves fino (wallWaveK) y lento (wallSwellK) de las caras: 0 y 1 los planos, 2 Scarpa, 3 la fascia, 4 la transversalis
${WALL_WAVE_TERMS.map((terms, k) => glslRelief(`wallWave${k}`, terms)).join('\n')}
${WALL_SWELL_TERMS.map((terms, k) => glslRelief(`wallSwell${k}`, terms)).join('\n')}
// (Scarpa, fascia profunda, transversalis, peritoneo) en (u, z); la piel es uWall.x
vec4 wallDepths(float u, float z) {
  float iP = 6.2831853 / wallPerimeter();
  float peritoneum = uWall.x + uWall.y + uWall.z;
  float fat = uWall.y + min(WALL_FAT_SWELL * uWall.y, WALL_FAT_SWELL_MAX_MM) * wallSwell3(u, z, iP);
  return vec4(uWall.x + (WALL_SCARPA_FRACTION + WALL_SCARPA_SWELL * wallSwell2(u, z, iP)) * fat + WALL_SCARPA_WAVE_MM * wallWave2(u, z, iP),
              uWall.x + fat + WALL_FASCIA_WAVE_MM * wallWave3(u, z, iP),
              peritoneum - uWall.w + WALL_TR_WAVE_FRACTION * (uWall.w - 1.0) * wallWave4(u, z, iP),
              peritoneum);
}
// plano intermuscular i con las profundidades w = wallDepths(u, z) ya calculadas
float wallPlaneDepth(float u, float z, int i, vec4 w) {
  float iP = 6.2831853 / wallPerimeter();
  float M = w.z - w.y;
  float L = smoothstep(WALL_RECTUS_MM0, WALL_RECTUS_MM1, abs(u));
  return i == 0 ? w.y + (WALL_PLANE_F0 + WALL_PLANE_SWELL * wallSwell0(u, z, iP)) * L * M + WALL_PLANE_WAVE_MM * wallWave0(u, z, iP)
                : w.z - (WALL_PLANE_F1 + WALL_PLANE_SWELL * wallSwell1(u, z, iP)) * L * M + WALL_PLANE_WAVE_MM * wallWave1(u, z, iP);
}
float wallPlaneGap(float depth, int i, vec4 w) {
  return i == 0 ? depth - w.y : w.z - depth;
}
// (cara, valor de su distancia) de una muestra de la pared a la profundidad d; ribD: costilla ósea más cercana; w, sus
// profundidades (wallDepths) ya calculadas
vec2 wallFace(float d, float u, float z, float ribD, vec4 w) {
  float skin = uWall.x;
  if (d < skin) return vec2(float(IF_SKIN_FAT), skin - d);
  if (ribD < WALL_RIB_PRIORITY_MM) return vec2(float(IF_RIB), ribD);
  float face = float(IF_SKIN_FAT);
  float best = 1e3;
  if (d < w.y) {
    best = d - skin;
    float ds = abs(d - w.x);
    if (ds < best) { face = float(IF_SCARPA); best = ds; }
    float df = w.y - d;
    if (df < best) { face = float(IF_DEEP_FASCIA); best = df; }
  } else if (d < w.z) {
    face = float(IF_DEEP_FASCIA);
    best = d - w.y;
    float dt = w.z - d;
    if (dt < best) { face = float(IF_TRANSVERSALIS); best = dt; }
    // el plano profundo que se acerca a menos de WALL_PLANE_MIN_MM de la cara de encima (el plano superficial o, si este
    // se ha fundido con la fascia, la fascia) se funde con ella (decisión 88)
    float p0 = wallPlaneDepth(u, z, 0, w);
    float p1 = wallPlaneDepth(u, z, 1, w);
    bool p0Drawn = wallPlaneGap(p0, 0, w) >= WALL_PLANE_MIN_MM;
    float d0 = abs(d - p0);
    if (p0Drawn && d0 < best) { face = float(IF_OBLIQUE_PLANE); best = d0; }
    float d1 = abs(d - p1);
    if (wallPlaneGap(p1, 1, w) >= WALL_PLANE_MIN_MM && p1 - (p0Drawn ? p0 : w.y) >= WALL_PLANE_MIN_MM && d1 < best) { face = float(IF_TRANSVERSUS_PLANE); best = d1; }
  } else {
    face = float(IF_TRANSVERSALIS);
    best = d - w.z;
    float dp = w.w - d;
    if (dp < best) { face = float(IF_PERITONEUM); best = dp; }
  }
  return vec2(face, best);
}
float wallFaceDepth(float u, float z, int face) {
  if (face == IF_SKIN_FAT) return uWall.x;
  vec4 w = wallDepths(u, z);
  if (face == IF_SCARPA) return w.x;
  if (face == IF_DEEP_FASCIA) return w.y;
  if (face == IF_TRANSVERSALIS) return w.z;
  if (face == IF_PERITONEUM) return w.w;
  return wallPlaneDepth(u, z, face == IF_OBLIQUE_PLANE ? 0 : 1, w);
}
float wallFaceSd(vec3 m, int face) {
  return -torsoDepth(m) - wallFaceDepth(wallArc(m), m.z, face);
}
// gradiente analítico de wallArc (decisión 88)
vec3 wallArcGradient(vec3 m) {
  float X = m.x / uTorso.x;
  float Y = (m.y - uTorsoY) / uTorso.y;
  float q = X * X + Y * Y;
  if (q < 1e-12) return vec3(0.0);
  float tau = atan(X, Y);
  float a2 = uTorso.x * uTorso.x;
  float b2 = uTorso.y * uTorso.y;
  float M = sqrt(0.5 * (a2 + b2));
  float e = (a2 - b2) / (a2 + b2);
  float du = M * (1.0 - e * e / 16.0 + 2.0 * cos(2.0 * tau) * (e / 4.0 + 3.0 * e * e * e / 128.0)
    - 4.0 * e * e / 64.0 * cos(4.0 * tau) + 6.0 * e * e * e / 384.0 * cos(6.0 * tau));
  return vec3(du * Y / (uTorso.x * q), -du * X / (uTorso.y * q), 0.0);
}
// pendiente (∂f/∂u, ∂f/∂z) de la cara de pared face, diferencias adelantadas (gemelo de wallFaceSlope)
vec2 wallFaceSlope(float u, float z, int face) {
  float f0 = wallFaceDepth(u, z, face);
  return vec2(wallFaceDepth(u + WALL_SLOPE_STEP, z, face) - f0, wallFaceDepth(u, z + WALL_SLOPE_STEP, face) - f0) / WALL_SLOPE_STEP;
}
// gradiente de torsoDepth (gemelo: torsoDepthGradient de anatomy/primitives)
vec3 torsoDepthGrad(vec3 p) {
  if (uReferenceBody == 1) return bodyGradient(p);
  p.y -= uTorsoY;
  float r = length(p.xy);
  if (r < 1e-6) return vec3(0.0, 1.0, 0.0);
  float rho = length(p.xy / uTorso.xy);
  vec2 g = p.xy / r * (1.0 - 1.0 / rho) + r / (rho * rho * rho) * p.xy / (uTorso.xy * uTorso.xy);
  return vec3(g, 0.0);
}
// gradiente de wallFaceSd con la pendiente de la capa (gemelo de wallFaceGradient, decisión 88)
vec3 wallFaceGradient(vec3 m, int face) {
  vec2 sl = wallFaceSlope(wallArc(m), m.z, face);
  return -(torsoDepthGrad(m) + sl.x * wallArcGradient(m) + vec3(0.0, 0.0, sl.y));
}
float ribSd(vec3 m, int k) {
  bool cart; vec3 n;
  return sdRib(m, k, cart, n);
}
int nearestRib(vec3 m) {
  int best = 0;
  float bd = 1e9;
  for (int i = 0; i < MAX_RIBS; i++) {
    float d = ribSd(m, i);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
vec3 ribTangent(vec3 p, int k) {
  vec4 rib = uRibs[k], s = uRibShape[k];
  float mirror = p.x > 0.0 ? -1.0 : 1.0;
  float phi = atan((p.y - s.z) / s.y, -abs(p.x) / s.x);
  return normalize(vec3(-s.x * sin(phi) * mirror, s.y * cos(phi), -0.5 * rib.y * cos(phi) - s.w * sin(phi)));
}
float ribCurvature(vec3 p, int k) {
  vec4 rib = uRibs[k], s = uRibShape[k];
  vec2 xy = vec2(-abs(p.x), p.y - s.z);
  float rho = length(xy / s.xy);
  float dRadial = rho > 0.0 ? length(xy) * (1.0 - 1.0 / rho) : -min(s.x, s.y);
  float phi = atan(xy.y / s.y, xy.x / s.x);
  float dz = p.z - (rib.x + rib.y * (0.5 - 0.5 * sin(phi)) + s.w * cos(phi));
  vec2 q = abs(vec2(dRadial / rib.w, dz / rib.z));
  float l = length(q);
  float c = l > 0.0 ? q.x / l : 1.0;
  float ss = l > 0.0 ? q.y / l : 0.0;
  return rib.w * rib.z / pow(rib.w * rib.w * ss * ss + rib.z * rib.z * c * c, 1.5);
}
`;
