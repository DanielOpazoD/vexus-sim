import { registerDevtools } from './app/devtools';
import { caseDisplayLabel, teacherToggleAllowed } from './app/blindMode';
import { buildDiagnostics, buildLabel, diagnosticsFileName, gpuInfo } from './app/diagnostics';
import { ErrorBudget } from './app/errorBudget';
import { modeHasColor, modeHasPw, toggleM, toggleMode } from './app/equipment';
import { compareTissueGrids } from './app/equivalenceCheck';
import { errorLog, errorMessage } from './app/errorLog';
import { ProbeAnimator } from './app/probeAnimation';
import { windowPreset } from './app/windowPreset';
import { startPointsFor } from './app/startPoints';
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
import { drawVelocityRuler } from './ui/velocityRuler';
import { MModeView } from './ui/mModeView';
import { traceRight } from './ui/sweep';
import { bindKeyboardShortcuts } from './ui/keyboardShortcuts';
import type { Navigator3D } from './ui/navigator3d';
import { setPressed } from './ui/controls';
import { ControlPanel, tabAfterMode } from './ui/panel';
import { ProbeInput } from './ui/probeInput';
import { translateProbe } from './probe/translation';
import { StartPointCards } from './ui/startPointCards';
import { compoundActive } from './ultrasound/compound';
import { markStartup, startupTraceEnabled } from './app/startupTrace';
import { FirstGpuFrame } from './app/firstGpuFrame';
import { GpuFramePacer } from './app/gpuFramePacer';
import { gpuPageTurns as gpuTurns } from './app/gpuPageTurns';

