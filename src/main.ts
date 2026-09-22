import { compareTissueGrids } from './app/equivalenceCheck';
import { ProbeAnimator } from './app/probeAnimation';
import { bindKeyboardShortcuts } from './ui/keyboardShortcuts';
import { registerDevtools } from './app/devtools';
import { errorLog, errorMessage } from './app/errorLog';
import { nyquistVelocityCms } from './core/units';
import { Simulator } from './app/simulator';
import { Store, type ImagingMode } from './app/store';
import { CASES, CASE_IDS, findCase, isCaseId, type CaseId } from './cases';
import { NonFiniteStateError } from './physiology/engine';
import { clonePatient } from './physiology/patientState';
import { CutMapView } from './ui/cutMapView';
import { drawEcg, drawOverlay, SpectrogramView } from './ui/displays';
import { Navigator3D } from './ui/navigator3d';
import { ControlPanel } from './ui/panel';
import { ProbeInput } from './ui/probeInput';

/**
 * Composición de la aplicación: un Simulator (núcleo, sin DOM salvo el canvas
 * WebGL), un Store (estado de UI) y las vistas (navegador 3D, corte, imagen,
 * consola). Todo el tiempo procede del reloj de la simulación.
 */
const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Falta el elemento #${id}`);
  return el as T;
};

const app = $<HTMLElement>('app');
const glCanvas = $<HTMLCanvasElement>('gl');
const overlay = $<HTMLCanvasElement>('overlay');
const ecgCanvas = $<HTMLCanvasElement>('ecg');
const spectrumCanvas = $<HTMLCanvasElement>('spectrum');
const cutCanvas = $<HTMLCanvasElement>('cutmap');
const navHost = $<HTMLElement>('nav3d');
const hudTl = $<HTMLElement>('hud-tl');
const hudTr = $<HTMLElement>('hud-tr');
const hudBr = $<HTMLElement>('hud-br');
const status = $<HTMLElement>('status');
const ctxChip = $<HTMLElement>('ctx-chip');
const liveChip = $<HTMLElement>('live-chip');
const caseSelect = $<HTMLSelectElement>('case-select');
const sectorWrap = $<HTMLElement>('sector-wrap');

for (const c of CASES) {
  const o = document.createElement('option');
  o.value = c.id;
  o.textContent = c.label;
  caseSelect.appendChild(o);
}

// Ningún fallo es silencioso: excepciones no capturadas, promesas rechazadas y
// oyentes del store que lanzan terminan en el registro (pestaña Docente).
errorLog.installGlobalHandlers(window);
const store = new Store(
  {
    mode: 'B',
    tab: 'adquirir',
    frozen: false,
    debug: false,
    audio: false,
    caseId: CASE_IDS[0],
    torso: true,
    tool: 'none',
  },
  (e) => errorLog.report('ui', e),
);

function fatal(message: string): never {
  document.body.innerHTML = '';
  const d = document.createElement('div');
  d.className = 'error';
  d.textContent = `No se pudo iniciar el simulador: ${message}`;
  document.body.appendChild(d);
  throw new Error(message);
}

let sim: Simulator;
try {
  sim = new Simulator(clonePatient(CASES[0]), glCanvas);
} catch (e) {
  fatal((e as Error).message);
}
registerDevtools(
  () => sim,
  () => ({ nav, cutMap, spectrogram }),
);

const spectrogram = new SpectrogramView(spectrumCanvas);
const cutMap = new CutMapView(cutCanvas);
const panel = new ControlPanel($('panel'), () => sim, store);
const input = new ProbeInput(
  sectorWrap,
  () => sim.pose,
  (p) => setPoseManual(p),
);
let nav: Navigator3D | null = null;
try {
  nav = new Navigator3D(navHost, sim.scene, sim.transducer, {
    getPose: () => sim.pose,
    setPose: (p) => setPoseManual(p),
    getFrame: () => sim.frame,
    getDepthMm: () => sim.bmode.depthMm,
    getRespCaudalMm: () => sim.sample.resp.diaphragmCaudalMm,
    getCaliber: () => sim.anatomy.caliberFor(sim.sample),
  });
} catch (e) {
  errorLog.report('navegador3d', e);
}

// --- Animación hacia un punto de partida (continua, cancelable) --------------
const probeAnimator = new ProbeAnimator(
  () => sim.pose,
  (p) => sim.setPose(p),
);
function setPoseManual(p: Parameters<Simulator['setPose']>[0]): void {
  probeAnimator.cancel(); // cualquier gesto manual cancela la animación
  sim.setPose(p);
}
panel.onStartPoint = (sp) => probeAnimator.goTo(sp);

