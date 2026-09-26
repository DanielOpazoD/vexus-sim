import type { Vec3 } from '../../core/vec3';
import { sdEllipsoid, smoothMax, smoothMin, type Ellipsoid, type Torso } from '../primitives';
import { gallbladderSdf, type GallbladderShape } from './gallbladder';
import { RENAL_IMPRESSION_OVERLAP_MM, kidneyLocal, perirenalOuterSdf, type Kidney } from './kidney';
import { umbilicalFissureSdf, type UmbilicalFissure } from './liverLigaments';

/**
 * Hígado como módulo de órgano (decisión 46): dos lóbulos (elipsoides; el izquierdo afilado hacia +x) forman la
 * envolvente; la pared abdominal recorta la cara anterior y lateral, la cúpula la superior y la cara visceral en cuña la
 * inferior (decisión 72), con el recorte posteromedial, la impresión renal, la fosa vesicular y la fisura umbilical. El
 * SDF es igual en TS y en GLSL (`liverSdf`); el shader usa `uLiverC/R/Taper`, `uLiverLC/LR/LTaper`, `uLiverBlend` y
 * `uVisInnerA/B`, `uVisAnt`, `uVisLat`, `uVisSlope` del esquema único.
 */

/**
 * Cara visceral (decisión 72): una superficie z = z_v(x, y) por encima de la cual está el hígado, mínimo suave de
 * tres términos:
 *  - la cara interior, una cuádrica ajustada a la anatomía (≈ −62 sobre el riñón derecho, −45 en el hilio, −62 sobre
 *    la vesícula, −38 en el lóbulo izquierdo junto a la línea media, −26 en su extremo);
 *  - la falda anterior: el borde inferior en la cara interna de la pared anterior, z_A(x) (−62 en el epigastrio, −93
 *    en la línea medioclavicular derecha, junto al reborde costal; −33 a la izquierda), que sube hacia dentro con
 *    pendiente s_A (la cotangente del ángulo del borde contra la pared: 1 da 45°) por la profundidad bajo la pared;
 *  - la falda lateral: el borde en la cara interna de la pared lateral derecha, z_L(y) (−118 en el flanco, junto al
 *    polo inferior del riñón; sube por detrás), con pendiente s_L por la profundidad desde esa pared.
 * Así el borde inferior es agudo (< 75° el derecho, < 45° el izquierdo en el sano), el hígado apoya en la pared hasta
 * él y la cara visceral queda cóncava; la hepatomegalia lo baja y lo redondea.
 */
export interface VisceralFace {
  /** Cara interior: z = c₀ + c₁x + c₂y + c₃x² + c₄xy + c₅y² (mm). */
  inner: readonly [number, number, number, number, number, number];
  /** Borde en la pared anterior: z = a₀ + a₁x + a₂x² + a₃x³ (mm). */
  anterior: readonly [number, number, number, number];
  /**
   * Borde en la pared lateral derecha: z = l₀ + l₁y + l₂y² + l₃·(max(0, y − 35)² + max(0, −35 − y)²) (mm): el último
   * término lo sube deprisa por delante y por detrás del flanco, donde mandan la falda anterior y la cara interior.
   */
  lateral: readonly [number, number, number, number];
  /** Cotangente del ángulo del borde anterior: lóbulo derecho (x ≤ TIP_SLOPE_X[0]) e izquierdo (x ≥ TIP_SLOPE_X[1]). */
  tipSlope: readonly [number, number];
  /** Cotangente del ángulo del borde lateral (corte coronal). */
  lateralSlope: number;
  /** Redondeo de la arista entre los lóbulos y la cara visceral (mm). */
  edgeRoundMm: number;
}

