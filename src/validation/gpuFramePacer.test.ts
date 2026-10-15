import { describe, expect, it, vi } from 'vitest';
import { GpuFramePacer } from '../app/gpuFramePacer';

function fixture() {
  const sync = {} as WebGLSync;
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 0x9117,
    ALREADY_SIGNALED: 0x911a,
    TIMEOUT_EXPIRED: 0x911b,
    CONDITION_SATISFIED: 0x911c,
    WAIT_FAILED: 0x911d,
    fenceSync: vi.fn<() => WebGLSync | null>(() => sync),
    clientWaitSync: vi.fn(() => 0x911b),
    isContextLost: vi.fn(() => false),
    deleteSync: vi.fn(),
    flush: vi.fn(),
  };
  return { pacer: new GpuFramePacer(), gl, context: gl as unknown as WebGL2RenderingContext, sync };
}

describe('Adquisiciones sin cola de cuadros GPU', () => {
  it.each([0x911a, 0x911c])('retiene el siguiente cuadro hasta la señal %s y libera cada valla una sola vez', (signal) => {
    const { pacer, gl, context, sync } = fixture();
    expect(pacer.ready()).toBe(true);
    expect(gl.clientWaitSync).not.toHaveBeenCalled();
    pacer.submit(context);
    for (let raf = 0; raf < 4; raf++) expect(pacer.ready()).toBe(false);
    expect(gl.fenceSync).toHaveBeenCalledExactlyOnceWith(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    expect(gl.flush).toHaveBeenCalledOnce();
    expect(gl.clientWaitSync.mock.calls.every((args) => JSON.stringify(args) === JSON.stringify([sync, 0, 0]))).toBe(true);
    expect(gl.deleteSync).not.toHaveBeenCalled();
    expect(() => pacer.submit(context)).toThrow('en vuelo');
    expect(gl.fenceSync).toHaveBeenCalledOnce();
    gl.clientWaitSync.mockReturnValue(signal);
    expect(pacer.ready()).toBe(true);
    expect(pacer.ready()).toBe(true);
    expect(gl.deleteSync).toHaveBeenCalledExactlyOnceWith(sync);
    pacer.submit(context);
    expect(gl.fenceSync).toHaveBeenCalledTimes(2);
  });

  it('libera la valla de un contexto perdido y permite adquirir tras recuperarlo', () => {
    const { pacer, gl, context, sync } = fixture();
    pacer.submit(context);
    gl.isContextLost.mockReturnValue(true);
    expect(pacer.ready()).toBe(true);
    pacer.submit(context);
    expect(gl.clientWaitSync).not.toHaveBeenCalled();
    expect(gl.deleteSync).toHaveBeenCalledExactlyOnceWith(sync);
    expect(gl.fenceSync).toHaveBeenCalledOnce();
    gl.isContextLost.mockReturnValue(false);
    pacer.submit(context);
    expect(gl.fenceSync).toHaveBeenCalledTimes(2);
  });

  it.each([0x911d, -1])('informa del estado fallido %s y no retiene una valla inválida', (signal) => {
    const { pacer, gl, context, sync } = fixture();
    pacer.submit(context);
    gl.clientWaitSync.mockReturnValue(signal);
    expect(() => pacer.ready()).toThrow('finalización');
    expect(gl.deleteSync).toHaveBeenCalledExactlyOnceWith(sync);
    expect(pacer.ready()).toBe(true);
    pacer.submit(context);
    expect(gl.fenceSync).toHaveBeenCalledTimes(2);
  });

  it('informa si no puede crear una valla sin inventar trabajo pendiente', () => {
    const { pacer, gl, context } = fixture();
    gl.fenceSync.mockReturnValue(null);
    expect(() => pacer.submit(context)).toThrow('crear la valla');
    expect(gl.flush).not.toHaveBeenCalled();
    expect(pacer.ready()).toBe(true);
  });
});