// --- Estado de UI → simulador --------------------------------------------
const modeButtons: Record<ImagingMode, HTMLButtonElement> = { B: $('mode-b'), color: $('mode-color'), pw: $('mode-pw') };
function applyMode(mode: ImagingMode): void {
  sim.color.enabled = mode === 'color';
  const wasPw = sim.pw.enabled;
  sim.pw.enabled = mode === 'pw';
  if (sim.pw.enabled && !wasPw) {
    sim.pwChain.reset();
    spectrogram.reset();
  }
  for (const [k, b] of Object.entries(modeButtons)) b.classList.toggle('active', k === mode);
}
for (const [k, b] of Object.entries(modeButtons)) {
  b.addEventListener('click', () => {
    const mode = k as ImagingMode;
    store.set({ mode, tab: mode === 'B' ? (store.get().tab === 'doppler' ? 'imagen' : store.get().tab) : 'doppler' });
  });
}
const freezeBtn = $<HTMLButtonElement>('freeze');
freezeBtn.addEventListener('click', () => store.set({ frozen: !store.get().frozen }));
const audioBtn = $<HTMLButtonElement>('audio-toggle');
audioBtn.addEventListener('click', async () => {
  try {
    if (sim.audio.enabled) await sim.audio.disable();
    else await sim.audio.enable();
  } catch (e) {
    errorLog.report('audio', e);
    showBanner(`Audio no disponible: ${errorMessage(e)}`, 5000);
  }
  store.set({ audio: sim.audio.enabled });
});
const torsoBtn = $<HTMLButtonElement>('torso-toggle');
torsoBtn.addEventListener('click', () => store.set({ torso: !store.get().torso }));
$<HTMLButtonElement>('rail-collapse').addEventListener('click', () => store.set({ torso: false }));
const debugToggle = $<HTMLInputElement>('debug-toggle');
debugToggle.addEventListener('change', () =>
  store.set({
    debug: debugToggle.checked,
    tab: debugToggle.checked ? 'docente' : store.get().tab === 'docente' ? 'adquirir' : store.get().tab,
  }),
);
caseSelect.addEventListener('change', () => {
  if (isCaseId(caseSelect.value)) store.set({ caseId: caseSelect.value });
});

// Navegador: zoom, centrar, capas
$<HTMLButtonElement>('nav-zoom-in').addEventListener('click', () => nav?.zoomBy(0.85));
$<HTMLButtonElement>('nav-zoom-out').addEventListener('click', () => nav?.zoomBy(1 / 0.85));
$<HTMLButtonElement>('nav-center').addEventListener('click', () => nav?.centerOnProbe());
const layerMenu = $<HTMLElement>('layer-menu');
{
  const cap = (t: string) => {
    const d = document.createElement('div');
    d.className = 'menu-cap';
    d.textContent = t;
    layerMenu.appendChild(d);
  };
  const item = (label: string, key: 'skin' | 'skeleton' | 'organs' | 'vessels' | 'windows') => {
    const l = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.addEventListener('change', () => nav?.setLayers({ [key]: cb.checked }));
    l.append(cb, document.createTextNode(label));
    layerMenu.appendChild(l);
  };
  cap('Cuerpo');
  item('Piel', 'skin');
  item('Hueso', 'skeleton');
  cap('Abdomen');
  item('Órganos', 'organs');
  item('Vasos', 'vessels');
  cap('Examen');
  item('Ventanas', 'windows');
}
$<HTMLButtonElement>('nav-layers').addEventListener('click', () => (layerMenu.hidden = !layerMenu.hidden));

store.subscribe((st, prev) => {
  if (st.mode !== prev.mode) applyMode(st.mode);
  if (st.frozen !== prev.frozen) {
    sim.frozen = st.frozen;
    freezeBtn.classList.toggle('on', st.frozen);
    freezeBtn.textContent = st.frozen ? 'Live' : 'Freeze';
    liveChip.textContent = st.frozen ? 'FREEZE' : 'LIVE';
    liveChip.className = `chip ${st.frozen ? 'freeze' : 'live'}`;
  }
  if (st.audio !== prev.audio) {
    audioBtn.classList.toggle('on', st.audio);
    audioBtn.textContent = st.audio ? 'Audio ●' : 'Audio';
  }
  if (st.torso !== prev.torso) {
    app.classList.toggle('no-torso', !st.torso);
    torsoBtn.classList.toggle('on', st.torso);
  }
  if (st.caseId !== prev.caseId) loadCase(st.caseId);
  if (st.tool !== prev.tool && st.tool !== 'caliper') caliperA = null;
});

/**
 * Cambio de caso transaccional: el simulador nuevo se construye ANTES de tocar nada;
 * si falla, el caso anterior sigue vivo, el selector vuelve atrás y el error se ve.
 */
