import type { Vec3 } from '../../core/vec3';
import { abdominalAtlas, abdominalAtlasSdf } from '../abdominalAtlas';
import { sdEllipsoidLocal, smoothMax, smoothMin } from '../primitives';

/**
 * Riñón como módulo de órgano (decisión 46): contorno en judía con escotadura hiliar, cápsula,
 * seno, pelvis y pirámides con columnas de Bertin (decisión 43). La consulta TS y su gemelo GLSL
 * viven aquí con el mismo nombre; las tablas del shader (pirámides, pelvis, escotadura, cápsula)
 * se generan desde las constantes TS. El shader usa `uKidC/U/V/W/R`, `uKidSinus` y `uKidExtra`
 * del esquema único de uniforms.
 */

/**
 * Riñón implícito en un marco ortonormal propio: u = eje largo (hacia el polo
 * superior), v = hacia el hilio (medial), w = anterior. Elipsoide externo,
 * seno renal (elipsoide desplazado hacia el hilio + canal del hilio), pirámides
 * medulares en cuña alrededor del seno y columnas de Bertin entre ellas.
 * Dimensiones de un adulto (B.5): 110 × 55 × 45 mm, seno ≈ 60 × 22 mm
 * [EXTRAPOLACIÓN PROPIA para la disposición de las pirámides].
 */
export interface Kidney {
  kind: 'kidney';
  center: Vec3;
  radii: Vec3;
  u: Vec3;
  v: Vec3;
  w: Vec3;
  sinusRadii: Vec3;
  /** Desplazamiento del seno hacia el hilio a lo largo de v (mm). */
  sinusOffset: number;
  hilumRadius: number;
}

/** `arcuate`: los vasos arcuatos del borde de la base de cada pirámide (decisión 87). */
export type KidneyRegion = 'cortex' | 'medulla' | 'sinus' | 'pelvis' | 'arcuate';

export interface KidneyHit {
  /** Distancia con signo al contorno externo (mm, negativa dentro). */
  dOuter: number;
  /** Distancia con signo al seno (negativa dentro del seno); +∞ fuera del riñón (`dOuter ≥ 0`), donde no se evalúa. */
  dSinus: number;
  /** Fuera del riñón, `cortex` (no se evalúa). */
  region: KidneyRegion;
  /** Distancia a la interfaz más cercana dentro del riñón (mm); fuera, −dOuter. */
  inner: number;
}

/** Coordenadas locales (u, v, w) de un punto respecto al riñón. */
export function kidneyLocal(p: Vec3, k: Kidney): Vec3 {
  const d: Vec3 = [p[0] - k.center[0], p[1] - k.center[1], p[2] - k.center[2]];
  return [
    d[0] * k.u[0] + d[1] * k.u[1] + d[2] * k.u[2],
    d[0] * k.v[0] + d[1] * k.v[1] + d[2] * k.v[2],
    d[0] * k.w[0] + d[1] * k.w[1] + d[2] * k.w[2],
  ];
}

/** Punto del mundo a partir de coordenadas locales del riñón. */
export function kidneyWorld(q: Vec3, k: Kidney): Vec3 {
  return [
    k.center[0] + q[0] * k.u[0] + q[1] * k.v[0] + q[2] * k.w[0],
    k.center[1] + q[0] * k.u[1] + q[1] * k.v[1] + q[2] * k.w[1],
    k.center[2] + q[0] * k.u[2] + q[1] * k.v[2] + q[2] * k.w[2],
  ];
}

/** Semiejes del riñón adulto de referencia (mm) y del seno con su desplazamiento hacia el hilio: los dos riñones los
 * comparten, y las tablas del shader (pirámides, dedos del seno) salen de ellos. */
export const KIDNEY_RADII: Vec3 = [54, 27, 23];
export const KIDNEY_SINUS = { radii: [30, 12, 8] as Vec3, offsetV: 4 };
/**
 * Profundidad bajo la cápsula del centro de la base de cada pirámide, por su eje (mm): corteza de 7–8 mm y parénquima de
 * 15–16 (revisión 25-09). El casquete redondeado de la base, que llegaba a 3 mm de la cápsula, lo corta la unión
 * corticomedular (`MEDULLA_MIN_DEPTH_MM`).
 */
export const RENAL_CORTEX_MM = 7.5;

