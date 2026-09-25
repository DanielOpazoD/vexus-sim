/**
 * Contorno del hígado en el plano de imagen (PR 0 de las decisiones 60 y 63), portado del diseño
 * «geometry-first» (`design-contour/geometry-first/contour.ts`) sobre las funciones de producción. Lo usa
 * `liverContour.test.ts`.
 *
 *  - Superficie: marching squares, en una rejilla de pantalla de 0,25 mm sobre el sector de 18 cm, de
 *    inner = −`faceSdf('liverSurface')` (el mismo min de hígado, cúpula y pared que decide `classifyLiver`),
 *    remuestreada cada 0,5 mm de arco. Normales de `faceGradient` (la de la GPU y del banco).
 *  - Atribución (`liverTerms`): qué término de la fórmula de hoy manda en cada vértice (lóbulos, cara
 *    visceral, impresión renal, fosa vesicular, fisura, pared o cúpula). Reproduce `faceSdf` exactamente;
 *    cuando la decisión 60 cambie la fórmula, queda como la referencia de «hoy» para sus guardas.
 *  - Dueño de la cara: la cúpula si su cara está a ≤ 0,2 mm de la del hígado (`DOME_OWNER_MM`, la igualdad
 *    exacta del min duro con margen de rejilla), Morison si la grasa perirrenal la toca y la cápsula en el
 *    resto. Cuando la decisión 60 dé el peso continuo de dueño (ifw), el nivel se multiplicará aquí por él.
 *  - Nivel previsto del eco (dB sobre el moteado): el lóbulo coherente de la decisión 57 con los parámetros
 *    de producción de cada cara (`facetLobe`·`roughnessCoherence` relativos a la incidencia normal) sobre el
 *    pico medido con GPU a < 15° (cápsula 19 dB, cúpula 17 dB). Visible desde +6 dB, como el banco.
 *  - Oculto: línea desacoplada (< 0,5) o con pulmón o gas intestinal antes del vértice.
 *
 * Métricas: aristas 3D (la normal gira > 8° entre vértices a 0,5 mm), extremos de los tramos visibles de la
 * cápsula (fundido de 15 a 6 dB, extremos bruscos y cambios de dueño) y tramos rectos (flecha ≤ 0,25 o
 * 0,5 mm en ≥ 20 mm, solo informados: con 0,1 mm la flecha es 0,4 px de la rejilla).
 */
import { MORISON_CONTACT_MM, INTERFACES, Interface } from '../../anatomy/interfaces';
import { kidneyLocal, kidneyOuterSdf } from '../../anatomy/organs/kidney';
import { gallbladderSdf } from '../../anatomy/organs/gallbladder';
import { GALLBLADDER_FOSSA_ROUND_MM, RENAL_IMPRESSION, visceralPlaneDistance } from '../../anatomy/organs/liver';
import { umbilicalFissureSdf } from '../../anatomy/organs/liverLigaments';
import { sdDiaphragm, sdEllipsoid, smoothMax, smoothMin, torsoDepth } from '../../anatomy/primitives';
import { AnatomyScene, BASELINE_CALIBER, type VesselCaliber } from '../../anatomy/scene';
import { DIAPHRAGM_THICKNESS_MM, Tissue } from '../../anatomy/tissues';
import { START_POINTS, type StartPoint } from '../../app/startPoints';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../../cases';
import type { Vec3 } from '../../core/vec3';
import type { ProbeCompression } from '../../anatomy/compression';
import { contactCoupling, probeContact } from '../../probe/contact';
import { CONVEX_C35, lineDirection, pointOnLine, probeFrame, type ProbeFrame, type ProbePose } from '../../probe/probe';
import { facetLobe, roughnessCoherence } from '../../ultrasound/interfaceEcho';
import { FACE_GRADIENT_EPS_MM } from '../../anatomy/interfaces';

export const CONTOUR_DEPTH_MM = 180;
/** Paso de la rejilla de pantalla (mm) y de los vértices a lo largo del contorno (mm de arco). */
export const CONTOUR_GRID_MM = 0.25;
export const CONTOUR_STEP_MM = 0.5;
/** Arista 3D: la normal gira más que esto (°) entre vértices contiguos (radio de curvatura < 3,6 mm). */
export const CREASE_DEG = 8;
/** Nivel mostrado (dB sobre el moteado) desde el que la cara se ve, como `GAP_DB` del banco. */
export const VISIBLE_DB = 6;
/** Nivel desde el que empieza el fundido de un extremo (dB). */
export const FADE_FROM_DB = 15;
/** La cara es de la cúpula si su distancia supera a la del hígado en ≤ esto (mm). */
export const DOME_OWNER_MM = 0.2;
/** Pico del eco sobre el moteado a < 15° medido con GPU (decisión 57): cápsula y cúpula (dB). */
export const PEAK_DB = { capsule: 19, dome: 17 } as const;
const K0 = (2 * Math.PI) / (1540 / 3.5e3);

