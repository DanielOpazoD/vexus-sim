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
 * Diafragma completo: dos hemicúpulas (la derecha, más alta, con el hígado debajo) sobre
 * la línea de inserción costal. z = 0 en el xifoides: la inserción está a 0 en la línea
 * media anterior y desciende a −50 mm en los flancos y la espalda (10.º–12.º arcos).
 */
export interface Diaphragm {
  right: Dome;
  left: Dome;
  /** Altura de la inserción en el flanco/espalda y ascenso hacia el xifoides (mm). */
  edgeZ: number;
  edgeRise: number;
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

/** Altura del diafragma (z, mm) en (x, y): inserción costal + la hemicúpula más alta. */
export function diaphragmHeight(x: number, y: number, d: Diaphragm, torso: Torso): number {
  const edge = diaphragmEdgeZ(torsoPhi(x, y, torso), d);
  const zr = edge + Math.max(0, d.right.apex - edge) * domeLift(x, y, d.right);
  const zl = edge + Math.max(0, d.left.apex - edge) * domeLift(x, y, d.left);
  return Math.max(edge, zr, zl);
}

/** Distancia con signo al diafragma: negativa en el tórax (por encima). */
export function sdDiaphragm(p: Vec3, d: Diaphragm, torso: Torso): number {
  const zd = diaphragmHeight(p[0], p[1], d, torso);
  const h = 0.5;
  const gx = (diaphragmHeight(p[0] + h, p[1], d, torso) - diaphragmHeight(p[0] - h, p[1], d, torso)) / (2 * h);
  const gy = (diaphragmHeight(p[0], p[1] + h, d, torso) - diaphragmHeight(p[0], p[1] - h, d, torso)) / (2 * h);
  const slope = Math.sqrt(1 + gx * gx + gy * gy);
  return (zd - p[2]) / slope;
}

export interface CylinderZ {
  kind: 'cylinderZ';
  x0: number;
  y0: number;
  r: number;
}

/**
 * Columna: cuerpo vertebral (cilindro) + arco posterior con apófisis transversas
 * (caja de semiancho `archHalfWidth`, entre `archY0` y `archY1`, por detrás del
 * cuerpo). Las costillas se articulan con las apófisis transversas: no existen por
 * detrás de la columna (`sdRib` las excluye en |x| < archHalfWidth + margen).
 */
export interface Spine extends CylinderZ {
  archHalfWidth: number;
  archY0: number;
  archY1: number;
}

/** Elipse del tronco (sección transversal) y sus capas parietales. */
export interface Torso {
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
  /** Altura z del arco costal en la línea anterior (φ = π/2) en mm. */
  zAnterior: number;
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

/**
 * Elipsoide con base propia (u, v, w) y afilamiento lineal de los semiejes v/w al
 * avanzar en +u (pera: fondo grande en −u, cuello estrecho en +u). Vesícula.
 */
export interface OrientedEllipsoid {
  kind: 'oriented-ellipsoid';
  center: Vec3;
  radii: Vec3;
  u: Vec3;
  v: Vec3;
  w: Vec3;
  taperU: number;
}

export function sdOrientedEllipsoid(p: Vec3, e: OrientedEllipsoid): number {
  const d: Vec3 = [p[0] - e.center[0], p[1] - e.center[1], p[2] - e.center[2]];
  const q: Vec3 = [
    d[0] * e.u[0] + d[1] * e.u[1] + d[2] * e.u[2],
    d[0] * e.v[0] + d[1] * e.v[1] + d[2] * e.v[2],
    d[0] * e.w[0] + d[1] * e.w[1] + d[2] * e.w[2],
  ];
  const taper = Math.max(0.15, 1 - e.taperU * (q[0] / e.radii[0]));
  const rr: Vec3 = [e.radii[0], e.radii[1] * taper, e.radii[2] * taper];
  const kx = q[0] / rr[0];
  const ky = q[1] / rr[1];
  const kz = q[2] / rr[2];
  const k1 = Math.sqrt(kx * kx + ky * ky + kz * kz);
  const k2 = Math.sqrt((kx * kx) / (rr[0] * rr[0]) + (ky * ky) / (rr[1] * rr[1]) + (kz * kz) / (rr[2] * rr[2]));
  return k2 > 0 ? (k1 * (k1 - 1)) / k2 : -Math.min(rr[0], rr[1], rr[2]);
}

export function sdSphere(p: Vec3, s: Sphere): number {
  return Math.hypot(p[0] - s.center[0], p[1] - s.center[1], p[2] - s.center[2]) - s.r;
}

export function sdCylinderZ(p: Vec3, c: CylinderZ): number {
  return Math.hypot(p[0] - c.x0, p[1] - c.y0) - c.r;
}

/** Distancia con signo a la columna (cuerpo ∪ arco posterior); negativa en hueso. */
export function sdSpine(p: Vec3, sp: Spine): number {
  const body = sdCylinderZ(p, sp);
  const dx = Math.abs(p[0] - sp.x0) - sp.archHalfWidth;
  const cy = 0.5 * (sp.archY0 + sp.archY1);
  const dy = Math.abs(p[1] - cy) - 0.5 * (sp.archY1 - sp.archY0);
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  const arch = Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0);
  return Math.min(body, arch);
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

/**
 * Gradiente de la distancia con signo del tubo (sd = dist − r(s)) en el segmento de `hit` y curvatura
 * circunferencial de su cara: gemelo de `tubeQuery` en la GLSL, que deja el primero en `Cls.n` (sin
 * normalizar) y la segunda en `Cls.kc` (decisión 57). En la sección elíptica el gradiente escala dos
 * veces la componente AP, así que su norma es 1/apScale en las paredes anterior y posterior: la pasada B
 * divide por ella `ifd` (el valor de sd) para tener la distancia por la normal. Dentro del segmento se
 * resta el crecimiento del radio a lo largo del eje. La curvatura de la cara en su dirección
 * circunferencial ĉ (normal a la cara y al eje) es |S·ĉ|²/(r·|∇dist|), con S = diag(1, 1/apScale, 1):
 * 1/r en la sección circular, apScale/r en las paredes AP y 1/(apScale²·r) en las laterales.
 */
export function tubeFaceGradient(p: Vec3, tube: Tube, radiusScale: number, hit: TubeHit): { gradient: Vec3; curvature: number } {
  const a = tube.nodes[hit.segment];
  const b = tube.nodes[hit.segment + 1];
  const ab: Vec3 = [b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]];
  const len = Math.hypot(ab[0], ab[1], ab[2]) || 1;
  const tg: Vec3 = [ab[0] / len, ab[1] / len, ab[2] / len];
  const s = hit.s;
  const d: Vec3 = [p[0] - (a.p[0] + ab[0] * s), p[1] - (a.p[1] + ab[1] * s), p[2] - (a.p[2] + ab[2] * s)];
  const dot = (x: Vec3, y: Vec3) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  let dist: number;
  let g: Vec3;
  const ap = tube.apScale;
  if (ap !== 1) {
    const along = dot(d, tg);
    const perp: Vec3 = [d[0] - tg[0] * along, (d[1] - tg[1] * along) / ap, d[2] - tg[2] * along];
    dist = Math.hypot(perp[0], perp[1], perp[2], along);
    const q: Vec3 = [perp[0], perp[1] / ap, perp[2]];
    const qt = dot(q, tg);
    g = [q[0] - tg[0] * qt + tg[0] * along, q[1] - tg[1] * qt + tg[1] * along, q[2] - tg[2] * qt + tg[2] * along];
  } else {
    dist = Math.hypot(d[0], d[1], d[2]);
    g = d;
  }
  const r = (a.r + (b.r - a.r) * s) * radiusScale;
  const taper = s > 0 && s < 1 ? (radiusScale * (b.r - a.r)) / len : 0;
  const inv = 1 / Math.max(dist, 1e-6);
  const gn: Vec3 = [g[0] * inv - tg[0] * taper, g[1] * inv - tg[1] * taper, g[2] * inv - tg[2] * taper];
  const gradient: Vec3 = dist > 0 && dot(gn, gn) > 0 ? gn : [0, 1, 0];
  let curvature = 1 / r;
  const c: Vec3 = [g[1] * tg[2] - g[2] * tg[1], g[2] * tg[0] - g[0] * tg[2], g[0] * tg[1] - g[1] * tg[0]];
  const cl = Math.hypot(c[0], c[1], c[2]);
  if (ap !== 1 && dist > 0 && cl > 1e-6) {
    const cy = c[1] / cl;
    curvature = ((1 + cy * cy * (1 / (ap * ap) - 1)) * dist) / (r * Math.hypot(g[0], g[1], g[2]));
  }
  return { gradient, curvature };
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

/**
 * Gradiente de `torsoDepth` (su métrica radial: no es unitario salvo en un tronco circular), analítico:
 * ∂d/∂x = (x/r)(1 − 1/ρ) + r·x/(a²ρ³), igual en y con b; 0 en z. Da la normal y la norma del gradiente de las
 * caras de las capas de la pared sin su ondulación (el eco de cara plana de la serie de la pleura, decisión 62).
 */
export function torsoDepthGradient(p: Vec3, t: Torso): Vec3 {
  const r = Math.hypot(p[0], p[1]);
  if (r < 1e-6) return [0, 1, 0];
  const rho = Math.hypot(p[0] / t.a, p[1] / t.b);
  const k = 1 - 1 / rho;
  const c = r / (rho * rho * rho);
  return [(p[0] / r) * k + (c * p[0]) / (t.a * t.a), (p[1] / r) * k + (c * p[1]) / (t.b * t.b), 0];
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
export function ribAnteriorEndX(rib: Pick<Rib, 'zAnterior'>): number {
  return Math.min(RIB_ANTERIOR_END.xMm, RIB_ANTERIOR_END.xMm + RIB_ANTERIOR_END.marginSlope * rib.zAnterior);
}

/** Distancia con signo a una costilla (negativa dentro del hueso). */
export function sdRib(p: Vec3, rib: Rib, torso: Torso, spine?: Spine): { d: number; cartilage: boolean } {
  const phi = torsoPhi(p[0], p[1], torso);
  if (rib.rightOnly && p[0] > ribAnteriorEndX(rib)) return { d: 1e3, cartilage: false };
  // El arco costal termina en la apófisis transversa: nada por detrás de la columna
  if (spine && p[1] < spine.y0 && Math.abs(p[0] - spine.x0) < spine.archHalfWidth + 6) return { d: 1e3, cartilage: false };
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
  // cartílago solo en el arco anterior, a menos de π/2 − cartilageFromPhi de la línea media (φ = π/2), a los
  // dos lados (antes `φ > cartilageFromPhi`, que en las costillas derechas, φ ∈ (π/2, π], hacía cartílago todo
  // el arco anterolateral: la ventana intercostal sin cortical ni sombra; decisión 62)
  const cartilage =
    Number.isFinite(rib.cartilageFromPhi) &&
    (Math.abs(phi - Math.PI / 2) < Math.PI / 2 - rib.cartilageFromPhi ||
      (rib.rightOnly && p[1] > 0 && p[0] > ribAnteriorEndX(rib) - RIB_ANTERIOR_END.cartilageTailMm));
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