/** Pirámide medular (decisión 68): cono redondeado con la papila (vértice) hacia el seno y la base hacia la corteza. */
export interface RenalPyramid {
  apex: Vec3;
  base: Vec3;
  apexR: number;
  baseR: number;
}

/**
 * Pirámides medulares (decisión 68): conos redondeados que irradian del seno a la corteza, de tamaño y orientación
 * algo distintos (un riñón adulto muestra 6–8 en un corte; no son triángulos idénticos ni equidistantes). La fila
 * lateral deja libres las columnas de Bertin de las interlobares (`BERTIN_COLUMNS_U`, a intervalos desiguales). (θ, u) es la posición en la
 * superficie del seno: θ alrededor del eje largo (0 hacia el hilio, π lateral, π/2 anterior); `baseR`, el radio de
 * la base. Antes eran 16 cuñas finas que se veían como rayas oscuras verticales. Decisión 87: bases de 5,6–8,9 mm de
 * radio (antes 5,2–7,4) y la papila a 2 mm del seno: conos con la base hacia la corteza y el vértice hacia el seno, de
 * 8,9–10,7 mm de la papila a la base en la fila lateral, 8,6–9,0 en las oblicuas y 16 en los polos (compuestas, se funden
 * con la última lateral); las de las filas anterior y posterior, con 15 mm de parénquima, miden 5,8–7 mm y siguen siendo
 * más anchas que altas. Entre dos pirámides vecinas queda una columna de corteza de ≥ 2 mm.
 */
const PYRAMID_SPECS: ReadonlyArray<{ theta: number; u: number; baseR: number }> = [
  { theta: Math.PI + 0.05, u: -39, baseR: 8.2 },
  { theta: Math.PI - 0.04, u: -15, baseR: 8.9 },
  { theta: Math.PI + 0.03, u: 10, baseR: 7.7 },
  { theta: Math.PI - 0.06, u: 37, baseR: 8.4 },
  { theta: Math.PI / 2 + 0.1, u: -25, baseR: 7.2 },
  { theta: Math.PI / 2 - 0.05, u: 1, baseR: 7.9 },
  { theta: Math.PI / 2 + 0.02, u: 26, baseR: 6.7 },
  { theta: (3 * Math.PI) / 2 - 0.08, u: -24, baseR: 7.4 },
  { theta: (3 * Math.PI) / 2 + 0.04, u: -1, baseR: 8.2 },
  { theta: (3 * Math.PI) / 2 - 0.02, u: 25, baseR: 6.4 },
  { theta: (3 * Math.PI) / 4, u: -2, baseR: 6.5 },
  { theta: (5 * Math.PI) / 4, u: 20, baseR: 5.6 },
];

/**
 * La papila empieza a esta distancia de la superficie del seno (mm): el cáliz menor (un dedo del seno) le hace de copa. Con 3
 * mm y un dedo de 3,5 mm de radio que pasaba 4 mm de la papila, el cáliz se comía la mitad de la pirámide, que quedaba como
 * una banda de ~5 mm de alto bajo la corteza y no como un cono (decisión 87).
 */
const PAPILLA_OFFSET_MM = 2;

function buildPyramids(): RenalPyramid[] {
  const [ru, rv, rw] = KIDNEY_RADII;
  const [su, sv, sw] = KIDNEY_SINUS.radii;
  const out: RenalPyramid[] = [];
  const cone = (s: Vec3, o: Vec3, baseR: number) => {
    const d: Vec3 = [o[0] - s[0], o[1] - s[1], o[2] - s[2]];
    const l = Math.hypot(d[0], d[1], d[2]);
    const n: Vec3 = [d[0] / l, d[1] / l, d[2] / l];
    const apex: Vec3 = [s[0] + n[0] * PAPILLA_OFFSET_MM, s[1] + n[1] * PAPILLA_OFFSET_MM, s[2] + n[2] * PAPILLA_OFFSET_MM];
    const base: Vec3 = [o[0] - n[0] * RENAL_CORTEX_MM, o[1] - n[1] * RENAL_CORTEX_MM, o[2] - n[2] * RENAL_CORTEX_MM];
    out.push({ apex, base, apexR: 1.5, baseR });
  };
  for (const p of PYRAMID_SPECS) {
    const fs = Math.sqrt(Math.max(0, 1 - (p.u / su) ** 2));
    const s: Vec3 = [p.u, KIDNEY_SINUS.offsetV + sv * fs * Math.cos(p.theta), sw * fs * Math.sin(p.theta)];
    const uo = p.u * 1.25;
    const fo = Math.sqrt(Math.max(0, 1 - (uo / ru) ** 2));
    cone(s, [uo, rv * fo * Math.cos(p.theta), rw * fo * Math.sin(p.theta)], p.baseR);
  }
  // pirámides compuestas de los polos, hacia ±u
  cone([su * 0.97, KIDNEY_SINUS.offsetV, 0], [ru, -2, 0], 8.6);
  cone([-su * 0.97, KIDNEY_SINUS.offsetV, 0], [-ru, -2, 1], 8.2);
  return out;
}

