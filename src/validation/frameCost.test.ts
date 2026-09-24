import { describe, expect, it } from 'vitest';
import { EquipmentController, type EquipmentCommand } from '../app/equipment';
import { Simulator, defaultEquipment } from '../app/simulator';
import { createTestHooks, frameMeasureOptions } from '../app/testHooks';
import { NORMAL_ADULT } from '../cases';
import { C_RECONSTRUCTION_MM_S } from '../core/units';
import { clonePatient } from '../physiology/patientState';
import { FRAME_PASSES, type PassId } from '../ultrasound/passGraph';
import type { FrameInputs, PassRepeat, UltrasoundRenderer } from '../ultrasound/renderer';

/** Renderizador falso: registra lo que pide cada cuadro (el coste en GPU lo mide el banco, no vitest). */
class FakeRenderer {
  frames: { updateColor: boolean; colorOn: boolean; repeat: PassRepeat | undefined }[] = [];
  poses: FrameInputs['pose'][] = [];
  syncs = 0;
  /** Cuadros que dibuja antes de fallar (un fallo de GPU a mitad de la medida). */
  failAfter = Number.POSITIVE_INFINITY;
  setScene(): void {}
  render(inputs: FrameInputs, repeat?: PassRepeat): void {
    if (this.frames.length >= this.failAfter) throw new Error('fallo de GPU simulado');
    this.frames.push({ updateColor: inputs.updateColor, colorOn: inputs.color.enabled, repeat });
    this.poses.push({ ...inputs.pose });
  }
  finishForTiming(): void {
    this.syncs++;
  }
}

/** Simulador real con el renderizador falso y el equipo gobernado por comandos, como en `SimulationSession`. */
function rig() {
  const fake = new FakeRenderer();
  const sim = new Simulator(clonePatient(NORMAL_ADULT), {} as HTMLCanvasElement, undefined, fake as unknown as UltrasoundRenderer);
  const equipment = new EquipmentController(defaultEquipment(), { halfSectorRad: sim.transducer.halfSector, cMmS: C_RECONSTRUCTION_MM_S });
  sim.equipment = equipment.state;
  equipment.subscribe((next) => {
    sim.equipment = next;
  });
  const dispatch = (cmd: EquipmentCommand): void => equipment.dispatch(cmd);
  return { fake, sim, equipment, dispatch, hooks: createTestHooks(() => sim, dispatch) };
}