export async function start(): Promise<void> {
  markStartup('bootstrap:begin');
  try {
    await gpuTurns.prepare();
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
    const pwScaleCanvas = $<HTMLCanvasElement>('pw-scale');
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
      gpuTurns.dispose();
      document.body.innerHTML = '';
      const d = document.createElement('div');
      d.className = 'error';
      d.textContent = `No se pudo iniciar el simulador: ${message}`;
      document.body.appendChild(d);
      throw new Error(message);
    }

    // Preview revisable: aún no sustituye el adulto por defecto sin validar todas las ventanas.
    let session: SimulationSession;
    try {
      markStartup('simulation:begin');
      session = new SimulationSession(glCanvas, CASE_IDS[0]);
      markStartup('simulation:ready');
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
      const first = startPointsFor(sim().scene.torso)[0];
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
    markStartup('cut:import');
    void import('./ui/cutMapView')
      .then(({ CutMapView }) => {
        cutMap = new CutMapView(cutCanvas, () => {
          if (store.get().torso && !gpu.lost && !panel.venousComparisonOpen) {
            try {
              cutMap?.draw(sim(), performance.now());
            } catch (error) {
              errorLog.report('corte', error);
            }
          }
        });
        cutMap.setLabels(store.get().debug);
        markStartup('cut:ready');
      })
      .catch((e: unknown) => errorLog.report('corte', e));
    const panel = new ControlPanel($('panel'), sim, store, dispatch, setPoseManual);
    markStartup('controls:ready');
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
    // Carril izquierdo: accesos por territorio (la sonda se desliza hasta su punto de partida), ayuda y corte plegable
    const windows = new StartPointCards($('start-points'), {
      onPick: (sp) => {
        // La tarjeta pide una adquisición 2D nueva: sale de cine y cancela la medición pendiente.
        // Los gestos libres no pasan por esta ruta y conservan el modo.
        store.set({ mode: 'B', tab: tabAfterMode('B', store.get().tab), frozen: false, tool: 'none' });
        imageClick.cancelCaliper();
        for (const cmd of windowPreset(sp.id, sim().transducer.f0Doppler, !!sim().scene.torso.profile, sim().scene.hasAbdominalAtlas))
          dispatch(cmd);
        probeAnimator.goTo(sp);
      },
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
      (p, phi, z) => translateProbe(p, phi, z, sim().scene.torso, sim().transducer),
    );
    // Preparar ambos contextos antes de encolar adquisiciones: crear el contexto 3D
    // con ecografías ya en vuelo puede forzar una espera síncrona en SwiftShader. La carga
    // sigue en su chunk; si falla, se informa y el bucle ecográfico continúa.
    let nav: Navigator3D | null = null;
    markStartup('navigator:import');
    const navigatorReady = import('./ui/navigator3d')
      .then(async ({ Navigator3D }) => {
        if (sim().scene.hasAbdominalAtlas) {
          markStartup('navigator:surface:begin');
          await (await import('./anatomy/abdominalSurface')).loadAbdominalSurface();
          markStartup('navigator:surface:ready');
        }
        markStartup('navigator:construct');
        nav = new Navigator3D(navHost, sim().scene, sim().transducer, {
          getPose: () => sim().pose,
          setPose: setPoseManual,
          getFrame: () => sim().renderer.displayedFrame?.anatomy.frame ?? sim().frame,
          getDepthMm: () => sim().renderer.displayedFrame?.bmode.depthMm ?? sim().bmode.depthMm,
          getRespCaudalMm: () => (sim().renderer.displayedFrame?.anatomy.sample ?? sim().sample).resp.diaphragmCaudalMm,
          getCaliber: () => sim().anatomy.caliberFor(sim().renderer.displayedFrame?.anatomy.sample ?? sim().sample),
        });
        nav.setStudentMode(!store.get().debug);
        // El primer dibujo prepara programas y buffers de Three. Hacerlo tras
        // s.render() intercala sus consultas síncronas con la adquisición en vuelo.
        markStartup('navigator:draw');
        nav.draw();
        markStartup('navigator:drawn');
        markStartup('navigator:ready');
      })
      .catch((e: unknown) => {
        errorLog.report('navegador3d', e);
        const failed = nav;
        nav = null;
        try {
          failed?.dispose();
        } catch (cleanupError) {
          errorLog.report('navegador3d', cleanupError);
        }
      });
    registerDevtools(
      sim,
      () => ({ nav, cutMap, spectrogram }),
      dispatch,
      () => loopFrames,
    );
    session.onSimulatorChanged((next) => {
      cutMap?.onSimulatorChanged(next);
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
      fitTraceCanvases();
    }

    /** La consola y sus capturas pueden hacerse visibles entre adquisiciones GPU. */
    function fitTraceCanvases(): void {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      for (const c of [ecgCanvas, spectrumCanvas, pwScaleCanvas, mCanvas, cutCanvas]) {
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
    /** Vueltas completas de JS (nunca se reinicia); la valla confirma aparte el primer cuadro GPU. */
    let loopFrames = 0;
    const firstGpuFrame = new FirstGpuFrame(startupTraceEnabled, markStartup);
    const gpuFramePacer = new GpuFramePacer();
    const errorBudget = new ErrorBudget();
    let loopDegraded = false;
    const heartRate = new HeartRateDisplay();
    let eqPrevCpu: CutMapView['lastMap'] = null;
    let presentationDirty = true;
    let presentedCpuState: unknown[] = [];
    let presentedCutMap: unknown;
    let submittedGpuState: unknown[] = [];
    // Incluye el dibujo inicial que navigatorReady envía antes del primer cuadro.
    let submittedNavRevision = 0;
    // An unchanged 2D canvas must not keep submitting compositor work while the
    // software GPU is busy. Cut interaction invalidates its annotation in that turn.
    for (const event of ['pointermove', 'pointerleave', 'click', 'keydown'])
      cutCanvas.addEventListener(event, () => (presentationDirty = true), true);

    /** Una referencia de presentación para historial y captura; también se publica al pulsar Capturar. */
    function drawTraces(s: Simulator, allowGpu = true): void {
      fitTraceCanvases();
      const t = s.physiology.clock.t;
      // el ECG siempre está a la vista (el espectro, solo con PW; la franja M, con el modo M) y comparte con ellos el
      // eje de tiempo; con el cine llevan el cursor de su cuadro y se desplazan con él (decisión 80)
      const secondsVisible = ecgCanvas.clientWidth / (s.pw.sweepMmS * 3.2);
      const cursorT = cine.cursorT();
      const tRight = traceRight(t, cursorT, secondsVisible);
      drawEcg(ecgCanvas, s, secondsVisible, tRight, cursorT);
      spectrogram.draw(s, s.spectral.columns, tRight, secondsVisible, cursorT, panel.captureOverlay);
      if (s.pw.enabled) drawVelocityRuler(pwScaleCanvas, s.pwNyquistCms(), s.pw.baselineShift, s.pw.invert);
      if (allowGpu && s.mmode.enabled && !gpu.lost) mview.draw(s.renderer, tRight, secondsVisible, cursorT, panel.mMarks);
    }

    /** Presentar el estado adquirido en CPU no necesita otra adquisición ni otro dibujo 3D. */
    function drawAcquiredViews(s: Simulator, now: number, allowGpu: boolean): void {
      fitTraceCanvases();
      // Always service the Worker, including progress, cancellation and new maps.
      if (store.get().torso && !gpu.lost) cutMap?.draw(s, now);
      const map = cutMap?.lastMap?.map;
      const state = [
        s,
        s.renderer.displayedFrame,
        s.equipment,
        s.pwChain.revision,
        store.get(),
        s.physiology.clock.t,
        panel.captureOverlay,
        panel.mMarks,
        panel.mMarks.length,
        overlay.width,
        overlay.height,
        ecgCanvas.width,
        ecgCanvas.height,
        spectrumCanvas.width,
        spectrumCanvas.height,
        mCanvas.width,
        mCanvas.height,
        allowGpu && s.mmode.enabled,
      ];
      const tracesChanged = presentationDirty || !state.every((value, i) => value === presentedCpuState[i]);
      if (!tracesChanged && map === presentedCutMap) return;
      presentationDirty = false;
      presentedCpuState = state;
      presentedCutMap = map;
      // Un mapa nuevo solo invalida el contorno anatómico, no ECG/espectro/M.
      if (tracesChanged) drawTraces(s, allowGpu);
      drawOverlay(overlay, s);
      cutMap?.drawHighlight(overlay, s, store.get().torso && !gpu.lost);
    }

    function frame(now: number, dt: number): boolean {
      if (loopFrames === 0) markStartup('frame:begin');
      const s = sim();
      fitCanvases();
      input.tick(dt);
      probeAnimator.tick(dt);
      if (loopFrames === 0) markStartup('advance:begin');
      s.advance(dt);
      if (loopFrames === 0) markStartup('advance:ready');
      const comparisonOpen = panel.venousComparisonOpen;
      if (comparisonOpen) panel.renderVenous();
      // El visor es modal: no gastar GPU en imágenes ocultas. El reloj y la adquisición IQ
      // siguen en advance; al cerrar se vuelve a dibujar el estado actual, sin cambiar frozen.
      // Si ya se adquiría M, mantener sus columnas y cine: no fabricar un hueco temporal.
      if ((!comparisonOpen || s.mmode.enabled) && !gpu.lost) {
        if (loopFrames === 0) markStartup('ultrasound:begin');
        s.render();
        if (loopFrames === 0) markStartup('ultrasound:ready');
        firstGpuFrame.submit(s.renderer.gl);
        cine.tick();
      }
      if (!comparisonOpen) {
        if (loopFrames === 0 && nav) markStartup('navigator:draw');
        nav?.draw();
        if (loopFrames === 0 && nav) markStartup('navigator:drawn');
        drawAcquiredViews(s, now, true);
      }
      const t = s.physiology.clock.t;
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
        if (comparisonOpen) {
          eqPrevCpu = null;
          panel.setEquivalence(null);
        } else if (store.get().debug && store.get().torso && !gpu.lost) {
          const cpu = cutMap?.lastMap ?? null;
          const gpuMap = cpu ? s.gpuTissueMap(cpu) : null;
          panel.setEquivalence(gpuMap && eqPrevCpu ? compareTissueGrids(eqPrevCpu.map, gpuMap) : null);
          eqPrevCpu = cpu;
        }
        panel.renderDebug();
        panel.sync(); // la pose y el acoplamiento cambian con el ratón; el equipo avisa por su cuenta
        windows.sync();
      }
      const state = [s.renderer, s.renderer.cineShownFrame, nav?.renderRevision, presentedCpuState, gpu.lost];
      // Una pausa estable no envía comandos: no fabricar una valla/flush.
      // Cine, tamaño, cámara, modos y recuperación invalidan esta identidad.
      // Docente/visor y los dos primeros cuadros conservan el drenaje completo.
      const work = loopFrames < 2 || !s.frozen || comparisonOpen || store.get().debug || state.some((v, i) => v !== submittedGpuState[i]);
      submittedGpuState = state;
      return work;
    }

    function loop(now: number): void {
      try {
        firstGpuFrame.poll();
        const gpuReady = gpuFramePacer.ready();
        if (!gpuFramePacer.inFlight) gpuTurns.completed();
        if (!gpuReady || !gpuTurns.ready) {
          // El Worker, los rótulos y las franjas 2D siguen presentando la instantánea
          // disponible. No encolar ecografía, 3D ni la conversión GPU del modo M.
          if (!panel.venousComparisonOpen) drawAcquiredViews(sim(), now, false);
          requestAnimationFrame(loop);
          return;
        }
        // Acumular el tiempo entre cuadros adquiridos, con el mismo techo de 0,25 s.
        const dt = Math.min(0.25, (now - last) / 1000);
        last = now;
        // undefined conserva el drenaje conservador si frame lanza tras enviar trabajo parcial.
        let gpuWork: boolean | undefined;
        try {
          gpuWork = frame(now, dt);
        } finally {
          // Drain even a partially submitted frame before another page prepares
          // contexts. No lease is released merely because JS returned or threw.
          try {
            if (gpuWork !== false) {
              const contexts = [sim().renderer.gl];
              if (nav && (gpuWork === undefined || nav.renderRevision !== submittedNavRevision)) contexts.push(nav.gpuContext);
              gpuFramePacer.submit(...contexts);
              submittedNavRevision = nav?.renderRevision ?? 0;
            }
          } finally {
            // submit puede lanzar después de crear una valla válida: el turno
            // debe registrarse también para poder liberarlo cuando termine.
            gpuTurns.submitted();
            if (gpuWork === false) gpuTurns.completed();
          }
        }
        loopFrames++;
        if (loopFrames === 1) markStartup('frame:first');
        if (loopFrames === 2) markStartup('frame:second');
        if (loopDegraded) {
          loopDegraded = false; // se recuperó: el aviso de error persistente ya no aplica
          if (!gpu.lost) banner.hide();
        }
      } catch (e) {
        if (!gpuFramePacer.inFlight) gpuTurns.dispose();
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
    void navigatorReady.then(() => {
      fitCanvases();
      markStartup('loop:scheduled');
      requestAnimationFrame(loop);
    });
  } catch (error) {
    gpuTurns.dispose();
    throw error;
  }
}
