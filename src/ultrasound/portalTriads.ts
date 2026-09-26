import type { Vec3 } from '../core/vec3';

/**
 * Tríadas portales finas (decisión 78): el parénquima hepático de un equipo real no es un moteado uniforme. Las ramas
 * portales de menos de 2 mm, con su vaina fibrosa de Glisson (vena porta, arteria y conducto biliar), salen como
 * puntos y trazos brillantes, a menudo con una luz diminuta, repartidos por todo el hígado y orientados hacia el hilio.
 * El árbol de tubos (`vesselTree.ts`) llega hasta las ramas de 4.º orden (~1 mm de radio) con el tope de `MAX_TUBES`;
 * por debajo, el hígado del simulador era un moteado sin estructura (la ronda 2 del juez ciego lo señaló: «textura del
 * hígado demasiado homogénea», frente a las referencias con focos ecogénicos).
 *
 * Modelo: una tríada como mucho por célula de `cellMm` (probabilidad `presence`), con su centro en cualquier punto de la
 * célula, un segmento de semilongitud `halfLengthMm` orientado del hilio hacia fuera con un giro aleatorio
 * (`directionJitter`), una vaina de radio `radiusMm` que multiplica la amplitud de retrodispersión del hígado por una
 * ganancia de `sheathGain` (distinta en cada tríada) y una luz (fracción `lumenFraction` del radio) con la sangre
 * (`lumenGain`). Cada tríada cabe en media célula alrededor de su centro, así que en cada punto bastan las 8 células
 * más cercanas (dos por eje). Solo en el hígado (el factor multiplica la retrodispersión de `T_LIVER` en `fieldFor`); en
 * cada plano de elevación, así que el grosor de corte las funde como a los vasos.
 *
 * Los parámetros de cada célula salen de un hash ENTERO (PCG3D, Jarzynski y Olano 2020) de sus índices, con sales
 * fijas: el mismo resultado bit a bit en TS (`Math.imul`) y en GLSL (`uvec3`), en cualquier GPU, y la anatomía del
 * paciente no depende de la semilla del moteado. Con el hash de coma flotante del moteado (primera versión, revisión
 * adversarial) el gemelo y la GPU daban otras tríadas en el 67 % de los puntos junto a una, y dos GPU conformes
 * (con y sin FMA) discrepaban en el 11 %.
 *
 * [ESTIMADO: densidad, tamaño y brillo, calibrados con capturas de GPU frente a las referencias reales de la revisión
 * (el hígado del Toshiba Aplio y el de Morison: 0,2–0,3 focos por cm²) y con la pared periportal de los tubos
 * (retrodispersión 2,6).] Gemelos: `portalTriadGain` (TS: el gemelo de la pared) y `PORTAL_TRIADS_GLSL` (pasada B).
 */
export const PORTAL_TRIADS = {
  /** Célula (mm): una tríada como mucho por célula. */
  cellMm: 12,
  /** Probabilidad de que una célula tenga tríada. */
  presence: 0.7,
  /** Semilongitud del segmento (mm). */
  halfLengthMm: [1.5, 4.5] as const,
  /** Radio exterior de la vaina (mm). */
  radiusMm: [0.5, 1.2] as const,
  /** Radio de la luz sobre el de la vaina (0: tríada maciza; una luz por debajo de `edgeMm` no se dibuja). */
  lumenFraction: [0, 0.6] as const,
  /** Amplitud de retrodispersión de la vaina (de una tríada a otra, entre estos dos) sobre la del hígado. */
  sheathGain: [4, 9] as const,
  /** Amplitud de la luz (sangre) sobre la del hígado. */
  lumenGain: 0.05,
  /** Peso del giro aleatorio de la dirección frente a la radial desde el hilio. */
  directionJitter: 0.7,
  /** Hilio hepático (material, mm): la bifurcación portal de `vesselTree.ts` (pvTrunk → pvRight / pvLeft). */
  hilum: [-34, 0, -45] as const,
  /** Suavizado del borde de la vaina y de la luz (mm). */
  edgeMm: 0.12,
  /** Desplazamiento de los índices de célula para el hash sin signo (cubre ±49 m con células de 12 mm). */
  cellOffset: 4096,
  /** Sal entera del hash (anatomía, no moteado): se suma a la z de cada una de las 4 llamadas, ×1, ×2, ×3, ×4. */
  salt: 0x9e3779b9,
} as const;