function loadCase(id: CaseId): void {
  const prevSim = sim;
  if (prevSim.patient.id === id) return;
  let next: Simulator;
  try {
    next = new Simulator(clonePatient(findCase(id)), glCanvas, prevSim.audio);
  } catch (e) {
    errorLog.report('caso', e);
    showBanner(`No se pudo cargar el caso: ${errorMessage(e)}`, 6000);
    caseSelect.value = prevSim.patient.id;
    if (isCaseId(prevSim.patient.id)) store.set({ caseId: prevSim.patient.id });
    return;
  }
  next.setPose(prevSim.pose);
  next.equipment = prevSim.equipment;
  next.frozen = prevSim.frozen;
  sim = next;
  prevSim.dispose();
  nav?.setAnatomy(sim.scene);
  sim.pwChain.reset();
  spectrogram.reset();
  panel.onSimulatorChanged();
}

// --- Clic en la imagen: calibrador, puerta PW o caja de color -----------------
let caliperA: { x: number; y: number } | null = null;
let downAt: { x: number; y: number; t: number } | null = null;
sectorWrap.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY, t: performance.now() }));
sectorWrap.addEventListener('click', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4 || performance.now() - downAt.t > 400) return;
  const rect = glCanvas.getBoundingClientRect();
  const dpr = glCanvas.width / rect.width;
  const px = (e.clientX - rect.left) * dpr;
  const py = (e.clientY - rect.top) * dpr;
  const beam = sim.renderer.pixelToBeam(px, py, sim.transducer, sim.bmode.depthMm);
  if (!beam) return;
  if (store.get().tool === 'caliper' || e.metaKey || e.ctrlKey) {
    if (!caliperA) {
      caliperA = { x: px, y: py };
      panel.setIvcCaliper(null);
    } else {
      panel.setIvcCaliper(Math.hypot(px - caliperA.x, py - caliperA.y) / sim.renderer.display.scale);
      caliperA = null;
      store.set({ tool: 'none' });
    }
    return;
  }
  if (sim.pw.enabled) {
    sim.pw.theta = beam.theta;
    sim.pw.depthMm = beam.r;
  } else if (sim.color.enabled) {
    const c = sim.color;
    const hw = (c.theta1 - c.theta0) / 2;
    const hr = (c.r1 - c.r0) / 2;
    c.theta0 = beam.theta - hw;
    c.theta1 = beam.theta + hw;
    c.r0 = Math.max(5, beam.r - hr);
    c.r1 = Math.min(sim.bmode.depthMm, beam.r + hr);
  }
});

// --- Atajos de teclado (misma familia que EchoTwin) ---------------------------
bindKeyboardShortcuts(
  store,
  () => sim,
  () => panel.sync(),
);

// --- Pérdida de contexto GPU ---------------------------------------------------
let gpuLost = false;
glCanvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  gpuLost = true;
  errorLog.report('gpu', 'contexto WebGL perdido');
  showBanner('Contexto GPU perdido: recuperando…');
});
glCanvas.addEventListener('webglcontextrestored', () => {
  try {
    sim.rebuildRenderer(glCanvas);
    gpuLost = false;
    hideBanner();
  } catch (e) {
    errorLog.report('gpu', e);
    showBanner(`No se pudo recuperar la GPU: ${errorMessage(e)}`);
  }
});
let bannerEl: HTMLElement | null = null;
let bannerTimer: ReturnType<typeof setTimeout> | null = null;
function showBanner(text: string, autoHideMs?: number): void {
  if (bannerTimer) clearTimeout(bannerTimer);
  bannerTimer = autoHideMs ? setTimeout(hideBanner, autoHideMs) : null;
  if (!bannerEl) {
    bannerEl = document.createElement('div');
    bannerEl.className = 'banner';
    sectorWrap.appendChild(bannerEl);
  }
  bannerEl.textContent = text;
}
function hideBanner(): void {
  bannerEl?.remove();
  bannerEl = null;
}

// --- Tamaño de lienzos -------------------------------------------------------
function fitCanvases(): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(320, Math.floor(sectorWrap.clientWidth * dpr));
  const h = Math.max(240, Math.floor(sectorWrap.clientHeight * dpr));
  if (glCanvas.width !== w || glCanvas.height !== h) {
    glCanvas.width = w;
    glCanvas.height = h;
    overlay.width = w;
    overlay.height = h;
  }
  for (const c of [ecgCanvas, spectrumCanvas, cutCanvas]) {
    // el corte se calcula por píxel en CPU: resolución 1× basta
    const k = c === cutCanvas ? 1 : dpr;
    const cw = Math.floor(c.clientWidth * k);
    const ch = Math.floor(c.clientHeight * k);
    if (cw > 0 && ch > 0 && (c.width !== cw || c.height !== ch)) {
      c.width = cw;
      c.height = ch;
      if (c === spectrumCanvas) spectrogram.reset();
    }
  }
}
window.addEventListener('resize', fitCanvases);