/** Transición de la pendiente del borde anterior del lóbulo derecho al izquierdo (x, mm). */
export const TIP_SLOPE_X = [-60, 10] as const;
/** Semialtura (y, mm) del tramo de flanco donde vale la falda lateral. */
export const LATERAL_SKIRT_Y = 35;
/**
 * Recorte posteromedial (decisión 72): el hígado no pasa a la izquierda y por detrás del borde izquierdo de la VCI (el
 * epiplón menor y la fisura del ligamento venoso; detrás quedan el pilar derecho, la aorta y el tronco celíaco). Región
 * recortada: a la izquierda de x = xPost, a la izquierda del plano vertical x − x₀ = k·(y − y₀) (que se abre hacia el
 * lóbulo izquierdo por delante) y por detrás de y = yMax (no toca el cuerpo del segmento lateral); distancia positiva
 * dentro de ella (fuera del hígado).
 */
export const MEDIAL_CUT = { xPost: -10, x0: -6, y0: -4, k: 1.2, yMax: 10, roundMm: 6 } as const;

/** Distancia con signo a la región recortada por detrás y a la izquierda de la VCI (positiva dentro: fuera del hígado). */
export function medialCutDistance(m: Vec3): number {
  const plane = (m[0] - MEDIAL_CUT.x0 - MEDIAL_CUT.k * (m[1] - MEDIAL_CUT.y0)) / Math.hypot(1, MEDIAL_CUT.k);
  return Math.min(m[0] - MEDIAL_CUT.xPost, plane, MEDIAL_CUT.yMax - m[1]);
}

/** Normal exterior del hígado en el recorte posteromedial: la del término que manda (gemela de la GLSL). */
export function medialCutNormal(m: Vec3): Vec3 {
  const plane = (m[0] - MEDIAL_CUT.x0 - MEDIAL_CUT.k * (m[1] - MEDIAL_CUT.y0)) / Math.hypot(1, MEDIAL_CUT.k);
  const xp = m[0] - MEDIAL_CUT.xPost;
  const ym = MEDIAL_CUT.yMax - m[1];
  if (xp <= plane && xp <= ym) return [1, 0, 0];
  if (plane <= ym) {
    const l = Math.hypot(1, MEDIAL_CUT.k);
    return [1 / l, -MEDIAL_CUT.k / l, 0];
  }
  return [0, -1, 0];
}

/** Mínimo suave entre las dos faldas y entre ellas y la cara interior (mm). */
export const VISCERAL_BLEND_MM = { skirts: 8, inner: 6 } as const;

/** Unión suave de los lóbulos (mm). */
export const LIVER_BLEND_MM = 15;
/** Separación mínima hígado–riñón (impresión renal, mm) y redondeo de su borde. */
export const RENAL_IMPRESSION = { roundMm: 8 } as const;
/** Redondeo del borde de la fosa vesicular (mm). */
export const GALLBLADDER_FOSSA_ROUND_MM = 2;

/**
 * Lóbulos y cara visceral para un factor de tamaño. Los lóbulos son la envolvente (la pared recorta la cara anterior y
 * lateral, la cúpula la superior) y la cara visceral la inferior. Hepatomegalia congestiva: los radios escalan con
 * `sizeFactor`, la cara visceral y el borde descienden ≈ 1 cm por cada 10 % y el borde se redondea (menos pendiente,
 * más radio). Craneocaudal en la línea medioclavicular ≈ 145 mm con f = 1.
 */
export function liverLobes(sizeFactor: number): { liver: Ellipsoid; liverLeft: Ellipsoid; visceralFace: VisceralFace } {
  const f = sizeFactor;
  const g = f - 1;
  return {
    liver: { kind: 'ellipsoid', center: [-70, -8, -42], radii: [92 * f, 108 * f, 145 * f], taperX: 0.12 },
    liverLeft: { kind: 'ellipsoid', center: [5, 42, -20], radii: [100 * f, 45 * f, 85 * f], taperX: 0.5 },
    visceralFace: {
      inner: [-41.6 - 300 * g, 0.36066, -0.28777, -0.00023999, -0.0022207, 0.0031832],
      anterior: [-61.695 - 220 * g, 0.18516, -0.0002002, 0.000012117],
      lateral: [-112 - 220 * g, -0.1, 0.00875, 0.2],
      tipSlope: [0.75 - 2 * g, 1.6 - 8 * g],
      lateralSlope: 0.75 - 2 * g,
      edgeRoundMm: 3 + 80 * g,
    },
  };
}

