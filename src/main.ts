import { registerDevtools } from './app/devtools';
import { caseDisplayLabel, teacherToggleAllowed } from './app/blindMode';
import { buildDiagnostics, buildLabel, diagnosticsFileName, gpuInfo } from './app/diagnostics';
import { ErrorBudget } from './app/errorBudget';
import { modeHasColor, modeHasPw, toggleM, toggleMode } from './app/equipment';
import { compareTissueGrids } from './app/equivalenceCheck';
import { errorLog, errorMessage } from './app/errorLog';
import { ProbeAnimator } from './app/probeAnimation';
import { START_POINTS } from './app/startPoints';
import { SimulationSession } from './app/session';
import type { Simulator } from './app/simulator';
import { Store, type ImagingMode } from './app/store';
import { CASES, CASE_IDS, isCaseId } from './cases';
import { NonFiniteStateError } from './physiology/engine';
import { Banner } from './ui/controllers/banner';
import { bindGpuLifecycle } from './ui/controllers/gpuLifecycle';
import { HeartRateDisplay, hudText, renderLines } from './ui/controllers/hud';
import { bindCine } from './ui/controllers/cine';
import { bindImageClick } from './ui/controllers/imageClick';
import { buildLayerMenu } from './ui/controllers/layerMenu';
import type { CutMapView } from './ui/cutMapView';
import { bindCollapsible, bindPopover } from './ui/disclosure';
import { SpectrogramView, drawEcg, drawOverlay } from './ui/displays';
import { MModeView } from './ui/mModeView';
import { traceRight } from './ui/sweep';
import { bindKeyboardShortcuts } from './ui/keyboardShortcuts';
import type { Navigator3D } from './ui/navigator3d';
import { setPressed } from './ui/controls';
import { ControlPanel, tabAfterMode } from './ui/panel';
import { ProbeInput } from './ui/probeInput';
import { StartPointCards } from './ui/startPointCards';
import { compoundActive } from './ultrasound/compound';

/**
 * Raíz de composición (Fase 1): crea la sesión de simulación, el estado de UI y las vistas, y
 * los conecta. La lógica vive en módulos con una sola responsabilidad: `SimulationSession`
 * (simulador vivo + equipo + cambio de caso transaccional), `ui/controllers/*` (HUD, clic en la
 * imagen, pérdida de GPU, avisos, menú de capas) y `ErrorBudget` (bucle que se degrada, no muere).
 * Todo el tiempo procede del reloj de la simulación.
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
const mCanvas = $<HTMLCanvasElement>('mmode');
const cutCanvas = $<HTMLCanvasElement>('cutmap');
const navHost = $<HTMLElement>('nav3d');
const hud = { tl: $<HTMLElement>('hud-tl'), tr: $<HTMLElement>('hud-tr'), br: $<HTMLElement>('hud-br') };
const status = $<HTMLElement>('status');
const ctxChip = $<HTMLElement>('ctx-chip');
const liveChip = $<HTMLElement>('live-chip');
const caseSelect = $<HTMLSelectElement>('case-select');
const sectorWrap = $<HTMLElement>('sector-wrap');
$<HTMLElement>('build-info').textContent = buildLabel(__APP_VERSION__, __GIT_COMMIT__);

for (const c of CASES) {
  const o = document.createElement('option');
  o.value = c.id;
  caseSelect.appendChild(o);
}
/** Nombres del selector según el modo: «Paciente A/B/C» para el alumno (guía §17). */
function labelCases(teacher: boolean): void {
  for (const o of Array.from(caseSelect.options)) o.textContent = caseDisplayLabel(o.value, teacher);
}
labelCases(false);

