import { structureIdentity } from '../anatomy/structureIdentity';
import { setReferenceBody } from '../anatomy/referenceBody';
import { setAbdominalBody } from '../anatomy/referenceBody';
import { setAbdominalAtlas } from '../anatomy/abdominalAtlas';
/// <reference lib="webworker" />
import type { ProbeCompression } from '../anatomy/compression';
import { AnatomyQuery } from '../anatomy/query';
import { domeFloor } from '../anatomy/organs/heart';
import { HEART_CHAMBER_IDS, heartChamber } from '../anatomy/organs/heartChamber';
import { AnatomyScene } from '../anatomy/scene';
import { Tissue } from '../anatomy/tissues';
import type { Vec3 } from '../core/vec3';
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
  /** Contacto de la sonda del marco (decisión 63): el corte muestra el tejido comprimido, como la imagen. */
  compression: ProbeCompression | null;
  depthMm: number;
  /** Subconjunto de la muestra fisiológica que la clasificación necesita. */
  sample: Pick<PhysiologySample, 'resp' | 'ivc' | 'ivcSupra' | 'hvRadiusScale' | 'pvRadiusScale' | 'velocities'>;
  width: number;
  height: number;
}

export interface CutMapInit {
  type: 'init';
  patient: PatientState;
  referenceProfile?: Float32Array;
  abdominalField?: Uint16Array;
}

export interface CutMapResponse {
  type: 'map';
  id: number;
  width: number;
  height: number;
  tissue: Uint8Array;
  /** Organ/digestive region from the same material point, independent of tissue/flow. */
  structure?: Uint8Array;
  /**
   * Índice de vaso en `scene.vessels` o −1; en la sangre de una cavidad del corazón (decisión 85), −2 − su índice en
   * `HEART_CHAMBER_IDS` (VI, VD, AD, AI).
   */
  vessel: Int8Array;
}

/** El Worker nunca calla un fallo: responde con el id de la petición y el mensaje. */
export interface CutMapError {
  type: 'error';
  id: number;
  message: string;
}

let query: AnatomyQuery | null = null;

/** Código de la cavidad del corazón que contiene un punto material (−2 − su índice), o −1. */
function chamberCode(m: Vec3): number {
  const sc = query!.scene;
  const ch = heartChamber(m, domeFloor(m, sc.diaphragm, sc.torso));
  return ch ? -2 - HEART_CHAMBER_IDS.indexOf(ch) : -1;
}
let vesselIndex = new Map<string, number>();

const post = (m: CutMapResponse | CutMapError, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

self.onmessage = (ev: MessageEvent<CutMapInit | CutMapRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      setReferenceBody(msg.referenceProfile);
      setAbdominalBody(msg.abdominalField ? msg.referenceProfile : undefined);
      setAbdominalAtlas(msg.abdominalField);
      const scene = new AnatomyScene(msg.patient);
      query = new AnatomyQuery(scene);
      vesselIndex = new Map(scene.vessels.map((v, i) => [v.id, i]));
      return;
    }
    if (!query) {
      post({ type: 'error', id: msg.id, message: 'petición antes de inicializar la anatomía' });
      return;
    }
    const { width, height, frame, transducer, depthMm } = msg;
    query.setProbeCompression(msg.compression);
    const tissue = new Uint8Array(width * height);
    const structure = new Uint8Array(width * height);
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
        structure[i] = structureIdentity(c.material, c.tissue, c.interface, query.scene.hasAbdominalAtlas);
        vessel[i] = c.vessel ? (vesselIndex.get(c.vessel) ?? -1) : c.tissue === Tissue.Blood ? chamberCode(c.material) : -1;
      }
    }
    post({ type: 'map', id: msg.id, width, height, tissue, vessel, structure }, [tissue.buffer, vessel.buffer, structure.buffer]);
  } catch (e) {
    post({ type: 'error', id: msg.type === 'map' ? msg.id : -1, message: e instanceof Error ? e.message : String(e) });
  }
};
