import { STRUCTURE_LABELS } from '../anatomy/structureIdentity';
import { maskBoundary } from './anatomyContour';
import { abdominalBody } from '../anatomy/referenceBody';
import { abdominalAtlas } from '../anatomy/abdominalAtlas';
import type { Simulator } from '../app/simulator';
import type { ProbeCompression } from '../anatomy/compression';
import type { PhysiologySample } from '../physiology/engine';
import type { ProbeFrame } from '../probe/probe';
import { Tissue } from '../anatomy/tissues';
import { VESSEL_META, type VesselId, type VesselSystem } from '../physiology/vessels';
import { beamToPixel, pixelToBeam, sectorLayout } from '../ultrasound/sectorGeometry';
import type { CutMapError, CutMapInit, CutMapRequest, CutMapResponse } from './cutMapWorker';
import { errorLog } from '../app/errorLog';
import { RequestWatchdog } from './requestWatchdog';

/**
 * «Corte ecográfico · plano de la imagen»: mapa a color de las estructuras que
 * atraviesa el plano, con rótulos en el centroide de cada una. Se calcula en un
 * Worker con la misma anatomía TypeScript que el Doppler y las mediciones
 * (decisión 25), así que es una guía honesta de lo que el alumno está viendo.
 */
const MAP_W = 96;
const MAP_H = 128;
const TISSUE_COLOR: Record<number, [number, number, number]> = {
  [Tissue.Pancreas]: [213, 172, 113],
  [Tissue.Spleen]: [153, 94, 126],
  [Tissue.GutSubmucosa]: [220, 199, 153],
  [Tissue.GutMuscularis]: [141, 99, 104],
  [Tissue.SoftCapsule]: [218, 201, 171],
  [Tissue.BladderWall]: [167, 182, 132],
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
  [Tissue.Psoas]: [165, 80, 95],
  [Tissue.QuadratusLumborum]: [140, 75, 105],
  [Tissue.RetroperitonealFat]: [220, 196, 128],
  [Tissue.Myocardium]: [150, 62, 78],
  [Tissue.Mediastinum]: [196, 170, 112],
  [Tissue.MesentericFat]: [212, 183, 112],
};
const TISSUE_LABEL: Record<number, string> = {
  [Tissue.Air]: 'aire',
  [Tissue.Skin]: 'piel',
  [Tissue.LiverCapsule]: 'cápsula hepática',
  [Tissue.RenalMedulla]: 'médula renal',
  [Tissue.RenalCapsule]: 'cápsula renal',
  [Tissue.PerirenalFat]: 'grasa perirrenal',
  [Tissue.Blood]: 'sangre',
  [Tissue.VesselWallPortal]: 'pared portal',
  [Tissue.VesselWallThin]: 'pared venosa',
  [Tissue.ArteryWall]: 'pared arterial',
  [Tissue.BileDuctWall]: 'pared biliar',
  [Tissue.SoftCapsule]: 'cápsula',
  [Tissue.Pancreas]: 'páncreas',
  [Tissue.Spleen]: 'bazo',
  [Tissue.GutSubmucosa]: 'pared intestinal',
  [Tissue.GutMuscularis]: 'pared intestinal',
  [Tissue.BladderWall]: 'vejiga',
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
  [Tissue.Fluid]: 'líquido',
  [Tissue.Cartilage]: 'cartílago',
  [Tissue.RenalCortex]: 'riñón',
  [Tissue.RenalSinus]: 'seno renal',
  [Tissue.Psoas]: 'psoas',
  [Tissue.QuadratusLumborum]: 'cuadrado lumbar',
  [Tissue.RetroperitonealFat]: 'retroperitoneo',
  [Tissue.Myocardium]: 'miocardio',
  [Tissue.Mediastinum]: 'mediastino',
  [Tissue.MesentericFat]: 'grasa mesentérica',
};
/** Cavidades del corazón (decisión 85), en el orden de `HEART_CHAMBER_IDS`: rótulo y color (derechas azules, izquierdas rojas). */
const CHAMBER: ReadonlyArray<{ label: string; color: [number, number, number] }> = [
  { label: 'VI', color: [205, 70, 70] },
  { label: 'VD', color: [70, 105, 215] },
  { label: 'AD', color: [70, 105, 215] },
  { label: 'AI', color: [205, 70, 70] },
];
const SYSTEM_COLOR: Record<VesselSystem, [number, number, number]> = {
  ivc: [60, 120, 230],
  hepaticVein: [120, 180, 255],
  portal: [225, 120, 225],
  hepaticArtery: [240, 90, 90],
  aorta: [230, 60, 60],
  visceralArtery: [240, 90, 90],
  renalArtery: [240, 90, 90],
  renalVein: [90, 140, 220],
  interlobarArtery: [240, 90, 90],
  interlobarVein: [90, 140, 220],
  systemicArtery: [240, 90, 90],
  systemicVein: [80, 130, 220],
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
  celiacTrunk: 'tronco celíaco',
  splenicArtery: 'art. esplénica',
  sma: 'AMS',
  leftGastricArtery: 'gástrica izda.',
  commonHepaticArtery: 'hepática común',
  ima: 'AMI',
  portalSmv: 'VMS',
  portalSplenic: 'v. esplénica',
  iliacArteryRight: 'ilíaca dcha.',
  iliacArteryLeft: 'ilíaca izda.',
  internalIliacArteryRight: 'ilíaca dcha.',
  internalIliacArteryLeft: 'ilíaca izda.',
  externalIliacArteryRight: 'ilíaca dcha.',
  externalIliacArteryLeft: 'ilíaca izda.',
  iliacVeinRight: 'ilíaca dcha.',
  iliacVeinLeft: 'ilíaca izda.',
  internalIliacVeinRight: 'ilíaca dcha.',
  internalIliacVeinLeft: 'ilíaca izda.',
  externalIliacVeinRight: 'ilíaca dcha.',
  externalIliacVeinLeft: 'ilíaca izda.',
};

