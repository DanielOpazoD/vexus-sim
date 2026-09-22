import type { Simulator } from '../app/simulator';
import type { PhysiologySample } from '../physiology/engine';
import type { ProbeFrame } from '../probe/probe';
import { Tissue } from '../anatomy/tissues';
import { VESSEL_META, type VesselId, type VesselSystem } from '../physiology/vessels';
import { beamToPixel, pixelToBeam, sectorLayout } from '../ultrasound/sectorGeometry';
import type { CutMapError, CutMapInit, CutMapRequest, CutMapResponse } from './cutMapWorker';
import { errorLog } from '../app/errorLog';

/**
 * «Corte ecográfico · plano de la imagen»: mapa a color de las estructuras que
 * atraviesa el plano, con rótulos en el centroide de cada una. Se calcula en un
 * Worker con la misma anatomía TypeScript que el Doppler y las mediciones
 * (decisión 25), así que es una guía honesta de lo que el alumno está viendo.
 */
const MAP_W = 96;
const MAP_H = 128;
const TISSUE_COLOR: Record<number, [number, number, number]> = {
  [Tissue.Air]: [15, 17, 22],
  [Tissue.Skin]: [200, 170, 150],
  [Tissue.Fat]: [214, 190, 110],
  [Tissue.Muscle]: [150, 70, 70],
  [Tissue.Liver]: [140, 90, 60],
  [Tissue.LiverCapsule]: [190, 140, 100],
  [Tissue.Blood]: [80, 110, 200],
  [Tissue.VesselWallPortal]: [220, 150, 220],
  [Tissue.VesselWallThin]: [150, 170, 230],
  [Tissue.Diaphragm]: [230, 230, 210],
  [Tissue.Lung]: [90, 110, 130],
  [Tissue.Bone]: [235, 235, 225],
  [Tissue.Bowel]: [120, 130, 90],
  [Tissue.BowelGas]: [70, 75, 70],
  [Tissue.Fluid]: [60, 190, 170],
  [Tissue.ArteryWall]: [230, 90, 90],
  [Tissue.Cartilage]: [200, 210, 200],
  [Tissue.RenalCortex]: [150, 100, 90],
  [Tissue.RenalMedulla]: [110, 70, 70],
  [Tissue.RenalSinus]: [225, 200, 140],
  [Tissue.PerirenalFat]: [205, 180, 120],
  [Tissue.BileDuctWall]: [120, 200, 120],
  [Tissue.Vertebra]: [215, 215, 205],
  [Tissue.LigamentumTeres]: [240, 220, 150],
  [Tissue.LigamentumVenosum]: [245, 235, 190],
  [Tissue.RenalCapsule]: [235, 225, 210],
  [Tissue.RenalPelvis]: [70, 200, 190],
};
const TISSUE_LABEL: Record<number, string> = {
  [Tissue.Liver]: 'hígado',
  [Tissue.Fat]: 'grasa',
  [Tissue.Muscle]: 'músculo',
  [Tissue.Diaphragm]: 'diafragma',
  [Tissue.Lung]: 'pulmón',
  [Tissue.Bone]: 'costilla',
  [Tissue.Vertebra]: 'columna',
  [Tissue.LigamentumTeres]: 'lig. redondo',
  [Tissue.LigamentumVenosum]: 'lig. venoso',
  [Tissue.RenalPelvis]: 'pelvis',
  [Tissue.Bowel]: 'intestino',
  [Tissue.BowelGas]: 'gas',
  [Tissue.Fluid]: 'vesícula',
  [Tissue.Cartilage]: 'cartílago',
  [Tissue.RenalCortex]: 'riñón',
  [Tissue.RenalSinus]: 'seno renal',
};
const SYSTEM_COLOR: Record<VesselSystem, [number, number, number]> = {
  ivc: [60, 120, 230],
  hepaticVein: [120, 180, 255],
  portal: [225, 120, 225],
  hepaticArtery: [240, 90, 90],
  aorta: [230, 60, 60],
  renalArtery: [240, 90, 90],
  renalVein: [90, 140, 220],
  interlobarArtery: [240, 90, 90],
  interlobarVein: [90, 140, 220],
};
const vesselColor = (id: VesselId): [number, number, number] => SYSTEM_COLOR[VESSEL_META[id].system];
const VESSEL_LABEL: Record<VesselId, string> = {
  ivcInfra: 'VCI',
  ivcSupra: 'VCI',
  hvRight: 'VSH dcha',
  hvRightAnterior: 'VSH dcha',
  hvRightPosterior: 'VSH dcha',
  hvMiddle: 'VSH media',
  hvMiddleTributary: 'VSH media',
  hvLeft: 'VSH izq',
  hvLeftTributary: 'VSH izq',
  hvCommonTrunk: 'tronco VSH',
  pvTrunk: 'porta',
  pvRight: 'porta dcha',
  pvRightAnterior: 'porta ant',
  pvRightPosterior: 'porta post',
  pvLeft: 'porta izq',
  pvLeftLateral: 'porta izq',
  pvLeftMedial: 'porta IV',
  hepaticArtery: 'art. hepática',
  aorta: 'aorta',
  renalArteryRight: 'art. renal',
  renalVeinRight: 'v. renal',
  renalArteryLeft: 'art. renal',
  renalVeinLeft: 'v. renal',
  interlobarArtery1: 'interlobar',
  interlobarArtery2: 'interlobar',
  interlobarArtery3: 'interlobar',
  interlobarVein1: 'v. interlobar',
  interlobarVein2: 'v. interlobar',
  interlobarVein3: 'v. interlobar',
};

