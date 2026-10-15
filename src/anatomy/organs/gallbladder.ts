import { sub, scale, dot, length, add, type Vec3 } from '../../core/vec3';
import { smoothMin } from '../primitives';
import { abdominalAtlas, abdominalAtlasSdf, abdominalAtlasGradient } from '../abdominalAtlas';

/**
 * Vesícula biliar como módulo de órgano (decisiones 41, 46 y 67): pera curvada en su fosa (cara visceral
 * entre IVb y V). La luz es una cadena de conos redondeados a lo largo de una línea media que va del fondo
 * (anteroinferolateral, asomando bajo el borde hepático junto al reborde costal) al cuello
 * (posterosuperomedial, hacia el hilio): fondo redondeado, cuerpo, infundíbulo con la bolsa de Hartmann que
 * cuelga hacia abajo y atrás, y el cuello que se dobla en «S» hacia arriba y adentro antes del cístico. Los
 * tramos se unen con una mezcla suave (`blendMm`): sin aristas en las curvas. Antes era un elipsoide recto
 * afilado (decisión 41). El shader usa `uGbNodes` y `uGbExtra` del esquema único de uniforms.
 */

/** Pared vesicular en ayunas (mm), ecogénica, entre la luz anecoica y la fosa (normal ≤ 3 mm). */
export const GALLBLADDER_WALL_MM = 1.8;

/** Nodos de la línea media de la luz (fondo → cuello); el shader tiene un array de este tamaño. */
export const GALLBLADDER_NODES = 5;

/** Nodo de la línea media: centro y radio de la luz (mm). */
export interface GallbladderNode {
  p: Vec3;
  r: number;
}

export interface GallbladderShape {
  kind: 'gallbladder';
  /** Del fondo (0) al cuello (último); `GALLBLADDER_NODES` nodos. */
  nodes: readonly GallbladderNode[];
  /** Radio de la unión suave entre tramos (mm). */
  blendMm: number;
}

/** Luz vesicular del adulto de referencia en ayunas: ~9 cm de largo, cuerpo de 3 cm, ~35 mL. */
export function gallbladderBody(): GallbladderShape {
  return {
    kind: 'gallbladder',
    blendMm: 6,
    nodes: [
      { p: [-78, 46, -86], r: 12 }, // fondo, contra el peritoneo de la pared anterior junto al reborde costal
      { p: [-67, 36, -72], r: 14.5 }, // cuerpo
      { p: [-54, 25, -62], r: 11 }, // infundíbulo
      { p: [-45, 17, -64], r: 8 }, // bolsa de Hartmann (cuelga hacia abajo y atrás)
      { p: [-39, 14, -51], r: 4.5 }, // cuello, doblado hacia arriba y adentro
    ],
  };
}

/** Centro del cuerpo de la vesícula (referencia de pruebas y del navegador 3D). */
export function gallbladderCenter(g: GallbladderShape): Vec3 {
  return g.nodes[1].p;
}

/** Eje del cuerpo, del fondo al infundíbulo (unitario). */
export function gallbladderAxis(g: GallbladderShape): Vec3 {
  const a = g.nodes[0].p;
  const b = g.nodes[2].p;
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / l, d[1] / l, d[2] / l];
}

/** Distancia con signo a un tramo de la luz: cono redondeado con el radio interpolado a lo largo del segmento. */
export function gbSegment(m: Vec3, a: GallbladderNode, b: GallbladderNode): number {
  const abx = b.p[0] - a.p[0];
  const aby = b.p[1] - a.p[1];
  const abz = b.p[2] - a.p[2];
  const apx = m[0] - a.p[0];
  const apy = m[1] - a.p[1];
  const apz = m[2] - a.p[2];
  const len2 = abx * abx + aby * aby + abz * abz;
  let s = (apx * abx + apy * aby + apz * abz) / len2;
  s = s < 0 ? 0 : s > 1 ? 1 : s;
  const dx = apx - abx * s;
  const dy = apy - aby * s;
  const dz = apz - abz * s;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - (a.r + (b.r - a.r) * s);
}

