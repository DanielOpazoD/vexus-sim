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
    expect(pacer.ready()).toBe(false);
    expect(pacer.ready()).toBe(true);
    expect(gl.deleteSync).toHaveBeenCalledExactlyOnceWith(sync);
    pacer.submit(context);
    expect(gl.fenceSync).toHaveBeenCalledTimes(2);
  });

  it('no añade una RAF si la GPU termina antes de la primera consulta', () => {
    const { pacer, gl, context, sync } = fixture();
    pacer.submit(context);
    gl.clientWaitSync.mockReturnValue(gl.ALREADY_SIGNALED);
    expect(pacer.ready()).toBe(true);
    expect(gl.deleteSync).toHaveBeenCalledExactlyOnceWith(sync);
  });

  it('libera la valla de un contexto perdido y permite adquirir tras recuperarlo', () => {
    const { pacer, gl, context, sync } = fixture();
    pacer.submit(context);
    expect(pacer.ready()).toBe(false);
    gl.isContextLost.mockReturnValue(true);
    expect(pacer.ready()).toBe(true);
    pacer.submit(context);
    expect(gl.clientWaitSync).toHaveBeenCalledOnce();
    expect(gl.deleteSync).toHaveBeenCalledExactlyOnceWith(sync);
    expect(gl.fenceSync).toHaveBeenCalledOnce();
    gl.isContextLost.mockReturnValue(false);
    pacer.submit(context);
    expect(gl.fenceSync).toHaveBeenCalledTimes(2);
  });

  it.each([0x911d, -1])('informa del estado fallido %s y conserva el contexto hasta confirmar otra valla', (signal) => {
    const { pacer, gl, context, sync } = fixture();
    pacer.submit(context);
    gl.clientWaitSync.mockReturnValue(signal);
    expect(() => pacer.ready()).toThrow('finalización');
    expect(gl.deleteSync).toHaveBeenCalledExactlyOnceWith(sync);
    expect(pacer.inFlight).toBe(true);
    expect(() => pacer.submit(context)).toThrow('en vuelo');
    const repaired = {} as WebGLSync;
    gl.fenceSync.mockReturnValue(repaired);
    gl.clientWaitSync.mockReturnValue(gl.CONDITION_SATISFIED);
    expect(pacer.ready()).toBe(false);
    expect(pacer.ready()).toBe(true);
    expect(gl.fenceSync).toHaveBeenCalledTimes(2);
    expect(gl.deleteSync.mock.calls).toEqual([[sync], [repaired]]);
  });

  it('sin otro submit, informa de creación fallida y recerca el trabajo congelado desde ready', () => {
    const { pacer, gl, context, sync } = fixture();
    gl.fenceSync.mockReturnValue(null);
    expect(() => pacer.submit(context)).toThrow('crear la valla');
    expect(pacer.inFlight).toBe(true);
    expect(() => pacer.submit(context)).toThrow('en vuelo');
    for (let raf = 0; raf < 3; raf++) {
      expect(() => pacer.ready()).toThrow('crear la valla');
      expect(pacer.inFlight).toBe(true);
    }
    expect(gl.flush).not.toHaveBeenCalled();
    expect(gl.clientWaitSync).not.toHaveBeenCalled();
    expect(gl.deleteSync).not.toHaveBeenCalled();
    gl.fenceSync.mockReturnValue(sync);
    gl.clientWaitSync.mockReturnValue(gl.ALREADY_SIGNALED);
    expect(pacer.ready()).toBe(false);
    expect(pacer.ready()).toBe(true);
    expect(pacer.inFlight).toBe(false);
    expect(gl.clientWaitSync).toHaveBeenCalledExactlyOnceWith(sync, 0, 0);
    expect(gl.flush).toHaveBeenCalledOnce();
    expect(gl.deleteSync).toHaveBeenCalledExactlyOnceWith(sync);
  });

  it('retiene el cuadro mientras el navegador sigue pendiente aunque la ecografía ya terminó', () => {
    const ultrasound = fixture();
    const navigator = fixture();
    const { pacer } = ultrasound;
    ultrasound.gl.clientWaitSync.mockReturnValue(ultrasound.gl.ALREADY_SIGNALED);
    pacer.submit(ultrasound.context, navigator.context);
    expect(pacer.ready()).toBe(false);
    expect(pacer.inFlight).toBe(true);
    expect(ultrasound.gl.deleteSync).toHaveBeenCalledExactlyOnceWith(ultrasound.sync);
    expect(navigator.gl.deleteSync).not.toHaveBeenCalled();
    expect(() => pacer.submit(ultrasound.context, navigator.context)).toThrow('en vuelo');
    for (let raf = 0; raf < 3; raf++) expect(pacer.ready()).toBe(false);
    expect(ultrasound.gl.clientWaitSync).toHaveBeenCalledExactlyOnceWith(ultrasound.sync, 0, 0);
    expect(navigator.gl.clientWaitSync).toHaveBeenCalledTimes(4);
    expect(navigator.gl.clientWaitSync.mock.calls.every((args) => JSON.stringify(args) === JSON.stringify([navigator.sync, 0, 0]))).toBe(
      true,
    );
    navigator.gl.clientWaitSync.mockReturnValue(navigator.gl.CONDITION_SATISFIED);
    expect(pacer.ready()).toBe(false);
    expect(pacer.inFlight).toBe(false);
    expect(pacer.ready()).toBe(true);
    expect(navigator.gl.deleteSync).toHaveBeenCalledExactlyOnceWith(navigator.sync);
    expect(ultrasound.gl.fenceSync).toHaveBeenCalledOnce();
    expect(navigator.gl.fenceSync).toHaveBeenCalledOnce();
  });

  it('perder el contexto principal no libera el trabajo pendiente del navegador', () => {
    const ultrasound = fixture();
    const navigator = fixture();
    const { pacer } = ultrasound;
    pacer.submit(ultrasound.context, navigator.context);
    ultrasound.gl.isContextLost.mockReturnValue(true);
    expect(pacer.ready()).toBe(false);
    expect(pacer.inFlight).toBe(true);
    expect(ultrasound.gl.clientWaitSync).not.toHaveBeenCalled();
    expect(ultrasound.gl.deleteSync).toHaveBeenCalledExactlyOnceWith(ultrasound.sync);
    expect(navigator.gl.deleteSync).not.toHaveBeenCalled();
    navigator.gl.clientWaitSync.mockReturnValue(navigator.gl.ALREADY_SIGNALED);
    expect(pacer.ready()).toBe(false);
    expect(pacer.ready()).toBe(true);
    expect(navigator.gl.deleteSync).toHaveBeenCalledExactlyOnceWith(navigator.sync);
    expect(ultrasound.gl.deleteSync).toHaveBeenCalledOnce();
  });

  it('deduplica los contextos rápidos sin añadir una RAF ni vallas duplicadas', () => {
    const ultrasound = fixture();
    const navigator = fixture();
    const { pacer } = ultrasound;
    ultrasound.gl.clientWaitSync.mockReturnValue(ultrasound.gl.ALREADY_SIGNALED);
    navigator.gl.clientWaitSync.mockReturnValue(navigator.gl.CONDITION_SATISFIED);
    pacer.submit(ultrasound.context, navigator.context, ultrasound.context, navigator.context);
    expect(pacer.ready()).toBe(true);
    expect(pacer.inFlight).toBe(false);
    expect(pacer.ready()).toBe(true);
    for (const view of [ultrasound, navigator]) {
      expect(view.gl.fenceSync).toHaveBeenCalledExactlyOnceWith(view.gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      expect(view.gl.flush).toHaveBeenCalledOnce();
      expect(view.gl.clientWaitSync).toHaveBeenCalledExactlyOnceWith(view.sync, 0, 0);
      expect(view.gl.deleteSync).toHaveBeenCalledExactlyOnceWith(view.sync);
    }
  });

  it('omite contextos perdidos al enviar y conserva los demás', () => {
    const lost = fixture();
    const live = fixture();
    lost.gl.isContextLost.mockReturnValue(true);
    lost.pacer.submit(lost.context, live.context);
    expect(lost.gl.fenceSync).not.toHaveBeenCalled();
    expect(lost.gl.flush).not.toHaveBeenCalled();
    expect(live.gl.fenceSync).toHaveBeenCalledOnce();
    expect(lost.pacer.inFlight).toBe(true);
    expect(lost.pacer.ready()).toBe(false);
    live.gl.isContextLost.mockReturnValue(true);
    expect(lost.pacer.ready()).toBe(true);
    expect(live.gl.deleteSync).toHaveBeenCalledExactlyOnceWith(live.sync);
    expect(lost.pacer.inFlight).toBe(false);
    lost.pacer.submit(lost.context, live.context);
    expect(lost.pacer.ready()).toBe(true);
    expect(live.gl.fenceSync).toHaveBeenCalledOnce();
  });

  it.each([false, true])('un fallo de consulta retiene ambos contextos hasta confirmar cada uno (fallo primero: %s)', (failedFirst) => {
    const failed = fixture();
    const pending = fixture();
    const { pacer } = failed;
    failed.gl.clientWaitSync.mockReturnValue(failed.gl.WAIT_FAILED);
    pacer.submit(...(failedFirst ? [failed.context, pending.context] : [pending.context, failed.context]));
    expect(() => pacer.ready()).toThrow('finalización');
    expect(pacer.inFlight).toBe(true);
    expect(failed.gl.deleteSync).toHaveBeenCalledExactlyOnceWith(failed.sync);
    expect(pending.gl.deleteSync).not.toHaveBeenCalled();
    expect(() => pacer.submit(pending.context)).toThrow('en vuelo');
    failed.gl.fenceSync.mockReturnValue(null);
    pending.gl.clientWaitSync.mockReturnValue(pending.gl.CONDITION_SATISFIED);
    expect(() => pacer.ready()).toThrow('crear la valla');
    expect(pacer.inFlight).toBe(true);
    expect(pending.gl.deleteSync).toHaveBeenCalledExactlyOnceWith(pending.sync);
    expect(failed.gl.deleteSync).toHaveBeenCalledExactlyOnceWith(failed.sync);
    const repaired = {} as WebGLSync;
    failed.gl.fenceSync.mockReturnValue(repaired);
    failed.gl.clientWaitSync.mockReturnValue(failed.gl.ALREADY_SIGNALED);
    expect(pacer.ready()).toBe(false);
    expect(pacer.ready()).toBe(true);
    expect(pending.gl.deleteSync).toHaveBeenCalledExactlyOnceWith(pending.sync);
    expect(failed.gl.clientWaitSync.mock.calls).toEqual([
      [failed.sync, 0, 0],
      [repaired, 0, 0],
    ]);
    expect(failed.gl.deleteSync.mock.calls).toEqual([[failed.sync], [repaired]]);
  });

  it.each([false, true])('un fallo de creación conserva las vallas de los otros contextos (fallo primero: %s)', (failedFirst) => {
    const failed = fixture();
    const pending = fixture();
    const { pacer } = failed;
    failed.gl.fenceSync.mockReturnValue(null);
    expect(() => pacer.submit(...(failedFirst ? [failed.context, pending.context] : [pending.context, failed.context]))).toThrow(
      'crear la valla',
    );
    expect(failed.gl.flush).not.toHaveBeenCalled();
    expect(pending.gl.flush).toHaveBeenCalledOnce();
    expect(pacer.inFlight).toBe(true);
    expect(() => pacer.submit(pending.context)).toThrow('en vuelo');
    expect(() => pacer.ready()).toThrow('crear la valla');
    pending.gl.clientWaitSync.mockReturnValue(pending.gl.ALREADY_SIGNALED);
    expect(() => pacer.ready()).toThrow('crear la valla');
    expect(pacer.inFlight).toBe(true);
    expect(pending.gl.deleteSync).toHaveBeenCalledExactlyOnceWith(pending.sync);
    expect(failed.gl.deleteSync).not.toHaveBeenCalled();
    failed.gl.fenceSync.mockReturnValue(failed.sync);
    failed.gl.clientWaitSync.mockReturnValue(failed.gl.CONDITION_SATISFIED);
    expect(pacer.ready()).toBe(false);
    expect(pacer.ready()).toBe(true);
    expect(pending.gl.deleteSync).toHaveBeenCalledExactlyOnceWith(pending.sync);
    expect(failed.gl.deleteSync).toHaveBeenCalledExactlyOnceWith(failed.sync);
  });

  it('la pérdida del contexto libera un placeholder sin fabricar ni borrar vallas', () => {
    const { pacer, gl, context } = fixture();
    gl.fenceSync.mockReturnValue(null);
    expect(() => pacer.submit(context)).toThrow('crear la valla');
    gl.isContextLost.mockReturnValue(true);
    expect(pacer.ready()).toBe(true);
    expect(pacer.inFlight).toBe(false);
    expect(gl.fenceSync).toHaveBeenCalledOnce();
    expect(gl.clientWaitSync).not.toHaveBeenCalled();
    expect(gl.deleteSync).not.toHaveBeenCalled();
  });

  it('una segunda valla fallida se borra una sola vez y vuelve a intentarse sin adquirir otro cuadro', () => {
    const { pacer, gl, context, sync } = fixture();
    const failedAgain = {} as WebGLSync;
    const repaired = {} as WebGLSync;
    pacer.submit(context);
    gl.clientWaitSync.mockReturnValue(gl.WAIT_FAILED);
    expect(() => pacer.ready()).toThrow('finalización');
    gl.fenceSync.mockReturnValue(failedAgain);
    expect(() => pacer.ready()).toThrow('finalización');
    expect(pacer.inFlight).toBe(true);
    gl.fenceSync.mockReturnValue(repaired);
    gl.clientWaitSync.mockReturnValue(gl.ALREADY_SIGNALED);
    expect(pacer.ready()).toBe(false);
    expect(pacer.ready()).toBe(true);
    expect(gl.deleteSync.mock.calls).toEqual([[sync], [failedAgain], [repaired]]);
    expect(gl.flush).toHaveBeenCalledTimes(3);
  });
});
