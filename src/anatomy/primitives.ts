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
}

export interface Sphere {
  kind: 'sphere';
  center: Vec3;
  r: number;
}

/** Cúpula diafragmática: la región z > zBase + h·sqrt(1 − ((x−x0)/rx)² − ((y−y0)/ry)²) es tórax. */
export interface Dome {
  kind: 'dome';
  x0: number;
  y0: number;
  rx: number;
  ry: number;
  zBase: number;
  h: number;
}

export interface CylinderZ {
  kind: 'cylinderZ';
  x0: number;
  y0: number;
  r: number;
}

/** Elipse del tronco (sección transversal) y sus capas parietales. */
export interface Torso {
  a: number; // semieje x (mm)
  b: number; // semieje y (mm)
  zMin: number;
  zMax: number;
  skinMm: number;
  fatMm: number;
  muscleMm: number;
}

export interface Rib {
  /** Altura z del arco costal en la línea anterior (φ = π/2) en mm. */
  zAnterior: number;
  /** Inclinación: cuánto sube el arco al ir hacia posterior (mm). */
  tilt: number;
  /** Semiancho craneocaudal (mm) y semiespesor radial (mm). */
  halfWidth: number;
  halfThickness: number;
  /** Escala de la elipse del tronco a la que corre la costilla (0–1). */
  scale: number;
  /** Ángulo a partir del cual (hacia anterior) el arco es cartílago; NaN = todo hueso. */
  cartilageFromPhi: number;
  /** Solo en el lado derecho del paciente (x < 0)? */
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
 * Altura de la cúpula. Perfil superelíptico (q = 1 − ρ⁴): techo aplanado y
 * caída rápida cerca de la pared, como el seno costofrénico.
 */
export function domeHeight(x: number, y: number, d: Dome): number {
  const u = (x - d.x0) / d.rx;
  const v = (y - d.y0) / d.ry;
  const rho2 = u * u + v * v;
  const q = 1 - rho2 * rho2;
  return d.zBase + d.h * Math.sqrt(Math.max(0, q));
}

/** Distancia con signo a la cúpula: negativa en el tórax (por encima). */
export function sdDome(p: Vec3, d: Dome): number {
  const zd = domeHeight(p[0], p[1], d);
  const h = 0.5;
  const gx = (domeHeight(p[0] + h, p[1], d) - domeHeight(p[0] - h, p[1], d)) / (2 * h);
  const gy = (domeHeight(p[0], p[1] + h, d) - domeHeight(p[0], p[1] - h, d)) / (2 * h);
  const slope = Math.sqrt(1 + gx * gx + gy * gy);
  return (zd - p[2]) / slope;
}

export function sdCylinderZ(p: Vec3, c: CylinderZ): number {
  return Math.hypot(p[0] - c.x0, p[1] - c.y0) - c.r;
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
}

/**
 * Distancia a una cadena de cápsulas con radio interpolado y sección elíptica
 * (semieje AP = r·apScale). `radiusScale` multiplica los radios (fisiología).
 */
export function tubeQuery(p: Vec3, tube: Tube, radiusScale = 1): TubeHit {
  let best: TubeHit | null = null;
  const nodes = tube.nodes;
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
      const len = Math.sqrt(len2) || 1;
      const tx = abx / len;
      const ty = aby / len;
      const tz = abz / len;
      const along = dx * tx + dy * ty + dz * tz;
      const px = dx - tx * along;
      const py = (dy - ty * along) / tube.apScale;
      const pz = dz - tz * along;
      dist = Math.sqrt(px * px + py * py + pz * pz + along * along);
    } else {
      dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    const r = (nodes[i].r + (nodes[i + 1].r - nodes[i].r) * s) * radiusScale;
    const d = dist - r;
    if (!best || d < best.d) {
      const len = Math.sqrt(len2) || 1;
      best = {
        d,
        rho: dist / Math.max(1e-6, r),
        tangent: [abx / len, aby / len, abz / len],
        r,
        segment: i,
        s,
      };
    }
  }
  return best as TubeHit;
}

/** Ángulo alrededor del tronco: 0 = lado izquierdo del paciente (+x), π/2 = anterior (+y). */
export function torsoPhi(x: number, y: number, t: Torso): number {
  return Math.atan2(y / t.b, x / t.a);
}

/** Distancia radial (mm, aproximada) desde la piel: negativa dentro del cuerpo. */
export function torsoDepth(p: Vec3, t: Torso): number {
  const u = p[0] / t.a;
  const v = p[1] / t.b;
  const rho = Math.sqrt(u * u + v * v);
  // Escala local aproximada de la elipse en esa dirección
  const localR = rho > 0 ? Math.hypot(p[0], p[1]) / rho : Math.min(t.a, t.b);
  return (rho - 1) * localR;
}