/** Lo que el SDF del hígado necesita de la escena (`AnatomyScene` lo cumple tal cual). */
export interface LiverShape {
  readonly liver: Ellipsoid;
  readonly liverLeft: Ellipsoid;
  readonly liverBlendMm: number;
  readonly visceralFace: VisceralFace;
  readonly torso: Torso;
  wallThickness(): number;
  readonly kidneyRight: Kidney;
  readonly gallbladder: GallbladderShape;
  readonly gallbladderWallMm: number;
  readonly umbilicalFissure: UmbilicalFissure;
}

/** Distancia con signo a la cara visceral (positiva dentro del hígado, por encima) y normal exterior del hígado en ella. */
export interface VisceralHit {
  d: number;
  n: Vec3;
}

/** Mínimo suave con su gradiente en (x, y): [valor, ∂x, ∂y]. */
export function sminGrad(a: readonly number[], b: readonly number[], k: number): [number, number, number] {
  const h = Math.max(k - Math.abs(a[0] - b[0]), 0) / k;
  const wa = a[0] < b[0] ? 1 - h / 2 : h / 2;
  return [Math.min(a[0], b[0]) - h * h * k * 0.25, wa * a[1] + (1 - wa) * b[1], wa * a[2] + (1 - wa) * b[2]];
}

/**
 * Cara visceral en (x, y): altura z_v y su gradiente (∂z_v/∂x, ∂z_v/∂y). La pared interna se aproxima por la elipse
 * de semiejes (a − pared, b − pared): profundidad bajo la pared anterior d_A = y_W(x) − y y desde la lateral derecha
 * d_L = x − x_W(y).
 */
export function visceralHeight(x: number, y: number, vf: VisceralFace, torso: Torso, wallMm: number): [number, number, number] {
  const c = vf.inner;
  const inner = [
    c[0] + c[1] * x + c[2] * y + c[3] * x * x + c[4] * x * y + c[5] * y * y,
    c[1] + 2 * c[3] * x + c[4] * y,
    c[2] + c[4] * x + 2 * c[5] * y,
  ];
  const A = torso.a - wallMm;
  const B = torso.b - wallMm;
  // falda anterior
  const qa = Math.max(1e-4, 1 - (x / A) * (x / A));
  const yW = B * Math.sqrt(qa);
  const yWx = (-B * x) / (A * A * Math.sqrt(qa));
  const dA = yW - y;
  const [x0, x1] = TIP_SLOPE_X;
  const t = Math.min(1, Math.max(0, (x - x0) / (x1 - x0)));
  const sA = vf.tipSlope[0] + (vf.tipSlope[1] - vf.tipSlope[0]) * t * t * (3 - 2 * t);
  const sAx = t > 0 && t < 1 ? ((vf.tipSlope[1] - vf.tipSlope[0]) * 6 * t * (1 - t)) / (x1 - x0) : 0;
  const an = vf.anterior;
  const ant = [
    an[0] + an[1] * x + an[2] * x * x + an[3] * x * x * x + sA * dA,
    an[1] + 2 * an[2] * x + 3 * an[3] * x * x + sAx * dA + sA * yWx,
    -sA,
  ];
  // falda lateral
  const ql = Math.max(1e-4, 1 - (y / B) * (y / B));
  const xW = -A * Math.sqrt(ql);
  const xWy = (A * y) / (B * B * Math.sqrt(ql));
  const dL = x - xW;
  const la = vf.lateral;
  const pa = Math.max(0, y - LATERAL_SKIRT_Y);
  const pp = Math.max(0, -LATERAL_SKIRT_Y - y);
  const lat = [
    la[0] + la[1] * y + la[2] * y * y + la[3] * (pa * pa + pp * pp) + vf.lateralSlope * dL,
    vf.lateralSlope,
    la[1] + 2 * la[2] * y + 2 * la[3] * (pa - pp) - vf.lateralSlope * xWy,
  ];
  return sminGrad(inner, sminGrad(ant, lat, VISCERAL_BLEND_MM.skirts), VISCERAL_BLEND_MM.inner);
}

