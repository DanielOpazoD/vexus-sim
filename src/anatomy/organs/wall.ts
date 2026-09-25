import type { Vec3 } from '../../core/vec3';
import { Interface } from '../interfaces';
import { sdRib, torsoDepth, torsoPhi, type Rib, type Spine, type Torso } from '../primitives';

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
  /** Ondulación de los planos (mm): pendiente ≤ 5° (planos suaves). */
  planeWaveMm: 0.8,
  /**
   * Ondulación de las caras internas (mm): Scarpa y fascia profunda, y la transversalis en fracción de
   * (grasa preperitoneal − 1 mm) para que la capa no baje de 1 mm. Piel y peritoneo no ondulan: el espesor
   * de la pared, y con él el hígado, no cambia.
   */
  scarpaWaveMm: 0.8,
  fasciaWaveMm: 1.2,
  transversalisWaveFraction: 0.25,
  /** Transición del recto (línea media) a la pared lateral: |u| en mm (línea semilunar a 5–8 cm). */
  rectusMm: [50, 80] as const,
  /** Un plano a menos de esto (mm) de su vaina se ha fundido con ella: no dibuja cara. */
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
   * 3,2 mm (en la métrica radial, ≤ 3,8), así que ningún punto más somero puede estar dentro de una.
   */
  ribSearchMarginMm: 8,
} as const;

/**
 * Profundidad bajo la piel (mm) desde la que se buscan las costillas: más somera, ningún punto puede estar
 * dentro de una (`ribSearchMarginMm`). Así la grasa subcutánea no corta las costillas y no se paga su bucle
 * en toda la grasa.
 */
