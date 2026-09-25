import { START_POINTS } from './startPoints';
import type { Simulator } from './simulator';
import { Interface } from '../anatomy/interfaces';
import { Tissue } from '../anatomy/tissues';
import type { ProbeCompression } from '../anatomy/compression';
import { probeContact } from '../probe/contact';
import { pointOnLine, probeFrame, type ProbeFrame, type ProbePose } from '../probe/probe';
import { compareTissueGrids } from './equivalenceCheck';

/**
 * Gate de equivalencia TS ↔ GLSL (Fase 0): para cada punto de partida se muestrea la
 * misma rejilla (líneas × profundidad) del plano con la anatomía TS (`classifyWorld`)
 * y con la GLSL (`queryPoints`), en el MISMO instante fisiológico, y se comparan:
 *  - tejido: acuerdo total e interior (lejos de bordes, `compareTissueGrids`);
 *  - vaso: en las celdas de sangre interiores, mismo identificador de vaso;
 *  - velocidad de la sangre: error relativo en esas celdas (p95 y máximo).
 * La e2e lo ejecuta con SwiftShader en CI; así la regla central del proyecto deja de
 * depender de mirar la pestaña Docente. En cada punto de partida el tejido está deformado por la compresión de
 * la sonda en esa pose (decisión 63), en la CPU y en la GPU: el acuerdo se exige con la deformación activa.
 */

/**
 * Ejecuta `fn` con la compresión de la sonda `k` en la anatomía TS (la de la GPU se pasa a `gpuQuery`) y deja
 * después la del simulador.
 */
function withCompression<T>(sim: Simulator, k: ProbeCompression, fn: () => T): T {
  const saved = sim.anatomy.probeCompression;
  sim.anatomy.setProbeCompression(k);
  try {
    return fn();
  } finally {
    sim.anatomy.setProbeCompression(saved);
  }
}
export interface EquivalencePoseReport {
  id: string;
  agreement: number;
  interiorAgreement: number;
  bloodCells: number;
  vesselAgreement: number;
  velocityP95RelErr: number;
  velocityMaxRelErr: number;
  worst: string;
}

const LINES = 48;
const SAMPLES = 72;
const DEPTH_MM = 160;
/** Suelo de velocidad para el error relativo (mm/s): cerca de la pared la sangre casi no se mueve. */
const V_FLOOR_MM_S = 30;
/** Tejido «sangre» como número: las rejillas de tejidos son Uint8Array. */
const BLOOD: number = Tissue.Blood;
/** «Sin cara» como número: la GPU devuelve las caras en un Int32Array. */
const NO_FACE: number = Interface.None;

export function equivalenceSweep(sim: Simulator): EquivalencePoseReport[] {
  const tr = sim.transducer;
  const out: EquivalencePoseReport[] = [];
  for (const sp of START_POINTS) {
    const pose: ProbePose = { phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 };
    const frame = probeFrame(pose, sim.scene.torso, tr);
    const k = probeContact(pose, frame, tr, sim.scene.torso);
    out.push(withCompression(sim, k, () => poseReport(sim, sp.id, frame, k)));
  }
  return out;
}