/** Gradiente exacto del tramo, incluida la derivada nula del radio en sus tapas. */
export function gbSegmentGradient(m: Vec3, a: GallbladderNode, b: GallbladderNode): Vec3 {
  const ab = sub(b.p, a.p),
    ap = sub(m, a.p);
  const len2 = dot(ab, ab),
    t = dot(ap, ab) / len2;
  const d = sub(ap, scale(ab, Math.max(0, Math.min(1, t))));
  const slope = t > 0 && t < 1 ? (b.r - a.r) / len2 : 0;
  return sub(scale(d, 1 / Math.max(length(d), 1e-6)), scale(ab, slope));
}

/** Gradiente de la misma unión suave, sin normalizar: su norma calibra el grosor del eco. */
export function gallbladderGradient(m: Vec3, g: GallbladderShape): Vec3 {
  if (abdominalAtlas) return abdominalAtlasGradient(m, 7);
  const n = g.nodes;
  let d = gbSegment(m, n[0], n[1]);
  let grad = gbSegmentGradient(m, n[0], n[1]);
  for (let i = 1; i < n.length - 1; i++) {
    const di = gbSegment(m, n[i], n[i + 1]);
    const next = gbSegmentGradient(m, n[i], n[i + 1]);
    const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (di - d)) / g.blendMm));
    grad = add(scale(next, 1 - h), scale(grad, h));
    d = smoothMin(d, di, g.blendMm);
  }
  return grad;
}

/** Distancia con signo a la luz vesicular (negativa dentro; la pared va de 0 a `wallMm`). */
export function gallbladderSdf(m: Vec3, g: GallbladderShape): number {
  if (abdominalAtlas) return abdominalAtlasSdf(m, 7) + GALLBLADDER_WALL_MM;
  const n = g.nodes;
  let d = gbSegment(m, n[0], n[1]);
  for (let i = 1; i < n.length - 1; i++) d = smoothMin(d, gbSegment(m, n[i], n[i + 1]), g.blendMm);
  return d;
}

/**
 * Gemelo GLSL. Con el gradiente exacto de la unión suave (sin normalizar; decisión 105) y, en sobrecarga sin ella, solo
 * la distancia: la usan las diferencias centrales de `faceGradient` (la cara de la luz) y la fosa del hígado de
 * `liverInner`, que antes calculaban y tiraban la normal de cada tramo. Mismas operaciones y en el mismo orden que el TS.
 */
export const GALLBLADDER_GLSL = /* glsl */ `
float gbSegment(vec3 m, vec4 a, vec4 b, out vec3 g) {
  vec3 ab = b.xyz - a.xyz;
  vec3 ap = m - a.xyz;
  float len2 = dot(ab, ab);
  float t = dot(ap, ab) / len2;
  float s = clamp(t, 0.0, 1.0);
  vec3 d = ap - ab * s;
  float dist = length(d);
  g = d / max(dist, 1e-6) - ab * ((t > 0.0 && t < 1.0) ? (b.w - a.w) / len2 : 0.0);
  return dist - (a.w + (b.w - a.w) * s);
}



float gallbladderSdf(vec3 m, out vec3 n) {
  if(uAbdominalAtlasEnabled!=0){n=abdominalAtlasGradient(m,7);return abdominalAtlasSdf(m,7)+${GALLBLADDER_WALL_MM.toFixed(3)};}
  vec3 g;
  float d = gbSegment(m, uGbNodes[0], uGbNodes[1], n);
  for (int i = 1; i < ${GALLBLADDER_NODES - 1}; i++) {
    float di = gbSegment(m, uGbNodes[i], uGbNodes[i + 1], g);
    float h = clamp(0.5 + 0.5 * (di - d) / uGbExtra.x, 0.0, 1.0);
    n = mix(g, n, h);
    d = smoothMin(d, di, uGbExtra.x);
  }
  return d;
}

float gallbladderSdf(vec3 m) {
  vec3 unused;
  return gallbladderSdf(m, unused);
}
`;
