/**
 * Gemelo en CPU de las pasadas A (transmisión de un rayo) → B → C → D de la mirada 0 sobre la anatomía real
 * (`AnatomyScene`), para la pared (decisión 62). Lo usa `wallTwin.test.ts` y el script de calibración. Usa
 * las funciones de producción:
 *  - A: la suma de A2 por segmentos gruesos (paso profundidad/160, el tejido del punto medio, 2·α·paso,
 *    hueso +6 dB al entrar, el gel antes de la piel sin pérdidas) y su interpolación lineal en amplitud entre
 *    los centros de fila (la textura de la GPU). Sin la penumbra de la apertura ni el espejo: en la pared no
 *    hay espejo, y la penumbra solo cambia lo que hay detrás de una costilla;
 *  - B: el medio anclado de tres planos (`speckleSliceField`), la retrodispersión de `TISSUES`, la
 *    heterogeneidad, los grumos, la textura de la pared (`wallTexture`, con la dirección de la línea) y el eco
 *    de interfaz (`interfaceEchoField` con `faceGradient` y la coherencia de curvatura de tubos y costillas),
 *    y el transitorio del campo cercano anclado a (línea, r);
 *  - C: gaussiana axial de σ = max(0,6; 0,26/dr) muestras, ±12, energía unidad;
 *  - D: gaussiana lateral de σ = max(0,35; σ_PSF/paso de línea) líneas, ±14, energía unidad, envolvente ×2/√π.
 * El modelo `base` es la pared de antes de la decisión 62: retrodispersión 0,55 / 0,5 / 0,6 (grasa, músculo,
 * cartílago), sin grasa preperitoneal (músculo hasta la cara interna), sin caras de pared ni de costilla y
 * sin textura. Sin respiración (el marco material es el del mundo: apnea espiratoria).
 */
import { INTERFACES, Interface, hasCurvatureCoherence, isRibInterface, isWallLayerInterface } from '../../anatomy/interfaces';
import { torsoDepth } from '../../anatomy/primitives';
import type { AnatomyScene, VesselCaliber } from '../../anatomy/scene';
import { TISSUES, Tissue, attenuationDbPerCm } from '../../anatomy/tissues';
import { cross, dot, normalize, type Vec3 } from '../../core/vec3';
import { lateralSigmaMm } from '../../ultrasound/beamModel';
import {
  IFACE_MIN_COS,
  IFACE_REACH_MM,
  IFACE_SHIFT_MM,
  curvatureCoherence,
  faceDelta,
  interfaceEchoField,
} from '../../ultrasound/interfaceEcho';
import { TRANSIENT_AMPLITUDE, TRANSIENT_DECAY_MM, TRANSIENT_SKIP_MM } from '../../ultrasound/receiver';
import {
  TISSUE_SALT_STEP,
  anchoredClumpGain,
  heterogeneityDb,
  scattererField,
  speckleSliceField,
  type SpeckleAnchorState,
} from '../../ultrasound/speckleField';
import { BONE_ENTRY_DB, GAS_DB_PER_CM } from '../../ultrasound/transmission';
import { wallFaceGain, wallTexture } from '../../ultrasound/wallTexture';
import { TWIN_GEOMETRY, elevSigmaMm, type TwinFrame, type TwinGeometry } from './compoundTwin';

export type WallModel = 'wall' | 'base';

/** Retrodispersión de la pared antes de la decisión 62. */
const BASE_BACK: Partial<Record<Tissue, number>> = { [Tissue.Fat]: 0.55, [Tissue.Muscle]: 0.5, [Tissue.Cartilage]: 0.6 };
/** Muestras gruesas de la pasada A (`COARSE_DEPTH` del renderizador). */
const COARSE = 160;
/** Frecuencia B efectiva del convexo (MHz, `CONVEX_C35_PROFILE`). */
export const B_MHZ = 2.5;
/** Número de onda del eco de interfaz (1/mm): 2π/λ con λ del haz. */
const K0 = (2 * Math.PI) / TWIN_GEOMETRY.beam.lambdaMm;