describe('frameCostMs: el coste del cuadro con color y por pasada', () => {
  it('forceColor dibuja cada cuadro completo y con color, y deja la caja apagada como estaba', () => {
    const { fake, sim, equipment, hooks } = rig();
    const before = equipment.state;
    expect(sim.color.enabled).toBe(false);
    hooks.frameCostMs(20, { forceColor: true });
    expect(fake.frames.length).toBe(21);
    for (const f of fake.frames) expect(f).toEqual({ updateColor: true, colorOn: true, repeat: undefined });
    expect(fake.syncs).toBe(2);
    expect(equipment.state).toEqual(before);
    expect(sim.color.enabled).toBe(false);
  });

  it('con la caja ya encendida exige forceColor (sin él lanza, no devuelve ≈ 0 ms) y con él dibuja cada cuadro', () => {
    const { fake, sim, dispatch, hooks } = rig();
    dispatch({ type: 'color', patch: { enabled: true } });
    sim.render();
    fake.frames = [];
    // el reloj no avanza: la cadencia del color (decisión 39) no dejaría dibujar ninguno de los 11 cuadros
    sim.render();
    expect(fake.frames.length).toBe(0);
    expect(() => hooks.frameCostMs(10)).toThrow(/forceColor/);
    expect(() => hooks.frameCostMs(10, { repeatPass: 'rawField' })).toThrow(/forceColor/);
    expect(() => hooks.frameCostMs(10, { repeatPass: 'transmission', repeatCount: 4 })).toThrow(/forceColor/);
    expect(fake.frames.length).toBe(0);
    hooks.frameCostMs(10, { forceColor: true });
    expect(fake.frames.length).toBe(11);
    expect(fake.frames.every((f) => f.updateColor && f.colorOn)).toBe(true);
    expect(sim.color.enabled).toBe(true);
  });

  it('lanza si no dibujaría ningún cuadro: imagen congelada o n que no es un entero ≥ 1', () => {
    const { fake, sim, hooks } = rig();
    sim.frozen = true;
    expect(() => hooks.frameCostMs(10)).toThrow(/congelada/);
    expect(() => hooks.frameCostMs(10, { forceColor: true })).toThrow(/congelada/);
    expect(sim.color.enabled).toBe(false);
    sim.frozen = false;
    for (const n of [0, -1, 2.5, Number.NaN]) expect(() => hooks.frameCostMs(n)).toThrow(/entero ≥ 1/);
    expect(fake.frames.length).toBe(0);
    expect(hooks.frameCostMs(3)).toBeGreaterThanOrEqual(0);
    expect(fake.frames.length).toBe(4);
  });

  it('si un cuadro falla, el error sube y la caja vuelve igualmente a como estaba', () => {
    const { fake, sim, hooks } = rig();
    fake.failAfter = 3;
    expect(() => hooks.frameCostMs(20, { forceColor: true })).toThrow(/fallo de GPU/);
    // los cuadros previos al fallo se dibujaron con la caja encendida por la medida
    expect(fake.frames.length).toBe(3);
    expect(fake.frames.every((f) => f.colorOn)).toBe(true);
    expect(sim.color.enabled).toBe(false);
  });

  it('repeatPass llega al renderizador en cada cuadro, con repeatCount repeticiones (1 por defecto)', () => {
    const { fake, hooks } = rig();
    hooks.frameCostMs(4, { repeatPass: 'rawField' });
    expect(fake.frames.map((f) => f.repeat)).toEqual(Array(5).fill({ pass: 'rawField', times: 1 }));
    fake.frames = [];
    hooks.frameCostMs(4, { repeatPass: 'transmission', repeatCount: 3, forceColor: true });
    expect(fake.frames.every((f) => f.colorOn && f.repeat?.pass === 'transmission' && f.repeat.times === 3)).toBe(true);
  });

  it('startPoint mide en la pose de partida aunque la sonda se haya movido (el barrido del banco)', () => {
    const { fake, sim, hooks } = rig();
    hooks.goToStartPoint('intercostal');
    const at = { ...sim.pose };
    sim.setPose({ ...at, tilt: at.tilt + (6 * Math.PI) / 180 });
    hooks.frameCostMs(3);
    expect(fake.poses.every((p) => p.tilt !== at.tilt)).toBe(true);
    for (const opts of [{}, { forceColor: true }]) {
      sim.setPose({ ...at, rock: at.rock - (6 * Math.PI) / 180 });
      fake.poses = [];
      hooks.frameCostMs(3, { ...opts, startPoint: 'intercostal' });
      expect(fake.poses.length).toBe(4);
      for (const p of fake.poses) expect(p).toEqual(at);
    }
  });

  it('las opciones que no medirían nada lanzan en vez de ignorarse', () => {
    expect(() => frameMeasureOptions({ repeatPass: 'noExiste' as PassId })).toThrow(/no es una pasada/);
    expect(() => frameMeasureOptions({ repeatPass: 'rawField', repeatCount: 0 })).toThrow(/entero ≥ 1/);
    expect(() => frameMeasureOptions({ repeatPass: 'rawField', repeatCount: 1.5 })).toThrow(/entero ≥ 1/);
    expect(() => frameMeasureOptions({ repeatCount: 2 })).toThrow(/sin repeatPass/);
    // la pasada de color solo se dibuja en los cuadros de color
    expect(() => frameMeasureOptions({ repeatPass: 'color' })).toThrow(/exige forceColor/);
    expect(frameMeasureOptions({ repeatPass: 'color', forceColor: true })).toEqual({
      forceColor: true,
      repeat: { pass: 'color', times: 1 },
    });
    expect(frameMeasureOptions()).toEqual({ forceColor: false });
  });

  it('la aplicación no cambia: render() sin opciones ni repite ni fuerza, y forceColor sin caja lanza', () => {
    const { fake, sim, dispatch } = rig();
    sim.render();
    sim.render();
    expect(fake.frames).toEqual(Array(2).fill({ updateColor: true, colorOn: false, repeat: undefined }));
    dispatch({ type: 'color', patch: { enabled: true } });
    sim.render(); // mismo instante que el último cuadro: la cadencia del color lo salta
    expect(fake.frames.length).toBe(2);
    sim.advance(1 / sim.colorTiming.frameHz + 0.02);
    sim.render();
    expect(fake.frames[2]).toEqual({ updateColor: true, colorOn: true, repeat: undefined });
    dispatch({ type: 'color', patch: { enabled: false } });
    expect(() => sim.render({ forceColor: true })).toThrow(/caja de color/);
  });
});