export type ContourCase = 'normal' | 'severe';
export type ContourLabel =
  'lobeR' | 'lobeL' | 'lobeBlend' | 'visceral' | 'visceralBlend' | 'renal' | 'gbFossa' | 'fissure' | 'wall' | 'dome';
export type ContourOwner = 'capsule' | 'dome' | 'morison';

/** Plano de imagen de una vista: la pose de partida en apnea espiratoria (la de las capturas), con desvíos. */
export interface ContourView {
  id: string;
  scene: AnatomyScene;
  frame: ProbeFrame;
  caliber: VesselCaliber;
  pose: ProbePose;
  /**
   * Contacto de la pose (decisión 63): solo el acoplamiento de las líneas; el contorno se mide sobre la anatomía
   * rígida (la forma del hígado, no su compresión: la placa no llega al hígado salvo en su cara anterior).
   */
  contact: ProbeCompression;
}

const scenes = new Map<ContourCase, AnatomyScene>();
function sceneOf(c: ContourCase): AnatomyScene {
  let s = scenes.get(c);
  if (!s) {
    s = new AnatomyScene(c === 'normal' ? NORMAL_ADULT : SEVERE_CONGESTION);
    scenes.set(c, s);
  }
  return s;
}

/**
 * Poses de las capturas del dueño (24-09-2026) que ya no son las de partida: la intercostal de entonces (casi
 * craneocaudal); desde la decisión 62 la de partida va por el 8.º espacio. El contorno se compara con las capturas
 * y el banco sin GPU (`fidelityScene.test.ts`) mide en ella las suprahepáticas oblicuas y Morison.
 */
export const CAPTURE_POSES: Partial<Record<StartPoint['id'], Pick<StartPoint, 'phi' | 'z' | 'yaw' | 'rock' | 'tilt'>>> = {
  intercostal: { phi: Math.PI * 0.88, z: 8, yaw: 0.35 },
};

/**
 * Vista `sp` del caso: la pose de partida con φ + `dPhi`, basculación + `dRock` e inclinación + `dTilt`
 * (rad). Apnea espiratoria: el diafragma en espiración y la VCI con apScale 0,777.
 */
export function contourView(c: ContourCase, sp: StartPoint['id'], dPhi = 0, dRock = 0, dTilt = 0): ContourView {
  const scene = sceneOf(c);
  const p = CAPTURE_POSES[sp] ?? START_POINTS.find((s) => s.id === sp)!;
  const pose: ProbePose = { phi: p.phi + dPhi, z: p.z, lift: 0, yaw: p.yaw, rock: (p.rock ?? 0) + dRock, tilt: (p.tilt ?? 0) + dTilt };
  const frame = probeFrame(pose, scene.torso, CONVEX_C35);
  return {
    id: `${c}-${sp}`,
    scene,
    frame,
    caliber: { ...BASELINE_CALIBER, ivcApScale: 0.777 },
    pose,
    contact: probeContact(pose, frame, CONVEX_C35, scene.torso),
  };
}

/** Términos de la superficie hepática de hoy en un punto material: inner = −faceSdf('liverSurface'). */
export interface LiverTerms {
  inner: number;
  /** El término que manda (el de la etiqueta del contorno). */
  label: ContourLabel;
  /** Distancia de la cara del diafragma (sdDiaphragm − grosor). */
  dDiaphragm: number;
  /** Distancia (mm) entre los dos menores de hígado, cúpula y pared: < 1 junto a una arista del min. */
  hardGap: number;
}

/**
 * La fórmula de hoy de `faceSdf('liverSurface')` término a término: lóbulos (unión suave), cara visceral,
 * impresión renal, fosa vesicular y fisura (`liverSdf`), y el min duro con la cúpula y la pared.
 */
