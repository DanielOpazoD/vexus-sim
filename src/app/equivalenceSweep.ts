import { START_POINTS } from './startPoints';
import type { Simulator } from './simulator';
import { Tissue } from '../anatomy/tissues';
import { pointOnLine, probeFrame, type ProbePose } from '../probe/probe';
import { compareTissueGrids } from './equivalenceCheck';

/**
 * Gate de equivalencia TS ↔ GLSL (Fase 0): para cada punto de partida se muestrea la
 * misma rejilla (líneas × profundidad) del plano con la anatomía TS (`classifyWorld`)
 * y con la GLSL (`queryPoints`), en el MISMO instante fisiológico, y se comparan:
 *  - tejido: acuerdo total e interior (lejos de bordes, `compareTissueGrids`);
 *  - vaso: en las celdas de sangre interiores, mismo identificador de vaso;
 *  - velocidad de la sangre: error relativo en esas celdas (p95 y máximo).
 * La e2e lo ejecuta con SwiftShader en CI; así la regla central del proyecto deja de
 * depender de mirar la pestaña Docente.
 */
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

export function equivalenceSweep(sim: Simulator): EquivalencePoseReport[] {
  const tr = sim.transducer;
  const out: EquivalencePoseReport[] = [];
  for (const sp of START_POINTS) {
    const pose: ProbePose = { phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 };
    const frame = probeFrame(pose, sim.scene.torso, tr);
    const n = LINES * SAMPLES;
    const pts = new Float32Array(n * 3);
    for (let v = 0; v < SAMPLES; v++)
      for (let u = 0; u < LINES; u++) {
        const theta = -tr.halfSector + (2 * tr.halfSector * (u + 0.5)) / LINES;
        const p = pointOnLine(frame, tr, theta, ((v + 0.5) / SAMPLES) * DEPTH_MM);
        pts.set(p, (v * LINES + u) * 3);
      }
    const gpu = sim.gpuQuery(pts, frame);
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
    out.push({
      id: sp.id,
      agreement: rep.agreement,
      interiorAgreement: rep.interiorAgreement,
      bloodCells: blood,
      vesselAgreement: blood > 0 ? sameVessel / blood : 1,
      velocityP95RelErr: errs.length ? errs[Math.floor(0.95 * (errs.length - 1))] : 0,
      velocityMaxRelErr: errs.length ? errs[errs.length - 1] : 0,
      worst: rep.worst.map((w) => `${Tissue[w.cpu]}→${Tissue[w.gpu]}×${w.count}`).join(', '),
    });
  }
  return out;
}

/**
 * Equivalencia VOLUMÉTRICA (Fase 2): `n` puntos pseudoaleatorios (semilla fija) repartidos por
 * todo el tronco — no solo los planos de las ventanas — clasificados en TS y en GLSL. Mide el
 * acuerdo de tejido lejos de interfaces (distancia a la frontera ≥ 1 mm en la CPU), el de vaso y
 * el error de velocidad en sangre. Es la red para cualquier cambio de anatomía.
 */
export interface VolumeEquivalenceReport {
  points: number;
  interiorPoints: number;
  tissueAgreement: number;
  bloodPoints: number;
  vesselAgreement: number;
  velocityP95RelErr: number;
  worst: string;
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
  for (let i = 0; i < n; i++) {
    const q = sim.anatomy.classifyWorld([pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]], sim.sample);
    if (q.boundaryDistance < 1) continue;
    interior++;
    const cpuTissue: number = q.tissue;
    if (cpuTissue === gpu.tissue[i]) same++;
    else {
      const k = `${Tissue[q.tissue]}→${Tissue[gpu.tissue[i]]}`;
      pairs.set(k, (pairs.get(k) ?? 0) + 1);
    }
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
    worst: [...pairs.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([k, c]) => `${k}×${c}`)
      .join(', '),
  };
}
