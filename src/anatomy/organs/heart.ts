import type { Vec3 } from '../../core/vec3';
import { sdDiaphragmSlope, sdEllipsoidLocal, smoothMin, type Diaphragm, type Torso } from '../primitives';
import { Tissue } from '../tissues';

/**
 * Corazón y mediastino (decisión 85) como módulo de órgano (decisión 46). Por encima de la cúpula (`sdDiaphragm` < 0) no
 * todo es pulmón: el corazón, en su saco pericárdico, apoya en el centro tendinoso y en la hemicúpula izquierda, y lo
 * rodea el tejido del mediastino (grasa y tejido conectivo), que sigue por detrás hasta la columna alrededor de la aorta
 * torácica; los pulmones quedan a los lados y detrás. Marco levógiro: x = izquierda del paciente, y = anterior, z = craneal.
 *
 * - Cuatro cavidades de sangre (elipsoides): el VI y el VD en el marco de los ventrículos, cuyo eje largo va de la base
 *   (atrás, arriba y a la derecha) a la punta (delante, abajo y a la izquierda: 45° a la izquierda del plano sagital y
 *   29° hacia abajo); la AD y la AI alineadas con el tronco. El VD es una media luna: su elipsoide sin lo que queda a
 *   menos del tabique interventricular del VI; la AD, sin lo que queda a menos del tabique interauricular de la AI y del
 *   auriculoventricular del VI. La AI apoya en la base del VI. Tricúspide y mitral son orificios abiertos (las cavidades se
 *   solapan: la mitral, de 14–20 mm), sin valvas.
 * - El miocardio de cada cámara rodea su cavidad; el pericardio es la capa de 1,5 mm que envuelve el miocardio y dibuja
 *   la cara pericárdica (`Interface.Pericardium`, de un lado). Sobre la cúpula el saco apoya en el diafragma: cavidades y
 *   miocardio se recortan a su pared y al pericardio por encima del suelo (`heartFloor`; la cara inferior es plana).
 * - Mediastino: 5 mm de grasa alrededor del saco, 15 mm más junto a la cúpula alrededor de los ventrículos (la grasa de los
 *   ángulos cardiofrénicos), unida de forma suave a la columna del mediastino posterior (aorta torácica, esófago y ácigos,
 *   que no se modelan aparte) desde la cúpula.
 * - La VCI cruza el diafragma por el hiato de la cava (z 53, T8) y entra en el suelo de la AD (`ivcAtrium`).
 *
 * Cifras [ESTIMADO] sobre valores publicados de un adulto (ASE/EACVI 2015: AD ≤ 53 × 44 mm; VD basal 25–41 mm y pared libre
 * 3–5 mm; VI telediastólico 42–58 mm con pared de 6–10 mm; AI 27–40 mm AP), con la geometría de un esquema de elipsoides
 * encajado en el tórax del modelo (poco profundo: 106 mm de la cara anterior de la vértebra a la pared anterior), no de una
 * malla segmentada: el VD basal (23–27 mm en el plano de cuatro cámaras) y la AI (27 mm AP) quedan en el límite inferior.
 * Las constantes del shader salen de aquí.
 */

/** Ejes del marco de los ventrículos (filas de la base): largo (base → punta), septal (VI → VD) y el tercero. */
export const HEART_AXES: readonly [Vec3, Vec3, Vec3] = [
  [0.6203, 0.6203, -0.48],
  [-0.7071, 0.7071, 0],
  [0.3394, 0.3394, 0.8772],
];
/** Origen del marco de los ventrículos: el centro de la cavidad del VI (mm, marco del tronco). */
export const HEART_ORIGIN: Vec3 = [39, 30, 50];

/**
 * Cavidades: centro y semiejes (mm). VI y VD en el marco de los ventrículos (largo, septal, tercero); AD y AI en el del
 * tronco (x, y, z).
 */
export const HEART_CAVITIES = {
  lv: { c: [0, 0, 0] as Vec3, r: [37, 21, 21] as Vec3 },
  rv: { c: [-9, 27, -10] as Vec3, r: [40, 22, 32] as Vec3 },
  ra: { c: [-22, 6, 70] as Vec3, r: [22, 21, 30] as Vec3 },
  la: { c: [13, 5, 83] as Vec3, r: [24, 14, 23] as Vec3 },
} as const;

