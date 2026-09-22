import { describe, expect, it } from 'vitest';
import { ErrorLog, errorMessage } from '../app/errorLog';

describe('Registro de errores', () => {
  it('agrupa mensajes repetidos por origen y ordena por el más reciente', () => {
    let t = 0;
    const log = new ErrorLog(10, () => t);
    log.report('corte', new Error('worker caído'));
    t = 5;
    log.report('audio', 'sin AudioWorklet');
    t = 9;
    const e = log.report('corte', new Error('worker caído'));
    expect(e.count).toBe(2);
    expect(e.firstAt).toBe(0);
    expect(e.lastAt).toBe(9);
    expect(log.size).toBe(2);
    expect(log.recent().map((x) => x.source)).toEqual(['corte', 'audio']);
  });

  it('respeta la capacidad y un oyente que lanza no silencia a los demás', () => {
    const log = new ErrorLog(2);
    const seen: string[] = [];
    log.subscribe(() => {
      throw new Error('oyente roto');
    });
    log.subscribe((e) => seen.push(e.message));
    for (const m of ['a', 'b', 'c']) log.report('ui', m);
    expect(log.size).toBe(2);
    expect(seen).toEqual(['a', 'b', 'c']);
  });

  it('los manejadores globales registran excepciones y promesas rechazadas', () => {
    const log = new ErrorLog();
    const target = new EventTarget();
    log.installGlobalHandlers(target);
    const err = new Event('error') as Event & { error: unknown };
    err.error = new Error('boom');
    target.dispatchEvent(err);
    const rej = new Event('unhandledrejection') as Event & { reason: unknown };
    rej.reason = 'promesa';
    target.dispatchEvent(rej);
    expect(
      log
        .recent()
        .map((e) => e.message)
        .sort(),
    ).toEqual(['boom', 'promesa']);
  });

  it('extrae mensajes de cualquier cosa lanzada', () => {
    expect(errorMessage(new TypeError('x'))).toBe('x');
    expect(errorMessage({ a: 1 })).toBe('{"a":1}');
    expect(errorMessage(undefined)).toBe('undefined');
  });
});