export const PYRAMIDS: readonly RenalPyramid[] = buildPyramids();

/**
 * Factor de las cotas que salen de los conos de las pirámides (decisión 87, revisión adversarial): la seudodistancia de
 * `sdRoundCone` sobrestima la real hasta √(1 + pendiente²) en el flanco del cono (1,52 en las pirámides anteriores y
 * posteriores, más anchas que altas); `inner` la multiplica por su inversa, redondeada hacia abajo a cuatro decimales (el
 * mismo número en la GLSL), para que siga siendo una cota inferior.
 */
export const PYRAMID_BD =
  Math.floor(
    1e4 /
      Math.max(
        ...PYRAMIDS.map((p) =>
          Math.hypot(1, (p.baseR - p.apexR) / Math.hypot(p.base[0] - p.apex[0], p.base[1] - p.apex[1], p.base[2] - p.apex[2])),
        ),
      ),
  ) / 1e4;

/**
 * Grasa perirrenal (decisión 68): grosor variable, fina (≈ 1 mm) en la cara anterolateral que apoya en el hígado
 * (Morison) y gruesa detrás, hacia el hilio y en los polos (hasta 9 mm). Antes era una capa de 4 mm constante cuyas
 * dos caras dibujaban una doble línea concéntrica perfecta alrededor del riñón. Donde es fina (≤ `faceMaxMm`) toda ella
 * dibuja la cara de la cápsula renal: sus dos caras, a 1–2,5 mm, se ven como una sola línea (decisión 81; antes su mitad
 * externa dibujaba la suya y salían dos líneas paralelas). Donde es gruesa, su cara externa solo se dibuja donde apoya
 * el hígado (Morison, a ≤ `MORISON_CONTACT_MM`: la cápsula hepática le cede la cara); si no (detrás, hacia el hilio, en
 * los polos) se confunde con la grasa retroperitoneal sin línea, como en un equipo.
 */
export const PERIRENAL = { minMm: 1, maxMm: 9, faceMaxMm: 2.5 } as const;

/**
 * Rampa suave (C2): 0 por debajo de −w, x por encima de w y entre ambos 2w·(t³ − t⁴/2) con t = (x + w)/2w, que empalma
 * valor, pendiente y curvatura en los dos extremos (sin aristas en la superficie ni saltos de curvatura que las
 * diferencias centrales de las normales convertirían en error).
 */
export function softRamp(x: number, w: number): number {
  if (x <= -w) return 0;
  if (x >= w) return x;
  const t = (x + w) / (2 * w);
  return 2 * w * t * t * t * (1 - 0.5 * t);
}

/** Ancho de las rampas suaves del grosor perirrenal (en unidades de la dirección normalizada). */
const PERIRENAL_SOFT = 0.15;

/**
 * Grosor de la grasa perirrenal (mm) en la dirección del punto local q del riñón k: suave (C1) en la dirección, para que
 * la impresión renal del hígado, que la sigue, no tenga aristas. Fina delante: en el riñón derecho +w es anterior, y el
 * izquierdo es especular (su w apunta hacia atrás, `k.w·ŷ < 0`), así que allí la anterior es −w (antes se leía +w en
 * los dos y el izquierdo tenía la grasa gruesa delante, 8,2 mm, y fina detrás, 1,2).
 */