/**
 * La AD inclinada hacia delante por arriba (coseno y seno de 25°, en el plano sagital): su suelo, atrás, recibe la VCI; su
 * parte alta queda delante de la AI.
 */
export const RA_TILT = [0.9063, 0.4226] as const;

/**
 * Grosores (mm): pared de cada cámara (VI, VD, AD, AI), tabiques interventricular, interauricular y auriculoventricular, y
 * pericardio.
 */
export const HEART_WALLS = { lv: 8, rv: 4, ra: 2, la: 2.5, ivs: 9, ias: 4, avs: 6, pericardium: 1.5 } as const;

/**
 * Más de esto (mm) por encima de la cúpula, la VCI solo existe dentro de la AD (el suelo de la aurícula: el pericardio y su
 * pared, más 1,5 mm por la pendiente de la cúpula bajo el lado medial de la VCI): su orificio está en ese suelo y su embudo
 * no atraviesa paredes ni tabiques aunque la congestión la dilate (hasta ×1,57 en los casos); fuera de la aurícula gana el
 * corazón.
 */
export const IVC_ORIFICE_MM = HEART_WALLS.pericardium + HEART_WALLS.ra + 1.5;
/** Estimated inferior approach lip, derived from the existing atrium and orifice thickness. */
export const RA_APPROACH_TOP_Z =
  HEART_CAVITIES.ra.c[2] - Math.hypot(HEART_CAVITIES.ra.r[1] * RA_TILT[1], HEART_CAVITIES.ra.r[2] * RA_TILT[0]) + IVC_ORIFICE_MM;

/**
 * Mediastino: grasa alrededor del saco (mm), unión suave con la columna (mm), grasa de los ángulos cardiofrénicos (en la
 * cúpula el margen crece `padMm`, nada a `padHeightMm` por encima) y columna del mediastino posterior, un cilindro
 * elíptico en z desde la cúpula hasta `top` (centro x, y y semiejes).
 */
export const MEDIASTINUM = {
  fatMm: 5,
  blendMm: 16,
  padMm: 15,
  padHeightMm: 20,
  column: { x: 6, y: -18, ax: 27, ay: 16, top: 130 },
  /** Esfera que contiene el corazón y el mediastino (el tejido que no es pulmón llega a 90,3 mm de su centro): fuera, pulmón. */
  bound: { c: [22, 16, 60] as Vec3, r: 94 },
} as const;

const W = HEART_WALLS;
const CAV = HEART_CAVITIES;
const MED = MEDIASTINUM;
const WALL4 = [W.lv, W.rv, W.ra, W.la] as const;

/**
 * Distancia al suelo del corazón (mm, negativa por encima de la cúpula): la del diafragma con su pendiente limitada a 2,
 * dDome·max(1, pendiente/2) = (z_cúpula − z)/min(pendiente, 2). En el borde de una hemicúpula, donde su altura sube con
 * tangente vertical, `sdDiaphragm` casi se anula en toda la columna de encima y el recorte del corazón y la grasa de la
 * cúpula levantaban allí cortinas de miocardio en las cavidades y aletas de grasa en el pulmón; con la pendiente de hasta 2
 * (63°) la distancia es la del plano tangente, la misma que antes en la cúpula lisa.
 */
export function heartFloor(dDome: number, slope: number): number {
  return dDome * Math.max(1, slope / 2);
}

/** `heartFloor` en el punto m (TS: la cara del pericardio, el corte y el navegador 3D). */
export function domeFloor(m: Vec3, d: Diaphragm, torso: Torso): number {
  const [dDome, slope] = sdDiaphragmSlope(m, d, torso);
  return heartFloor(dDome, slope);
}