export interface WallTwinOpts {
  model: WallModel;
  /** Semilla de la aplicación (`uSeed` = (semilla mod 1000)/7). */
  seed?: number;
  /** Líneas [j0, j1] y profundidades [r0, r1] (mm) de interés; se forma el margen de C y D alrededor. */
  j0: number;
  j1: number;
  r0: number;
  r1: number;
  /** Sin transmisión (T = 1): para comparar el campo de B entre modelos. */
  noTransmission?: boolean;
  /** Sin el transitorio del campo cercano (anclado a la línea, no al material): la prueba del anclaje. */
  noTransient?: boolean;
  /**
   * Sin la textura de la pared (lóbulos, septos, estrías) pero con sus caras: la prueba de que las métricas
   * de septos y estrías no cuentan la falda de los ecos de las fascias.
   */
  noTexture?: boolean;
  /** Caras que no se dibujan (el resto, como en la GPU): las pruebas de qué eco mide cada puerta del banco. */
  noFaces?: readonly Interface[];
}

export interface WallTwinOut {
  /** Envolvente, índice (i − i0)·nL + (j − j0). */
  env: Float64Array;
  i0: number;
  i1: number;
  j0: number;
  j1: number;
  nL: number;
  dr: number;
  /** Tejido del plano central de cada muestra (mismo índice). */
  tissue: Uint8Array;
  /** Cara que dibuja cada muestra (mismo índice). */
  face: Uint8Array;
  /** Punto del mundo (= material) de cada muestra y dirección de su línea. */
  point: (i: number, j: number) => Vec3;
  dir: (j: number) => Vec3;
  rowR: (i: number) => number;
}

/** Clasificación del modelo: la de hoy o, en `base`, sin grasa preperitoneal ni caras de pared o costilla. */
export function classifyModel(scene: AnatomyScene, caliber: VesselCaliber, m: Vec3, model: WallModel) {
  const c = scene.classify(m, caliber);
  if (model === 'wall') return c;
  const wallFace = isWallLayerInterface(c.interface) || isRibInterface(c.interface);
  // la grasa preperitoneal era músculo
  const pp = c.tissue === Tissue.Fat && -torsoDepth(m, scene.torso) >= scene.torso.skinMm + scene.torso.fatMm;
  const tissue = pp ? Tissue.Muscle : c.tissue;
  return wallFace ? { ...c, tissue, interface: Interface.None, interfaceDistance: 1e3 } : { ...c, tissue };
}

function unitKernel(sigma: number, max: number): number[] {
  const R = Math.min(max, Math.ceil(sigma * 2.5));
  const w: number[] = [];
  for (let k = -R; k <= R; k++) w.push(Math.exp(-0.5 * (k / sigma) ** 2));
  const n = Math.hypot(...w);
  return w.map((v) => v / n);
}

/**
 * Marco de una sonda con el eje en la normal interior de la piel en (φ, z) (incidencia normal en la línea
 * central): transversal (lateral a lo largo de la piel, en u) o longitudinal (lateral craneal, en z).
 */
export function normalFrame(
  scene: AnatomyScene,
  phi: number,
  z: number,
  longitudinal: boolean,
  R = TWIN_GEOMETRY.curvatureRadius,
): TwinFrame {
  const t = scene.torso;
  const face: Vec3 = [t.a * Math.cos(phi), t.b * Math.sin(phi), z];
  const n = normalize([face[0] / (t.a * t.a), face[1] / (t.b * t.b), 0]);
  const axial: Vec3 = [-n[0], -n[1], -n[2]];
  const lateral: Vec3 = longitudinal ? [0, 0, 1] : normalize([n[1], -n[0], 0]);
  const elevation = normalize(cross(axial, lateral));
  return { center: [face[0] - axial[0] * R, face[1] - axial[1] * R, face[2] - axial[2] * R], axial, lateral, elevation, face };
}

