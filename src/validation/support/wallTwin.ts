/**
 * Gemelo en CPU de las pasadas A (transmisión de un rayo) → B → C → D de la mirada 0 sobre la anatomía real
 * (`AnatomyScene`), para la pared (decisión 62). Lo usa `wallTwin.test.ts` y el script de calibración. Usa
 * las funciones de producción:
 *  - A: la suma de A2 por segmentos gruesos (paso profundidad/160, el tejido del punto medio, 2·α·paso,
 *    la entrada en el hueso, `BONE_ENTRY_DB`, el gel antes de la piel sin pérdidas) y su interpolación lineal en
 *    amplitud entre los centros de fila, sin mezclar a través de la entrada en un hueso (`transmissionLerp`, la de la
 *    pasada B). Sin la penumbra de la apertura ni el espejo: en la pared no hay espejo, y la penumbra solo cambia lo
 *    que hay detrás de una costilla (sin ella, la transmisión de la apertura es la del rayo central, así que la de los
 *    ecos especulares de la decisión 88 es la misma);
 *  - B: el medio anclado de tres planos (`speckleSliceField`, con los dispersores fuertes del tejido), la retrodispersión
 *    de `TISSUES`, la heterogeneidad, la densidad de dispersores y las tríadas del hígado con el haz de la línea (decisión
 *    89), los grumos, la textura de la pared (`wallTexture`, con la dirección de la línea), la del «resto»
 *    (`restTexture`) y la de los músculos retroperitoneales (`retroTexture`, decisión 81) y el eco
 *    de interfaz (la especular de la faceta, `facetEchoField`, con `faceGradient`, el campo de inclinación anclado y la
 *    coherencia de curvatura de tubos y costillas, y la difusa sobre el fasor del moteado: decisión 65), y el
 *    transitorio del campo cercano anclado a (línea, r);
 *  - C: gaussiana axial de σ = max(0,6; σ_ax(r)/dr) muestras (`axialSigmaMm`, decisión 84), ±12, energía unidad;
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
import { axialSigmaMm, lateralSigmaMm } from '../../ultrasound/beamModel';
import { focalGain, frequencyRatio } from '../../ultrasound/beamEcho';
import { restTexture } from '../../ultrasound/restTexture';
import { portalTriadGain } from '../../ultrasound/portalTriads';
import { retroTexture } from '../../ultrasound/retroTexture';
import { CLUTTER, applyComplexKernel, clutterParams, lateralKernel, reverbGains, reverbGateWeight } from '../../ultrasound/clutter';
import {
  IFACE_MIN_COS,
  IFACE_REACH_MM,
  IFACE_SHIFT_MM,
  addInterfaceEcho,
  curvatureCoherence,
  diffuseEchoField,
  faceDelta,
  faceLitFromProbe,
  faceSiteGain,
  facetCosine,
  facetEchoField,
  facetTilt,
  interfaceEchoField,
} from '../../ultrasound/interfaceEcho';
import { TRANSIENT_AMPLITUDE, TRANSIENT_DECAY_MM, TRANSIENT_SKIP_MM } from '../../ultrasound/receiver';
import {
  TISSUE_SALT_STEP,
  anchoredClumpGain,
  densityGain,
  heterogeneityDb,
  scattererField,
  speckleSliceField,
  strongScatter,
  type SpeckleAnchorState,
} from '../../ultrasound/speckleField';
import { BONE_ENTRY_DB, GAS_DB_PER_CM, transmissionLerp } from '../../ultrasound/transmission';
import { wallFaceGain, wallTexture } from '../../ultrasound/wallTexture';
import { TWIN_GEOMETRY, elevSigmaMm, type TwinFrame, type TwinGeometry } from './compoundTwin';

export type WallModel = 'wall' | 'base';

/** Retrodispersión de la pared antes de la decisión 62. */
const BASE_BACK: Partial<Record<Tissue, number>> = { [Tissue.Fat]: 0.55, [Tissue.Muscle]: 0.5, [Tissue.Cartilage]: 0.6 };
/** Tejidos con la heterogeneidad lenta del parénquima (`hetGain` de `fieldFor`). */
const HET_TISSUES: ReadonlySet<Tissue> = new Set([
  Tissue.Liver,
  Tissue.Muscle,
  Tissue.Bowel,
  Tissue.RenalCortex,
  Tissue.Psoas,
  Tissue.QuadratusLumborum,
]);
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
  /** Sin las réplicas de reverberación de la pared (decisión 76): para comparar el campo de B bit a bit. */
  noReverb?: boolean;
  /** El eco de la decisión 57 (lóbulo del conjunto, χ(θ), sin facetas ni difusa): la comparación de la 65. */
  noFacets?: boolean;
  /**
   * Sin el pedestal de lóbulos laterales (decisión 76): llega a ±40 líneas, hasta los bordes del sector, donde los
   * modelos de pared difieren a la misma profundidad; para comparar el campo de B bit a bit.
   */
  noPedestal?: boolean;
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
  const i0 = Math.max(0, Math.floor(o.r0 / dr));
  const i1 = Math.min(g.samples - 1, Math.ceil(o.r1 / dr));
  // C: el pulso de cada fila (se alarga con la bajada de la frecuencia central, decisión 84)
  const kAx = new Map<number, number[]>();
  let RA = 0;
  for (let i = i0; i <= i1; i++) {
    const k = unitKernel(Math.max(0.6, axialSigmaMm(rowR(i), g.beam) / dr), 12);
    kAx.set(i, k);
    RA = Math.max(RA, (k.length - 1) / 2);
  }
  let RL = 0;
  // ecos parásitos del paciente (decisión 76): pedestal de lóbulos laterales y réplicas de reverberación de la pared
  const cp = clutterParams(scene.wallThickness(), scene.torso.fatMm);
  const kLat = new Map<number, Array<[number, number]>>();
  const latSigma = (i: number): number => Math.max(0.35, lateralSigmaMm(rowR(i), g.focusMm, g.beam) / pitch(rowR(i)));
  const cpLat = o.noPedestal ? { ...cp, sidelobeIslr: 0 } : cp;
  for (let i = i0; i <= i1; i++) {
    const k = lateralKernel(latSigma(i), cpLat);
    kLat.set(i, k);
    RL = Math.max(RL, (k.length - 1) / 2);
  }
  const nL = o.j1 - o.j0 + 1;
  const nR = i1 - i0 + 1;
  const wL = nL + 2 * RL;
  // B se calcula también por encima del parche: las fuentes de las réplicas de reverberación de C están W y 2W filas
  // más arriba (con la pared, que es de donde salen)
  const shift = o.noReverb ? 0 : Math.round(cp.wallMm / dr);
  const srcMax = shift + Math.round(CLUTTER.reverbSourceMarginMm / dr);
  const top = RA + 2 * shift;
  const wR = nR + top + RA;
  const tWall = new Float64Array(wL);
  // la fracción del haz de cada línea que sobrevive a los huesos (A o2.z, decisión 88): sin la penumbra de la apertura,
  // el rayo frente al mismo rayo sin lo que cobra el hueso; la pasada D apaga con ella el pedestal de la línea
  const shadowAt: Array<(r: number) => number> = [];
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
    const shadow = new Float64Array(COARSE);
    let db = 0;
    let boneDb = 0;
    let entered = false;
    let bone = false;
    for (let s = 0; s < COARSE; s++) {
      const t = classifyModel(scene, caliber, pointAt(dir, (s + 0.5) * coarseStep), o.model).tissue;
      if (t === Tissue.Air && !entered) {
        Tc[s] = 1;
        shadow[s] = 1;
        continue;
      }
      entered = true;
      if (TISSUES[t].bone && !bone) {
        db += BONE_ENTRY_DB;
        boneDb += BONE_ENTRY_DB;
        bone = true;
      }
      const segDb = TISSUES[t].gas ? (GAS_DB_PER_CM * coarseStep) / 10 : (2 * attenuationDbPerCm(t, B_MHZ) * coarseStep) / 10;
      db += segDb;
      if (TISSUES[t].bone) boneDb += segDb;
      Tc[s] = Math.pow(10, -db / 20);
      shadow[s] = Math.pow(10, -boneDb / 20);
    }
    shadowAt[a] = (r) => transmissionLerp((k) => shadow[k], COARSE, g.depthMm, r);
    // la de la pasada B: lineal entre filas salvo a través de la entrada en un hueso (decisión 88)
    const Tat = (r: number): number => (o.noTransmission ? 1 : transmissionLerp((k) => Tc[k], COARSE, g.depthMm, r));
    const lineU = (j + 0.5) / L;
    tWall[a] = Tat(cp.wallMm);
    for (let b = 0; b < wR; b++) {
      const i = i0 - top + b;
      if (i < 0) continue; // por encima de la imagen: campo nulo, como el borde de la textura con la réplica apagada
      const r = rowR(i);
      const p = pointAt(dir, r);
      const se = elevSigmaMm(r, g);
      const c0 = classifyModel(scene, caliber, p, o.model);
      const fieldFor = (m: Vec3, tissue: Tissue): [number, number] => {
        // con los dispersores fuertes del tejido (decisión 89): nodos de la misma retícula
        const f = speckleSliceField(m, g.latticeMm, se, seedF + tissue * TISSUE_SALT_STEP, st, strongScatter(tissue));
        let gain = back(tissue);
        if (HET_TISSUES.has(tissue)) gain *= Math.pow(10, heterogeneityDb(m, seedF) / 20);
        const beam = normalize(m.map((x, k) => x - frame.center[k]) as Vec3);
        if (o.model === 'wall' && !o.noTexture && (tissue === Tissue.Fat || tissue === Tissue.Muscle))
          gain *= wallTexture(m, tissue, beam, scene.torso);
        if (tissue === Tissue.Bowel) gain *= restTexture(m, scene.bowelRadii);
        if (tissue === Tissue.Liver) gain *= portalTriadGain(m, beam);
        gain *= retroTexture(m, tissue, beam);
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
      // densidad de dispersores del plano central (decisión 89), como mediumField: 1 fuera del hígado
      const dg = densityGain(p, seedF, c0.tissue);
      fr *= dg;
      fi *= dg;
      if (!o.noFaces?.includes(c0.interface)) {
        const [spec, diff] = echoOf(scene, caliber, c0, p, dir, r, se, frame, g, o.noFacets ?? false);
        [fr, fi] = addInterfaceEcho([fr, fi], spec, diff);
      }
      // la transmisión y la ganancia focal de la emisión (decisión 84): el eco, no el transitorio
      const T = Tat(r) * focalGain(r, g.focusMm, g.beam);
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
      const inPatch = a >= RL && a < RL + nL && b >= top && b < top + nR;
      if (inPatch) {
        tissueOut[(b - top) * nL + (a - RL)] = c0.tissue;
        faceOut[(b - top) * nL + (a - RL)] = c0.interface;
      }
    }
  }
  // C (con las réplicas de reverberación de FRAG_AXIAL: el campo tomado W y 2W filas enteras más arriba, con la
  // compuerta de los ecos fuertes y la transmisión de ida y vuelta de la línea hasta la pared, una vez por orden)
  const axR = new Float64Array(wL * nR);
  const axI = new Float64Array(wL * nR);
  const rawAt = (a: number, b: number): [number, number] => {
    if (b < 0 || b >= wR) throw new Error(`wallTwin: fila ${b} fuera del campo calculado`);
    const n = a * wR + b;
    return [re[n], im[n]];
  };
  for (let a = 0; a < wL; a++)
    for (let i = 0; i < nR; i++) {
      let sr = 0;
      let si = 0;
      const row = i0 + i;
      const [g1, g2] = reverbGains(cp, tWall[a]);
      const reps: Array<[number, number]> = [];
      if (shift > 0 && row >= shift && row - shift <= srcMax && g1 > 0) reps.push([shift, g1]);
      if (shift > 0 && row >= 2 * shift && row - 2 * shift <= srcMax && g2 > 0) reps.push([2 * shift, g2]);
      const kA = kAx.get(row)!;
      const Ri = (kA.length - 1) / 2;
      for (let q = -Ri; q <= Ri; q++) {
        const b = i + top + q;
        const [fr, fi] = rawAt(a, b);
        sr += kA[q + Ri] * fr;
        si += kA[q + Ri] * fi;
        for (const [d, gain] of reps) {
          const [rr, ri] = rawAt(a, b - d);
          const gate = reverbGateWeight(Math.hypot(rr, ri));
          sr += gain * kA[q + Ri] * rr * gate;
          si += gain * kA[q + Ri] * ri * gate;
        }
      }
      axR[a * nR + i] = sr;
      axI[a * nR + i] = si;
    }
  // D (el pedestal de la línea de destino, con la fracción de su haz que sobrevive a los huesos: decisión 88)
  const env = new Float64Array(nL * nR);
  for (let i = 0; i < nR; i++) {
    const kRow = kLat.get(i0 + i)!;
    for (let jj = 0; jj < nL; jj++) {
      const sh = o.noTransmission ? 1 : shadowAt[jj + RL](rowR(i0 + i));
      const kl = sh === 1 ? kRow : lateralKernel(latSigma(i0 + i), cpLat, sh);
      const [sr, si] = applyComplexKernel(kl, (q) => {
        const n = (jj + RL + q) * nR + i;
        return [axR[n], axI[n]];
      });
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

/**
 * Eco de interfaz de la muestra (`interfaceEcho` de la pasada B): [especular de la faceta, amplitud de la difusa]
 * (decisión 65); con `noFacets`, la especular de la decisión 57 y sin difusa.
 */
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
  noFacets: boolean,
): [number, number] {
  const face = c.interface;
  if (face === Interface.None) return [0, 0];
  const reach = INTERFACES[face].twoSided ? IFACE_REACH_MM : IFACE_SHIFT_MM + IFACE_REACH_MM;
  if (c.interfaceDistance > reach * 2.5) return [0, 0];
  const fg = scene.faceGradient(m, caliber);
  if (!fg) return [0, 0];
  if (!faceLitFromProbe(face, fg.normal, dir)) return [0, 0];
  const cosI = Math.abs(dot(fg.normal, dir));
  if (cosI < IFACE_MIN_COS) return [0, 0];
  let curv = 1;
  if (hasCurvatureCoherence(face) && fg.axis) {
    const circ = cross(fg.normal, fg.axis);
    const cl = Math.hypot(circ[0], circ[1], circ[2]);
    if (cl >= 1e-4) {
      const cu: Vec3 = [circ[0] / cl, circ[1] / cl, circ[2] / cl];
      const lat = normalize(cross(frame.elevation, dir));
      const kl = dot(lat, cu) ** 2 * fg.curvature;
      const ke = dot(frame.elevation, cu) ** 2 * fg.curvature;
      curv = curvatureCoherence(lateralSigmaMm(r, g.focusMm, g.beam), se * Math.SQRT1_2, kl, ke, K0 * frequencyRatio(r, g.beam));
    }
  }
  const delta = faceDelta(c.interfaceDistance, fg.norm, cosI);
  if (noFacets) return [interfaceEchoField(face, cosI, curv * wallFaceGain(m, face, scene.torso), delta, K0), 0];
  const gain = wallFaceGain(m, face, scene.torso) * faceSiteGain(face, m, scene);
  const cosF = facetCosine(fg.normal, dir, facetTilt(m, face));
  return [facetEchoField(face, cosF, curv * gain, delta, K0), diffuseEchoField(face, cosI, delta, K0) * gain];
}