/** Coordenadas de un punto en el marco de los ventrículos. */
export function heartFrame(m: Vec3): Vec3 {
  const d: Vec3 = [m[0] - HEART_ORIGIN[0], m[1] - HEART_ORIGIN[1], m[2] - HEART_ORIGIN[2]];
  const a = HEART_AXES;
  return [
    d[0] * a[0][0] + d[1] * a[0][1] + d[2] * a[0][2],
    d[0] * a[1][0] + d[1] * a[1][1] + d[2] * a[1][2],
    d[0] * a[2][0] + d[1] * a[2][1] + d[2] * a[2][2],
  ];
}

/** Coordenadas de un punto en el marco de la AD (su centro, inclinada `RA_TILT` en el plano sagital). */
export function raFrame(m: Vec3): Vec3 {
  const [c, s] = RA_TILT;
  const y = m[1] - CAV.ra.c[1];
  const z = m[2] - CAV.ra.c[2];
  return [m[0] - CAV.ra.c[0], y * c - z * s, y * s + z * c];
}

/** Elipsoide de la AD sin los tabiques (mm, negativa dentro): la VCI que entra en ella. */
export function raSdf(m: Vec3): number {
  return sdEllipsoidLocal(raFrame(m), CAV.ra.r);
}

/** Inferior crossing of the existing tilted RA at this XY, without moving its geometry.
 * Outside its projection, the lowest pole bounds the approach; no atrial opening is invented.
 */
export function raInferiorZ(x: number, y: number): number {
  const [c, s] = RA_TILT,
    [rx, ry, rz] = CAV.ra.r,
    dx = x - CAV.ra.c[0],
    dy = y - CAV.ra.c[1],
    a = (s * s) / (ry * ry) + (c * c) / (rz * rz),
    b = 2 * dy * c * s * (1 / (rz * rz) - 1 / (ry * ry)),
    cc = (dx * dx) / (rx * rx) + dy * dy * ((c * c) / (ry * ry) + (s * s) / (rz * rz)) - 1,
    discriminant = b * b - 4 * a * cc;
  return CAV.ra.c[2] + (discriminant >= 0 ? (-b - Math.sqrt(discriminant)) / (2 * a) : -Math.hypot(ry * s, rz * c));
}

/**
 * La VCI junto a la aurícula (en `classify`, tras hallar el tubo de la VCI; `floor` = `heartFloor`): la cavidad de la AD,
 * con sus tabiques tallados y recortada por la cúpula, y si el punto está fuera de ella a más de `IVC_ORIFICE_MM` sobre la
 * cúpula, donde la VCI no existe (gana el corazón: la VCI dilatada no borra el tabique interauricular ni entra en la AI).
 * `cut` es la distancia (cota) a las dos fronteras que eso crea.
 */
export function ivcAtrium(m: Vec3, floor: number): { cavity: number; outside: boolean; cut: number } {
  const ra = heartChambers(m)[2];
  const cavity = Math.max(ra, floor + W.pericardium + W.ra);
  const approach = Math.min(raInferiorZ(m[0], m[1]), RA_APPROACH_TOP_Z) - m[2];
  // A diaphragm below the inherited atrium must not delete the intervening cava.
  // Above the actual atrial entry, the original septal/outer exclusion remains.
  return {
    cavity,
    outside: ra >= 0 && floor < -IVC_ORIFICE_MM && approach < 0,
    cut: Math.min(cavity, Math.max(-ra, floor + IVC_ORIFICE_MM, approach)),
  };
}

/**
 * Distancias (mm, negativas dentro) a las cavidades del VI, VD, AD y AI, con los tabiques tallados: el VD, a `ivs` del VI;
 * la AD, a `ias` de la AI y a `avs` del VI. Sin el recorte de la cúpula.
 */
export function heartChambers(m: Vec3): [number, number, number, number] {
  const q = heartFrame(m);
  const lv = sdEllipsoidLocal(q, CAV.lv.r);
  const rv = Math.max(sdEllipsoidLocal([q[0] - CAV.rv.c[0], q[1] - CAV.rv.c[1], q[2] - CAV.rv.c[2]], CAV.rv.r), W.ivs - lv);
  const la = sdEllipsoidLocal([m[0] - CAV.la.c[0], m[1] - CAV.la.c[1], m[2] - CAV.la.c[2]], CAV.la.r);
  const ra = Math.max(raSdf(m), Math.max(W.ias - la, W.avs - lv));
  return [lv, rv, ra, la];
}