export function perirenalThicknessMm(q: Vec3, k: Kidney): number {
  const r = k.radii;
  const nu = q[0] / r[0];
  const nv = q[1] / r[1];
  const nw = (k.w[1] < 0 ? -q[2] : q[2]) / r[2];
  const l = Math.sqrt(nu * nu + nv * nv + nw * nw);
  const s = l > 0 ? 1 / l : 0;
  const w = PERIRENAL_SOFT;
  const a = 0.8 * softRamp(-nw * s, w) + 0.5 * softRamp(nv * s, w) + 2 * softRamp(Math.sqrt(nu * nu * s * s + w * w * 0.01) - 0.6, w * 0.5);
  const kc = 1 - softRamp(1 - softRamp(a, w), w);
  return PERIRENAL.minMm + (PERIRENAL.maxMm - PERIRENAL.minMm) * kc;
}

/** Distancia con signo a la cara externa de la grasa perirrenal (marco local): el contorno menos el grosor local. */
export function perirenalOuterSdf(q: Vec3, k: Kidney): number {
  let d = kidneyOuterSdf(q, k) - perirenalThicknessMm(q, k);
  if (abdominalAtlas && d < 2) {
    const p = kidneyWorld(q, k);
    // The fat compartment conforms to neighboring viscera in the shared physical field.
    for (const field of [0, 1, 2, 3, 4, 7, 8, 9, 10]) d = Math.max(d, -abdominalAtlasSdf(p, field));
  }
  return d;
}

/**
 * Solape de la impresión renal del hígado sobre la grasa perirrenal (mm): el redondeo de la impresión apartaba la
 * cápsula hepática hasta ~0,3 mm de una grasa fina y quedaba un hueco de «intestino»; la grasa, que se clasifica
 * antes, gana en el solape.
 */
export const RENAL_IMPRESSION_OVERLAP_MM = 1;

/** Distancia con signo a un cono redondeado (radio interpolado a lo largo del eje), marco local. */
export function sdRoundCone(q: Vec3, a: Vec3, b: Vec3, ra: number, rb: number): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const apx = q[0] - a[0];
  const apy = q[1] - a[1];
  const apz = q[2] - a[2];
  const len2 = abx * abx + aby * aby + abz * abz;
  let s = (apx * abx + apy * aby + apz * abz) / len2;
  s = s < 0 ? 0 : s > 1 ? 1 : s;
  const dx = apx - abx * s;
  const dy = apy - aby * s;
  const dz = apz - abz * s;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - (ra + (rb - ra) * s);
}

/**
 * Dedos del seno hacia cada papila (infundíbulo y cáliz menor envueltos en grasa): borde digitado, no un óvalo liso. El
 * dedo llega a 1 mm de la papila y su punta redondeada la ahueca 1,2 mm (decisión 87: antes, con 3,5 mm de radio y 4 mm
 * más allá de la papila, se comía la punta de la pirámide).
 */
export const SINUS_FINGER = { backMm: 3, reachMm: 1, radiusMm: 2.2, blendMm: 2.5 } as const;

/** Columnas de Bertin del plano coronal lateral (entre las pirámides laterales, a intervalos desiguales): posiciones u. */
export const BERTIN_COLUMNS_U = [-27, -2.5, 23.5] as const;
/**
 * Pelvis renal colapsada (decisión 68): en el riñón normal el sistema colector no se ve o apenas es una hendidura; una
 * lámina de orina de 2,4 mm entre las caras anterior y posterior del seno, hacia el hilio (antes 18 × 7 × 5 mm, una
 * barra negra recortada). Marco local del seno, mm.
 */
export const RENAL_PELVIS = { offsetV: 3, radii: [7, 3, 1.2] as Vec3 };
/** Cápsula renal fibrosa (mm), línea ecogénica en la superficie. */
export const RENAL_CAPSULE_MM = 0.6;
/** Escotadura hiliar: elipsoide restado en la cara medial (marco local, mm). */
export const HILUM_NOTCH = { offsetV: 6, radii: [24, 16, 13] as Vec3, roundMm: 6 };

/** Contorno externo del riñón: elipsoide con escotadura hiliar (forma de judía). */
export function kidneyOuterSdf(q: Vec3, k: Kidney): number {
  if (abdominalAtlas) return abdominalAtlasSdf(kidneyWorld(q, k), k.center[0] < 0 ? 5 : 6);
  const ell = sdEllipsoidLocal(q, k.radii);
  const notch = sdEllipsoidLocal([q[0], q[1] - (k.radii[1] + HILUM_NOTCH.offsetV), q[2]], HILUM_NOTCH.radii);
  return smoothMax(ell, -notch, HILUM_NOTCH.roundMm);
}