/**
 * WebGL2 falso que registra lo que el renderizador real pide a la GPU: qué FBO está puesto, con qué
 * programa y qué textura hay en cada unidad en cada dibujo, y los adjuntos (formato y tamaño) de cada
 * FBO. Todo lo demás (uniforms, parámetros de textura) no hace nada; los shaders «compilan».
 */
function recordingGl(canvasSize: { width: number; height: number }) {
  const K: Record<string, number> = {
    TEXTURE0: 0x84c0,
    TEXTURE_2D: 0x0de1,
    FRAMEBUFFER: 0x8d40,
    FRAMEBUFFER_COMPLETE: 0x8cd5,
    COLOR_ATTACHMENT0: 0x8ce0,
  };
  let nextConst = 0x10000;
  let nextId = 1;
  type Obj = { kind: string; id: number };
  const make = (kind: string): Obj => ({ kind, id: nextId++ });
  const state = {
    fbo: null as Obj | null,
    program: null as Obj | null,
    unit: 0,
    units: new Map<number, Obj | null>(),
    viewport: [0, 0, 0, 0] as number[],
  };
  const texInfo = new Map<Obj, { internal: number; w: number; h: number }>();
  const attachments = new Map<Obj, { internal: number; w: number; h: number }[]>();
  const draws: { fbo: Obj | null; program: Obj | null; units: string; viewport: number[] }[] = [];
  const binds: (Obj | null)[] = [];
  const deleted = new Set<Obj>();
  const methods: Record<string, (...a: never[]) => unknown> = {
    getExtension: (name: string) => (name === 'EXT_color_buffer_float' || name === 'OES_texture_float_linear' ? {} : null),
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    checkFramebufferStatus: () => K.FRAMEBUFFER_COMPLETE,
    getUniformLocation: () => make('loc'),
    createShader: () => make('shader'),
    createProgram: () => make('program'),
    createTexture: () => make('texture'),
    createFramebuffer: () => make('fbo'),
    createBuffer: () => make('buffer'),
    createQuery: () => make('query'),
    fenceSync: () => make('sync'),
    useProgram: (p: Obj) => void (state.program = p),
    activeTexture: (u: number) => void (state.unit = u - K.TEXTURE0),
    bindTexture: (_t: number, tex: Obj | null) => void state.units.set(state.unit, tex),
    texImage2D: (_t: number, _l: number, internal: number, w: number, h: number) => {
      const tex = state.units.get(state.unit);
      if (tex) texInfo.set(tex, { internal, w, h });
    },
    bindFramebuffer: (_t: number, fbo: Obj | null) => {
      state.fbo = fbo;
      binds.push(fbo);
    },
    framebufferTexture2D: (_t: number, att: number, _tt: number, tex: Obj) => {
      const list = attachments.get(state.fbo!) ?? [];
      list[att - K.COLOR_ATTACHMENT0] = texInfo.get(tex)!;
      attachments.set(state.fbo!, list);
    },
    deleteFramebuffer: (fbo: Obj) => void deleted.add(fbo),
    viewport: (...v: number[]) => void (state.viewport = v),
    drawArrays: () => {
      const units = [...state.units.entries()]
        .filter(([, t]) => t)
        .sort(([a], [b]) => a - b)
        .map(([u, t]) => `${u}:${t!.id}`)
        .join(' ');
      draws.push({ fbo: state.fbo, program: state.program, units, viewport: state.viewport });
    },
  };
  const gl = new Proxy(
    { drawingBufferWidth: canvasSize.width, drawingBufferHeight: canvasSize.height },
    {
      get(target: Record<string, unknown>, prop: string) {
        if (prop in target) return target[prop];
        if (prop in methods) return methods[prop];
        if (/^[A-Z][A-Z0-9_]*$/.test(prop)) return (K[prop] ??= nextConst++);
        return () => undefined;
      },
    },
  );
  const canvas = { ...canvasSize, getContext: () => gl } as unknown as HTMLCanvasElement;
  return { canvas, draws, binds, attachments, deleted };
}

