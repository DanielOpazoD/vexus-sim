import { describe, expect, it } from 'vitest';
import { EquipmentController, type EquipmentCommand } from '../app/equipment';
import { Simulator, defaultEquipment } from '../app/simulator';
import { createTestHooks, frameMeasureOptions } from '../app/testHooks';
import { NORMAL_ADULT } from '../cases';
import { C_RECONSTRUCTION_MM_S } from '../core/units';
import { clonePatient } from '../physiology/patientState';
import type { PassId } from '../ultrasound/passGraph';
import type { FrameInputs, PassRepeat, UltrasoundRenderer } from '../ultrasound/renderer';

/** Renderizador falso: registra lo que pide cada cuadro (el coste en GPU lo mide el banco, no vitest). */
class FakeRenderer {
  frames: { updateColor: boolean; colorOn: boolean; repeat: PassRepeat | undefined }[] = [];
  syncs = 0;
  /** Cuadros que dibuja antes de fallar (un fallo de GPU a mitad de la medida). */
  failAfter = Number.POSITIVE_INFINITY;
  setScene(): void {}
  render(inputs: FrameInputs, repeat?: PassRepeat): void {
    if (this.frames.length >= this.failAfter) throw new Error('fallo de GPU simulado');
    this.frames.push({ updateColor: inputs.updateColor, colorOn: inputs.color.enabled, repeat });
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

  it('con la caja ya encendida, sin forceColor casi no se dibuja nada; con él, cada cuadro, y la caja sigue encendida', () => {
    const { fake, sim, dispatch, hooks } = rig();
    dispatch({ type: 'color', patch: { enabled: true } });
    // el reloj no avanza: la cadencia del color (decisión 39) solo deja dibujar el primero de los 11
    hooks.frameCostMs(10);
    expect(fake.frames.length).toBe(1);
    fake.frames = [];
    hooks.frameCostMs(10, { forceColor: true });
    expect(fake.frames.length).toBe(11);
    expect(fake.frames.every((f) => f.updateColor && f.colorOn)).toBe(true);
    expect(sim.color.enabled).toBe(true);
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