/**
 * ¿Pesa la escotadura hiliar en `kidneyOuterSdf` en q (marco local)? Fuera del redondeo de `smoothMax`
 * (el elipsoide supera a la escotadura en `roundMm` o más) el contorno es el elipsoide exacto y su
 * gradiente es la normal del elipsoide que usa la GPU; dentro, no. Solo pruebas (e2e de normales).
 */
export function hilumNotchActive(q: Vec3, k: Kidney): boolean {
  const ell = sdEllipsoidLocal(q, k.radii);
  const notch = sdEllipsoidLocal([q[0], q[1] - (k.radii[1] + HILUM_NOTCH.offsetV), q[2]], HILUM_NOTCH.radii);
  return ell + notch < HILUM_NOTCH.roundMm;
}

/** Extremos de los dedos del seno (cálices) hacia cada papila: del seno hacia fuera por el eje de la pirámide. */
export const SINUS_FINGERS: ReadonlyArray<{ a: Vec3; b: Vec3 }> = PYRAMIDS.map((p) => {
  const d: Vec3 = [p.base[0] - p.apex[0], p.base[1] - p.apex[1], p.base[2] - p.apex[2]];
  const l = Math.hypot(d[0], d[1], d[2]);
  const n: Vec3 = [d[0] / l, d[1] / l, d[2] / l];
  // superficie del seno: la papila empieza PAPILLA_OFFSET_MM fuera de ella
  const s0 = -PAPILLA_OFFSET_MM - SINUS_FINGER.backMm;
  const s1 = -PAPILLA_OFFSET_MM + SINUS_FINGER.reachMm;
  return {
    a: [p.apex[0] + n[0] * s0, p.apex[1] + n[1] * s0, p.apex[2] + n[2] * s0],
    b: [p.apex[0] + n[0] * s1, p.apex[1] + n[1] * s1, p.apex[2] + n[2] * s1],
  };
});

/**
 * Distancia con signo al canal del hilio (marco local): la cápsula desde el centro del seno hasta la cara medial (+v). Es
 * la parte del seno que llega al contorno: allí la grasa del seno sigue en la perirrenal sin cápsula (decisión 87).
 */
export function hilumChannelSdf(q: Vec3, k: Kidney): number {
  const t = Math.min(Math.max(q[1] - k.sinusOffset, 0), k.radii[1]);
  return Math.hypot(q[0], q[1] - k.sinusOffset - t, q[2]) - k.hilumRadius;
}

/** Distancia con signo al seno (elipsoide + canal del hilio + dedos hacia las papilas), marco local. */
export function kidneySinusSdf(q: Vec3, k: Kidney): number {
  const qs: Vec3 = [q[0], q[1] - k.sinusOffset, q[2]];
  let d = Math.min(sdEllipsoidLocal(qs, k.sinusRadii), hilumChannelSdf(q, k));
  for (const f of SINUS_FINGERS)
    d = smoothMin(d, sdRoundCone(q, f.a, f.b, SINUS_FINGER.radiusMm, SINUS_FINGER.radiusMm), SINUS_FINGER.blendMm);
  return d;
}

/**
 * Unión corticomedular (mm bajo la cápsula): la médula empieza a esta profundidad. Corta el casquete de la base de cada
 * pirámide (su centro está a `RENAL_CORTEX_MM`) en una base ancha que sigue al contorno, como la línea arcuata: la
 * corteza mide ≥ 7 mm sobre toda pirámide. Con 3 mm, el casquete (de radio `baseR`, entonces 5,2–7,4 mm) llegaba a 3 mm
 * de la cápsula: 3,9 mm de corteza en la mediana (revisión adversarial de la decisión 68).
 */
export const MEDULLA_MIN_DEPTH_MM = 7;

/**
 * Vasos arcuatos (decisión 87): las arterias y venas arcuatas corren por la unión corticomedular sobre la base de cada
 * pirámide, donde acaban las interlobares de las columnas de Bertin, y a 3,5 MHz se ven como ecos brillantes en la base de
 * las pirámides (Emamian 1993; Radiopaedia; revisión 25-09). Son un anillo en el borde de la base: a ≤ `halfMm` de la unión
 * (`MEDULLA_MIN_DEPTH_MM`) y a ≤ `rimMm` dentro del cono, que se clasifica como pared arterial, sin luz ni flujo
 * [EXTRAPOLACIÓN PROPIA: sección del anillo; limitación `arcuate-no-lumen`]. En el corte que pasa por el eje de una pirámide,
 * dos focos en las esquinas de su base; en uno oblicuo, un arco corto.
 */
