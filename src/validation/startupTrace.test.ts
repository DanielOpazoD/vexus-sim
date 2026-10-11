import { describe, expect, it, vi } from 'vitest';
import { STARTUP_PREFIX, startupEntry, startupRecorder } from '../app/startupTrace';

describe('Diagnóstico de arranque independiente del paciente y del hilo bloqueado', () => {
  it('conserva la entrada emitida antes de una operación que falla y no fabrica una etapa completa', () => {
    const messages: string[] = [];
    const mark = startupRecorder(
      true,
      (line) => messages.push(line),
      () => 125,
    );
    expect(() => {
      mark('navigator:construct');
      throw new Error('constructor bloqueante');
    }).toThrow('constructor bloqueante');
    expect(messages.map(startupEntry)).toEqual([{ stage: 'navigator:construct', timeMs: 125 }]);
    // La evidencia sigue disponible sin volver a consultar la operación/página que falló.
    mark('navigator:construct');
    expect(messages).toHaveLength(1);
  });

  it('no consulta el reloj ni emite datos cuando el diagnóstico está desactivado', () => {
    const emit = vi.fn(),
      now = vi.fn();
    const mark = startupRecorder(false, emit, now);
    mark('frame:first');
    expect(now).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('separa tiempo de navegador de cualquier reloj del paciente y conserva ambos cuadros', () => {
    const messages: string[] = [];
    let browserMs = 17;
    const mark = startupRecorder(
      true,
      (line) => messages.push(line),
      () => browserMs,
    );
    mark('frame:first');
    browserMs = 93;
    mark('frame:second');
    expect(messages.map(startupEntry)).toEqual([
      { stage: 'frame:first', timeMs: 17 },
      { stage: 'frame:second', timeMs: 93 },
    ]);
  });

  it('rechaza mensajes ajenos, JSON roto, etapas desconocidas y tiempos inválidos', () => {
    for (const message of [
      'otro mensaje',
      STARTUP_PREFIX + '{',
      STARTUP_PREFIX + 'null',
      STARTUP_PREFIX + '{}',
      STARTUP_PREFIX + '{"stage":"frame:first","timeMs":-1}',
      STARTUP_PREFIX + '{"stage":"frame:first","timeMs":"12"}',
      STARTUP_PREFIX + '{"stage":"inexistente","timeMs":1}',
      STARTUP_PREFIX + '{"stage":"frame:first","timeMs":1e999}',
    ])
      expect(startupEntry(message)).toBeNull();
  });
});