/** Normal exterior aproximada de la piel en el punto. */
export function torsoNormal(p: Vec3, t: Torso): Vec3 {
  const nx = p[0] / (t.a * t.a);
  const ny = p[1] / (t.b * t.b);
  const n = Math.hypot(nx, ny) || 1;
  return [nx / n, ny / n, 0];
}

/** Punto de la piel para un ángulo φ y altura z. */
export function torsoSkinPoint(phi: number, z: number, t: Torso): Vec3 {
  return [t.a * Math.cos(phi), t.b * Math.sin(phi), z];
}

/** Distancia con signo a una costilla (negativa dentro del hueso). */
export function sdRib(p: Vec3, rib: Rib, torso: Torso): { d: number; cartilage: boolean } {
  const phi = torsoPhi(p[0], p[1], torso);
  if (rib.rightOnly && p[0] > 15) return { d: 1e3, cartilage: false };
  // radio local de la costilla a lo largo de su elipse escalada
  const u = p[0] / (torso.a * rib.scale);
  const v = p[1] / (torso.b * rib.scale);
  const rho = Math.sqrt(u * u + v * v);
  const localR = rho > 0 ? Math.hypot(p[0], p[1]) / rho : 1;
  const dRadial = (rho - 1) * localR;
  // altura del arco: más alto hacia posterior (φ → −π/2)
  const zRib = rib.zAnterior + rib.tilt * (0.5 - 0.5 * Math.sin(phi));
  const dz = p[2] - zRib;
  const qx = Math.abs(dRadial) / rib.halfThickness;
  const qz = Math.abs(dz) / rib.halfWidth;
  const q = Math.sqrt(qx * qx + qz * qz) - 1;
  const d = q * Math.min(rib.halfThickness, rib.halfWidth);
  const cartilage = Number.isFinite(rib.cartilageFromPhi) && phi > rib.cartilageFromPhi;
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

export type KidneyRegion = 'cortex' | 'medulla' | 'sinus';

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

function sdEllipsoidLocal(q: Vec3, r: Vec3): number {
  const kx = q[0] / r[0];
  const ky = q[1] / r[1];
  const kz = q[2] / r[2];
  const k1 = Math.sqrt(kx * kx + ky * ky + kz * kz);
  const k2 = Math.sqrt((kx * kx) / (r[0] * r[0]) + (ky * ky) / (r[1] * r[1]) + (kz * kz) / (r[2] * r[2]));
  return k2 > 0 ? (k1 * (k1 - 1)) / k2 : -Math.min(r[0], r[1], r[2]);
}

/** Ángulos (alrededor del eje largo) de las pirámides: anterior, lateral, posterior; ninguna en el hilio. */
export const PYRAMID_THETAS = [Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
/** Posiciones de las pirámides a lo largo del eje largo (mm). */
export const PYRAMID_US = [-40, -13, 13, 40];

export function kidneyQuery(p: Vec3, k: Kidney): KidneyHit {
  const q = kidneyLocal(p, k);
  const dOuter = sdEllipsoidLocal(q, k.radii);
  const qs: Vec3 = [q[0], q[1] - k.sinusOffset, q[2]];
  let dSinus = sdEllipsoidLocal(qs, k.sinusRadii);
  // Canal del hilio: cápsula desde el centro del seno hacia la cara medial (+v)
  const t = Math.min(Math.max(q[1] - k.sinusOffset, 0), k.radii[1]);
  const dHilum = Math.hypot(q[0], q[1] - k.sinusOffset - t, q[2]) - k.hilumRadius;
  dSinus = Math.min(dSinus, dHilum);
  if (dSinus < 0) return { dOuter, dSinus, region: 'sinus', inner: Math.min(-dSinus, -dOuter) };
  // Pirámides en cuña (papila hacia el seno, base hacia la corteza)
  let medulla = false;
  if (dSinus > 1.5 && dSinus < 13 && -dOuter > 5) {
    const theta = Math.atan2(q[2], q[1]);
    const halfAng = 0.22 + 0.028 * dSinus;
    const halfU = 4.5 + 0.45 * dSinus;
    for (const th of PYRAMID_THETAS) {
      let dth = theta - th;
      dth = Math.atan2(Math.sin(dth), Math.cos(dth));
      if (Math.abs(dth) > halfAng) continue;
      for (const u0 of PYRAMID_US) {
        if (Math.abs(q[0] - u0) < halfU) {
          medulla = true;
          break;
        }
      }
      if (medulla) break;
    }
  }
  const inner = Math.min(-dOuter, dSinus);
  return { dOuter, dSinus, region: medulla ? 'medulla' : 'cortex', inner };
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