/** Tejido «sangre» como número (el mapa del Worker es un Uint8Array). */
const BLOOD_ID: number = Tissue.Blood;

/** Tiempo máximo de una petición al Worker antes de darlo por caído (ms). */
const WORKER_TIMEOUT_MS = 3000;

export class CutMapView {
  private img: ImageData | null = null;
  private lastUpdate = -1;
  private worker: Worker | null = null;
  private workerPatient: string | null = null;
  private pending = false;
  private pendingSince = 0;
  /** Fallos consecutivos del Worker (error, caída o tiempo agotado) y próximo reintento. */
  private failures = 0;
  private retryAt = 0;
  private requestId = 0;
  private map: CutMapResponse | null = null;
  private mapDirty = false;
  /** Instante (muestra, marco, profundidad) con el que se pidió cada mapa, por id. */
  private pendingInputs: { id: number; sample: PhysiologySample; frame: ProbeFrame; depthMm: number } | null = null;
  private mapInputs: { sample: PhysiologySample; frame: ProbeFrame; depthMm: number } | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  /**
   * Último mapa recibido del Worker (anatomía TypeScript) junto con el instante
   * exacto (muestra fisiológica, marco de la sonda, profundidad) con el que se
   * calculó, para que la comprobación TS ↔ GLSL compare el MISMO instante.
   */
  get lastMap(): { map: CutMapResponse; sample: PhysiologySample; frame: ProbeFrame; depthMm: number } | null {
    return this.map && this.mapInputs ? { map: this.map, ...this.mapInputs } : null;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  /** El corte está degradado: el Worker falló y se espera al siguiente reintento. */
  get degraded(): boolean {
    return this.failures > 0;
  }

  /** Registra el fallo, descarta el Worker y programa un reintento con espera creciente (1 s → 30 s). */
  private fail(error: unknown, nowMs: number): void {
    errorLog.report('corte', error);
    this.failures++;
    this.retryAt = nowMs + Math.min(30_000, 1000 * 2 ** (this.failures - 1));
    this.worker?.terminate();
    this.worker = null;
    this.pending = false;
  }

  private ensureWorker(sim: Simulator, nowMs: number): Worker | null {
    const key = sim.patient.id;
    if (this.worker && this.workerPatient === key) return this.worker;
    if (!this.worker && nowMs < this.retryAt) return null;
    this.worker?.terminate();
    try {
      this.worker = new Worker(new URL('./cutMapWorker.ts', import.meta.url), { type: 'module' });
    } catch (e) {
      this.fail(e, nowMs);
      return null;
    }
    this.workerPatient = key;
    this.pending = false;
    const init: CutMapInit = { type: 'init', patient: sim.patient };
    this.worker.postMessage(init);
    this.worker.onmessage = (ev: MessageEvent<CutMapResponse | CutMapError>) => {
      if (ev.data.type === 'error') {
        this.fail(new Error(ev.data.message), performance.now());
        return;
      }
      if (ev.data.id !== this.requestId) return;
      this.map = ev.data;
      if (this.pendingInputs?.id === ev.data.id) this.mapInputs = this.pendingInputs;
      this.mapDirty = true;
      this.pending = false;
      this.failures = 0;
    };
    this.worker.onerror = (ev) => {
      ev.preventDefault();
      this.fail(new Error(ev.message || 'el Worker del corte se detuvo'), performance.now());
    };
    return this.worker;
  }

  /** Pide un mapa nuevo a ≤ `hz` veces por segundo y dibuja el último recibido. */
  draw(sim: Simulator, nowMs: number, hz = 8): void {
    // Vigilante: una petición sin respuesta en 3 s cuenta como caída del Worker
    if (this.pending && nowMs - this.pendingSince > WORKER_TIMEOUT_MS) this.fail(new Error('el Worker del corte no responde (3 s)'), nowMs);
    const worker = this.ensureWorker(sim, nowMs);
    if (worker && !this.pending && nowMs - this.lastUpdate >= 1000 / hz) {
      this.lastUpdate = nowMs;
      this.pending = true;
      this.pendingSince = nowMs;
      const s = sim.sample;
      const req: CutMapRequest = {
        type: 'map',
        id: ++this.requestId,
        frame: sim.frame,
        transducer: sim.transducer,
        depthMm: sim.bmode.depthMm,
        sample: { resp: s.resp, ivc: s.ivc, hvRadiusScale: s.hvRadiusScale, pvRadiusScale: s.pvRadiusScale, velocities: s.velocities },
        width: MAP_W,
        height: MAP_H,
      };
      worker.postMessage(req);
      this.pendingInputs = { id: req.id, sample: s, frame: sim.frame, depthMm: sim.bmode.depthMm };
    }
    if (!this.mapDirty || !this.map) return;
    this.mapDirty = false;
    const map = this.map;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    if (W === 0 || H === 0) return;
    const tr = sim.transducer;
    const depth = sim.bmode.depthMm;
    const layout = sectorLayout(W, H, tr, depth, 6);
    if (!this.img || this.img.width !== W || this.img.height !== H) this.img = ctx.createImageData(W, H);
    const px = this.img.data;
    const vesselIds = sim.scene.vessels.map((v) => v.id);
    // acumuladores de centroides por estructura
    const acc = new Map<string, { x: number; y: number; n: number; label: string }>();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const beam = pixelToBeam(layout, tr, depth, x, y);
        const o = (y * W + x) * 4;
        if (!beam) {
          px[o] = 13;
          px[o + 1] = 15;
          px[o + 2] = 19;
          px[o + 3] = 255;
          continue;
        }
        const u = Math.min(map.width - 1, Math.floor(((beam.theta + tr.halfSector) / (2 * tr.halfSector)) * map.width));
        const v = Math.min(map.height - 1, Math.floor((beam.r / depth) * map.height));
        const i = v * map.width + u;
        const t = map.tissue[i];
        const vi = map.vessel[i];
        let c: [number, number, number];
        let key: string | null = null;
        let label = '';
        if (vi >= 0 && vi < vesselIds.length && t === BLOOD_ID) {
          const id = vesselIds[vi];
          c = vesselColor(id);
          key = `v:${id}`;
          label = VESSEL_LABEL[id];
        } else {
          c = TISSUE_COLOR[t] ?? [100, 100, 100];
          if (TISSUE_LABEL[t]) {
            key = `t:${t}`;
            label = TISSUE_LABEL[t];
          }
        }
        px[o] = c[0];
        px[o + 1] = c[1];
        px[o + 2] = c[2];
        px[o + 3] = 255;
        if (key) {
          const a = acc.get(key) ?? { x: 0, y: 0, n: 0, label };
          a.x += x;
          a.y += y;
          a.n++;
          acc.set(key, a);
        }
      }
    }
    ctx.putImageData(this.img, 0, 0);
    // regla de profundidad
    ctx.fillStyle = '#e0a33b';
    ctx.font = `${Math.round(10 * (W / 300))}px sans-serif`;
    for (let cm = 5; cm <= depth / 10; cm += 5) {
      const rr = cm * 10;
      const { x, y } = beamToPixel(layout, tr, tr.halfSector, rr);
      ctx.fillText(String(cm), Math.max(2, x - 16), y);
    }
    // rótulos
    ctx.font = `bold ${Math.round(11 * (W / 300))}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    const minArea = W * H * 0.004;
    for (const a of acc.values()) {
      if (a.n < minArea) continue;
      const x = a.x / a.n;
      const y = a.y / a.n;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(a.label, x, y);
      ctx.fillStyle = '#fff';
      ctx.fillText(a.label, x, y);
    }
    ctx.textAlign = 'start';
  }
}