export function ribSearchDepth(t: Pick<Torso, 'a' | 'b'>, ribScale: number): number {
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
export function wallPerimeter(t: Pick<Torso, 'a' | 'b'>): number {
  const a2 = t.a * t.a;
  const b2 = t.b * t.b;
  const e = (a2 - b2) / (a2 + b2);
  return 2 * Math.PI * Math.sqrt(0.5 * (a2 + b2)) * (1 - (e * e) / 16);
}

/**
 * Número de onda (rad/mm) del armónico del perímetro más cercano a la longitud de onda λ (mm): una onda en u
 * con él es periódica en la vuelta, sin costura donde u salta de +P/2 a −P/2 (línea media posterior). Con
 * una longitud de onda cualquiera, la profundidad de las capas saltaba allí y la diferencia central del
 * gradiente de la GPU daba un eco espurio (lo halló la prueba de la salida barata de `faceGradient.test.ts`).
 */
export function wallWavenumber(lambda: number, t: Pick<Torso, 'a' | 'b'>): number {
  const P = wallPerimeter(t);
  return (2 * Math.PI * Math.floor(P / (2 * Math.PI * lambda) + 0.5)) / P;
}

/**
 * Ondulación suave de la cara k de la pared en (u, z) (mm de arco y craneocaudal), de amplitud unidad: dos
 * senos de longitudes de onda inconmensurables que crecen con k (0 y 1 los planos intermusculares, 2 Scarpa,
 * 3 la fascia profunda, 4 la transversalis), periódicos en u.
 */
export function wallWave(u: number, z: number, k: number, t: Pick<Torso, 'a' | 'b'>): number {
  return (
    0.6 * Math.sin(wallWavenumber(9 + 4 * k, t) * u + 1.3 + 2.1 * k) +
    0.4 * Math.sin(z / (13 + 3 * k) + wallWavenumber(31 + 5 * k, t) * u + 0.7 + 1.9 * k)
  );
}

export function wallDepths(t: Torso, u: number, z: number): WallDepths {
  const peritoneum = t.skinMm + t.fatMm + t.muscleMm;
  return {
    skin: t.skinMm,
    scarpa: t.skinMm + WALL.scarpaFraction * t.fatMm + WALL.scarpaWaveMm * wallWave(u, z, 2, t),
    fascia: t.skinMm + t.fatMm + WALL.fasciaWaveMm * wallWave(u, z, 3, t),
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
export function wallArc(m: Vec3, t: Pick<Torso, 'a' | 'b'>): number {
  const tau = Math.atan2(m[0] / t.a, m[1] / t.b);
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
 * `planeMinMm` de ella (`wallPlaneGap`) se ha fundido con ella y no dibuja cara.
 */
export function wallPlaneDepth(u: number, z: number, i: number, t: Torso, w: WallDepths = wallDepths(t, u, z)): number {
  const M = w.transversalis - w.fascia;
  const L = smooth(WALL.rectusMm[0], WALL.rectusMm[1], Math.abs(u));
  const wave = WALL.planeWaveMm * wallWave(u, z, i, t);
  return i === 0 ? w.fascia + WALL.planeFractions[0] * L * M + wave : w.transversalis - WALL.planeFractions[1] * L * M + wave;
}

/** Distancia (mm) del plano `i` a su vaina (la fascia profunda o la transversalis): < `planeMinMm`, fundido. */
export function wallPlaneGap(depth: number, i: number, w: WallDepths): number {
  return i === 0 ? depth - w.fascia : w.transversalis - depth;
}

/**
 * Cara que dibuja una muestra de la pared a la profundidad d (piel, grasa, músculo o grasa preperitoneal) y
 * el valor de su distancia: la capa más cercana (a igualdad, la de fuera). `ribD` es la distancia a la
 * costilla ósea más cercana (1e3 si no hay): en el tejido blando bajo la fascia profunda manda la cortical.
 */
export function wallFace(d: number, u: number, z: number, ribD: number, t: Torso): [Interface, number] {
  const w = wallDepths(t, u, z);
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
    for (let i = 0; i < 2; i++) {
      const wp = wallPlaneDepth(u, z, i, t, w);
      if (wallPlaneGap(wp, i, w) >= WALL.planeMinMm) offer(i === 0 ? Interface.ObliquePlane : Interface.TransversusPlane, Math.abs(d - wp));
    }
  } else {
    offer(Interface.Transversalis, d - w.transversalis);
    offer(Interface.Peritoneum, w.peritoneum - d);
  }
  return [face, best];
}

/**
 * Distancia con signo a la cara de pared `face` (su gradiente es la normal que usa el eco): la profundidad
 * menos la de la capa, continua (los planos intermusculares, sin el corte de su fusión: el gradiente de la
 * GPU es una diferencia central y un salto en la distancia lo dispararía). Gemelo de la GLSL.
 */
export function wallFaceSd(m: Vec3, face: Interface, t: Torso): number {
  const d = -torsoDepth(m, t);
  const u = wallArc(m, t);
  const w = wallDepths(t, u, m[2]);
  switch (face) {
    case Interface.SkinFat:
      return d - w.skin;
    case Interface.Scarpa:
      return d - w.scarpa;
    case Interface.DeepFascia:
      return d - w.fascia;
    case Interface.Transversalis:
      return d - w.transversalis;
    case Interface.Peritoneum:
      return d - w.peritoneum;
    default:
      return d - wallPlaneDepth(u, m[2], face === Interface.ObliquePlane ? 0 : 1, t, w);
  }
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
  const phi = torsoPhi(p[0], p[1], t);
  const v: Vec3 = [-rib.scale * t.a * Math.sin(phi), rib.scale * t.b * Math.cos(phi), -0.5 * rib.tilt * Math.cos(phi)];
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * Curvatura (1/mm) de la sección elíptica de la costilla (semiejes radial `halfThickness` y craneocaudal
 * `halfWidth`) en el punto del contorno en la dirección del punto: a·b/(a²sin²t + b²cos²t)^{3/2}. En la
 * cresta que mira a la piel, halfThickness/halfWidth² (0,089/mm: radio de 11 mm).
 */
export function ribCurvature(p: Vec3, rib: Rib, t: Torso): number {
  const u = p[0] / (t.a * rib.scale);
  const v = p[1] / (t.b * rib.scale);
  const rho = Math.sqrt(u * u + v * v);
  const localR = rho > 0 ? Math.hypot(p[0], p[1]) / rho : 1;
  const dRadial = (rho - 1) * localR;
  const phi = torsoPhi(p[0], p[1], t);
  const dz = p[2] - (rib.zAnterior + rib.tilt * (0.5 - 0.5 * Math.sin(phi)));
  const qx = Math.abs(dRadial) / rib.halfThickness;
  const qz = Math.abs(dz) / rib.halfWidth;
  const l = Math.hypot(qx, qz);
  const c = l > 0 ? qx / l : 1;
  const s = l > 0 ? qz / l : 0;
  const a = rib.halfThickness;
  const b = rib.halfWidth;
  return (a * b) / Math.pow(a * a * s * s + b * b * c * c, 1.5);
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
#define WALL_RECTUS_MM0 ${WALL.rectusMm[0].toFixed(4)}
#define WALL_RECTUS_MM1 ${WALL.rectusMm[1].toFixed(4)}
#define WALL_PLANE_MIN_MM ${WALL.planeMinMm.toFixed(4)}
#define WALL_RIB_PRIORITY_MM ${WALL.ribFacePriorityMm.toFixed(4)}
#define WALL_RIB_SEARCH_MARGIN_MM ${WALL.ribSearchMarginMm.toFixed(4)}
float ribSearchDepth() { return (1.0 - uRibParams.x) * min(uTorso.x, uTorso.y) - WALL_RIB_SEARCH_MARGIN_MM; }
float wallArc(vec3 m) {
  float tau = atan(m.x / uTorso.x, m.y / uTorso.y);
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
float wallWave(float u, float z, float k, float P) {
  return 0.6 * sin(wallWavenumber(9.0 + 4.0 * k, P) * u + 1.3 + 2.1 * k)
    + 0.4 * sin(z / (13.0 + 3.0 * k) + wallWavenumber(31.0 + 5.0 * k, P) * u + 0.7 + 1.9 * k);
}
// (Scarpa, fascia profunda, transversalis, peritoneo) en (u, z); la piel es uWall.x
vec4 wallDepths(float u, float z) {
  float P = wallPerimeter();
  float peritoneum = uWall.x + uWall.y + uWall.z;
  return vec4(uWall.x + WALL_SCARPA_FRACTION * uWall.y + WALL_SCARPA_WAVE_MM * wallWave(u, z, 2.0, P),
              uWall.x + uWall.y + WALL_FASCIA_WAVE_MM * wallWave(u, z, 3.0, P),
              peritoneum - uWall.w + WALL_TR_WAVE_FRACTION * (uWall.w - 1.0) * wallWave(u, z, 4.0, P),
              peritoneum);
}
// plano intermuscular i con las profundidades w = wallDepths(u, z) ya calculadas
float wallPlaneDepth(float u, float z, int i, vec4 w) {
  float M = w.z - w.y;
  float L = smoothstep(WALL_RECTUS_MM0, WALL_RECTUS_MM1, abs(u));
  float wave = WALL_PLANE_WAVE_MM * wallWave(u, z, float(i), wallPerimeter());
  return i == 0 ? w.y + WALL_PLANE_F0 * L * M + wave : w.z - WALL_PLANE_F1 * L * M + wave;
}
float wallPlaneGap(float depth, int i, vec4 w) {
  return i == 0 ? depth - w.y : w.z - depth;
}
// (cara, valor de su distancia) de una muestra de la pared a la profundidad d; ribD: costilla ósea más cercana
vec2 wallFace(float d, float u, float z, float ribD) {
  float skin = uWall.x;
  vec4 w = wallDepths(u, z);
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
    for (int i = 0; i < 2; i++) {
      float wp = wallPlaneDepth(u, z, i, w);
      if (wallPlaneGap(wp, i, w) < WALL_PLANE_MIN_MM) continue;
      float dp = abs(d - wp);
      if (dp < best) { face = float(i == 0 ? IF_OBLIQUE_PLANE : IF_TRANSVERSUS_PLANE); best = dp; }
    }
  } else {
    face = float(IF_TRANSVERSALIS);
    best = d - w.z;
    float dp = w.w - d;
    if (dp < best) { face = float(IF_PERITONEUM); best = dp; }
  }
  return vec2(face, best);
}
float wallFaceSd(vec3 m, int face) {
  float d = -torsoDepth(m);
  float u = wallArc(m);
  vec4 w = wallDepths(u, m.z);
  if (face == IF_SKIN_FAT) return d - uWall.x;
  if (face == IF_SCARPA) return d - w.x;
  if (face == IF_DEEP_FASCIA) return d - w.y;
  if (face == IF_TRANSVERSALIS) return d - w.z;
  if (face == IF_PERITONEUM) return d - w.w;
  return d - wallPlaneDepth(u, m.z, face == IF_OBLIQUE_PLANE ? 0 : 1, w);
}
float ribSd(vec3 m, int k) {
  bool cart; vec3 n;
  return sdRib(m, uRibs[k], cart, n);
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
vec3 ribTangent(vec3 p, vec4 rib) {
  float phi = atan(p.y / uTorso.y, p.x / uTorso.x);
  float sc = uRibParams.x;
  return normalize(vec3(-sc * uTorso.x * sin(phi), sc * uTorso.y * cos(phi), -0.5 * rib.y * cos(phi)));
}
float ribCurvature(vec3 p, vec4 rib) {
  float sc = uRibParams.x;
  float u = p.x / (uTorso.x * sc);
  float v = p.y / (uTorso.y * sc);
  float rho = sqrt(u * u + v * v);
  float localR = rho > 0.0 ? length(p.xy) / rho : 1.0;
  float dRadial = (rho - 1.0) * localR;
  float phi = atan(p.y / uTorso.y, p.x / uTorso.x);
  float dz = p.z - (rib.x + rib.y * (0.5 - 0.5 * sin(phi)));
  float qx = abs(dRadial) / rib.w;
  float qz = abs(dz) / rib.z;
  float l = length(vec2(qx, qz));
  float c = l > 0.0 ? qx / l : 1.0;
  float s = l > 0.0 ? qz / l : 0.0;
  return rib.w * rib.z / pow(rib.w * rib.w * s * s + rib.z * rib.z * c * c, 1.5);
}
`;