export const ARCUATE = { halfMm: 0.6, rimMm: 2.5 } as const;

/**
 * Regiones del riñón en p. Fuera de él (`dOuter ≥ 0`) no se evalúan el seno ni las pirámides: `dSinus` = +∞. `inner` acota
 * por debajo la distancia a la región vecina, el anillo de los arcuatos incluido: las distancias de los conos van por
 * `PYRAMID_BD`. La cápsula (los primeros `RENAL_CAPSULE_MM`) la resta quien clasifica.
 */
export function kidneyQuery(p: Vec3, k: Kidney): KidneyHit {
  const q = kidneyLocal(p, k);
  const dOuter = kidneyOuterSdf(q, k);
  // fuera no hay regiones: la grasa perirrenal y su entorno (a < 65 mm del centro) no pagan los 14 dedos del seno
  if (dOuter >= 0) return { dOuter, dSinus: Infinity, region: 'cortex', inner: -dOuter };
  const dSinus = kidneySinusSdf(q, k);
  if (dSinus < 0) {
    // Pelvis: hendidura de orina colapsada en el seno, hacia el hilio
    const qs: Vec3 = [q[0], q[1] - k.sinusOffset, q[2]];
    const dPelvis = sdEllipsoidLocal([qs[0], qs[1] - RENAL_PELVIS.offsetV, qs[2]], RENAL_PELVIS.radii);
    if (dPelvis < 0) return { dOuter, dSinus, region: 'pelvis', inner: Math.min(-dPelvis, -dOuter) };
    return { dOuter, dSinus, region: 'sinus', inner: Math.min(-dSinus, -dOuter, dPelvis) };
  }
  // Pirámides (conos redondeados de la papila a la base, bajo la corteza) y el anillo de los arcuatos en el borde de su base
  const depth = -dOuter - MEDULLA_MIN_DEPTH_MM;
  const A = ARCUATE;
  if (depth > -A.halfMm) {
    let dMed = 1e3;
    for (const pyr of PYRAMIDS) dMed = Math.min(dMed, sdRoundCone(q, pyr.apex, pyr.base, pyr.apexR, pyr.baseR));
    const g = PYRAMID_BD;
    if (dMed >= 0) return { dOuter, dSinus, region: 'cortex', inner: Math.min(-dOuter, dSinus, dMed * g) };
    // dentro del cono: el anillo (lejos de la unión menos de halfMm y del borde menos de rimMm), la médula bajo la unión o
    // la corteza sobre el centro de la base; `toRing` acota la distancia al anillo desde fuera de él
    const ringDepth = A.halfMm - Math.abs(depth);
    const ringRim = A.rimMm + dMed;
    if (ringDepth > 0 && ringRim > 0)
      return { dOuter, dSinus, region: 'arcuate', inner: Math.min(ringDepth, ringRim * g, -dMed * g, dSinus) };
    const toRing = Math.max(-ringDepth, -ringRim * g);
    if (depth > 0) return { dOuter, dSinus, region: 'medulla', inner: Math.min(-dMed * g, dSinus, depth, toRing) };
    return { dOuter, dSinus, region: 'cortex', inner: Math.min(-dOuter, dSinus, -depth, toRing) };
  }
  return { dOuter, dSinus, region: 'cortex', inner: Math.min(-dOuter, dSinus, -depth - A.halfMm) };
}

