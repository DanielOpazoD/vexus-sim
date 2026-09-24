import type { Vec3 } from '../../core/vec3';
import { sdEllipsoidLocal, smoothMax } from '../primitives';

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

export type KidneyRegion = 'cortex' | 'medulla' | 'sinus' | 'pelvis';

export interface KidneyHit {
  /** Distancia con signo al contorno externo (mm, negativa dentro). */
  dOuter: number;
  /** Distancia con signo al seno (negativa dentro del seno). */
  dSinus: number;
  region: KidneyRegion;
  /** Distancia a la interfaz más cercana dentro del riñón (mm). */
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

/**
 * Pirámides medulares: (ángulo alrededor del eje largo, posición u a lo largo de él).
 * Fila lateral de 4 (θ = π) y filas anterior, posterior y oblicuas de 3: 16 pirámides
 * (un riñón adulto tiene 8–18); ninguna en el hilio (θ = 0). La misma tabla se
 * interpola en GLSL.
 */
export const PYRAMIDS: ReadonlyArray<readonly [number, number]> = [
  [Math.PI, -36],
  [Math.PI, -12],
  [Math.PI, 12],
  [Math.PI, 36],
  ...[Math.PI / 2, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (3 * Math.PI) / 2].flatMap((th) => [
    [th, -24] as const,
    [th, 0] as const,
    [th, 24] as const,
  ]),
];
/** Columnas de Bertin del plano coronal lateral (entre las pirámides laterales): posiciones u. */
export const BERTIN_COLUMNS_U = [-24, 0, 24] as const;
/** Pelvis renal: elipsoide de orina en el seno, desplazado hacia el hilio (marco local del seno, mm). */
export const RENAL_PELVIS = { offsetV: 3, radii: [9, 3.5, 2.5] as Vec3 };
/** Cápsula renal fibrosa (mm), línea ecogénica en la superficie. */
export const RENAL_CAPSULE_MM = 0.6;
/** Escotadura hiliar: elipsoide restado en la cara medial (marco local, mm). */
export const HILUM_NOTCH = { offsetV: 6, radii: [24, 16, 13] as Vec3, roundMm: 6 };

/** Contorno externo del riñón: elipsoide con escotadura hiliar (forma de judía). */
export function kidneyOuterSdf(q: Vec3, k: Kidney): number {
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

export function kidneyQuery(p: Vec3, k: Kidney): KidneyHit {
  const q = kidneyLocal(p, k);
  const dOuter = kidneyOuterSdf(q, k);
  const qs: Vec3 = [q[0], q[1] - k.sinusOffset, q[2]];
  let dSinus = sdEllipsoidLocal(qs, k.sinusRadii);
  // Canal del hilio: cápsula desde el centro del seno hacia la cara medial (+v)
  const t = Math.min(Math.max(q[1] - k.sinusOffset, 0), k.radii[1]);
  const dHilum = Math.hypot(q[0], q[1] - k.sinusOffset - t, q[2]) - k.hilumRadius;
  dSinus = Math.min(dSinus, dHilum);
  if (dSinus < 0) {
    // Pelvis: hendidura anecoica de orina en el centro del seno, alargada en u
    const dPelvis = sdEllipsoidLocal([qs[0], qs[1] - RENAL_PELVIS.offsetV, qs[2]], RENAL_PELVIS.radii);
    if (dPelvis < 0) return { dOuter, dSinus, region: 'pelvis', inner: Math.min(-dPelvis, -dOuter) };
    return { dOuter, dSinus, region: 'sinus', inner: Math.min(-dSinus, -dOuter, dPelvis) };
  }
  // Pirámides en cuña (papila hacia el seno, base hacia la corteza), separadas por
  // columnas de Bertin de corteza: semiángulo 7°→14° y semilongitud 3,5→8 mm del vértice a la base
  let medulla = false;
  if (dSinus > 1.5 && dSinus < 12 && -dOuter > 5) {
    const theta = Math.atan2(q[2], q[1]);
    const halfAng = 0.12 + 0.012 * dSinus;
    const halfU = 3.5 + 0.38 * dSinus;
    for (const [th, u0] of PYRAMIDS) {
      let dth = theta - th;
      dth = Math.atan2(Math.sin(dth), Math.cos(dth));
      if (Math.abs(dth) <= halfAng && Math.abs(q[0] - u0) < halfU) {
        medulla = true;
        break;
      }
    }
  }
  const inner = Math.min(-dOuter, dSinus);
  return { dOuter, dSinus, region: medulla ? 'medulla' : 'cortex', inner };
}

const PYRAMID_TABLE = `#define N_PYR ${PYRAMIDS.length}
const vec2 PYR[${PYRAMIDS.length}] = vec2[${PYRAMIDS.length}](${PYRAMIDS.map(([t, u]) => `vec2(${t.toFixed(6)}, ${u.toFixed(1)})`).join(', ')});`;
const PELVIS = `const vec4 PELVIS = vec4(${RENAL_PELVIS.radii[0].toFixed(1)}, ${RENAL_PELVIS.radii[1].toFixed(1)}, ${RENAL_PELVIS.radii[2].toFixed(1)}, ${RENAL_PELVIS.offsetV.toFixed(1)}); const float RENAL_CAPSULE_MM = ${RENAL_CAPSULE_MM.toFixed(2)};`;
const NOTCH = `const vec4 NOTCH = vec4(${HILUM_NOTCH.radii[0].toFixed(1)}, ${HILUM_NOTCH.radii[1].toFixed(1)}, ${HILUM_NOTCH.radii[2].toFixed(1)}, ${HILUM_NOTCH.offsetV.toFixed(1)}); const float NOTCH_ROUND = ${HILUM_NOTCH.roundMm.toFixed(1)};`;

/** Gemelo GLSL: `kidneyQuery` devuelve la región (0 corteza, 1 médula, 2 seno, 3 pelvis). */
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
  vec3 q = kidneyLocal(p, k);
  vec3 r = uKidR[k];
  vec3 nl = normalize(q / (r * r) + vec3(1e-6));
  n = normalize(uKidU[k] * nl.x + uKidV[k] * nl.y + uKidW[k] * nl.z);
  return kidneyOuterSdf(q, r);
}

// Región interna: 0 corteza, 1 médula, 2 seno, 3 pelvis; devuelve la distancia interna mínima
int kidneyQuery(vec3 p, int k, out float inner, out float dOuter) {
  vec3 q = kidneyLocal(p, k);
  dOuter = kidneyOuterSdf(q, uKidR[k]);
  vec4 sn = uKidSinus[k];
  vec3 qs = vec3(q.x, q.y - sn.w, q.z);
  float dSinus = sdEllipsoidLocal(qs, sn.xyz);
  float t = clamp(q.y - sn.w, 0.0, uKidR[k].y);
  float dHilum = length(vec3(q.x, q.y - sn.w - t, q.z)) - uKidExtra.x;
  dSinus = min(dSinus, dHilum);
  if (dSinus < 0.0) {
    float dPelvis = sdEllipsoidLocal(vec3(qs.x, qs.y - PELVIS.w, qs.z), PELVIS.xyz);
    if (dPelvis < 0.0) { inner = min(-dPelvis, -dOuter); return 3; }
    inner = min(min(-dSinus, -dOuter), dPelvis); return 2;
  }
  bool medulla = false;
  if (dSinus > 1.5 && dSinus < 12.0 && -dOuter > 5.0) {
    float theta = atan(q.z, q.y);
    float halfAng = 0.12 + 0.012 * dSinus;
    float halfU = 3.5 + 0.38 * dSinus;
    for (int i = 0; i < N_PYR; i++) {
      float dth = theta - PYR[i].x;
      dth = atan(sin(dth), cos(dth));
      if (abs(dth) <= halfAng && abs(q.x - PYR[i].y) < halfU) { medulla = true; break; }
    }
  }
  inner = min(-dOuter, dSinus);
  return medulla ? 1 : 0;
}
`;