export function liverTerms(s: AnatomyScene, m: Vec3): LiverTerms {
  const dR = sdEllipsoid(m, s.liver);
  const dL = sdEllipsoid(m, s.liverLeft);
  const d0 = smoothMin(dR, dL, s.liverBlendMm);
  let label: ContourLabel = Math.abs(dR - dL) < s.liverBlendMm ? 'lobeBlend' : dR < dL ? 'lobeR' : 'lobeL';
  const visc = -visceralPlaneDistance(m, s.visceralPlane);
  const d1 = smoothMax(d0, visc, s.visceralPlane.edgeRoundMm);
  if (d1 > d0 + 1e-3) label = Math.abs(d0 - visc) < s.visceralPlane.edgeRoundMm ? 'visceralBlend' : 'visceral';
  const dk = kidneyOuterSdf(kidneyLocal(m, s.kidneyRight), s.kidneyRight);
  const d2 = smoothMax(d1, -(dk - s.renalImpressionMm), RENAL_IMPRESSION.roundMm);
  if (d2 > d1 + 1e-3) label = 'renal';
  const d3 = smoothMax(d2, -(gallbladderSdf(m, s.gallbladder) - s.gallbladderWallMm), GALLBLADDER_FOSSA_ROUND_MM);
  if (d3 > d2 + 1e-3) label = 'gbFossa';
  const d4 = smoothMax(d3, -umbilicalFissureSdf(m, d3, s.umbilicalFissure), s.umbilicalFissure.roundMm);
  if (d4 > d3 + 1e-3) label = 'fissure';
  const wall = -torsoDepth(m, s.torso) - s.wallThickness();
  const dDiaphragm = sdDiaphragm(m, s.diaphragm, s.torso) - DIAPHRAGM_THICKNESS_MM;
  const t = [-d4, dDiaphragm, wall].sort((a, b) => a - b);
  if (t[0] === wall) label = 'wall';
  else if (t[0] === dDiaphragm) label = 'dome';
  return { inner: t[0], label, dDiaphragm, hardGap: t[1] - t[0] };
}

/** Nivel previsto del eco de la cara (dB sobre el moteado) con incidencia cosI: lóbulo de la decisión 57. */
export function faceLevelDb(cosI: number, owner: 'capsule' | 'dome'): number {
  if (cosI < 0.05) return -60;
  const p = INTERFACES[owner === 'dome' ? Interface.DiaphragmLiver : Interface.LiverCapsule];
  const rel =
    (facetLobe(cosI, p.slopeRms) * roughnessCoherence(cosI, p.roughnessMm, K0)) /
    (facetLobe(1, p.slopeRms) * roughnessCoherence(1, p.roughnessMm, K0));
  return Math.max(-60, PEAK_DB[owner] + 20 * Math.log10(rel));
}

export interface ContourVertex {
  /** Pantalla (mm, origen en el centro de curvatura, X a la derecha, Y hacia abajo). */
  X: number;
  Y: number;
  /** Arco a lo largo de su cadena (mm). */
  s: number;
  theta: number;
  r: number;
  /** Punto material. */
  p: Vec3;
  label: ContourLabel;
  owner: ContourOwner;
  /** Normal 3D (unitaria) de la cara y coseno de incidencia con la línea. */
  n: Vec3;
  cosI: number;
  /** Nivel previsto del eco (dB sobre el moteado); NaN en Morison (su cara no es la del hígado). */
  db: number;
  hidden: boolean;
}

export interface Crease {
  at: [number, number];
  /** Giro de la normal entre los vértices a −2,5 y +2 mm. */
  turnDeg: number;
  labels: string;
  /** Algún lado es la fisura umbilical (surco real, no una arista del min). */
  fissure: boolean;
  /** Salto del nivel previsto del eco a través de la arista (dB). */
  dbJump: number;
}

export interface ContourReport {
  view: string;
  /** Cadenas de vértices cada 0,5 mm de arco. */
  chains: ContourVertex[][];
  vertices: ContourVertex[];
  lengthMm: number;
  creases: Crease[];
  capsule: {
    lenMm: number;
    visibleMm: number;
    /** Extremos de los tramos visibles de la cápsula que no son de sombra, borde ni cambio de dueño. */
    runs: number;
    /** De ellos, los bruscos: el nivel cae ≥ 6 dB en 1 mm de arco a través del umbral de +6 dB. */
    abruptEnds: number;
    /** Extremos en que la cara pasa a la cúpula o a Morison (un corte en la imagen: hoy, un escalón). */
    ownerSwitches: number;
    /** Arco (mm) de 15 a 6 dB en cada extremo (`runs`). */
    fadeMm: number[];
  };
  dome: { lenMm: number; visibleMm: number };
}