/** PCG3D de Jarzynski y Olano (2020): un hash de 3 × 32 bits sin signo; gemelo exacto de `triadPcg` (GLSL). */
export function pcg3d(x: number, y: number, z: number): [number, number, number] {
  x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
  y = (Math.imul(y, 1664525) + 1013904223) >>> 0;
  z = (Math.imul(z, 1664525) + 1013904223) >>> 0;
  x = (x + Math.imul(y, z)) >>> 0;
  y = (y + Math.imul(z, x)) >>> 0;
  z = (z + Math.imul(x, y)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  y = (y ^ (y >>> 16)) >>> 0;
  z = (z ^ (z >>> 16)) >>> 0;
  x = (x + Math.imul(y, z)) >>> 0;
  y = (y + Math.imul(z, x)) >>> 0;
  z = (z + Math.imul(x, y)) >>> 0;
  return [x, y, z];
}

/** Uniforme en [0, 1) con los 24 bits altos: exacto en float32, así que la GPU obtiene el mismo número. */
const unit = (u: number): number => (u >>> 8) / 16777216;

/**
 * Los 12 números uniformes de la célula c (índices enteros): 4 llamadas a PCG3D con la sal ×1…×4 en z. Gemelo de las
 * cuatro llamadas de `portalTriad` (GLSL).
 */
export function cellRandoms(c: Vec3): number[] {
  const P = PORTAL_TRIADS;
  const b = [(c[0] + P.cellOffset) >>> 0, (c[1] + P.cellOffset) >>> 0, (c[2] + P.cellOffset) >>> 0];
  const out: number[] = [];
  for (let k = 1; k <= 4; k++) {
    const h = pcg3d(b[0], b[1], (b[2] + Math.imul(k, P.salt)) >>> 0);
    out.push(unit(h[0]), unit(h[1]), unit(h[2]));
  }
  return out;
}

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface Triad {
  center: Vec3;
  dir: Vec3;
  halfLength: number;
  radius: number;
  /** Radio de la luz (mm): 0 si la tríada es maciza o su luz no llega a `edgeMm`. */
  lumen: number;
  gain: number;
}

/**
 * Tríada de la célula c (índices enteros), o null si la célula no tiene. Cada parámetro sale de su propio número del
 * hash: presencia, centro (3), semilongitud, radio, luz, ganancia y giro (3).
 */
export function triadOfCell(c: Vec3): Triad | null {
  const P = PORTAL_TRIADS;
  const r = cellRandoms(c);
  if (r[0] >= P.presence) return null;
  const C = P.cellMm;
  const center: Vec3 = [(c[0] + r[1]) * C, (c[1] + r[2]) * C, (c[2] + r[3]) * C];
  const halfLength = mix(P.halfLengthMm[0], P.halfLengthMm[1], r[4]);
  const radius = mix(P.radiusMm[0], P.radiusMm[1], r[5]);
  const lumenRaw = radius * mix(P.lumenFraction[0], P.lumenFraction[1], r[6]);
  const gain = mix(P.sheathGain[0], P.sheathGain[1], r[7]);
  const rad = [center[0] - P.hilum[0], center[1] - P.hilum[1], center[2] - P.hilum[2]];
  const rl = Math.hypot(rad[0], rad[1], rad[2]) || 1;
  const j = [r[8] * 2 - 1, r[9] * 2 - 1, r[10] * 2 - 1];
  const d = [0, 1, 2].map((k) => rad[k] / rl + P.directionJitter * j[k]);
  const dl = Math.hypot(d[0], d[1], d[2]) || 1;
  return { center, dir: [d[0] / dl, d[1] / dl, d[2] / dl], halfLength, radius, lumen: lumenRaw > P.edgeMm ? lumenRaw : 0, gain };
}

/**
 * Factor de la amplitud de retrodispersión del hígado en el punto material m: la ganancia de su vaina en la vaina de una
 * tríada, `lumenGain` en su luz y 1 fuera, con bordes suaves; donde dos se tocan, la vaina más brillante y la luz
 * (sangre) por encima de cualquier vaina. `cells` = 1 recorre las 8 células vecinas (lo que hace la GPU); con 2 (las
 * 64), la prueba de que bastan las 8.
 */
export function portalTriadGain(m: Vec3, cells: 1 | 2 = 1): number {
  const P = PORTAL_TRIADS;
  const C = P.cellMm;
  const base = [Math.floor(m[0] / C - 0.5), Math.floor(m[1] / C - 0.5), Math.floor(m[2] / C - 0.5)];
  const lo = cells === 1 ? 0 : -1;
  const hi = cells === 1 ? 1 : 2;
  let sheath = 1;
  let lumen = 0;
  for (let dz = lo; dz <= hi; dz++)
    for (let dy = lo; dy <= hi; dy++)
      for (let dx = lo; dx <= hi; dx++) {
        const t = triadOfCell([base[0] + dx, base[1] + dy, base[2] + dz]);
        if (!t) continue;
        const v = [m[0] - t.center[0], m[1] - t.center[1], m[2] - t.center[2]];
        const s = Math.min(t.halfLength, Math.max(-t.halfLength, v[0] * t.dir[0] + v[1] * t.dir[1] + v[2] * t.dir[2]));
        const dist = Math.hypot(v[0] - t.dir[0] * s, v[1] - t.dir[1] * s, v[2] - t.dir[2] * s);
        if (dist > t.radius + P.edgeMm) continue;
        sheath = Math.max(sheath, 1 + (t.gain - 1) * (1 - smooth(t.radius - P.edgeMm, t.radius + P.edgeMm, dist)));
        if (t.lumen > 0) lumen = Math.max(lumen, 1 - smooth(t.lumen - P.edgeMm, t.lumen + P.edgeMm, dist));
      }
  return sheath + (P.lumenGain - sheath) * lumen;
}

const f4 = (x: number): string => x.toFixed(4);
const u32 = (x: number): string => `${x >>> 0}u`;

/** Gemelo GLSL de `portalTriadGain` (pasada B); autocontenido: su propio hash entero. */
export const PORTAL_TRIADS_GLSL = /* glsl */ `
const float TRIAD_CELL = ${f4(PORTAL_TRIADS.cellMm)};
const float TRIAD_PRESENCE = ${f4(PORTAL_TRIADS.presence)};
const vec2 TRIAD_HALF_LEN = vec2(${f4(PORTAL_TRIADS.halfLengthMm[0])}, ${f4(PORTAL_TRIADS.halfLengthMm[1])});
const vec2 TRIAD_RADIUS = vec2(${f4(PORTAL_TRIADS.radiusMm[0])}, ${f4(PORTAL_TRIADS.radiusMm[1])});
const vec2 TRIAD_LUMEN = vec2(${f4(PORTAL_TRIADS.lumenFraction[0])}, ${f4(PORTAL_TRIADS.lumenFraction[1])});
const vec2 TRIAD_GAIN = vec2(${f4(PORTAL_TRIADS.sheathGain[0])}, ${f4(PORTAL_TRIADS.sheathGain[1])});
const float TRIAD_LUMEN_GAIN = ${f4(PORTAL_TRIADS.lumenGain)};
const float TRIAD_JITTER = ${f4(PORTAL_TRIADS.directionJitter)};
const vec3 TRIAD_HILUM = vec3(${PORTAL_TRIADS.hilum.map(f4).join(', ')});
const float TRIAD_EDGE = ${f4(PORTAL_TRIADS.edgeMm)};
const int TRIAD_OFFSET = ${PORTAL_TRIADS.cellOffset};
const uint TRIAD_SALT = ${u32(PORTAL_TRIADS.salt)};
uvec3 triadPcg(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 triadUnit(uvec3 h) { return vec3(h >> 8u) / 16777216.0; }
float portalTriad(vec3 m) {
  vec3 base = floor(m / TRIAD_CELL - 0.5);
  float sheath = 1.0;
  float lumen = 0.0;
  for (int k = 0; k < 8; k++) {
    vec3 c = base + vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
    uvec3 b = uvec3(ivec3(c) + TRIAD_OFFSET);
    vec3 r1 = triadUnit(triadPcg(b + uvec3(0u, 0u, TRIAD_SALT)));
    if (r1.x >= TRIAD_PRESENCE) continue;
    vec3 r2 = triadUnit(triadPcg(b + uvec3(0u, 0u, 2u * TRIAD_SALT)));
    vec3 r3 = triadUnit(triadPcg(b + uvec3(0u, 0u, 3u * TRIAD_SALT)));
    vec3 r4 = triadUnit(triadPcg(b + uvec3(0u, 0u, 4u * TRIAD_SALT)));
    vec3 ctr = (c + vec3(r1.y, r1.z, r2.x)) * TRIAD_CELL;
    float L = mix(TRIAD_HALF_LEN.x, TRIAD_HALF_LEN.y, r2.y);
    float R = mix(TRIAD_RADIUS.x, TRIAD_RADIUS.y, r2.z);
    float Rl = R * mix(TRIAD_LUMEN.x, TRIAD_LUMEN.y, r3.x);
    float G = mix(TRIAD_GAIN.x, TRIAD_GAIN.y, r3.y);
    vec3 d = normalize(normalize(ctr - TRIAD_HILUM) + TRIAD_JITTER * (vec3(r3.z, r4.x, r4.y) * 2.0 - 1.0));
    vec3 v = m - ctr;
    float s = clamp(dot(v, d), -L, L);
    float dist = length(v - d * s);
    if (dist > R + TRIAD_EDGE) continue;
    sheath = max(sheath, 1.0 + (G - 1.0) * (1.0 - smoothstep(R - TRIAD_EDGE, R + TRIAD_EDGE, dist)));
    if (Rl > TRIAD_EDGE) lumen = max(lumen, 1.0 - smoothstep(Rl - TRIAD_EDGE, Rl + TRIAD_EDGE, dist));
  }
  return mix(sheath, TRIAD_LUMEN_GAIN, lumen);
}
`;