function poseReport(sim: Simulator, id: string, frame: ProbeFrame, k: ProbeCompression): EquivalencePoseReport {
  const tr = sim.transducer;
  {
    const n = LINES * SAMPLES;
    const pts = new Float32Array(n * 3);
    for (let v = 0; v < SAMPLES; v++)
      for (let u = 0; u < LINES; u++) {
        const theta = -tr.halfSector + (2 * tr.halfSector * (u + 0.5)) / LINES;
        const p = pointOnLine(frame, tr, theta, ((v + 0.5) / SAMPLES) * DEPTH_MM);
        pts.set(p, (v * LINES + u) * 3);
      }
    const gpu = sim.gpuQuery(pts, frame, false, { compression: k });
    const cpuTissue = new Uint8Array(n);
    const gpuTissue = new Uint8Array(n);
    const cpuVessel = new Array<string | null>(n).fill(null);
    const cpuVel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const q = sim.anatomy.classifyWorld([pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]], sim.sample);
      cpuTissue[i] = q.tissue;
      gpuTissue[i] = gpu.tissue[i];
      cpuVessel[i] = q.vessel;
      if (q.bloodVelocity) cpuVel.set(q.bloodVelocity, i * 3);
    }
    const rep = compareTissueGrids(
      { width: LINES, height: SAMPLES, tissue: cpuTissue },
      { width: LINES, height: SAMPLES, tissue: gpuTissue },
    )!;
    // Sangre interior: la celda y sus 4 vecinas son sangre en la CPU
    const errs: number[] = [];
    let blood = 0;
    let sameVessel = 0;
    for (let v = 1; v < SAMPLES - 1; v++)
      for (let u = 1; u < LINES - 1; u++) {
        const i = v * LINES + u;
        if (cpuTissue[i] !== BLOOD || !cpuVessel[i]) continue;
        if ([i - 1, i + 1, i - LINES, i + LINES].some((j) => cpuTissue[j] !== BLOOD)) continue;
        blood++;
        const gi = gpu.vessel[i];
        const gpuId = gi >= 0 && gi < sim.scene.vessels.length ? sim.scene.vessels[gi].id : null;
        if (gpuId !== cpuVessel[i]) continue;
        sameVessel++;
        const dx = gpu.velocity[i * 3] - cpuVel[i * 3];
        const dy = gpu.velocity[i * 3 + 1] - cpuVel[i * 3 + 1];
        const dz = gpu.velocity[i * 3 + 2] - cpuVel[i * 3 + 2];
        const ref = Math.max(V_FLOOR_MM_S, Math.hypot(cpuVel[i * 3], cpuVel[i * 3 + 1], cpuVel[i * 3 + 2]));
        errs.push(Math.hypot(dx, dy, dz) / ref);
      }
    errs.sort((a, b) => a - b);
    return {
      id,
      agreement: rep.agreement,
      interiorAgreement: rep.interiorAgreement,
      bloodCells: blood,
      vesselAgreement: blood > 0 ? sameVessel / blood : 1,
      velocityP95RelErr: errs.length ? errs[Math.floor(0.95 * (errs.length - 1))] : 0,
      velocityMaxRelErr: errs.length ? errs[errs.length - 1] : 0,
      worst: rep.worst.map((w) => `${Tissue[w.cpu]}→${Tissue[w.gpu]}×${w.count}`).join(', '),
    };
  }
}

/**
 * Equivalencia VOLUMÉTRICA (Fase 2): `n` puntos pseudoaleatorios (semilla fija) repartidos por
 * todo el tronco — no solo los planos de las ventanas — clasificados en TS y en GLSL. Mide el
 * acuerdo de tejido lejos de interfaces (distancia a la frontera ≥ 1 mm en la CPU y la misma cara a
 * ±`FACE_STABLE_MM`: la pared de la decisión 62 cambia de dueño dentro de sus capas), el de vaso,
 * el error de velocidad en sangre y el de la cara de interfaz que dibuja cada punto (decisión 57:
 * misma cara y la misma distancia a ella). Es la red para cualquier cambio de anatomía.
 */
export interface VolumeEquivalenceReport {
  points: number;
  interiorPoints: number;
  tissueAgreement: number;
  bloodPoints: number;
  vesselAgreement: number;
  velocityP95RelErr: number;
  worst: string;
  /** Puntos interiores que dibujan una cara en la CPU (luz de los vasos, diafragma, grasa perirrenal). */
  interfacePoints: number;
  /** Fracción de los puntos interiores con la misma cara (o ninguna) en la GPU. */
  interfaceAgreement: number;
  /** Máximo de |distancia a la cara de la GPU − la de la CPU| con la misma cara (mm). */
  interfaceDistanceMaxErr: number;
  /** Parejas de caras CPU → GPU con más desacuerdos. */
  interfaceWorst: string;
}

