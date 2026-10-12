import { describe, expect, it, vi } from 'vitest';
import { FirstGpuFrame } from '../app/firstGpuFrame';
import type { StartupStage } from '../app/startupTrace';

function fixture(enabled = true) {
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
  const stages: StartupStage[] = [];
  return {
    gl,
    sync,
    stages,
    trace: new FirstGpuFrame(enabled, (stage) => stages.push(stage)),
    context: gl as unknown as WebGL2RenderingContext,
  };
}

describe('Primer cuadro: finalización GPU independiente del contador JS', () => {
  it.each([0x911a, 0x911c])('no acepta vueltas con trabajo pendiente; acepta la señal %s una sola vez', (signal) => {
    const { trace, gl, context, stages, sync } = fixture();
    trace.poll();
    trace.submit(context);
    trace.submit(context);
    for (let frame = 0; frame < 4; frame++) trace.poll();
    expect(stages).toEqual(['ultrasound:gpu-submitted']);
    expect(gl.fenceSync).toHaveBeenCalledTimes(1);
    expect(gl.flush).toHaveBeenCalledOnce();
    expect(gl.clientWaitSync.mock.calls.every((args) => JSON.stringify(args) === JSON.stringify([sync, 0, 0]))).toBe(true);
    gl.clientWaitSync.mockReturnValue(signal);
    trace.poll();
    trace.poll();
    trace.submit(context);
    expect(stages).toEqual(['ultrasound:gpu-submitted', 'ultrasound:gpu-ready']);
    expect(gl.deleteSync).toHaveBeenCalledExactlyOnceWith(sync);
    expect(gl.clientWaitSync).toHaveBeenCalledTimes(5);
  });

  it.each(['null', 'wait-failed', 'context-lost', 'unknown'] as const)('rechaza %s sin fabricar éxito ni reintentar', (failure) => {
    const { trace, gl, context, stages } = fixture();
    if (failure === 'null') gl.fenceSync.mockReturnValue(null);
    trace.submit(context);
    if (failure === 'context-lost') gl.isContextLost.mockReturnValue(true);
    else gl.clientWaitSync.mockReturnValue(failure === 'wait-failed' ? gl.WAIT_FAILED : -1);
    trace.poll();
    trace.poll();
    trace.submit(context);
    expect(stages).toEqual(['ultrasound:gpu-submitted', 'ultrasound:gpu-failed']);
    expect(gl.fenceSync).toHaveBeenCalledOnce();
    expect(gl.deleteSync).toHaveBeenCalledTimes(failure === 'null' ? 0 : 1);
    if (failure === 'context-lost') expect(gl.clientWaitSync).not.toHaveBeenCalled();
  });

  it('no toca GL cuando el diagnóstico está desactivado', () => {
    const { trace, context, gl, stages } = fixture(false);
    trace.submit(context);
    trace.poll();
    expect(gl.fenceSync).not.toHaveBeenCalled();
    expect(gl.clientWaitSync).not.toHaveBeenCalled();
    expect(stages).toEqual([]);
  });
});
