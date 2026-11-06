import { domeFloor } from '../anatomy/organs/heart';
import { HEART_CHAMBER_IDS, heartChamber } from '../anatomy/organs/heartChamber';
import type { InstalledCpuPerson } from '../anatomy/person';
import { AnatomyQuery } from '../anatomy/query';
import { AnatomyScene } from '../anatomy/scene';
import { structureIdentity } from '../anatomy/structureIdentity';
import { Tissue } from '../anatomy/tissues';
import type { Vec3 } from '../core/vec3';
import type { PhysiologySample } from '../physiology/engine';
import { cutMapDirections, cutMapPoint } from './cutMapGeometry';
import type { CutMapInit, CutMapReply, CutMapRequest } from './cutMapProtocol';
export type { CutMapError, CutMapInit, CutMapProgress, CutMapReady, CutMapReply, CutMapRequest, CutMapResponse } from './cutMapProtocol';

/** CPU only; the two selected edges are audited in the build graph. */
async function loadCpu(msg: CutMapInit): Promise<InstalledCpuPerson> {
  if (!msg.buffers) throw new Error('Worker sin activos');
  if (msg.identity.person === 's0028') return (await import('../anatomy/people/s0028/cpu')).installS0028Cpu(msg.buffers);
  if (!['current', 'legacy'].includes(msg.identity.person)) throw new Error('Worker de persona desconocida');
  return (await import('../anatomy/people/default/cpu')).installDefaultCpu(msg.buffers, msg.identity.person === 'legacy');
}
function sameIdentity(a: InstalledCpuPerson, msg: CutMapInit): boolean {
  return (
    a.assetKey === msg.assetKey &&
    Object.entries(a.identity).every(([key, value]) => msg.identity[key as keyof typeof msg.identity] === value)
  );
}
function chamberCode(m: Vec3, query: AnatomyQuery): number {
  const sc = query.scene;
  const ch = heartChamber(m, domeFloor(m, sc.diaphragm, sc.torso), sc.person?.cpu);
  return ch ? -2 - HEART_CHAMBER_IDS.indexOf(ch) : -1;
}
/** One local installation, newest pending map only; late imports can never publish another identity. @twin trabajador-corte */
export function createCutMapWorker(post: (message: CutMapReply, transfer?: Transferable[]) => void, install = loadCpu) {
  let query: AnatomyQuery | null = null;
  let person: InstalledCpuPerson | null = null;
  let epoch = -1,
    revision = 0,
    initializing = false;
  let pending: CutMapRequest | null = null;
  let assetKey = '';
  let vesselIndex = new Map<string, number>();
  return async function receive(msg: CutMapInit | CutMapRequest): Promise<void> {
    if (msg.type === 'map' && (msg.epoch !== epoch || msg.assetKey !== assetKey)) return;
    const current = ++revision;
    try {
      if (msg.type !== 'map') {
        if (!Number.isSafeInteger(msg.epoch) || msg.epoch <= epoch) throw new Error('Epoch Worker incompatible');
        epoch = msg.epoch;
        assetKey = msg.assetKey;
        query = null;
        pending = null;
        initializing = true;
        if (msg.type === 'patient' && (!person || !sameIdentity(person, msg))) throw new Error('Worker de otra identidad');
        const installed = msg.type === 'patient' ? person! : await install(msg);
        if (epoch !== msg.epoch) return;
        if (!sameIdentity(installed, msg)) throw new Error('Identidad Worker incompatible');
        const scene = new AnatomyScene(msg.patient, msg.referenceProfile, installed);
        person = installed;
        query = new AnatomyQuery(scene);
        vesselIndex = new Map(scene.vessels.map((v, i) => [v.id, i]));
        initializing = false;
        post({ type: 'ready', id: msg.id, epoch, assetKey, identity: installed.identity });
        const latest = pending as CutMapRequest | null;
        pending = null;
        if (latest) await receive(latest);
        return;
      }
      if (initializing) {
        pending = msg;
        return;
      }
      if (!query) throw new Error('petición antes de inicializar la anatomía');
      const activeQuery = query,
        indices = vesselIndex;
      const { width, height, frame, transducer, depthMm } = msg;
      activeQuery.setProbeCompression(msg.compression);
      const tissue = new Uint8Array(width * height);
      const vessel = new Int8Array(width * height);
      const structure = new Uint8Array(width * height);
      const sample = msg.sample as PhysiologySample;
      const caliber = activeQuery.caliberFor(sample);
      const directions = cutMapDirections(frame, transducer, width);
      let deadline = performance.now() + 16;
      for (let v = 0; v < height; v++) {
        const r = (depthMm * (v + 0.5)) / height;
        const range = transducer.curvatureRadius + r;
        for (let u = 0; u < width; u++) {
          const p = cutMapPoint(frame.curvatureCenter, directions[u], range);
          const material = activeQuery.deformation.toMaterial(p, sample.resp);
          const c = activeQuery.scene.classify(material, caliber);
          const i = v * width + u;
          tissue[i] = c.tissue;
          structure[i] = structureIdentity(material, c.tissue, c.interface, activeQuery.scene, c.solids);
          vessel[i] = c.vessel ? (indices.get(c.vessel) ?? -1) : c.tissue === Tissue.Blood ? chamberCode(material, activeQuery) : -1;
        }
        // Report completed rows, never a timer-only heartbeat. Yield so a new
        // patient can abandon this slice without terminating/reloading the worker.
        if (v + 1 < height && performance.now() >= deadline) {
          post({ type: 'progress', id: msg.id, epoch: msg.epoch, assetKey: msg.assetKey, rows: v + 1 });
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (revision !== current || epoch !== msg.epoch) return;
          deadline = performance.now() + 16;
        }
      }
      post({ type: 'map', id: msg.id, epoch: msg.epoch, assetKey: msg.assetKey, width, height, tissue, vessel, structure }, [
        tissue.buffer,
        vessel.buffer,
        structure.buffer,
      ]);
    } catch (error) {
      if (msg.epoch !== epoch) return;
      query = null;
      initializing = false;
      pending = null;
      post({
        type: 'error',
        id: msg.id,
        epoch: msg.epoch,
        assetKey: msg.assetKey,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
const receive = createCutMapWorker((message, transfer = []) => (self as unknown as Worker).postMessage(message, transfer));
self.onmessage = (event: MessageEvent<CutMapInit | CutMapRequest>) => receive(event.data);