/** Distancia con signo a la cara visceral (positiva por encima: dentro del hígado) y normal exterior del hígado. */
export function visceralFaceDistance(m: Vec3, vf: VisceralFace, torso: Torso, wallMm: number): VisceralHit {
  const [zv, gx, gy] = visceralHeight(m[0], m[1], vf, torso, wallMm);
  const l = Math.hypot(gx, gy, 1);
  return { d: (m[2] - zv) / l, n: [gx / l, gy / l, -1 / l] };
}

/** Hígado sin la fisura umbilical (lo que la fisura excava se clasifica como ligamento redondo). */
export function liverBaseSdf(m: Vec3, s: LiverShape): number {
  let d = smoothMin(sdEllipsoid(m, s.liver), sdEllipsoid(m, s.liverLeft), s.liverBlendMm);
  d = smoothMax(d, -visceralFaceDistance(m, s.visceralFace, s.torso, s.wallThickness()).d, s.visceralFace.edgeRoundMm);
  d = smoothMax(d, medialCutDistance(m), MEDIAL_CUT.roundMm);
  // impresión renal: el hígado apoya en la cara externa de la grasa perirrenal, de grosor variable (decisión 68)
  d = smoothMax(
    d,
    -(perirenalOuterSdf(kidneyLocal(m, s.kidneyRight), s.kidneyRight) + RENAL_IMPRESSION_OVERLAP_MM),
    RENAL_IMPRESSION.roundMm,
  );
  d = smoothMax(d, -(gallbladderSdf(m, s.gallbladder) - s.gallbladderWallMm), GALLBLADDER_FOSSA_ROUND_MM);
  return d;
}

/**
 * Distancia con signo al hígado sin los recortes de cúpula y pared: unión suave de los lóbulos,
 * cara visceral en cuña, impresión renal, fosa vesicular y fisura umbilical.
 */
export function liverSdf(m: Vec3, s: LiverShape): number {
  const dBase = liverBaseSdf(m, s);
  return smoothMax(dBase, -umbilicalFissureSdf(m, dBase, s.umbilicalFissure), s.umbilicalFissure.roundMm);
}

/**
 * Gemelo GLSL; `n` es la normal de la superficie que manda y `dBase` el hígado sin fisura. La sobrecarga sin `n`
 * da la misma distancia, con los mismos términos y en el mismo orden, sin las normales de la impresión renal ni de
 * la fosa vesicular: la de `liverInner`, cuyo gradiente numérico da la cara de la cápsula (`faceGradient`).
 */