const f4 = (v: number) => v.toFixed(4);
const vec3s = (v: Vec3) => `vec3(${f4(v[0])}, ${f4(v[1])}, ${f4(v[2])})`;
const PYRAMID_TABLE = `#define N_PYR ${PYRAMIDS.length}
const vec4 PYRA[N_PYR] = vec4[N_PYR](${PYRAMIDS.map((p) => `vec4(${vec3s(p.apex)}, ${f4(p.apexR)})`).join(', ')});
const vec4 PYRB[N_PYR] = vec4[N_PYR](${PYRAMIDS.map((p) => `vec4(${vec3s(p.base)}, ${f4(p.baseR)})`).join(', ')});
const vec3 FINGA[N_PYR] = vec3[N_PYR](${SINUS_FINGERS.map((f) => vec3s(f.a)).join(', ')});
const vec3 FINGB[N_PYR] = vec3[N_PYR](${SINUS_FINGERS.map((f) => vec3s(f.b)).join(', ')});
const vec4 FINGER = vec4(${f4(SINUS_FINGER.radiusMm)}, ${f4(SINUS_FINGER.blendMm)}, ${f4(MEDULLA_MIN_DEPTH_MM)}, 0.0);
const vec3 ARC = vec3(${f4(ARCUATE.halfMm)}, ${f4(ARCUATE.rimMm)}, ${f4(PYRAMID_BD)});
const vec3 PERI = vec3(${f4(PERIRENAL.minMm)}, ${f4(PERIRENAL.maxMm)}, ${f4(PERIRENAL.faceMaxMm)});
const float PERI_SOFT = ${f4(PERIRENAL_SOFT)};`;
const PELVIS = `const vec4 PELVIS = vec4(${RENAL_PELVIS.radii[0].toFixed(1)}, ${RENAL_PELVIS.radii[1].toFixed(1)}, ${RENAL_PELVIS.radii[2].toFixed(1)}, ${RENAL_PELVIS.offsetV.toFixed(1)}); const float RENAL_CAPSULE_MM = ${RENAL_CAPSULE_MM.toFixed(2)};`;
const NOTCH = `const vec4 NOTCH = vec4(${HILUM_NOTCH.radii[0].toFixed(1)}, ${HILUM_NOTCH.radii[1].toFixed(1)}, ${HILUM_NOTCH.radii[2].toFixed(1)}, ${HILUM_NOTCH.offsetV.toFixed(1)}); const float NOTCH_ROUND = ${HILUM_NOTCH.roundMm.toFixed(1)};`;