/** Resultado de `thorax`: tejido, distancia a la frontera y valor de la distancia de la cara del pericardio (1e3 sin ella). */
export interface ThoraxClass {
  tissue: Tissue;
  bd: number;
  ifd: number;
}

/**
 * Tórax, por encima de la cúpula (`dDome` = `sdDiaphragm` < 0; `floor` = `heartFloor`): sangre de una cavidad, miocardio,
 * pericardio o grasa del mediastino (los dos, `Tissue.Mediastinum`), o pulmón. Cavidades y miocardio se recortan por encima
 * del suelo a su pared y al pericardio; el saco (miocardio y pericardio) no. La capa del pericardio dibuja su cara (de un
 * lado) a la distancia del epicardio recortado. La grasa de los ángulos cardiofrénicos solo rodea los ventrículos (junto a
 * las aurículas y la VCI, el pulmón baja hasta el saco). La distancia a la frontera no cuenta los tubos (como en el hígado)
 * y es una cota salvo junto al borde de una hemicúpula (el suelo no es allí una distancia); `classify` le suma la columna
 * y la pared.
 */
export function thorax(m: Vec3, dDome: number, floor: number): ThoraxClass {
  const b = MED.bound;
  const out = Math.hypot(m[0] - b.c[0], m[1] - b.c[1], m[2] - b.c[2]) - b.r;
  if (out > 0) return { tissue: Tissue.Lung, bd: Math.min(-dDome, out), ifd: 1e3 };
  const c = heartChambers(m);
  const p = W.pericardium;
  let cav = 1e3;
  let epi = 1e3;
  for (let i = 0; i < 4; i++) {
    cav = Math.min(cav, Math.max(c[i], floor + p + WALL4[i]));
    epi = Math.min(epi, c[i] - WALL4[i]);
  }
  if (cav < 0) return { tissue: Tissue.Blood, bd: -cav, ifd: 1e3 };
  // el epicardio, recortado a la capa del pericardio sobre la cúpula
  const epiC = Math.max(epi, floor + p);
  if (epiC < 0) return { tissue: Tissue.Myocardium, bd: Math.min(-epiC, cav), ifd: 1e3 };
  if (epi < p) return { tissue: Tissue.Mediastinum, bd: Math.min(epiC, -dDome), ifd: epiC };
  const pad = MED.padMm * Math.min(1, Math.max(0, 1 + floor / MED.padHeightMm));
  const fe = Math.min(c[0] - W.lv - pad, c[1] - W.rv - pad, c[2] - W.ra, c[3] - W.la);
  const fat = (fe - p - MED.fatMm) / (1 + MED.padMm / MED.padHeightMm);
  // la columna del mediastino posterior: elipse en (x, y) cortada por arriba en `top`
  const k = MED.column;
  const column = Math.max(sdEllipsoidLocal([m[0] - k.x, m[1] - k.y, 0], [k.ax, k.ay, 1e3]), m[2] - k.top);
  const med = smoothMin(fat, column, MED.blendMm);
  if (med < 0) return { tissue: Tissue.Mediastinum, bd: Math.min(-med, Math.min(epiC, -dDome)), ifd: 1e3 };
  return { tissue: Tissue.Lung, bd: Math.min(med, -dDome), ifd: 1e3 };
}

/**
 * Epicardio recortado por el suelo (mm, negativa dentro del miocardio y las cavidades; `floor` = `heartFloor`): la cara
 * del pericardio (`faceSdf`) y la malla del navegador 3D. Solo TS.
 */
export function heartOuterSdf(m: Vec3, floor: number): number {
  const c = heartChambers(m);
  return Math.max(Math.min(c[0] - W.lv, c[1] - W.rv, c[2] - W.ra, c[3] - W.la), floor + W.pericardium);
}

