import type { ProbeCompression } from '../anatomy/compression';
import type { PersonBuffers, PersonIdentity } from '../anatomy/personAssets';
import type { PhysiologySample } from '../physiology/engine';
import type { PatientState } from '../physiology/patientState';
import type { ProbeFrame, Transducer } from '../probe/probe';
export interface CutMapRequest {
  type: 'map';
  epoch: number;
  assetKey: string;
  id: number;
  frame: ProbeFrame;
  transducer: Transducer;
  /** Contacto de la sonda del marco (decisión 63): el corte muestra el tejido comprimido, como la imagen. */
  compression: ProbeCompression | null;
  depthMm: number;
  /** Subconjunto de la muestra fisiológica que la clasificación necesita. */
  sample: Pick<PhysiologySample, 'resp' | 'ivc' | 'ivcSupra' | 'hvRadiusScale' | 'pvRadiusScale' | 'aortaRadiusScale' | 'velocities'>;
  width: number;
  height: number;
}

export interface CutMapInit {
  type: 'init' | 'patient';
  epoch: number;
  assetKey: string;
  identity: PersonIdentity;
  id: number;
  patient: PatientState;
  referenceProfile?: Float32Array;
  buffers?: PersonBuffers;
}

export interface CutMapResponse {
  type: 'map';
  epoch: number;
  assetKey: string;
  id: number;
  width: number;
  height: number;
  tissue: Uint8Array;
  /** Órgano del clasificador común, independiente del tejido y vaso. */
  structure: Uint8Array;
  /**
   * Índice de vaso en `scene.vessels` o −1; en la sangre de una cavidad del corazón (decisión 85), −2 − su índice en
   * `HEART_CHAMBER_IDS` (VI, VD, AD, AI).
   */
  vessel: Int8Array;
}

/** El Worker nunca calla un fallo: responde con el id de la petición y el mensaje. */
export interface CutMapError {
  type: 'error';
  epoch: number;
  assetKey: string;
  id: number;
  message: string;
}

export interface CutMapProgress {
  type: 'progress';
  epoch: number;
  assetKey: string;
  id: number;
  rows: number;
}

export interface CutMapReady {
  type: 'ready';
  id: number;
  epoch: number;
  assetKey: string;
  identity: PersonIdentity;
}
export type CutMapReply = CutMapResponse | CutMapProgress | CutMapError | CutMapReady;