/** Simulador con el renderizador REAL sobre el WebGL falso (sin caja de color: 10 pasadas por cuadro). */
function realRig() {
  const rec = recordingGl({ width: 320, height: 240 });
  const sim = new Simulator(clonePatient(NORMAL_ADULT), rec.canvas);
  return { ...rec, sim };
}

describe('repeatPass en el renderizador real (WebGL falso)', () => {
  const perFrame = FRAME_PASSES.filter((p) => p.cadence === 'frame').length;

  it('sin repetición, un dibujo por pasada y ningún destino de prueba', () => {
    const { sim, draws, attachments } = realRig();
    const fbos = attachments.size;
    sim.render();
    expect(draws.length).toBe(perFrame);
    expect(attachments.size).toBe(fbos + 3); // conversión de barrido y las dos historias, del primer cuadro
    draws.length = 0;
    sim.render();
    expect(draws.length).toBe(perFrame);
    expect(attachments.size).toBe(fbos + 3);
  });

  for (const pass of ['rawField', 'transmission', 'persistence', 'present'] as const)
    it(`${pass}: cada repetición es su propio pase de render, con las texturas de la pasada, y la salida real no cambia`, () => {
      const { sim, draws, binds, attachments } = realRig();
      // la persistencia alterna sus dos historias: el cuadro con repetición se compara con el de su paridad
      sim.render();
      const base = draws.splice(0);
      sim.render();
      draws.length = 0;
      const idx = FRAME_PASSES.filter((p) => p.cadence === 'frame').findIndex((p) => p.id === pass);
      const own = base[idx];
      binds.length = 0;
      sim.render({ repeat: { pass, times: 3 } });
      expect(draws.length).toBe(perFrame + 3);
      // la pasada y las demás dibujan igual que sin repetir (mismo destino, programa y texturas)
      const withoutRepeats = [...draws.slice(0, idx + 1), ...draws.slice(idx + 4)];
      expect(withoutRepeats.map((d) => [d.fbo?.id ?? null, d.program?.id])).toEqual(base.map((d) => [d.fbo?.id ?? null, d.program?.id]));
      const repeats = draws.slice(idx + 1, idx + 4);
      const frameFbos = new Set(base.map((d) => d.fbo));
      let prev = draws[idx].fbo;
      for (const r of repeats) {
        expect(r.program).toBe(own.program);
        expect(r.units).toBe(draws[idx].units);
        // otro FBO que el del dibujo anterior y que cualquier destino del cuadro
        expect(r.fbo).not.toBe(prev);
        expect(frameFbos.has(r.fbo)).toBe(false);
        // con el tamaño y los formatos de la salida de la pasada (la pantalla: RGBA8 del lienzo)
        const want = own.fbo ? attachments.get(own.fbo) : [{ internal: attachments.get(repeats[0].fbo!)![0].internal, w: 320, h: 240 }];
        expect(attachments.get(r.fbo!)).toEqual(want);
        expect(r.viewport).toEqual(draws[idx].viewport);
        prev = r.fbo;
      }
      expect(new Set(repeats.map((r) => r.fbo)).size).toBe(2);
      // al terminar vuelve a quedar puesto el destino de la pasada
      const lastRepeatBind = binds.lastIndexOf(repeats[2].fbo);
      expect(binds[lastRepeatBind + 1]).toBe(own.fbo);
    });

  it('dispose libera los destinos de prueba', () => {
    const { sim, draws, deleted } = realRig();
    sim.render({ repeat: { pass: 'rawField', times: 2 } });
    const scratch = new Set(draws.slice(5, 7).map((d) => d.fbo));
    sim.renderer.dispose();
    for (const f of scratch) expect(deleted.has(f!)).toBe(true);
  });
});