const vec = (v: readonly number[]): string => `vec${v.length}(${v.map((x) => x.toFixed(4)).join(',')})`;
/** vec3 del shader: origen y ejes del marco de los ventrículos; semiejes del VI; centro y semiejes del VD, de la AD y de la AI. */
const V3 = [HEART_ORIGIN, ...HEART_AXES, CAV.lv.r, CAV.rv.c, CAV.rv.r, CAV.ra.c, CAV.ra.r, CAV.la.c, CAV.la.r];
/**
 * vec4 del shader: paredes; tabiques y pericardio; grasa, unión, grasa de la cúpula y su altura; columna (x, y, semiejes);
 * esfera envolvente; tope de la columna, suelo de la AD e inclinación de la AD.
 */
const V4 = [
  WALL4,
  [W.ivs, W.ias, W.avs, W.pericardium],
  [MED.fatMm, MED.blendMm, MED.padMm, MED.padHeightMm],
  [MED.column.x, MED.column.y, MED.column.ax, MED.column.ay],
  [...MED.bound.c, MED.bound.r],
  [MED.column.top, IVC_ORIFICE_MM, ...RA_TILT],
];

/**
 * Gemelo GLSL (usa `sdEllipsoidLocal` y `smoothMin` de la anatomía; las constantes, en `HV` y `HW` con el orden de `V3` y
 * `V4`): `thorax` recibe en `n` la normal de la cúpula (de ella saca el suelo, `heartFloor`) y devuelve el tejido (T_BLOOD,
 * T_MYOCARDIUM, T_MEDIASTINUM o T_LUNG), su distancia a la frontera en `bd` y la de la cara del pericardio en `ifd` (1e3 sin
 * ella); en la capa del pericardio deja en `n` la normal del epicardio (la del elipsoide de la cámara más cercana, o la de
 * la cúpula donde el saco apoya en ella), y en el pulmón cuya frontera más cercana es la del mediastino, la de esa frontera
 * (el espejo de la pasada A). Una sola llamada a `epiNormal`. La matriz lleva los ejes en columnas: (m − O)·B da las
 * coordenadas del marco.
 */