// Ningún fallo es silencioso: excepciones no capturadas, promesas rechazadas y
// oyentes del store que lanzan terminan en el registro (pestaña Docente).
errorLog.installGlobalHandlers(window);
const store = new Store(
  { mode: 'B', tab: 'adquirir', frozen: false, debug: false, audio: false, caseId: CASE_IDS[0], torso: true, tool: 'none' },
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

let session: SimulationSession;
try {
  session = new SimulationSession(glCanvas, CASE_IDS[0]);
} catch (e) {
  fatal(errorMessage(e));
}
const sim = (): Simulator => session.sim;
const dispatch = session.equipment.dispatch.bind(session.equipment);
// La app arranca en la ventana subxifoidea, la primera del protocolo VExUS, y no en la pose por defecto del
// simulador (sobre las costillas del flanco). La e2e conserva la pose por defecto: sus pruebas la suponen.
// También arranca en armónica tisular (decisión 77), el modo B de un equipo abdominal moderno; la e2e sigue en
// fundamental, la física calibrada de sus pruebas, y prueba la armónica aparte. Con `?e2e=app`, la e2e carga sus
// ganchos y arranca como el usuario (subxifoidea y armónica): así prueba también la configuración que se ve.
const e2eMode = new URLSearchParams(location.search).get('e2e');
if (e2eMode === null || e2eMode === 'app') {
  const first = START_POINTS[0];
  sim().setPose({ ...sim().pose, phi: first.phi, z: first.z, yaw: first.yaw, rock: first.rock ?? 0, tilt: first.tilt ?? 0 });
  dispatch({ type: 'harmonic', enabled: true });
}
const banner = new Banner(sectorWrap);

// --- Vistas ------------------------------------------------------------------
const spectrogram = new SpectrogramView(spectrumCanvas);
const mview = new MModeView(mCanvas);
// Mapa del plano (el corte del carril izquierdo) con carga diferida, como el navegador 3D: la imagen no lo necesita
// para su primer cuadro y el chunk principal no carga su código; si falla, la aplicación sigue sin él.
let cutMap: CutMapView | null = null;
void import('./ui/cutMapView')
  .then(({ CutMapView }) => {
    cutMap = new CutMapView(cutCanvas);
    cutMap.setLabels(store.get().debug);
  })
  .catch((e: unknown) => errorLog.report('corte', e));
const panel = new ControlPanel($('panel'), sim, store, dispatch);
panel.onCapture = () => drawTraces(sim());
session.equipment.subscribe(() => panel.sync());
const probeAnimator = new ProbeAnimator(
  () => sim().pose,
  (p) => sim().setPose(p),
);
function setPoseManual(p: Parameters<Simulator['setPose']>[0]): void {
  probeAnimator.cancel(); // cualquier gesto manual cancela la animación
  sim().setPose(p);
}
// Carril izquierdo: ventanas VExUS (la sonda se desliza hasta su punto de partida), ayuda y corte plegable
const windows = new StartPointCards($('start-points'), {
  onPick: (sp) => probeAnimator.goTo(sp),
  getPose: () => sim().pose,
  getTorso: () => sim().scene.torso,
  animating: () => probeAnimator.active,
});
bindPopover($<HTMLButtonElement>('nav-help'), $('nav-help-pop'));
bindCollapsible($<HTMLButtonElement>('cut-toggle'), $('cut-block'));
let lastFps = 0;
panel.onExportDiagnostics = () => {
  const s = sim();
  const d = buildDiagnostics({
    version: __APP_VERSION__,
    commit: __GIT_COMMIT__,
    buildTime: __BUILD_TIME__,
    userAgent: navigator.userAgent,
    gpu: gpuInfo(s.renderer.gl),
    viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
    caseId: s.patient.id,
    simTimeS: s.physiology.clock.t,
    fps: lastFps,
    gpuMs: s.renderer.gpuTimings(),
    equipment: s.equipment,
    circulation: { state: s.physiology.circulation.state, interventions: [...s.physiology.circulation.interventions] },
    errors: errorLog.recent(50),
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }));
  a.download = diagnosticsFileName(d);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
panel.onResetPatient = () => {
  const error = session.reloadCase();
  if (error) banner.show(`No se pudo reiniciar el paciente: ${errorMessage(error)}`, 6000);
  return error;
};
// con la imagen congelada la sonda no se mueve: la rueda y ← → recorren el cine (decisión 80)
const input = new ProbeInput(
  sectorWrap,
  () => sim().pose,
  setPoseManual,
  () => !store.get().frozen,
);
// Navegador 3D (three.js, ~560 kB) con carga diferida: la imagen ecográfica no lo necesita
// para su primer cuadro; si falla, la aplicación sigue sin él.
let nav: Navigator3D | null = null;
void import('./ui/navigator3d')
  .then(({ Navigator3D }) => {
    nav = new Navigator3D(navHost, sim().scene, sim().transducer, {
      getPose: () => sim().pose,
      setPose: setPoseManual,
      getFrame: () => sim().frame,
      getDepthMm: () => sim().bmode.depthMm,
      getRespCaudalMm: () => sim().sample.resp.diaphragmCaudalMm,
      getCaliber: () => sim().anatomy.caliberFor(sim().sample),
    });
    nav.setStudentMode(!store.get().debug);
  })
  .catch((e: unknown) => errorLog.report('navegador3d', e));
registerDevtools(
  sim,
  () => ({ nav, cutMap, spectrogram }),
  dispatch,
  () => loopFrames,
);
session.onSimulatorChanged((next) => {
  nav?.setAnatomy(next.scene);
  spectrogram.reset();
  mview.reset();
  panel.onSimulatorChanged();
  cine.sync();
});

// --- Controles de la barra ----------------------------------------------------
const modeButtons = {
  B: $<HTMLButtonElement>('mode-b'),
  M: $<HTMLButtonElement>('mode-m'),
  color: $<HTMLButtonElement>('mode-color'),
  pw: $<HTMLButtonElement>('mode-pw'),
};
function applyMode(mode: ImagingMode): void {
  const wasPw = sim().pw.enabled;
  dispatch({ type: 'mode', mode });
  if (sim().pw.enabled && !wasPw) {
    sim().pwChain.reset();
    spectrogram.reset();
  }
  const on = { B: mode === 'B', M: mode === 'M', color: modeHasColor(mode), pw: modeHasPw(mode) };
  for (const k of ['B', 'M', 'color', 'pw'] as const) {
    modeButtons[k].classList.toggle('active', on[k]);
    modeButtons[k].setAttribute('aria-pressed', String(on[k]));
  }
  // la imagen manda: el espectro solo ocupa su franja con el PW encendido, y la del modo M con el modo M
  app.classList.toggle('pw-on', modeHasPw(mode));
  app.classList.toggle('m-on', mode === 'M');
}
// 2D apaga todo; Color y PW alternan su función y conservan la otra (tríplex, decisión 66); M, el modo M (80)
modeButtons.B.addEventListener('click', () => store.set({ mode: 'B', tab: tabAfterMode('B', store.get().tab) }));
modeButtons.M.addEventListener('click', () => {
  const mode = toggleM(store.get().mode);
  store.set({ mode, tab: tabAfterMode(mode, store.get().tab) });
});
for (const key of ['color', 'pw'] as const) {
  modeButtons[key].addEventListener('click', () => {
    const mode = toggleMode(store.get().mode, key);
    store.set({ mode, tab: tabAfterMode(mode, store.get().tab) });
  });
}
const freezeBtn = $<HTMLButtonElement>('freeze');
freezeBtn.addEventListener('click', () => store.set({ frozen: !store.get().frozen }));
const audioBtn = $<HTMLButtonElement>('audio-toggle');
audioBtn.addEventListener('click', () => void toggleAudio());
async function toggleAudio(): Promise<void> {
  try {
    if (sim().audio.enabled) await sim().audio.disable();
    else await sim().audio.enable();
  } catch (e) {
    errorLog.report('audio', e);
    banner.show(`Audio no disponible: ${errorMessage(e)}`, 5000);
  }
  store.set({ audio: sim().audio.enabled });
}
const torsoBtn = $<HTMLButtonElement>('torso-toggle');
torsoBtn.addEventListener('click', () => store.set({ torso: !store.get().torso }));
$<HTMLButtonElement>('rail-collapse').addEventListener('click', () => store.set({ torso: false }));
const debugToggle = $<HTMLInputElement>('debug-toggle');
// en producción la casilla «Docente» solo aparece con ?docente (el alumno no la ve)
debugToggle.parentElement!.hidden = !teacherToggleAllowed(import.meta.env.DEV, location.search);
debugToggle.addEventListener('change', () =>
  store.set({
    debug: debugToggle.checked,
    tab: debugToggle.checked ? 'docente' : store.get().tab === 'docente' ? 'adquirir' : store.get().tab,
  }),
);
caseSelect.addEventListener('change', () => {
  if (isCaseId(caseSelect.value)) store.set({ caseId: caseSelect.value });
});
$<HTMLButtonElement>('nav-zoom-in').addEventListener('click', () => nav?.zoomBy(0.85));
$<HTMLButtonElement>('nav-zoom-out').addEventListener('click', () => nav?.zoomBy(1 / 0.85));
$<HTMLButtonElement>('nav-center').addEventListener('click', () => nav?.centerOnProbe());
const layerMenu = buildLayerMenu($<HTMLElement>('layer-menu'), $<HTMLButtonElement>('nav-layers'), (patch) => nav?.setLayers(patch));
/** Modo alumno: sin nombre del caso, sin rótulos en el corte y sin vasos en el 3D. */
function applyTeacherMode(teacher: boolean): void {
  labelCases(teacher);
  cutMap?.setLabels(teacher);
  nav?.setStudentMode(!teacher);
  layerMenu.setLocked('vessels', !teacher, 'Visible en modo docente');
}
applyTeacherMode(false);

const imageClick = bindImageClick({
  host: sectorWrap,
  canvas: glCanvas,
  getSim: sim,
  store,
  setIvcCaliper: (mm) => panel.setIvcCaliper(mm),
  dispatch,
});
bindKeyboardShortcuts(store, dispatch);
// el cine y la franja M eran del renderizador viejo (decisión 80)
const gpu = bindGpuLifecycle(glCanvas, sim, banner, () => {
  cine.sync();
  mview.reset();
});
const cine = bindCine({
  bar: $('cine-bar'),
  slider: $<HTMLInputElement>('cine'),
  label: $('cine-time'),
  freezeButton: freezeBtn,
  host: sectorWrap,
  getSim: sim,
  store,
});
// calibres de la VCI en modo M sobre la franja (decisión 80)
mCanvas.addEventListener('click', (e) => {
  const p = store.get().tool === 'mmode' ? mview.pick(e.clientX, e.clientY) : null;
  if (p) panel.addMPoint(p, mview.window());
});

// --- Estado de UI → sesión -------------------------------------------------------
store.subscribe((st, prev) => {
  if (st.mode !== prev.mode) applyMode(st.mode);
  if (st.frozen !== prev.frozen) {
    sim().frozen = st.frozen;
    app.classList.toggle('frozen', st.frozen);
    setPressed(freezeBtn, st.frozen);
    liveChip.textContent = st.frozen ? 'FREEZE' : 'LIVE';
    liveChip.className = `chip ${st.frozen ? 'freeze' : 'live'}`;
  }
  if (st.audio !== prev.audio) setPressed(audioBtn, st.audio);
  if (st.torso !== prev.torso) {
    app.classList.toggle('no-torso', !st.torso);
    setPressed(torsoBtn, st.torso);
  }
  if (st.caseId !== prev.caseId) {
    const error = session.loadCase(st.caseId);
    if (error) {
      // transaccional: sigue el caso anterior; el selector y el estado vuelven atrás
      banner.show(`No se pudo cargar el caso: ${errorMessage(error)}`, 6000);
      caseSelect.value = prev.caseId;
      store.set({ caseId: prev.caseId });
    }
  }
  if (st.tool !== prev.tool && st.tool !== 'caliper') imageClick.cancelCaliper();
  if (st.debug !== prev.debug) applyTeacherMode(st.debug);
});

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
  for (const c of [ecgCanvas, spectrumCanvas, mCanvas, cutCanvas]) {
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

// --- Bucle principal ---------------------------------------------------------
let last = performance.now();
let frames = 0;
let frameTime = 0;
let lastStatus = 0;
/** Cuadros completos del bucle (nunca se reinicia): la e2e espera cuadros, no segundos (`framesRendered`). */
let loopFrames = 0;
const errorBudget = new ErrorBudget();
let loopDegraded = false;
const heartRate = new HeartRateDisplay();
let eqPrevCpu: CutMapView['lastMap'] = null;

/** Una referencia de presentación para historial y captura; también se publica al pulsar Capturar. */
function drawTraces(s: Simulator): void {
  const t = s.physiology.clock.t;
  // el ECG siempre está a la vista (el espectro, solo con PW; la franja M, con el modo M) y comparte con ellos el
  // eje de tiempo; con el cine llevan el cursor de su cuadro y se desplazan con él (decisión 80)
  const secondsVisible = ecgCanvas.clientWidth / (s.pw.sweepMmS * 3.2);
  const cursorT = cine.cursorT();
  const tRight = traceRight(t, cursorT, secondsVisible);
  drawEcg(ecgCanvas, s, secondsVisible, tRight, cursorT);
  spectrogram.draw(s, s.spectral.columns, tRight, secondsVisible, cursorT, panel.captureOverlay);
  if (s.mmode.enabled && !gpu.lost) mview.draw(s.renderer, tRight, secondsVisible, cursorT, panel.mMarks);
}

function frame(now: number, dt: number): void {
  const s = sim();
  fitCanvases();
  input.tick(dt);
  probeAnimator.tick(dt);
  s.advance(dt);
  if (!gpu.lost) {
    s.render();
    cine.tick();
  }
  drawOverlay(overlay, s);
  nav?.draw();
  if (store.get().torso && !gpu.lost) cutMap?.draw(s, now);
  const t = s.physiology.clock.t;
  drawTraces(s);
  const h = hudText({
    patientLabel: caseDisplayLabel(s.patient.id, store.get().debug),
    frozen: s.frozen,
    heartRateBpm: heartRate.update(s.sample.rr, dt),
    atrialFibrillation: s.patient.rhythm === 'atrial-fibrillation',
    transducerMHz: s.transducer.f0B / 1e6,
    f0DopplerHz: s.transducer.f0Doppler,
    depthMm: s.bmode.depthMm,
    gainDb: s.bmode.gainDb,
    dynamicRangeDb: s.bmode.dynamicRangeDb,
    compound: compoundActive(s.bmode, s.color),
    harmonic: s.bmode.harmonic,
    mode: store.get().mode,
    color: { prfHz: s.color.prfHz, wallFilterHz: s.color.wallFilterHz, frameHz: s.colorTiming.frameHz },
    pw: { prfHz: s.pw.prfHz, gateMm: s.pw.gateMm, depthMm: s.pw.depthMm, sweepMmS: s.pw.sweepMmS },
    respVolume: s.sample.resp.volume,
  });
  renderLines(hud.tl, h.topLeft);
  renderLines(hud.tr, h.topRight);
  renderLines(hud.br, h.bottomRight);
  ctxChip.textContent = h.chip;
  frames++;
  frameTime += dt;
  if (now - lastStatus > 250) {
    lastStatus = now;
    lastFps = frames / Math.max(1e-3, frameTime);
    status.textContent = `${lastFps.toFixed(0)} fps · t ${t.toFixed(1)} s`;
    frames = 0;
    frameTime = 0;
    // Comprobación TS ↔ GLSL en vivo (solo docente): mapa GPU vs mapa del Worker, misma rejilla.
    // La lectura GPU es asíncrona: el mapa devuelto se compara con la instantánea CPU anterior.
    if (store.get().debug && store.get().torso && !gpu.lost) {
      const cpu = cutMap?.lastMap ?? null;
      const gpuMap = cpu ? s.gpuTissueMap(cpu) : null;
      panel.setEquivalence(gpuMap && eqPrevCpu ? compareTissueGrids(eqPrevCpu.map, gpuMap) : null);
      eqPrevCpu = cpu;
    }
    panel.renderDebug();
    panel.sync(); // la pose y el acoplamiento cambian con el ratón; el equipo avisa por su cuenta
    windows.sync();
  }
  loopFrames++;
}

function loop(now: number): void {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  try {
    frame(now, dt);
    if (loopDegraded) {
      loopDegraded = false; // se recuperó: el aviso de error persistente ya no aplica
      if (!gpu.lost) banner.hide();
    }
  } catch (e) {
    errorLog.report(e instanceof NonFiniteStateError ? 'fisiología' : 'bucle', e);
    if (errorBudget.fail(now)) {
      // Error persistente: avisar y reintentar a 1 Hz en vez de detener la aplicación para siempre
      loopDegraded = true;
      banner.show(`Error persistente en el bucle (se reintenta cada segundo): ${errorMessage(e)}`);
      setTimeout(() => requestAnimationFrame(loop), 1000);
      return;
    }
  }
  requestAnimationFrame(loop);
}
fitCanvases();
requestAnimationFrame(loop);