/** Gemelo GLSL: `kidneyQuery` devuelve la región (0 corteza, 1 médula, 2 seno, 3 pelvis, 4 arcuatos). */
export const KIDNEY_GLSL = /* glsl */ `
vec3 kidneyLocal(vec3 p, int k) {
  vec3 d = p - uKidC[k];
  return vec3(dot(d, uKidU[k]), dot(d, uKidV[k]), dot(d, uKidW[k]));
}

${PYRAMID_TABLE}
${PELVIS}
${NOTCH}

// Contorno externo: elipsoide con escotadura hiliar (forma de judía)
float kidneyOuterSdf(vec3 q, vec3 r) {
  float ell = sdEllipsoidLocal(q, r);
  float notch = sdEllipsoidLocal(vec3(q.x, q.y - (r.y + NOTCH.w), q.z), NOTCH.xyz);
  return smoothMax(ell, -notch, NOTCH_ROUND);
}

// Distancia externa del riñón k y normal en el mundo (solo GPU: la clasificación TS no usa normales)
float kidneyOuter(vec3 p, int k, out vec3 n) {
  if(uAbdominalAtlasEnabled!=0){n=abdominalAtlasGradient(p,k+5);return abdominalAtlasSdf(p,k+5);}
  vec3 q = kidneyLocal(p, k);
  vec3 r = uKidR[k];
  vec3 nl = normalize(q / (r * r) + vec3(1e-6));
  n = normalize(uKidU[k] * nl.x + uKidV[k] * nl.y + uKidW[k] * nl.z);
  return kidneyOuterSdf(q, r);
}

float sdRoundCone(vec3 q, vec3 a, vec3 b, float ra, float rb) {
  vec3 ab = b - a;
  vec3 ap = q - a;
  float s = clamp(dot(ap, ab) / dot(ab, ab), 0.0, 1.0);
  return length(ap - ab * s) - (ra + (rb - ra) * s);
}

float softRamp(float x, float w) {
  if (x <= -w) return 0.0;
  if (x >= w) return x;
  float t = (x + w) / (2.0 * w);
  return 2.0 * w * t * t * t * (1.0 - 0.5 * t);
}

// Grosor de la grasa perirrenal del riñón k (decisión 68): fina anterolateral (Morison), gruesa detrás, al hilio y en los
// polos; suave (C1) para que la impresión renal del hígado no tenga aristas. El riñón izquierdo es especular: su anterior es −w
float perirenalThicknessMm(vec3 q, int k) {
  vec3 n = vec3(q.x, q.y, uKidW[k].y < 0.0 ? -q.z : q.z) / uKidR[k];
  float l = length(n);
  float s = l > 0.0 ? 1.0 / l : 0.0;
  float w = PERI_SOFT;
  float a = 0.8 * softRamp(-n.z * s, w) + 0.5 * softRamp(n.y * s, w) + 2.0 * softRamp(sqrt(n.x * n.x * s * s + w * w * 0.01) - 0.6, w * 0.5);
  float kc = 1.0 - softRamp(1.0 - softRamp(a, w), w);
  return PERI.x + (PERI.y - PERI.x) * kc;
}

// Cara externa de la grasa perirrenal del riñón k (marco local)
float perirenalOuterSdf(vec3 q, int k) {
  if(uAbdominalAtlasEnabled!=0){
    vec3 p=uKidC[k]+uKidU[k]*q.x+uKidV[k]*q.y+uKidW[k]*q.z;
    float d=abdominalAtlasSdf(p,k+5)-perirenalThicknessMm(q,k);
    if(d<2.0){for(int field=0;field<11;field++){if(field==5||field==6)continue;d=max(d,-abdominalAtlasSdf(p,field));}}
    return d;
  }
  return kidneyOuterSdf(q, uKidR[k]) - perirenalThicknessMm(q, k);
}

// Canal del hilio: cápsula desde el centro del seno hasta la cara medial (+v)
float hilumChannelSdf(vec3 q, int k) {
  float t = clamp(q.y - uKidSinus[k].w, 0.0, uKidR[k].y);
  return length(vec3(q.x, q.y - uKidSinus[k].w - t, q.z)) - uKidExtra.x;
}

// Seno: elipsoide + canal del hilio + dedos hacia las papilas (cálices)
float kidneySinusSdf(vec3 q, int k) {
  vec4 sn = uKidSinus[k];
  float d = min(sdEllipsoidLocal(vec3(q.x, q.y - sn.w, q.z), sn.xyz), hilumChannelSdf(q, k));
  for (int i = 0; i < N_PYR; i++) d = smoothMin(d, sdRoundCone(q, FINGA[i], FINGB[i], FINGER.x, FINGER.x), FINGER.y);
  return d;
}

// Región interna: 0 corteza, 1 médula, 2 seno, 3 pelvis, 4 arcuatos (decisión 87); devuelve la distancia interna mínima
int kidneyQuery(vec3 p, int k, out float inner, out float dOuter) {
  vec3 q = kidneyLocal(p, k);
  dOuter = uAbdominalAtlasEnabled!=0?abdominalAtlasSdf(p,k+5):kidneyOuterSdf(q, uKidR[k]);
  if (dOuter >= 0.0) { inner = -dOuter; return 0; }
  float dSinus = kidneySinusSdf(q, k);
  if (dSinus < 0.0) {
    vec4 sn = uKidSinus[k];
    float dPelvis = sdEllipsoidLocal(vec3(q.x, q.y - sn.w - PELVIS.w, q.z), PELVIS.xyz);
    if (dPelvis < 0.0) { inner = min(-dPelvis, -dOuter); return 3; }
    inner = min(min(-dSinus, -dOuter), dPelvis); return 2;
  }
  float depth = -dOuter - FINGER.z;
  if (depth > -ARC.x) {
    float dMed = 1e3;
    for (int i = 0; i < N_PYR; i++) dMed = min(dMed, sdRoundCone(q, PYRA[i].xyz, PYRB[i].xyz, PYRA[i].w, PYRB[i].w));
    if (dMed >= 0.0) { inner = min(min(-dOuter, dSinus), dMed * ARC.z); return 0; }
    // anillo de los arcuatos en el borde de la base, médula bajo la unión o corteza sobre el centro de la base (las
    // distancias de los conos, por PYRAMID_BD)
    float ringDepth = ARC.x - abs(depth);
    float ringRim = ARC.y + dMed;
    if (ringDepth > 0.0 && ringRim > 0.0) { inner = min(min(ringDepth, ringRim * ARC.z), min(-dMed * ARC.z, dSinus)); return 4; }
    float toRing = max(-ringDepth, -ringRim * ARC.z);
    if (depth > 0.0) { inner = min(min(-dMed * ARC.z, dSinus), min(depth, toRing)); return 1; }
    inner = min(min(-dOuter, dSinus), min(-depth, toRing)); return 0;
  }
  inner = min(min(-dOuter, dSinus), -depth - ARC.x);
  return 0;
}
`;
