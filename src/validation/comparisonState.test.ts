import { afterEach, describe, expect, it, vi } from 'vitest';
import { SimulationClock } from '../core/clock';
import { comparisonState } from '../../tools/fidelity/comparisonState';
afterEach(() => vi.unstubAllGlobals());
function fixture(initialSteps = 4, initialFrame = 2) {
  let serial = initialFrame;
  const clock = new SimulationClock();
  for (let i = 0; i < initialSteps; i++) clock.advance();
  const step = vi.fn(() => clock.advance());
  const sim = {
    frozen: false,
    probeVelocity: [0, 0, 0],
    patient: { id: 'normal-adult', seed: 47, respiratoryPattern: 'apnea-expiratory' },
    physiology: { clock, step },
    scene: { torso: { profile: null } },
    pose: { phi: 1 },
    bmode: { gainDb: 0 },
    color: { enabled: false },
    mmode: { enabled: false },
    render: vi.fn(() => {
      serial++;
    }),
    renderer: { setScene: vi.fn(), cineSeal: vi.fn(), cineCount: 1, cineFrame: () => ({ n: serial, t: clock.t }) },
    get sample() {
      return { t: clock.t, resp: { diaphragmCaudalMm: 0 } };
    },
  };
  const button = {
    click: vi.fn(() => {
      sim.frozen = !sim.frozen;
    }),
  };
  const advance = vi.fn(() => {
    step();
    sim.probeVelocity = [0, 0, 0];
  });
  const advancedSim = Object.assign(sim, { advance });
  const hooks = {
    sim: () => advancedSim,
    goToStartPoint: vi.fn(() => {
      step();
      sim.probeVelocity = [20, 0, 0];
    }),
    frameCostMs: vi.fn((n: number) => {
      serial += n + 1;
      return 8.25;
    }),
  };
  vi.stubGlobal('window', { __vexusTest: hooks });
  vi.stubGlobal('document', { querySelector: () => button });
  return { sim: advancedSim, clock, step, hooks, button };
}
describe('comparaciones visuales con estado y reloj reproducibles', () => {
  it('arranques diferentes alcanzan la misma muestra sin reiniciar el reloj', () => {
    const results = [];
    for (const initial of [4, 31]) {
      const f = fixture(initial);
      expect(comparisonState({ phase: 'prepare', targetSeconds: 5 }).time).toBe(5);
      expect(f.sim.frozen).toBe(true);
      const result = comparisonState({ phase: 'capture', targetSeconds: 30, view: 'portal', frames: 6 });
      expect(f.step).toHaveBeenCalledTimes(7500 - initial);
      expect(f.hooks.frameCostMs).toHaveBeenCalledWith(6);
      expect(f.sim.renderer.setScene).toHaveBeenCalledWith(f.sim.scene);
      expect(f.sim.advance).toHaveBeenCalledWith(f.clock.dt);
      expect(result.probeVelocityMmS).toEqual([0, 0, 0]);
      expect(result).toMatchObject({ time: 30, step: 7500, frozen: true, seed: 47, protocol: { frames: 7 } });
      results.push(result);
    }
    expect(results[0]).toEqual(results[1]);
  });
  it('registra la misma historia con diferentes contadores previos sin modificar el reloj ni el contador privado', () => {
    const results = [2, 21].map((serial) => {
      const f = fixture(4, serial);
      comparisonState({ phase: 'prepare', targetSeconds: 5 });
      const result = comparisonState({ phase: 'capture', targetSeconds: 30, view: 'portal', historyStartFrame: 65 });
      expect(f.sim.render).toHaveBeenCalledTimes(64 - serial);
      expect(f.hooks.frameCostMs).toHaveBeenCalledWith(6);
      expect(result).toMatchObject({
        renderedFrame: 71,
        time: 30,
        frozen: true,
        protocol: { receiverPhaseRegistered: true, receiverPhaseReset: false, historyStartFrame: 65, historyEndFrame: 71, frames: 7 },
      });
      return result;
    });
    expect(results[0].sample).toEqual(results[1].sample);
    expect(results[0].protocol.paddingFrames).not.toBe(results[1].protocol.paddingFrames);
  });
  it('rechaza seriales imposibles, sobrepasados o que no avanzan como se adquirió', () => {
    for (const historyStartFrame of [NaN, Infinity, 1, 1.5, 4091]) {
      const f = fixture();
      comparisonState({ phase: 'prepare', targetSeconds: 5 });
      expect(() => comparisonState({ phase: 'capture', targetSeconds: 30, view: 'portal', historyStartFrame })).toThrow(RangeError);
      expect(f.sim.frozen).toBe(true);
    }
    const f = fixture(4, 70);
    comparisonState({ phase: 'prepare', targetSeconds: 5 });
    expect(() => comparisonState({ phase: 'capture', targetSeconds: 30, view: 'portal', historyStartFrame: 65 })).toThrow('already passed');
    expect(f.sim.frozen).toBe(true);
    const g = fixture();
    comparisonState({ phase: 'prepare', targetSeconds: 5 });
    g.hooks.frameCostMs.mockImplementation(() => 8.25);
    expect(() => comparisonState({ phase: 'capture', targetSeconds: 30, view: 'portal', historyStartFrame: 65 })).toThrow(
      'registered receiver phase',
    );
    expect(g.sim.frozen).toBe(true);
  });
  it('rechaza registrar Doppler color o modo M como comparación B-mode', () => {
    for (const mode of ['color', 'mmode'] as const) {
      const f = fixture();
      comparisonState({ phase: 'prepare', targetSeconds: 5 });
      f.sim[mode].enabled = true;
      expect(() => comparisonState({ phase: 'capture', targetSeconds: 30, view: 'portal', historyStartFrame: 65 })).toThrow(
        'B-mode without color',
      );
      expect(f.sim.frozen).toBe(true);
    }
  });
  it('una excepción de render deja el caso congelado y se propaga', () => {
    const f = fixture();
    comparisonState({ phase: 'prepare', targetSeconds: 5 });
    f.hooks.frameCostMs.mockImplementation(() => {
      throw new Error('render fault');
    });
    expect(() => comparisonState({ phase: 'capture', targetSeconds: 30, view: 'portal' })).toThrow('render fault');
    expect(f.sim.frozen).toBe(true);
  });
  it('rechaza retroceder, tiempos no representables o no finitos', () => {
    for (const time of [-1, 0, 5.001, NaN, Infinity, 1000]) {
      const f = fixture(31);
      expect(() => comparisonState({ phase: 'prepare', targetSeconds: time })).toThrow(RangeError);
      expect(f.clock.step).toBe(31);
      expect(f.sim.frozen).toBe(true);
    }
  });
  it('no acepta un caso que siguió avanzando entre etapas ni inventa éxito si el reloj no progresa', () => {
    const f = fixture();
    expect(() => comparisonState({ phase: 'capture', targetSeconds: 30, view: 'portal' })).toThrow('remain frozen');
    f.step.mockImplementation(() => {});
    expect(() => comparisonState({ phase: 'prepare', targetSeconds: 5 })).toThrow('did not reach');
    expect(f.sim.frozen).toBe(true);
  });
  it('medir el render no puede avanzar el estado fisiológico', () => {
    const f = fixture();
    comparisonState({ phase: 'prepare', targetSeconds: 5 });
    f.hooks.frameCostMs.mockImplementation(() => {
      f.clock.advance();
      return 8.25;
    });
    expect(() => comparisonState({ phase: 'capture', targetSeconds: 30, view: 'portal' })).toThrow('Rendering changed');
    expect(f.sim.frozen).toBe(true);
  });
  it('no publica tiempos de cuadro imposibles', () => {
    for (const value of [0, -1, NaN, Infinity]) {
      const f = fixture();
      comparisonState({ phase: 'prepare', targetSeconds: 5 });
      f.hooks.frameCostMs.mockReturnValue(value);
      expect(() => comparisonState({ phase: 'capture', targetSeconds: 30, view: 'portal' })).toThrow('Invalid frame timing');
      expect(f.sim.frozen).toBe(true);
    }
  });
  it('rechaza un fotograma cuya fecha no sea la del estado comparado', () => {
    const f = fixture();
    comparisonState({ phase: 'prepare', targetSeconds: 5 });
    f.sim.renderer.cineFrame = () => ({ n: 9, t: 0 });
    expect(() => comparisonState({ phase: 'capture', targetSeconds: 30, view: 'portal' })).toThrow('not at the comparison time');
    expect(f.sim.frozen).toBe(true);
  });
  it('exige controles, vista y número de cuadros válidos', () => {
    const f = fixture();
    comparisonState({ phase: 'prepare', targetSeconds: 5 });
    expect(() => comparisonState({ phase: 'capture', targetSeconds: 30 })).toThrow('Invalid capture');
    expect(() => comparisonState({ phase: 'capture', targetSeconds: 30, view: 'portal', frames: 0 })).toThrow('Invalid capture');
    expect(f.sim.frozen).toBe(true);
    vi.stubGlobal('document', { querySelector: () => null });
    expect(() => comparisonState({ phase: 'prepare', targetSeconds: 5 })).toThrow('controls unavailable');
  });
  it('rechaza comparar si la velocidad residual de la sonda no se estabilizó', () => {
    const f = fixture();
    comparisonState({ phase: 'prepare', targetSeconds: 5 });
    f.sim.advance.mockImplementation(() => {
      f.step();
    });
    expect(() => comparisonState({ phase: 'capture', targetSeconds: 30, view: 'portal' })).toThrow('probe did not settle');
    expect(f.sim.frozen).toBe(true);
  });
});