/** Tejido «sangre» como número (el mapa del Worker es un Uint8Array). */
const BLOOD_ID: number = Tissue.Blood;

/**
 * Tiempo máximo de una petición al Worker antes de darlo por caído (ms), con el hilo principal en marcha
 * (`RequestWatchdog`: a lo sumo 250 ms por cuadro, así que un cuadro largo no cuenta entero).
 */
const WORKER_TIMEOUT_MS = 3000;

export class CutMapView {
  /** Rótulos de estructuras sobre el corte (solo en modo docente). */
  private labels = true;
  private img: ImageData | null = null;
  private lastUpdate = -1;
  private worker: Worker | null = null;
  private workerPatient: string | null = null;
  private pending = false;
  private readonly watchdog = new RequestWatchdog(WORKER_TIMEOUT_MS);
  /** Fallos consecutivos del Worker (error, caída o tiempo agotado) y próximo reintento. */
  private failures = 0;
  private retryAt = 0;
  private requestId = 0;
  private map: CutMapResponse | null = null;
  private mapDirty = false;
  /** Instante (muestra, marco, profundidad) con el que se pidió cada mapa, por id. */
  private pendingInputs: {
    id: number;
    sample: PhysiologySample;
    frame: ProbeFrame;
    compression: ProbeCompression;
    depthMm: number;
  } | null = null;
  private mapInputs: { sample: PhysiologySample; frame: ProbeFrame; compression: ProbeCompression; depthMm: number } | null = null;