const span = (host: HTMLElement, lines: string[]): void => {
  host.innerHTML = '';
  for (const l of lines) {
    const s = document.createElement('span');
    s.textContent = l;
    host.appendChild(s);
  }
};
const nyq = (prf: number) => Math.round(nyquistVelocityCms(prf, sim.transducer.f0Doppler));

// --- Bucle principal ---------------------------------------------------------
let last = performance.now();
let frames = 0;
let frameTime = 0;
let lastStatus = 0;
// Errores del bucle: se cuentan en una ventana de 2 s (no por racha), así un fallo
// intermitente en cuadros alternos también termina en el banner.
let errorTimes: number[] = [];
let loopDegraded = false;
let hrShown = 0;
let eqPrevCpu: CutMapView['lastMap'] = null;
function loop(now: number): void {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  try {
    fitCanvases();
    input.tick(dt);
    probeAnimator.tick(dt);
    sim.advance(dt);
    if (!gpuLost) sim.render();
    drawOverlay(overlay, sim);
    nav?.draw();
    if (store.get().torso && !gpuLost) cutMap.draw(sim, now);
    const t = sim.physiology.clock.t;
    const secondsVisible = spectrumCanvas.clientWidth / (sim.pw.sweepMmS * 3.2);
    drawEcg(ecgCanvas, sim, secondsVisible, t);
    spectrogram.draw(sim, sim.spectral.columns, t, secondsVisible);
    const s = sim.sample;
    // FC mostrada como un monitor: media móvil (en FA el RR latido a latido salta)
    hrShown = hrShown ? hrShown + (60 / s.rr - hrShown) * Math.min(1, dt * 1.5) : 60 / s.rr;
    span(hudTl, [sim.patient.label + (sim.frozen ? ' · congelada' : '')]);
    span(hudTr, [
      `FC ${Math.round(hrShown)} lpm · ${sim.patient.rhythm === 'atrial-fibrillation' ? 'FA' : 'Sinusal'}`,
      `${(sim.bmode.depthMm / 10).toFixed(0)} cm · 3,5 MHz · G ${sim.bmode.gainDb} dB · RD ${sim.bmode.dynamicRangeDb}`,
    ]);
    span(hudBr, [
      sim.color.enabled
        ? `Color ±${nyq(sim.color.prfHz)} cm/s · WF ${sim.color.wallFilterHz} Hz · ${sim.colorTiming.frameHz.toFixed(0)} Hz`
        : sim.pw.enabled
          ? `PW ±${nyq(sim.pw.prfHz)} cm/s · puerta ${sim.pw.gateMm.toFixed(1)} mm`
          : `resp ${s.resp.volume.toFixed(2)}`,
    ]);
    const st = store.get();
    ctxChip.textContent =
      st.mode === 'color'
        ? `±${nyq(sim.color.prfHz)} cm/s`
        : st.mode === 'pw'
          ? `Puerta ${(sim.pw.depthMm / 10).toFixed(1)} cm · ${sim.pw.sweepMmS} mm/s`
          : '';
    frames++;
    frameTime += dt;
    if (now - lastStatus > 250) {
      lastStatus = now;
      status.textContent = `${(frames / Math.max(1e-3, frameTime)).toFixed(0)} fps · t ${t.toFixed(1)} s`;
      frames = 0;
      frameTime = 0;
      // Comprobación TS ↔ GLSL (solo docente): mapa GPU vs mapa del Worker, misma rejilla
      if (store.get().debug && store.get().torso && !gpuLost) {
        // La lectura GPU es asíncrona: el mapa devuelto es el que se pidió en el tick
        // anterior, así que se compara con la instantánea CPU de ese tick.
        const cpu = cutMap.lastMap;
        const gpu = cpu ? sim.gpuTissueMap(cpu) : null;
        panel.setEquivalence(gpu && eqPrevCpu ? compareTissueGrids(eqPrevCpu.map, gpu) : null);
        eqPrevCpu = cpu;
      }
      panel.renderDebug();
      panel.sync();
    }
    if (loopDegraded) {
      // se recuperó: el banner de error persistente ya no aplica
      loopDegraded = false;
      if (!gpuLost) hideBanner();
    }
  } catch (e) {
    errorLog.report(e instanceof NonFiniteStateError ? 'fisiología' : 'bucle', e);
    errorTimes.push(now);
    errorTimes = errorTimes.filter((t) => now - t < 2000);
    if (errorTimes.length > 5) {
      // Error persistente: avisar y reintentar a 1 Hz en vez de detener la aplicación para siempre
      loopDegraded = true;
      showBanner(`Error persistente en el bucle (se reintenta cada segundo): ${errorMessage(e)}`);
      setTimeout(() => requestAnimationFrame(loop), 1000);
      return;
    }
  }
  requestAnimationFrame(loop);
}
fitCanvases();
requestAnimationFrame(loop);
