import { describe, expect, it, vi } from 'vitest';
import { EquipmentController, type EquipmentCommand } from '../app/equipment';
import { Simulator, defaultEquipment } from '../app/simulator';
import { createTestHooks, frameMeasureOptions } from '../app/testHooks';
import { NORMAL_ADULT } from '../cases';
import { C_RECONSTRUCTION_MM_S } from '../core/units';
import { clonePatient } from '../physiology/patientState';
import { FRAME_PASSES, type PassId } from '../ultrasound/passGraph';
import { UltrasoundRenderer, type FrameInputs, type PassRepeat } from '../ultrasound/renderer';
import { recordingGl } from './support/recordingGl';

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
  return {
    fake,
    sim,
    equipment,
    dispatch,
    hooks: createTestHooks(
      () => sim,
      dispatch,
      () => 0,
    ),
  };
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

  it('PW también exige forzar adquisiciones para medir un reloj quieto, sin perder sus ajustes', () => {
    const { fake, sim, dispatch, equipment, hooks } = rig();
    dispatch({ type: 'mode', mode: 'pw' });
    const before = structuredClone(equipment.state);
    expect(() => hooks.frameCostMs(3)).toThrow(/forceColor/);
    expect(fake.frames).toHaveLength(0);
    hooks.frameCostMs(3, { forceColor: true });
    expect(fake.frames).toHaveLength(4);
    expect(fake.frames.every((f) => f.colorOn && f.updateColor)).toBe(true);
    expect(equipment.state).toEqual(before);
    expect(sim.pw.enabled).toBe(true);
  });

  it.each(['pw', 'color', 'triplex'] as const)(
    'la lectura de transmisión en %s adquiere después de la pose, sin forzar la cadencia',
    (mode) => {
      const { sim, fake, dispatch, hooks } = rig();
      dispatch({ type: 'mode', mode });
      sim.render();
      sim.setPose({ ...sim.pose, yaw: sim.pose.yaw + 0.01 });
      sim.advance(0.01);
      const before = sim.physiology.clock.t,
        period = 1 / sim.colorTiming.frameHz,
        render = vi.spyOn(fake, 'render'),
        read = vi.fn(() => {
          throw new Error('capture-read');
        });
      Object.assign(fake, { lines: sim.transducer.lines, readTransmission: read });
      expect(() => hooks.gateTransmissionDb()).toThrow('capture-read');
      expect(read).toHaveBeenCalledTimes(1);
      expect(render).toHaveBeenCalledTimes(1);
      expect(render.mock.calls[0][0].sample).toBe(sim.sample);
      expect(render.mock.calls[0][0].pose).toEqual(sim.pose);
      expect(sim.physiology.clock.t - before).toBeGreaterThanOrEqual(period);
      expect(render.mock.calls[0][1]).toBeUndefined();
    },
  );

  it('la adquisición diagnóstica rechaza una imagen congelada antes de leer texturas', () => {
    const { sim, fake, hooks } = rig();
    sim.frozen = true;
    const read = vi.fn();
    Object.assign(fake, { readTransmission: read });
    expect(() => hooks.gateTransmissionDb()).toThrow(/congelada/);
    expect(() => hooks.colorCells()).toThrow(/congelada/);
    expect(fake.frames).toHaveLength(0);
    expect(read).not.toHaveBeenCalled();
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

describe('finishForTiming: drenaje independiente del framebuffer que dejó el cine', () => {
  for (const previous of [null, { format: 'R32F' }])
    for (const fail of [false, true])
      it(`restaura READ ${previous?.format ?? 'pantalla'} y conserva DRAW${fail ? ' si la lectura falla' : ''}`, () => {
        let read: typeof previous = previous;
        const draw = { format: 'RGBA8' };
        let currentDraw = draw;
        let reads = 0;
        const failure = new Error('lectura interrumpida');
        const gl = {
          READ_FRAMEBUFFER: 0x8ca8,
          DRAW_FRAMEBUFFER: 0x8ca9,
          FRAMEBUFFER: 0x8d40,
          READ_FRAMEBUFFER_BINDING: 0x8caa,
          RGBA: 0x1908,
          UNSIGNED_BYTE: 0x1401,
          getParameter: (key: number) => {
            expect(key).toBe(gl.READ_FRAMEBUFFER_BINDING);
            return read;
          },
          bindFramebuffer: (target: number, fbo: typeof previous) => {
            if (target === gl.READ_FRAMEBUFFER || target === gl.FRAMEBUFFER) read = fbo;
            if (target === gl.DRAW_FRAMEBUFFER || target === gl.FRAMEBUFFER) currentDraw = fbo as typeof draw;
          },
          readPixels: (x: number, y: number, w: number, h: number, format: number, type: number, pixels: Uint8Array) => {
            expect(read, 'la lectura de bytes exige la pantalla, no la envolvente flotante').toBeNull();
            expect(currentDraw).toBe(draw);
            expect([x, y, w, h, format, type]).toEqual([0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE]);
            expect(pixels).toBeInstanceOf(Uint8Array);
            expect(pixels.byteLength).toBe(4);
            reads++;
            if (fail) throw failure;
          },
        };
        const invoke = () => UltrasoundRenderer.prototype.finishForTiming.call({ gl } as unknown as UltrasoundRenderer);
        if (fail) expect(invoke).toThrow(failure);
        else invoke();
        expect(reads).toBe(1);
        expect(read).toBe(previous);
        expect(currentDraw).toBe(draw);
      });
});

/**
 * Simulador con el renderizador REAL sobre el WebGL falso (sin caja de color: 11 pasadas por cuadro). Sin
 * composición espacial: con ella, D escribe cada cuadro en otra ranura del anillo (decisión 58,
 * `compoundRenderer.test.ts`) y aquí se comparan cuadros de la misma paridad de la persistencia.
 */
function realRig() {
  const rec = recordingGl({ width: 320, height: 240 });
  const sim = new Simulator(clonePatient(NORMAL_ADULT), rec.canvas);
  sim.equipment = { ...sim.equipment, bmode: { ...sim.equipment.bmode, compound: false } };
  return { ...rec, sim };
}

describe('repeatPass en el renderizador real (WebGL falso)', () => {
  // R no dibuja con su nivel a 0, el de estas pruebas (decisión 313)
  const framePasses = FRAME_PASSES.filter((p) => p.cadence === 'frame' && p.id !== 'speckleReduction');
  const perFrame = framePasses.length;

  it('sin repetición, reutiliza solo A0/A1 estáticos y conserva los demás dibujos y destinos', () => {
    const { sim, draws, attachments } = realRig();
    const fbos = attachments.size;
    sim.render();
    expect(draws.length).toBe(perFrame);
    expect(attachments.size).toBe(fbos + 3); // conversión de barrido y las dos historias, del primer cuadro
    const first = draws.splice(0);
    sim.render();
    expect(draws.length).toBe(perFrame - 2);
    expect(draws.map((d) => d.program)).toEqual(first.slice(2).map((d) => d.program));
    draws.length = 0;
    sim.render(); // misma paridad de persistencia que el primero
    expect(draws.map((d) => [d.program, d.fbo])).toEqual(first.slice(2).map((d) => [d.program, d.fbo]));
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
      const idx = framePasses.findIndex((p) => p.id === pass);
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

  it('la reducción de moteado añade su pasada solo con nivel > 0 y sin Color, y su salida va a un destino propio', () => {
    const { sim, draws, attachments } = realRig();
    sim.render();
    draws.length = 0;
    sim.render();
    const off = draws.splice(0);
    sim.equipment = { ...sim.equipment, bmode: { ...sim.equipment.bmode, speckleReduction: 1 } };
    sim.render();
    const on = draws.splice(0);
    expect(on.length).toBe(off.length + 1);
    const own = on.filter((d) => !off.some((o) => o.program === d.program));
    expect(own.length).toBe(1);
    // su destino no es ninguno de los del cuadro: tampoco el de la envolvente
    expect(off.some((d) => d.fbo === own[0].fbo)).toBe(false);
    expect(attachments.has(own[0].fbo!)).toBe(true);
    sim.equipment = {
      ...sim.equipment,
      color: { ...sim.equipment.color, enabled: true },
    };
    sim.render();
    expect(draws.some((d) => d.program === own[0].program)).toBe(false);
  });

  it('dispose libera los destinos de prueba', () => {
    const { sim, draws, deleted } = realRig();
    sim.render({ repeat: { pass: 'rawField', times: 2 } });
    const scratch = new Set(draws.slice(5, 7).map((d) => d.fbo));
    sim.renderer.dispose();
    for (const f of scratch) expect(deleted.has(f!)).toBe(true);
  });
});