export function volumeEquivalence(sim: Simulator, n = 20_000, seed = 20260922): VolumeEquivalenceReport {
  let state = seed >>> 0;
  const rnd = () => {
    // mulberry32: determinista y suficiente para muestrear
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const torso = sim.scene.torso;
  const pts = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    // dentro de la elipse del tronco (radio ≤ 1) y entre el tórax bajo y la pelvis alta
    const r = Math.sqrt(rnd());
    const a = 2 * Math.PI * rnd();
    pts.set([torso.a * r * Math.cos(a), torso.b * r * Math.sin(a), -160 + 280 * rnd()], i * 3);
  }
  // el plano de la sonda solo decide qué tubos entran en la lista del cuadro: se usa uno por
  // punto no es posible, así que se consulta con la lista completa (losa muy ancha)
  const gpu = sim.gpuQuery(pts, sim.frame, true);
  let interior = 0;
  let same = 0;
  let blood = 0;
  let sameVessel = 0;
  const errs: number[] = [];
  const pairs = new Map<string, number>();
  const face = new FaceTally();
  for (let i = 0; i < n; i++) {
    const p: [number, number, number] = [pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]];
    const q = sim.anatomy.classifyWorld(p, sim.sample);
    if (q.boundaryDistance < 1 || !faceStable(sim, p, q.interface)) continue;
    interior++;
    const cpuTissue: number = q.tissue;
    if (cpuTissue === gpu.tissue[i]) same++;
    else {
      const k = `${Tissue[q.tissue]}→${Tissue[gpu.tissue[i]]}`;
      pairs.set(k, (pairs.get(k) ?? 0) + 1);
    }
    face.add(q.interface, q.interfaceDistance, gpu.iface[i], gpu.ifd[i]);
    if (q.tissue !== Tissue.Blood || !q.vessel || !q.bloodVelocity) continue;
    blood++;
    const gi = gpu.vessel[i];
    const gpuId = gi >= 0 && gi < sim.scene.vessels.length ? sim.scene.vessels[gi].id : null;
    if (gpuId !== q.vessel) continue;
    sameVessel++;
    const v = q.bloodVelocity;
    const d = Math.hypot(gpu.velocity[i * 3] - v[0], gpu.velocity[i * 3 + 1] - v[1], gpu.velocity[i * 3 + 2] - v[2]);
    errs.push(d / Math.max(V_FLOOR_MM_S, Math.hypot(v[0], v[1], v[2])));
  }
  errs.sort((x, y) => x - y);
  return {
    points: n,
    interiorPoints: interior,
    tissueAgreement: interior ? same / interior : 1,
    bloodPoints: blood,
    vesselAgreement: blood ? sameVessel / blood : 1,
    velocityP95RelErr: errs.length ? errs[Math.floor(0.95 * (errs.length - 1))] : 0,
    worst: topPairs(pairs),
    interfacePoints: face.withFace,
    interfaceAgreement: face.points ? face.same / face.points : 1,
    interfaceDistanceMaxErr: face.maxErr,
    interfaceWorst: [topPairs(face.pairs), face.maxErrAt && `máx. |Δifd| en ${face.maxErrAt}`].filter(Boolean).join('; '),
  };
}

/** Desplazamiento (mm) con que se comprueba que la cara de un punto interior no está en un cambio de dueño. */
export const FACE_STABLE_MM = 0.02;

/**
 * La cara de la CPU es la misma a ±`FACE_STABLE_MM` en cada eje: el punto no está en una superficie donde el
 * dueño cambia sin cambiar el tejido (la mitad del diafragma, la capa más cercana de la pared, el umbral de la
 * cortical costal, la fusión de un plano intermuscular; decisiones 57 y 62). Allí un redondeo de float32
 * cambia la cara: el acuerdo exacto del volumen solo se exige lejos (a 1e-5 mm la GPU aún coincide).
 */
function faceStable(sim: Simulator, p: readonly [number, number, number], face: Interface): boolean {
  for (let a = 0; a < 3; a++)
    for (const s of [-FACE_STABLE_MM, FACE_STABLE_MM]) {
      const q: [number, number, number] = [p[0], p[1], p[2]];
      q[a] += s;
      if (sim.anatomy.classifyWorld(q, sim.sample).interface !== face) return false;
    }
  return true;
}

/** Las 4 parejas con más desacuerdos, como «A→B×n». */
function topPairs(pairs: ReadonlyMap<string, number>): string {
  return [...pairs.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k, c]) => `${k}×${c}`)
    .join(', ');
}

/** Recuento del acuerdo de la cara de interfaz (TS frente a GLSL) en un conjunto de puntos. */
class FaceTally {
  points = 0;
  withFace = 0;
  same = 0;
  maxErr = 0;
  /** Cara y distancia del peor desacuerdo de distancia (diagnóstico). */
  maxErrAt = '';
  readonly pairs = new Map<string, number>();
  /** Registra un punto; devuelve si la GPU dibuja la misma cara que la CPU. */
  add(cpu: Interface, cpuDist: number, gpu: number, gpuDist: number): boolean {
    this.points++;
    if (cpu !== Interface.None) this.withFace++;
    const cpuFace: number = cpu;
    if (gpu === cpuFace) {
      this.same++;
      const err = Math.abs(gpuDist - cpuDist);
      if (cpu !== Interface.None && err > this.maxErr) {
        this.maxErr = err;
        this.maxErrAt = `${Interface[cpu]} a ${cpuDist.toFixed(3)} mm`;
      }
      return true;
    }
    const k = `${Interface[cpu]}→${Interface[gpu] ?? gpu}`;
    this.pairs.set(k, (this.pairs.get(k) ?? 0) + 1);
    return false;
  }
}