/** Envolvente de la mirada 0 en un parche de la imagen (B → C → D con la transmisión de A). */
export function wallTwin(
  scene: AnatomyScene,
  caliber: VesselCaliber,
  frame: TwinFrame,
  st: SpeckleAnchorState,
  o: WallTwinOpts,
  g: TwinGeometry = TWIN_GEOMETRY,
): WallTwinOut {
  const L = g.lines;
  const dr = g.depthMm / g.samples;
  const seedF = ((o.seed ?? 1234) % 1000) / 7;
  const back = (t: Tissue): number => (o.model === 'base' ? (BASE_BACK[t] ?? TISSUES[t].backscatter) : TISSUES[t].backscatter);
  const theta = (j: number): number => -g.halfSector + (2 * g.halfSector * (j + 0.5)) / L;
  const dirOf = (j: number): Vec3 =>
    normalize([0, 1, 2].map((a) => frame.axial[a] * Math.cos(theta(j)) + frame.lateral[a] * Math.sin(theta(j))) as Vec3);
  const rowR = (i: number): number => (i + 0.5) * dr;
  const pointAt = (dir: Vec3, r: number): Vec3 => [0, 1, 2].map((a) => frame.center[a] + dir[a] * (g.curvatureRadius + r)) as Vec3;
  const pitch = (r: number): number => (g.curvatureRadius + r) * ((2 * g.halfSector) / (L - 1));
  const kA = unitKernel(Math.max(0.6, 0.26 / dr), 12);
  const RA = (kA.length - 1) / 2;
  const i0 = Math.max(0, Math.floor(o.r0 / dr));
  const i1 = Math.min(g.samples - 1, Math.ceil(o.r1 / dr));
  let RL = 0;
  const kLat = new Map<number, number[]>();
  for (let i = i0; i <= i1; i++) {
    const k = unitKernel(Math.max(0.35, lateralSigmaMm(rowR(i), g.focusMm, g.beam) / pitch(rowR(i))), 14);
    kLat.set(i, k);
    RL = Math.max(RL, (k.length - 1) / 2);
  }
  const nL = o.j1 - o.j0 + 1;
  const nR = i1 - i0 + 1;
  const wL = nL + 2 * RL;
  const wR = nR + 2 * RA;
  const re = new Float64Array(wL * wR);
  const im = new Float64Array(wL * wR);
  const tissueOut = new Uint8Array(nL * nR);
  const faceOut = new Uint8Array(nL * nR);
  const coarseStep = g.depthMm / COARSE;
  for (let a = 0; a < wL; a++) {
    const j = o.j0 - RL + a;
    const dir = dirOf(j);
    // A: prefijo grueso de un rayo, en amplitud en los centros de fila
    const Tc = new Float64Array(COARSE);
    let db = 0;
    let entered = false;
    let bone = false;
    for (let s = 0; s < COARSE; s++) {
      const t = classifyModel(scene, caliber, pointAt(dir, (s + 0.5) * coarseStep), o.model).tissue;
      if (t === Tissue.Air && !entered) {
        Tc[s] = 1;
        continue;
      }
      entered = true;
      if (TISSUES[t].bone && !bone) {
        db += BONE_ENTRY_DB;
        bone = true;
      }
      db += TISSUES[t].gas ? (GAS_DB_PER_CM * coarseStep) / 10 : (2 * attenuationDbPerCm(t, B_MHZ) * coarseStep) / 10;
      Tc[s] = Math.pow(10, -db / 20);
    }
    const Tat = (r: number): number => {
      if (o.noTransmission) return 1;
      const x = Math.min(COARSE - 1, Math.max(0, r / coarseStep - 0.5));
      const k = Math.min(COARSE - 2, Math.floor(x));
      const f = x - k;
      return Tc[k] * (1 - f) + Tc[k + 1] * f;
    };
    const lineU = (j + 0.5) / L;
    for (let b = 0; b < wR; b++) {
      const i = i0 - RA + b;
      const r = rowR(i);
      const p = pointAt(dir, r);
      const se = elevSigmaMm(r, g);
      const c0 = classifyModel(scene, caliber, p, o.model);
      const fieldFor = (m: Vec3, tissue: Tissue): [number, number] => {
        const f = speckleSliceField(m, g.latticeMm, se, seedF + tissue * TISSUE_SALT_STEP, st);
        let gain = back(tissue);
        if (tissue === Tissue.Liver || tissue === Tissue.Muscle || tissue === Tissue.Bowel || tissue === Tissue.RenalCortex)
          gain *= Math.pow(10, heterogeneityDb(m, seedF) / 20);
        if (o.model === 'wall' && !o.noTexture && (tissue === Tissue.Fat || tissue === Tissue.Muscle))
          gain *= wallTexture(m, tissue, normalize(m.map((x, k) => x - frame.center[k]) as Vec3), scene.torso);
        return [f[0] * gain, f[1] * gain];
      };
      const side = (sgn: number): [number, number] => {
        const m: Vec3 = [0, 1, 2].map((k) => p[k] + sgn * frame.elevation[k] * se) as Vec3;
        if (c0.boundaryDistance > se + 0.5) return fieldFor(m, c0.tissue);
        return fieldFor(m, classifyModel(scene, caliber, m, o.model).tissue);
      };
      const f0 = fieldFor(p, c0.tissue);
      const f1 = side(1);
      const f2 = side(-1);
      const l0 = Math.hypot(f0[0], f0[1]);
      const mag = 0.5 * l0 + 0.25 * (Math.hypot(f1[0], f1[1]) + Math.hypot(f2[0], f2[1]));
      let fr = l0 > 1e-6 ? (f0[0] * mag) / l0 : f0[0];
      let fi = l0 > 1e-6 ? (f0[1] * mag) / l0 : f0[1];
      const clump = TISSUES[c0.tissue].speckleClump ?? 0;
      if (clump > 0) {
        const k = anchoredClumpGain(p, se, clump, seedF, c0.tissue * TISSUE_SALT_STEP, st);
        fr *= k;
        fi *= k;
      }
      if (!o.noFaces?.includes(c0.interface)) fr += echoOf(scene, caliber, c0, p, dir, r, se, frame, g);
      const T = Tat(r);
      let outR = fr * T;
      let outI = fi * T;
      if (r < TRANSIENT_SKIP_MM && !o.noTransient) {
        const tr = scattererField([lineU * 190, r * 3, 1], 0.8, seedF + 7);
        const k = TRANSIENT_AMPLITUDE * Math.exp(-r / TRANSIENT_DECAY_MM);
        outR += tr[0] * k;
        outI += tr[1] * k;
      }
      re[a * wR + b] = outR;
      im[a * wR + b] = outI;
      const inPatch = a >= RL && a < RL + nL && b >= RA && b < RA + nR;
      if (inPatch) {
        tissueOut[(b - RA) * nL + (a - RL)] = c0.tissue;
        faceOut[(b - RA) * nL + (a - RL)] = c0.interface;
      }
    }
  }
  // C
  const axR = new Float64Array(wL * nR);
  const axI = new Float64Array(wL * nR);
  for (let a = 0; a < wL; a++)
    for (let i = 0; i < nR; i++) {
      let sr = 0;
      let si = 0;
      for (let q = -RA; q <= RA; q++) {
        const n = a * wR + i + RA + q;
        sr += kA[q + RA] * re[n];
        si += kA[q + RA] * im[n];
      }
      axR[a * nR + i] = sr;
      axI[a * nR + i] = si;
    }
  // D
  const env = new Float64Array(nL * nR);
  for (let i = 0; i < nR; i++) {
    const kl = kLat.get(i0 + i)!;
    const R = (kl.length - 1) / 2;
    for (let jj = 0; jj < nL; jj++) {
      let sr = 0;
      let si = 0;
      for (let q = -R; q <= R; q++) {
        const n = (jj + RL + q) * nR + i;
        sr += kl[q + R] * axR[n];
        si += kl[q + R] * axI[n];
      }
      env[i * nL + jj] = Math.hypot(sr, si) * 1.1283792;
    }
  }
  return {
    env,
    i0,
    i1,
    j0: o.j0,
    j1: o.j1,
    nL,
    dr,
    tissue: tissueOut,
    face: faceOut,
    point: (i, j) => pointAt(dirOf(j), rowR(i)),
    dir: dirOf,
    rowR,
  };
}