export const HEART_GLSL = /* glsl */ `
const vec3 HV[${V3.length}] = vec3[${V3.length}](${V3.map(vec).join(',')});
const vec4 HW[${V4.length}] = vec4[${V4.length}](${V4.map(vec).join(',')});
const mat3 HB = mat3(HV[1], HV[2], HV[3]);
vec3 heartFrame(vec3 m) { return (m - HV[0]) * HB; }
vec3 raFrame(vec3 m) { vec3 d = m - HV[7]; return vec3(d.x, d.y * HW[5].z - d.z * HW[5].w, d.y * HW[5].w + d.z * HW[5].z); }
float raSdf(vec3 m) { return sdEllipsoidLocal(raFrame(m), HV[8]); }
// normal del epicardio: la del elipsoide de la cámara más cercana (e: epicardio de cada una; VI y VD del marco al tronco; la
// AD, con la inversa de la rotación de raFrame)
vec3 epiNormal(vec3 m, vec4 e, float epi) {
  vec3 q = heartFrame(m);
  vec3 g = raFrame(m) / (HV[8] * HV[8]);
  return normalize(epi == e.x ? HB * (q / (HV[4] * HV[4])) : epi == e.y ? HB * ((q - HV[5]) / (HV[6] * HV[6]))
    : epi == e.z ? vec3(g.x, g.y * HW[5].z + g.z * HW[5].w, g.z * HW[5].z - g.y * HW[5].w) : (m - HV[9]) / (HV[10] * HV[10]));
}
vec4 heartChambers(vec3 m) {
  vec3 q = heartFrame(m);
  float lv = sdEllipsoidLocal(q, HV[4]);
  float la = sdEllipsoidLocal(m - HV[9], HV[10]);
  return vec4(lv, max(sdEllipsoidLocal(q - HV[5], HV[6]), HW[1].x - lv), max(raSdf(m), max(HW[1].y - la, HW[1].z - lv)), la);
}
// (cavidad de la AD tallada y recortada por el suelo hF, fuera de ella a más de IVC_ORIFICE_MM sobre él (1/0), cota de sus
// fronteras)
float raInferiorZ(vec2 p) {
  vec2 d=p-HV[7].xy;
  vec3 r=HV[8];
  float c=HW[5].z,s=HW[5].w;
  float a=s*s/(r.y*r.y)+c*c/(r.z*r.z);
  float b=2.0*d.y*c*s*(1.0/(r.z*r.z)-1.0/(r.y*r.y));
  float cc=d.x*d.x/(r.x*r.x)+d.y*d.y*(c*c/(r.y*r.y)+s*s/(r.z*r.z))-1.0;
  float disc=b*b-4.0*a*cc;
  return HV[7].z+(disc>=0.0?(-b-sqrt(disc))/(2.0*a):-length(vec2(r.y*s,r.z*c)));
}
vec3 ivcAtrium(vec3 m, float hF) {
  float ra = heartChambers(m).z;
  float cavity = max(ra, hF + HW[1].w + HW[0].z);
  float approach=min(raInferiorZ(m.xy),${RA_APPROACH_TOP_Z.toFixed(8)})-m.z;
  return vec3(cavity, ra >= 0.0 && hF < -HW[5].y && approach < 0.0 ? 1.0 : 0.0, min(cavity, max(max(-ra, hF + HW[5].y),approach)));
}
int thorax(vec3 m, float dDome, out float bd, out float ifd, inout vec3 n) {
  ifd = 1e3;
  // el suelo del corazón (heartFloor): la pendiente de la cúpula sale de su normal (n.z = −1/pendiente), limitada a 2
  float hF = dDome * max(1.0, -0.5 / n.z);
  float outside = distance(m, HW[4].xyz) - HW[4].w;
  bd = min(-dDome, outside);
  if (outside > 0.0) return T_LUNG;
  vec4 c = heartChambers(m);
  float p = HW[1].w;
  vec4 cc = max(c, vec4(hF + p) + HW[0]);
  float cav = min(min(cc.x, cc.y), min(cc.z, cc.w));
  vec4 e = c - HW[0];
  float epi = min(min(e.x, e.y), min(e.z, e.w));
  bd = -cav;
  if (cav < 0.0) return T_BLOOD;
  float epiC = max(epi, hF + p);
  bd = min(-epiC, cav);
  if (epiC < 0.0) return T_MYOCARDIUM;
  // la grasa: alrededor del saco y, junto a los ventrículos, la de los ángulos cardiofrénicos sobre la cúpula
  vec4 f = e - vec4(vec2(HW[2].z * clamp(1.0 + hF / HW[2].w, 0.0, 1.0)), 0.0, 0.0);
  float fe = min(min(f.x, f.y), min(f.z, f.w));
  float fat = (fe - p - HW[2].x) / (1.0 + HW[2].z / HW[2].w);
  // la columna del mediastino posterior: elipse en (x, y) cortada por arriba
  vec2 q = m.xy - HW[3].xy;
  float ell = sdEllipsoidLocal(vec3(q, 0.0), vec3(HW[3].zw, 1e3));
  float column = max(ell, m.z - HW[5].x);
  float med = smoothMin(fat, column, HW[2].y);
  bool sac = epi < p;
  bd = sac ? min(epiC, -dDome) : med < 0.0 ? min(-med, min(epiC, -dDome)) : min(med, -dDome);
  if (sac) ifd = epiC;
  // la normal: en el saco, la del epicardio (donde apoya en la cúpula, la de ella, la que trae n); en el pulmón que se
  // alcanza desde el mediastino (su frontera, más cerca que la cúpula), la de esa frontera, la del saco o la de la columna
  // (su tapa, +z), para el espejo de la pasada A: con la de la cúpula el camino reflejado se perdía (una zona negra)
  bool mirror = !sac && med >= 0.0 && med < -dDome;
  if (mirror && fat >= column) n = m.z - HW[5].x > ell ? vec3(0.0, 0.0, 1.0) : normalize(vec3(q / (HW[3].zw * HW[3].zw), 0.0));
  else if (sac ? epi > hF + p : mirror) n = epiNormal(m, sac ? e : f, sac ? epi : fe);
  return sac || med < 0.0 ? T_MEDIASTINUM : T_LUNG;
}
`;
