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
    const cpuVessel: Array<string | null> = new Array(n);
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
        if (cpuTissue[i] !== Tissue.Blood || !cpuVessel[i]) continue;
        if ([i - 1, i + 1, i - LINES, i + LINES].some((j) => cpuTissue[j] !== Tissue.Blood)) continue;
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