export const LIVER_GLSL = /* glsl */ `
const float RENAL_IMPRESSION_ROUND_MM = ${RENAL_IMPRESSION.roundMm.toFixed(3)};
const float RENAL_IMPRESSION_OVERLAP_MM = ${RENAL_IMPRESSION_OVERLAP_MM.toFixed(3)};
const float GALLBLADDER_FOSSA_ROUND_MM = ${GALLBLADDER_FOSSA_ROUND_MM.toFixed(3)};

const float TIP_SLOPE_X0 = ${TIP_SLOPE_X[0].toFixed(3)};
const float TIP_SLOPE_X1 = ${TIP_SLOPE_X[1].toFixed(3)};
const float LATERAL_SKIRT_Y = ${LATERAL_SKIRT_Y.toFixed(3)};
const float VISCERAL_BLEND_SKIRTS = ${VISCERAL_BLEND_MM.skirts.toFixed(3)};
const float VISCERAL_BLEND_INNER = ${VISCERAL_BLEND_MM.inner.toFixed(3)};
const float MEDIAL_CUT_X_POST = ${MEDIAL_CUT.xPost.toFixed(3)};
const float MEDIAL_CUT_X0 = ${MEDIAL_CUT.x0.toFixed(3)};
const float MEDIAL_CUT_Y0 = ${MEDIAL_CUT.y0.toFixed(3)};
const float MEDIAL_CUT_K = ${MEDIAL_CUT.k.toFixed(3)};
const float MEDIAL_CUT_Y_MAX = ${MEDIAL_CUT.yMax.toFixed(3)};
const float MEDIAL_CUT_ROUND_MM = ${MEDIAL_CUT.roundMm.toFixed(3)};

// (valor, ∂x, ∂y) del mínimo suave de dos alturas con gradiente
vec3 sminGrad(vec3 a, vec3 b, float k) {
  float h = max(k - abs(a.x - b.x), 0.0) / k;
  float wa = a.x < b.x ? 1.0 - h * 0.5 : h * 0.5;
  return vec3(min(a.x, b.x) - h * h * k * 0.25, wa * a.yz + (1.0 - wa) * b.yz);
}

// Cara visceral (decisión 72): (z_v, ∂z_v/∂x, ∂z_v/∂y); uVisInnerA/B = cuádrica interior, uVisAnt = borde anterior
// (cúbica en x), uVisLat = borde lateral (en y), uVisSlope = (pendiente anterior dcha., izda., lateral, redondeo)
vec3 visceralHeight(vec2 p) {
  float x = p.x;
  float y = p.y;
  vec3 ca = uVisInnerA;
  vec3 cb = uVisInnerB;
  vec3 inner = vec3(
    ca.x + ca.y * x + ca.z * y + cb.x * x * x + cb.y * x * y + cb.z * y * y,
    ca.y + 2.0 * cb.x * x + cb.y * y,
    ca.z + cb.y * x + 2.0 * cb.z * y);
  float wallMm = uWall.x + uWall.y + uWall.z;
  float A = uTorso.x - wallMm;
  float B = uTorso.y - wallMm;
  float qa = max(1e-4, 1.0 - (x / A) * (x / A));
  float yW = B * sqrt(qa);
  float yWx = (-B * x) / (A * A * sqrt(qa));
  float dA = yW - y;
  float t = clamp((x - TIP_SLOPE_X0) / (TIP_SLOPE_X1 - TIP_SLOPE_X0), 0.0, 1.0);
  float sA = uVisSlope.x + (uVisSlope.y - uVisSlope.x) * t * t * (3.0 - 2.0 * t);
  float sAx = t > 0.0 && t < 1.0 ? ((uVisSlope.y - uVisSlope.x) * 6.0 * t * (1.0 - t)) / (TIP_SLOPE_X1 - TIP_SLOPE_X0) : 0.0;
  vec4 an = uVisAnt;
  vec3 ant = vec3(
    an.x + an.y * x + an.z * x * x + an.w * x * x * x + sA * dA,
    an.y + 2.0 * an.z * x + 3.0 * an.w * x * x + sAx * dA + sA * yWx,
    -sA);
  float ql = max(1e-4, 1.0 - (y / B) * (y / B));
  float xW = -A * sqrt(ql);
  float xWy = (A * y) / (B * B * sqrt(ql));
  float dL = x - xW;
  vec4 la = uVisLat;
  float pa = max(0.0, y - LATERAL_SKIRT_Y);
  float pp = max(0.0, -LATERAL_SKIRT_Y - y);
  vec3 lat = vec3(
    la.x + la.y * y + la.z * y * y + la.w * (pa * pa + pp * pp) + uVisSlope.z * dL,
    uVisSlope.z,
    la.y + 2.0 * la.z * y + 2.0 * la.w * (pa - pp) - uVisSlope.z * xWy);
  return sminGrad(inner, sminGrad(ant, lat, VISCERAL_BLEND_SKIRTS), VISCERAL_BLEND_INNER);
}

// distancia con signo a la cara visceral (positiva dentro del hígado) y normal exterior del hígado en ella
float visceralFaceDistance(vec3 m, out vec3 n) {
  vec3 h = visceralHeight(m.xy);
  float l = length(vec3(h.yz, 1.0));
  n = vec3(h.y, h.z, -1.0) / l;
  return (m.z - h.x) / l;
}

float medialCutDistance(vec3 m) {
  float plane = (m.x - MEDIAL_CUT_X0 - MEDIAL_CUT_K * (m.y - MEDIAL_CUT_Y0)) / sqrt(1.0 + MEDIAL_CUT_K * MEDIAL_CUT_K);
  return min(min(m.x - MEDIAL_CUT_X_POST, plane), MEDIAL_CUT_Y_MAX - m.y);
}

// normal exterior del hígado en el recorte posteromedial: la del término que manda
vec3 medialCutNormal(vec3 m) {
  float plane = (m.x - MEDIAL_CUT_X0 - MEDIAL_CUT_K * (m.y - MEDIAL_CUT_Y0)) / sqrt(1.0 + MEDIAL_CUT_K * MEDIAL_CUT_K);
  float xp = m.x - MEDIAL_CUT_X_POST;
  float ym = MEDIAL_CUT_Y_MAX - m.y;
  if (xp <= plane && xp <= ym) return vec3(1.0, 0.0, 0.0);
  if (plane <= ym) return normalize(vec3(1.0, -MEDIAL_CUT_K, 0.0));
  return vec3(0.0, -1.0, 0.0);
}

float liverSdf(vec3 m, out vec3 n, out float dBase) {
  vec3 ln; vec3 ln2;
  float dR = sdEllipsoid(m, uLiverC, uLiverR, uLiverTaper, ln);
  float dL = sdEllipsoid(m, uLiverLC, uLiverLR, uLiverLTaper, ln2);
  float d = smoothMin(dR, dL, uLiverBlend);
  n = dL < dR ? ln2 : ln;
  vec3 vn;
  float dv = visceralFaceDistance(m, vn);
  float d1 = smoothMax(d, -dv, uVisSlope.w);
  if (d1 > d + 1e-3) n = vn;
  float dc = medialCutDistance(m);
  float d2 = smoothMax(d1, dc, MEDIAL_CUT_ROUND_MM);
  if (d2 > d1 + 1e-3) n = medialCutNormal(m);
  vec3 kn;
  float dk = kidneyOuter(m, 0, kn) - perirenalThicknessMm(kidneyLocal(m, 0), 0) + RENAL_IMPRESSION_OVERLAP_MM;
  float d3 = smoothMax(d2, -dk, RENAL_IMPRESSION_ROUND_MM);
  if (d3 > d2 + 1e-3) n = -kn;
  vec3 gn;
  float dg = gallbladderSdf(m, gn) - uGbExtra.y;
  float d4 = smoothMax(d3, -dg, GALLBLADDER_FOSSA_ROUND_MM);
  if (d4 > d3 + 1e-3) n = -gn;
  dBase = d4;
  float d5 = smoothMax(d4, -umbilicalFissureSdf(m, d4), FISSURE_ROUND_MM);
  if (d5 > d4 + 1e-3 && abs(m.x - uFissure.x) > uFissure.y - 1.0) n = vec3(sign(m.x - uFissure.x), 0.0, 0.0);
  return d5;
}

float liverSdf(vec3 m, out float dBase) {
  vec3 ln;
  float dR = sdEllipsoid(m, uLiverC, uLiverR, uLiverTaper, ln);
  float dL = sdEllipsoid(m, uLiverLC, uLiverLR, uLiverLTaper, ln);
  float d = smoothMin(dR, dL, uLiverBlend);
  vec3 vn;
  float d1 = smoothMax(d, -visceralFaceDistance(m, vn), uVisSlope.w);
  float d2 = smoothMax(d1, medialCutDistance(m), MEDIAL_CUT_ROUND_MM);
  float dk = kidneyOuterSdf(kidneyLocal(m, 0), uKidR[0]) - perirenalThicknessMm(kidneyLocal(m, 0), 0) + RENAL_IMPRESSION_OVERLAP_MM;
  float d3 = smoothMax(d2, -dk, RENAL_IMPRESSION_ROUND_MM);
  float dg = gallbladderSdf(m) - uGbExtra.y;
  float d4 = smoothMax(d3, -dg, GALLBLADDER_FOSSA_ROUND_MM);
  dBase = d4;
  return smoothMax(d4, -umbilicalFissureSdf(m, d4), FISSURE_ROUND_MM);
}
`;