/** Eco de interfaz de la muestra (`interfaceEcho` de la pasada B). */
function echoOf(
  scene: AnatomyScene,
  caliber: VesselCaliber,
  c: { interface: Interface; interfaceDistance: number },
  m: Vec3,
  dir: Vec3,
  r: number,
  se: number,
  frame: TwinFrame,
  g: TwinGeometry,
): number {
  const face = c.interface;
  if (face === Interface.None) return 0;
  const reach = INTERFACES[face].twoSided ? IFACE_REACH_MM : IFACE_SHIFT_MM + IFACE_REACH_MM;
  if (c.interfaceDistance > reach * 2.5) return 0;
  const fg = scene.faceGradient(m, caliber);
  if (!fg) return 0;
  const cosI = Math.abs(dot(fg.normal, dir));
  if (cosI < IFACE_MIN_COS) return 0;
  let curv = 1;
  if (hasCurvatureCoherence(face) && fg.axis) {
    const circ = cross(fg.normal, fg.axis);
    const cl = Math.hypot(circ[0], circ[1], circ[2]);
    if (cl >= 1e-4) {
      const cu: Vec3 = [circ[0] / cl, circ[1] / cl, circ[2] / cl];
      const lat = normalize(cross(frame.elevation, dir));
      const kl = dot(lat, cu) ** 2 * fg.curvature;
      const ke = dot(frame.elevation, cu) ** 2 * fg.curvature;
      curv = curvatureCoherence(lateralSigmaMm(r, g.focusMm, g.beam), se * Math.SQRT1_2, kl, ke, K0);
    }
  }
  curv *= wallFaceGain(m, face, scene.torso);
  return interfaceEchoField(face, cosI, curv, faceDelta(c.interfaceDistance, fg.norm, cosI), K0);
}
