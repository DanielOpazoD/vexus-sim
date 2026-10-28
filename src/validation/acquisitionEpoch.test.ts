import { expect, it, vi } from 'vitest';
import { Simulator } from '../app/simulator';

it('cierra la señal adquirida al cambiar condiciones sin reiniciar al paciente ni su reloj', () => {
  const reset = vi.fn(),
    clear = vi.fn();
  const sim = {
    acquisitionEpoch: 0,
    acquisitionFrameAfter: null,
    pwChain: { reset },
    gateTrack: [{ t: 5 }],
    renderer: { acquisitionSerial: 42, displayedFrame: { n: 12 }, mStrip: { clear } },
    physiology: { clock: { t: 5 } },
  };
  Simulator.prototype.beginAcquisitionEpoch.call(sim as unknown as Simulator);
  expect(reset).toHaveBeenCalledOnce();
  expect(clear).toHaveBeenCalledOnce();
  expect(sim.gateTrack).toEqual([]);
  expect(sim.acquisitionEpoch).toBe(1);
  expect(sim.acquisitionFrameAfter).toBe(42);
  expect(sim.physiology.clock.t).toBe(5);
});
