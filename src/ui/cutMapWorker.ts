/// <reference lib="webworker" />
import { AnatomyQuery } from '../anatomy/query';
import { AnatomyScene } from '../anatomy/scene';
import type { PhysiologySample } from '../physiology/engine';
import type { PatientState } from '../physiology/patientState';
import { pointOnLine, type ProbeFrame, type Transducer } from '../probe/probe';

/**
 * Worker del «corte ecográfico»: clasifica la rejilla del plano de la imagen con
 * la MISMA anatomía TypeScript que el Doppler y las mediciones (`AnatomyQuery`),
 * fuera del hilo principal y sin lecturas GPU→CPU (una lectura síncrona esperaba
 * a toda la cola de la GPU, 50–90 ms por cuadro; decisión 25).
 */
export interface CutMapRequest {
  type: 'map';
  id: number;
  frame: ProbeFrame;
  transducer: Transducer;
  depthMm: number;
  /** Subconjunto de la muestra fisiológica que la clasificación necesita. */
  sample: Pick<PhysiologySample, 'resp' | 'ivc' | 'hvRadiusScale' | 'pvRadiusScale' | 'velocities'>;
  width: number;
  height: number;
}

export interface CutMapInit {
  type: 'init';
  patient: PatientState;
}

export interface CutMapResponse {
  type: 'map';
  id: number;
  width: number;
  height: number;
  tissue: Uint8Array;
  /** Índice de vaso en `scene.vessels` o −1. */
  vessel: Int8Array;
}

let query: AnatomyQuery | null = null;
let vesselIndex = new Map<string, number>();

self.onmessage = (ev: MessageEvent<CutMapInit | CutMapRequest>) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    const scene = new AnatomyScene(msg.patient);
    query = new AnatomyQuery(scene);
    vesselIndex = new Map(scene.vessels.map((v, i) => [v.id, i]));
    return;
  }
  if (!query) return;
  const { width, height, frame, transducer, depthMm } = msg;
  const tissue = new Uint8Array(width * height);
  const vessel = new Int8Array(width * height);
  const sample = msg.sample as PhysiologySample;
  for (let v = 0; v < height; v++) {
    const r = (depthMm * (v + 0.5)) / height;
    for (let u = 0; u < width; u++) {
      const theta = -transducer.halfSector + (2 * transducer.halfSector * (u + 0.5)) / width;
      const p = pointOnLine(frame, transducer, theta, r);
      const c = query.classifyWorld(p, sample);
      const i = v * width + u;
      tissue[i] = c.tissue;
      vessel[i] = c.vessel ? (vesselIndex.get(c.vessel) ?? -1) : -1;
    }
  }
  const out: CutMapResponse = { type: 'map', id: msg.id, width, height, tissue, vessel };
  (self as unknown as Worker).postMessage(out, [tissue.buffer, vessel.buffer]);
};