/**
 * Cáscara de las caras (decisión 57): en los planos de los puntos de partida, los puntos a
 * 0,01–0,6 mm de una cara donde el eco de interfaz se dibuja, según la CPU o según la GPU (así cuenta
 * también una cara que la GPU dibuja y la CPU no). Allí las dos deben dar la misma cara y la misma
 * distancia: el reparto de dueños (mitades del diafragma y de la grasa perirrenal, cápsula junto al
 * diafragma o a la grasa, la VCI dentro de la aurícula) es una comparación real, sin el margen de 1 mm
 * del volumen. Rejilla de `lines` líneas × `COARSE_MM`; alrededor de las celdas que (o cuyas vecinas)
 * dibujan una cara en la CPU o están en un tubo (la GPU podría dibujar allí la cara de su luz aunque la
 * CPU no: el tramo de la VCI dentro de la aurícula), pasos de `stepMm`.
 */
export interface InterfaceShellReport {
  points: number;
  /** Fracción de los puntos con la misma cara en la GPU. */
  agreement: number;
  /** Máximo de |distancia de la GPU − la de la CPU| con la misma cara (mm). */
  distanceMaxErr: number;
  /** Puntos por cara (en la CPU), para ver que la prueba tiene dientes. */
  byInterface: Record<string, number>;
  /** Los primeros desacuerdos: vista, cara CPU → GPU, tejido, punto del mundo y distancia de la CPU. */
  disagreements: string[];
}

/** Banda de la cáscara (mm): donde el perfil del eco de interfaz es distinto de cero. */
export const SHELL_BAND_MM = [0.01, 0.6] as const;
const COARSE_MM = 0.5;
const MAX_LISTED = 12;

export function interfaceShellEquivalence(sim: Simulator, lines = 48, stepMm = 0.05): InterfaceShellReport {
  const tr = sim.transducer;
  const tally = new FaceTally();
  const byInterface: Record<string, number> = {};
  const disagreements: string[] = [];
  const nCoarse = Math.floor(DEPTH_MM / COARSE_MM);
  const perCell = Math.round(COARSE_MM / stepMm);
  for (const sp of START_POINTS) {
    const pose: ProbePose = { phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 };
    const frame = probeFrame(pose, sim.scene.torso, tr);
    const k = probeContact(pose, frame, tr, sim.scene.torso);
    withCompression(sim, k, () => {
      const near: { p: [number, number, number]; iface: Interface; dist: number; tissue: Tissue }[] = [];
      for (let u = 0; u < lines; u++) {
        const theta = -tr.halfSector + (2 * tr.halfSector * (u + 0.5)) / lines;
        const faceAt = Array.from({ length: nCoarse }, (_, k) => {
          const p = pointOnLine(frame, tr, theta, (k + 0.5) * COARSE_MM);
          if (sim.anatomy.classifyWorld(p, sim.sample).interface !== Interface.None) return true;
          return sim.anatomy.faceSdfWorld(p, sim.sample, 'tube') !== null;
        });
        for (let k = 0; k < nCoarse; k++) {
          if (!faceAt[k] && !faceAt[k - 1] && !faceAt[k + 1]) continue;
          for (let j = 0; j < perCell; j++) {
            const p = pointOnLine(frame, tr, theta, k * COARSE_MM + (j + 0.5) * stepMm);
            const q = sim.anatomy.classifyWorld(p, sim.sample);
            near.push({ p, iface: q.interface, dist: q.interfaceDistance, tissue: q.tissue });
          }
        }
      }
      const pts = new Float32Array(near.length * 3);
      near.forEach((s, i) => pts.set(s.p, i * 3));
      const gpu = sim.gpuQuery(pts, frame, false, { compression: k });
      const inBand = (face: number, d: number) => face !== NO_FACE && d >= SHELL_BAND_MM[0] && d <= SHELL_BAND_MM[1];
      near.forEach((s, i) => {
        if (!inBand(s.iface, s.dist) && !inBand(gpu.iface[i], gpu.ifd[i])) return;
        byInterface[Interface[s.iface]] = (byInterface[Interface[s.iface]] ?? 0) + 1;
        if (tally.add(s.iface, s.dist, gpu.iface[i], gpu.ifd[i]) || disagreements.length >= MAX_LISTED) return;
        disagreements.push(
          `${sp.id}: ${Interface[s.iface]}→${Interface[gpu.iface[i]] ?? gpu.iface[i]} (${Tissue[s.tissue]}) en ` +
            `(${s.p.map((x) => x.toFixed(2)).join(', ')}), a ${s.dist.toFixed(3)} mm`,
        );
      });
    });
  }
  return {
    points: tally.points,
    agreement: tally.points ? tally.same / tally.points : 1,
    distanceMaxErr: tally.maxErr,
    byInterface,
    disagreements,
  };
}
