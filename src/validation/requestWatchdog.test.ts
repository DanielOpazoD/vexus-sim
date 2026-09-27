import { describe, expect, it } from 'vitest';
import { RequestWatchdog } from '../ui/requestWatchdog';

describe('Vigilante de las peticiones al Worker del corte', () => {
  it('a 60 fps, la petición sin respuesta caduca pasados 3 s, como antes', () => {
    const w = new RequestWatchdog(3000);
    w.start(0);
    // 174 cuadros: 2,9 s; 13 más: 3,12 s
    for (let i = 1; i <= 174; i++) expect(w.expired((i * 1000) / 60)).toBe(false);
    expect(w.expired((187 * 1000) / 60)).toBe(true);
  });

  it('un hilo principal ocupado no cuenta: un cuadro de 20 s suma 250 ms (la respuesta esperaba en la cola)', () => {
    const w = new RequestWatchdog(3000);
    w.start(1000);
    // un cuadro largo (render por software, una medida que dibuja decenas de cuadros) y los siguientes, de 2 s
    expect(w.expired(21_000)).toBe(false);
    expect(w.expired(23_000)).toBe(false);
  });

  it('un Worker colgado sigue caducando aunque cada cuadro tarde segundos: 3000 / 250 = 12 cuadros', () => {
    const w = new RequestWatchdog(3000);
    w.start(0);
    const seen: boolean[] = [];
    for (let i = 1; i <= 13; i++) seen.push(w.expired(i * 2000));
    expect(seen.indexOf(true)).toBe(12);
  });

  it('una petición nueva vuelve a empezar; sin petición vigilada nunca caduca; el reloj que retrocede no resta', () => {
    const w = new RequestWatchdog(3000);
    expect(w.expired(1e9)).toBe(false);
    w.start(0);
    for (let i = 1; i <= 11; i++) w.expired(i * 250);
    w.start(3000);
    expect(w.expired(3250)).toBe(false);
    expect(w.expired(3000)).toBe(false);
    w.stop();
    expect(w.expired(1e9)).toBe(false);
  });
});