/** Pantalla → haz (θ > 0 es el marcador, a la izquierda de la pantalla). */
function screenToBeam(X: number, Y: number): { theta: number; r: number } {
  return { theta: -Math.atan2(X, Y), r: Math.hypot(X, Y) - CONVEX_C35.curvatureRadius };
}
const inSector = (theta: number, r: number): boolean => Math.abs(theta) <= CONVEX_C35.halfSector && r >= 0 && r <= CONTOUR_DEPTH_MM;

type Seg = [number, number, number, number];

/** Segmentos de la isolínea 0 de F (NaN fuera del sector) en una rejilla w × h. */
function march(F: Float32Array, w: number, h: number, x0: number, y0: number, mm: number): Seg[] {
  const segs: Seg[] = [];
  const at = (i: number, j: number) => F[j * w + i];
  const P = (i: number, j: number): [number, number] => [x0 + (i + 0.5) * mm, y0 + (j + 0.5) * mm];
  const cross = (i0: number, j0: number, i1: number, j1: number): [number, number] => {
    const a = at(i0, j0);
    const t = a / (a - at(i1, j1));
    const p0 = P(i0, j0);
    const p1 = P(i1, j1);
    return [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t];
  };
  // aristas de la celda: 0 arriba, 1 derecha, 2 abajo, 3 izquierda
  const pairs: Record<number, [number, number][]> = {
    1: [[3, 0]],
    2: [[0, 1]],
    3: [[3, 1]],
    4: [[1, 2]],
    5: [
      [3, 0],
      [1, 2],
    ],
    6: [[0, 2]],
    7: [[3, 2]],
    8: [[2, 3]],
    9: [[0, 2]],
    10: [
      [0, 1],
      [2, 3],
    ],
    11: [[1, 2]],
    12: [[1, 3]],
    13: [[0, 1]],
    14: [[0, 3]],
  };
  for (let j = 0; j < h - 1; j++)
    for (let i = 0; i < w - 1; i++) {
      const v = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
      if (v.some((x) => Number.isNaN(x))) continue;
      const code = (v[0] > 0 ? 1 : 0) | (v[1] > 0 ? 2 : 0) | (v[2] > 0 ? 4 : 0) | (v[3] > 0 ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const e = [cross(i, j, i + 1, j), cross(i + 1, j, i + 1, j + 1), cross(i, j + 1, i + 1, j + 1), cross(i, j, i, j + 1)];
      for (const [a, b] of pairs[code]) segs.push([e[a][0], e[a][1], e[b][0], e[b][1]]);
    }
  return segs;
}

/** Encadena los segmentos por sus extremos comunes. */
function chain(segs: readonly Seg[]): [number, number][][] {
  const key = (x: number, y: number) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)}`;
  const adj = new Map<string, number[]>();
  segs.forEach((s, k) => {
    for (const kk of [key(s[0], s[1]), key(s[2], s[3])]) adj.set(kk, [...(adj.get(kk) ?? []), k]);
  });
  const used = new Uint8Array(segs.length);
  const out: [number, number][][] = [];
  for (let k0 = 0; k0 < segs.length; k0++) {
    if (used[k0]) continue;
    used[k0] = 1;
    const pts: [number, number][] = [
      [segs[k0][0], segs[k0][1]],
      [segs[k0][2], segs[k0][3]],
    ];
    for (const dir of [1, -1]) {
      for (;;) {
        const end = dir === 1 ? pts[pts.length - 1] : pts[0];
        const q = (adj.get(key(end[0], end[1])) ?? []).find((c) => !used[c]);
        if (q === undefined) break;
        used[q] = 1;
        const s = segs[q];
        const next: [number, number] = key(s[0], s[1]) === key(end[0], end[1]) ? [s[2], s[3]] : [s[0], s[1]];
        if (dir === 1) pts.push(next);
        else pts.unshift(next);
      }
    }
    out.push(pts);
  }
  return out;
}

/** Remuestrea una polilínea cada `ds` mm de arco. */
function resample(pts: readonly [number, number][], ds: number): [number, number][] {
  const out: [number, number][] = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    let [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    let len = Math.hypot(x1 - x0, y1 - y0);
    while (carry + len >= ds) {
      const t = (ds - carry) / len;
      x0 += (x1 - x0) * t;
      y0 += (y1 - y0) * t;
      out.push([x0, y0]);
      len = Math.hypot(x1 - x0, y1 - y0);
      carry = 0;
    }
    carry += len;
  }
  return out;
}

const angleDeg = (a: Vec3, b: Vec3): number =>
  (Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180) / Math.PI;

/**
 * Contorno del hígado de una vista. `inner` (positivo dentro del parénquima) es por omisión el de
 * producción, −`faceSdf('liverSurface')`, con las normales de `faceGradient`; con otro `inner` (la fórmula
 * de hoy cuando la decisión 60 la cambie) las normales son su gradiente por diferencias centrales.
 */
export function analyzeContour(v: ContourView, inner?: (m: Vec3) => number): ContourReport {
  const innerOf = inner ?? ((m: Vec3) => -v.scene.faceSdf(m, v.caliber, 'liverSurface')!);
  const RC = CONVEX_C35.curvatureRadius;
  const half = CONVEX_C35.halfSector;
  const mm = CONTOUR_GRID_MM;
  const xMax = (RC + CONTOUR_DEPTH_MM) * Math.sin(half) + 2;
  const x0 = -xMax;
  const y0 = RC * Math.cos(half) - 2;
  const w = Math.ceil((2 * xMax) / mm);
  const h = Math.ceil((RC + CONTOUR_DEPTH_MM + 2 - y0) / mm);
  const F = new Float32Array(w * h).fill(Number.NaN);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const { theta, r } = screenToBeam(x0 + (i + 0.5) * mm, y0 + (j + 0.5) * mm);
      if (inSector(theta, r) && r >= 2) F[j * w + i] = innerOf(pointOnLine(v.frame, CONVEX_C35, theta, r));
    }
  const ds = CONTOUR_STEP_MM;
  const chains: ContourVertex[][] = [];
  const creases: Crease[] = [];
  const capsule: ContourReport['capsule'] = { lenMm: 0, visibleMm: 0, runs: 0, abruptEnds: 0, ownerSwitches: 0, fadeMm: [] };
  const dome = { lenMm: 0, visibleMm: 0 };
  let lengthMm = 0;
  for (const c of chain(march(F, w, h, x0, y0, mm)).filter((x) => x.length > 8)) {
    const pts = resample(c, ds);
    if (pts.length < 10) continue;
    const vs = pts.map(([X, Y], k): ContourVertex => {
      const { theta, r } = screenToBeam(X, Y);
      const p = pointOnLine(v.frame, CONVEX_C35, theta, r);
      const t = liverTerms(v.scene, p);
      // normal hacia fuera del hígado (gradiente de la distancia de la cara, −inner)
      let n: Vec3;
      if (inner) {
        const g: Vec3 = [0, 0, 0];
        for (let a = 0; a < 3; a++) {
          const pp: Vec3 = [p[0], p[1], p[2]];
          const pm: Vec3 = [p[0], p[1], p[2]];
          pp[a] += FACE_GRADIENT_EPS_MM;
          pm[a] -= FACE_GRADIENT_EPS_MM;
          g[a] = inner(pm) - inner(pp);
        }
        const l = Math.hypot(g[0], g[1], g[2]) || 1;
        n = [g[0] / l, g[1] / l, g[2] / l];
      } else n = v.scene.faceGradient(p, v.caliber, 'liverSurface')!.normal;
      const d = lineDirection(v.frame, theta);
      const cosI = Math.abs(n[0] * d[0] + n[1] * d[1] + n[2] * d[2]);
      let hidden = contactCoupling(v.contact, theta) < 0.5;
      for (let rr = 1; rr < r - 1 && !hidden; rr += 1) {
        const tt = v.scene.classify(pointOnLine(v.frame, CONVEX_C35, theta, rr), v.caliber).tissue;
        if (tt === Tissue.Lung || tt === Tissue.BowelGas) hidden = true;
      }
      const s = v.scene;
      const dPeri =
        Math.min(kidneyOuterSdf(kidneyLocal(p, s.kidneyRight), s.kidneyRight), kidneyOuterSdf(kidneyLocal(p, s.kidneyLeft), s.kidneyLeft)) -
        s.perirenalMm;
      const innerHere = innerOf(p);
      const owner: ContourOwner =
        t.dDiaphragm - innerHere <= DOME_OWNER_MM ? 'dome' : dPeri <= MORISON_CONTACT_MM + 0.5 ? 'morison' : 'capsule';
      const db = owner === 'morison' ? Number.NaN : faceLevelDb(cosI, owner);
      return { X, Y, s: k * ds, theta, r, p, label: t.label, owner, n, cosI, db, hidden };
    });
    chains.push(vs);
    const n = vs.length;
    // aristas 3D: una por evento (la normal gira > 8° entre vértices; los contiguos son el mismo)
    for (let q = 1; q < n; q++) {
      if (vs[q].hidden && vs[q - 1].hidden) continue;
      if (angleDeg(vs[q].n, vs[q - 1].n) <= CREASE_DEG) continue;
      if (q > 1 && angleDeg(vs[q - 1].n, vs[q - 2].n) > CREASE_DEG) continue;
      const a = vs[Math.max(0, q - 5)];
      const b = vs[Math.min(n - 1, q + 4)];
      const lv = (x: ContourVertex) => (Number.isFinite(x.db) ? Math.max(-60, x.db) : -60);
      creases.push({
        at: [vs[q].X, vs[q].Y],
        turnDeg: angleDeg(a.n, b.n),
        labels: `${a.label}|${b.label}`,
        fissure: a.label === 'fissure' || b.label === 'fissure',
        dbJump: Math.abs(lv(vs[q]) - lv(vs[q - 1])),
      });
    }
    for (const x of vs) {
      if (x.hidden) continue;
      lengthMm += ds;
      if (x.owner === 'capsule') {
        capsule.lenMm += ds;
        if (x.db >= VISIBLE_DB) capsule.visibleMm += ds;
      } else if (x.owner === 'dome') {
        dome.lenMm += ds;
        if (x.db >= VISIBLE_DB) dome.visibleMm += ds;
      }
    }
    // extremos de los tramos visibles de la cápsula
    const on = (x: number) => vs[x].owner === 'capsule' && !vs[x].hidden && vs[x].db >= VISIBLE_DB;
    for (let q = 1; q < n; q++)
      for (const [inside, outside, dir] of [
        [q - 1, q, 1],
        [q, q - 1, -1],
      ] as const) {
        if (!(on(inside) && !on(outside))) continue;
        if (vs[outside].hidden) continue; // lo corta una sombra o el borde de la imagen, no la cara
        if (vs[outside].owner !== 'capsule') {
          capsule.ownerSwitches++;
          continue;
        }
        capsule.runs++;
        let back: number = inside;
        while (back - dir >= 0 && back - dir < n && on(back - dir) && vs[back].db < FADE_FROM_DB) back -= dir;
        capsule.fadeMm.push(Math.abs(vs[inside].s - vs[back].s));
        // brusco: de su último vértice visible al que está 1 mm más allá cae ≥ 6 dB
        const beyond = outside + dir;
        if (beyond >= 0 && beyond < n && vs[inside].db - Math.max(-60, vs[beyond].db) >= VISIBLE_DB) capsule.abruptEnds++;
      }
  }
  return { view: v.id, chains, vertices: chains.flat(), lengthMm, creases, capsule, dome };
}

/**
 * Tramos rectos del contorno visible: cuerdas de ≥ `minLenMm` cuya flecha (distancia máxima de los
 * vértices a la cuerda) no pasa de `sagMm`, con más de la mitad de sus vértices a la vista. Solo se
 * informan: con 0,25 mm la flecha es 1 px de la rejilla y con 0,1 mm, 0,4 px (ruido de la isolínea).
 */
export function straightRuns(rep: ContourReport, sagMm: number, minLenMm = 20): { lenMm: number; labels: string }[] {
  const out: { lenMm: number; labels: string }[] = [];
  for (const vs of rep.chains) {
    const n = vs.length;
    let a = 0;
    while (a < n - 1) {
      let b = a + 1;
      while (b + 1 < n) {
        const [x0, y0] = [vs[a].X, vs[a].Y];
        const [x1, y1] = [vs[b + 1].X, vs[b + 1].Y];
        const len = Math.hypot(x1 - x0, y1 - y0);
        let dev = 0;
        for (let q = a; q <= b + 1; q++) dev = Math.max(dev, Math.abs((vs[q].X - x0) * (y1 - y0) - (vs[q].Y - y0) * (x1 - x0)) / len);
        if (dev > sagMm) break;
        b++;
      }
      const len = (b - a) * CONTOUR_STEP_MM;
      if (len >= minLenMm) {
        const seg = vs.slice(a, b + 1);
        if (seg.filter((x) => !x.hidden).length / seg.length > 0.5)
          out.push({ lenMm: len, labels: [...new Set(seg.map((x) => x.label))].join('+') });
        a = b;
      } else a++;
    }
  }
  return out;
}