  private readonly tooltip: HTMLDivElement;
  private hover: { x: number; y: number } | null = null;
  private selected: { key: string; label: string; mask: Uint8Array; edges: ReturnType<typeof maskBoundary> } | null = null;
  private selectionMap: CutMapResponse | null = null;
  private drawn: { map: CutMapResponse; inputs: NonNullable<CutMapView['mapInputs']>; scene: Simulator['scene'] } | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'anatomy-tooltip';
    this.tooltip.setAttribute('role', 'tooltip');
    this.tooltip.hidden = true;
    canvas.parentElement?.append(this.tooltip);
    canvas.addEventListener('pointermove', this.onHover);
    canvas.addEventListener('pointerleave', this.onLeave);
  }

  private onHover = (event: PointerEvent): void => {
    const box = this.canvas.getBoundingClientRect();
    if (!box.width || !box.height) return;
    this.hover = { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height };
    this.tooltip.style.left = `${Math.min(box.width - 140, Math.max(4, event.clientX - box.left + 10))}px`;
    this.tooltip.style.top = `${Math.max(4, Math.min(box.height - 45, event.clientY - box.top - 40))}px`;
    this.mapDirty = true;
  };

  private onLeave = (): void => {
    this.hover = null;
    this.selected = null;
    this.tooltip.hidden = true;
    delete this.canvas.dataset.hoverKey;
    this.mapDirty = true;
  };

  private keyAt(map: CutMapResponse, index: number, sim: Simulator): { key: string; label: string } {
    const vi = map.vessel[index],
      tissue = map.tissue[index],
      region = map.structure?.[index] ?? 0;
    if (tissue === BLOOD_ID && vi >= 0 && sim.scene.vessels[vi]) {
      const id = sim.scene.vessels[vi].id;
      const side = /Right$/.test(id) ? ' · derecha' : /Left$/.test(id) ? ' · izquierda' : '';
      return { key: `v:${id}`, label: `${VESSEL_LABEL[id]}${side}` };
    }
    if (tissue === BLOOD_ID && vi <= -2 && CHAMBER[-2 - vi]) return { key: `c:${vi}`, label: CHAMBER[-2 - vi].label };
    if (region && STRUCTURE_LABELS[region]) return { key: `o:${region}`, label: STRUCTURE_LABELS[region] };
    return { key: `t:${tissue}`, label: TISSUE_LABEL[tissue] ?? 'Tejido del modelo' };
  }

  private matchesShown(sim: Simulator): boolean {
    const shown = sim.renderer.displayedAnatomy,
      drawn = this.drawn;
    if (!shown || !drawn || drawn.scene !== sim.scene || drawn.inputs.depthMm !== sim.displayed.bmode.depthMm) return false;
    const xComp = drawn.inputs.compression,
      yComp = shown.compression;
    if (xComp.nodes.length !== yComp.nodes.length || Math.abs(xComp.plateMm - yComp.plateMm) > 1e-6) return false;
    for (let i = 0; i < xComp.nodes.length; i++) if (xComp.nodes[i].some((v, j) => Math.abs(v - yComp.nodes[i][j]) > 1e-6)) return false;
    for (const key of ['curvatureCenter', 'axial', 'lateral'] as const)
      if (shown.frame[key].some((v, i) => Math.abs(v - drawn.inputs.frame[key][i]) > 1e-6)) return false;
    const a = drawn.inputs.sample,
      b = shown.sample;
    if (Math.abs(a.resp.diaphragmCaudalMm - b.resp.diaphragmCaudalMm) > 0.5) return false;
    for (const key of ['ivc', 'ivcSupra'] as const) {
      const x = a[key] ?? a.ivc,
        y = b[key] ?? b.ivc;
      if (Math.abs(x.dApMm - y.dApMm) > 0.5 || Math.abs(x.dLatMm - y.dLatMm) > 0.5) return false;
    }
    return Math.abs(a.hvRadiusScale - b.hvRadiusScale) * 40 <= 0.5 && Math.abs(a.pvRadiusScale - b.pvRadiusScale) * 40 <= 0.5;
  }

  private updateSelection(sim: Simulator): void {
    const previous = this.selected;
    // Redraw the map if a previously valid contour is withdrawn between Worker responses.
    if (previous && !this.matchesShown(sim)) this.mapDirty = true;
    this.selected = null;
    delete this.canvas.dataset.hoverKey;
    this.tooltip.hidden = true;
    const drawn = this.drawn;
    if (!this.hover || !drawn || !this.canvas.clientHeight || !this.canvas.clientWidth || !this.matchesShown(sim)) return;
    const tr = sim.transducer,
      depth = drawn.inputs.depthMm;
    const layout = sectorLayout(this.canvas.width, this.canvas.height, tr, depth, 6);
    const beam = pixelToBeam(layout, tr, depth, this.hover.x * this.canvas.width, this.hover.y * this.canvas.height);
    if (!beam) return;
    const map = drawn.map,
      u = Math.min(map.width - 1, Math.floor(((beam.theta + tr.halfSector) / (2 * tr.halfSector)) * map.width));
    const v = Math.min(map.height - 1, Math.floor((beam.r / depth) * map.height));
    const identity = this.keyAt(map, v * map.width + u, sim),
      mask = new Uint8Array(map.tissue.length);
    if (previous?.key === identity.key && this.selectionMap === map) {
      this.selected = previous;
    } else {
      for (let i = 0; i < mask.length; i++)
        mask[i] = Number(
          identity.key.startsWith('o:') ? `o:${map.structure?.[i] ?? 0}` === identity.key : this.keyAt(map, i, sim).key === identity.key,
        );
      this.selected = { ...identity, mask, edges: maskBoundary(mask, map.width, map.height) };
      this.selectionMap = map;
    }
    this.canvas.dataset.hoverKey = identity.key;
    this.tooltip.textContent = `${identity.label} · guía anatómica`;
    this.tooltip.hidden = false;
  }

  private paintContour(ctx: CanvasRenderingContext2D, sim: Simulator, onUltrasound: boolean): void {
    if (!this.selected || !this.drawn) return;
    const { inputs } = this.drawn,
      tr = sim.transducer;
    const layout = onUltrasound ? sim.renderer.display : sectorLayout(this.canvas.width, this.canvas.height, tr, inputs.depthMm, 6);
    const at = (u: number, v: number) => beamToPixel(layout, tr, -tr.halfSector + 2 * tr.halfSector * u, v * inputs.depthMm);
    const dpr = onUltrasound ? Math.min(2, window.devicePixelRatio || 1) : 1;
    ctx.save();
    ctx.strokeStyle = '#5cebd2';
    ctx.lineWidth = 1.5 * dpr;
    ctx.setLineDash([5 * dpr, 3 * dpr]);
    ctx.beginPath();
    for (const [u0, v0, u1, v1] of this.selected.edges) {
      const a = at(u0, v0),
        b = at(u1, v1);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** An annotation on the actual presented image; it never writes the image, color field or patient. */
  drawHighlight(canvas: HTMLCanvasElement, sim: Simulator, enabled = true): void {
    if (!enabled) this.onLeave();
    this.updateSelection(sim);
    delete canvas.dataset.anatomyHover;
    if (!this.selected || !this.matchesShown(sim)) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    this.paintContour(ctx, sim, true);
    canvas.dataset.anatomyHover = this.selected.label;
  }

  /**
   * Último mapa recibido del Worker (anatomía TypeScript) junto con el instante
   * exacto (muestra fisiológica, marco de la sonda, profundidad) con el que se
   * calculó, para que la comprobación TS ↔ GLSL compare el MISMO instante.
   */
  get lastMap(): {
    map: CutMapResponse;
    sample: PhysiologySample;
    frame: ProbeFrame;
    compression: ProbeCompression;
    depthMm: number;
  } | null {
    return this.map && this.mapInputs ? { map: this.map, ...this.mapInputs } : null;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.canvas.removeEventListener('pointermove', this.onHover);
    this.canvas.removeEventListener('pointerleave', this.onLeave);
    this.tooltip.remove();
  }

  /** El corte está degradado: el Worker falló y se espera al siguiente reintento. */
  get degraded(): boolean {
    return this.failures > 0;
  }

  /** Registra el fallo, descarta el Worker y programa un reintento con espera creciente (1 s → 30 s). */
  private fail(error: unknown, nowMs: number): void {
    errorLog.report('corte', error);
    this.watchdog.stop();
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
    this.map = null;
    this.mapInputs = null;
    this.drawn = null;
    this.onLeave();
    this.pending = false;
    const init: CutMapInit = {
      type: 'init',
      referenceProfile: sim.scene.hasAbdominalAtlas ? abdominalBody : sim.scene.torso.profile,
      patient: sim.patient,
      abdominalField: sim.scene.hasAbdominalAtlas ? abdominalAtlas : undefined,
    };
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
      this.watchdog.stop();
      this.failures = 0;
    };
    this.worker.onerror = (ev) => {
      ev.preventDefault();
      this.fail(new Error(ev.message || 'el Worker del corte se detuvo'), performance.now());
    };
    return this.worker;
  }

  /** Muestra u oculta los rótulos; el lienzo lo refleja en `data-labels` (pruebas de extremo a extremo). */
  setLabels(on: boolean): void {
    this.labels = on;
    this.canvas.dataset.labels = on ? '1' : '0';
  }

  /** Pide un mapa nuevo a ≤ `hz` veces por segundo y dibuja el último recibido. */
  draw(sim: Simulator, nowMs: number, hz = 8): void {
    // Vigilante: una petición sin respuesta en 3 s de hilo principal en marcha cuenta como caída del Worker
    if (this.pending && this.watchdog.expired(nowMs))
      this.fail(new Error('el Worker del corte no responde (3 s de hilo principal)'), nowMs);
    const worker = this.ensureWorker(sim, nowMs);
    const shown = sim.renderer.displayedAnatomy;
    if (worker && shown && !this.pending && nowMs - this.lastUpdate >= 1000 / hz) {
      this.lastUpdate = nowMs;
      this.pending = true;
      this.watchdog.start(nowMs);
      const s = shown.sample;
      const req: CutMapRequest = {
        type: 'map',
        id: ++this.requestId,
        frame: shown.frame,
        transducer: sim.transducer,
        compression: shown.compression,
        depthMm: sim.displayed.bmode.depthMm,
        sample: {
          resp: s.resp,
          ivc: s.ivc,
          ivcSupra: s.ivcSupra,
          hvRadiusScale: s.hvRadiusScale,
          pvRadiusScale: s.pvRadiusScale,
          velocities: s.velocities,
        },
        width: MAP_W,
        height: MAP_H,
      };
      worker.postMessage(req);
      this.pendingInputs = {
        id: req.id,
        sample: s,
        frame: shown.frame,
        compression: shown.compression,
        depthMm: sim.displayed.bmode.depthMm,
      };
    }
    if (!this.mapDirty || !this.map) return;
    // Corte plegado: los mapas se siguen pidiendo (la comprobación TS ↔ GLSL los usa), pero el último solo se
    // pinta cuando el lienzo vuelve a verse
    if (this.canvas.clientHeight === 0) return;
    this.mapDirty = false;
    const map = this.map;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    if (W === 0 || H === 0) return;
    const tr = sim.transducer;
    const depth = this.mapInputs?.depthMm ?? sim.displayed.bmode.depthMm;
    if (this.mapInputs) this.drawn = { map, inputs: this.mapInputs, scene: sim.scene };
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
        } else if (vi <= -2 && t === BLOOD_ID && CHAMBER[-2 - vi]) {
          ({ color: c, label } = CHAMBER[-2 - vi]);
          key = `c:${label}`;
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
    this.updateSelection(sim);
    this.paintContour(ctx, sim, false);
    // rótulos (el alumno no los ve: identificar la estructura es parte del examen)
    if (!this.labels) return;
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
