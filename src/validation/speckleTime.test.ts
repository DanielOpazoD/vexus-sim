import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../core/vec3';
import { CROSSFADE_SECONDS, ElevationAnchor } from '../ultrasound/speckleField';

const face: Vec3 = [0, 0, 0];
const axis = (degrees: number): Vec3 => [Math.sin((degrees * Math.PI) / 180), 0, Math.cos((degrees * Math.PI) / 180)];

describe('tiempo físico del fundido del moteado', () => {
  it('no avanza al repetir renders del mismo instante', () => {
    const anchor = new ElevationAnchor();
    anchor.update(face, axis(0), 0);
    const start = anchor.update(face, axis(7), 1);
    for (let i = 0; i < 20; i++) expect(anchor.update(face, axis(7), 1)).toEqual(start);
  });

  it('da el mismo peso a igual tiempo con 15, 30 y 60 renders por segundo', () => {
    const at = (fps: number): number => {
      const anchor = new ElevationAnchor();
      anchor.update(face, axis(0), 0);
      anchor.update(face, axis(7), 1);
      for (let i = 1; i < fps / 15; i++) anchor.update(face, axis(7), 1 + i / fps);
      return anchor.update(face, axis(7), 1 + 1 / 15).w;
    };
    expect(at(15)).toBeCloseTo(at(30), 12);
    expect(at(15)).toBeCloseTo(at(60), 12);
  });
});

describe('reinicio y extremos del fundido temporal', () => {
  it('comienza sin salto, termina en un solo medio y tolera una pausa larga', () => {
    const anchor = new ElevationAnchor();
    const original = anchor.update(face, axis(0), 0);
    const start = anchor.update(face, axis(7), 1);
    expect(start.w).toBe(0);
    expect(start.b).toBe(original.a);
    const mid = anchor.update(face, axis(7), 1 + CROSSFADE_SECONDS / 2);
    expect(mid.w).toBeCloseTo(0.5, 12);
    expect(mid.a).not.toBe(mid.b);
    const end = anchor.update(face, axis(7), 1 + CROSSFADE_SECONDS);
    expect(end.w).toBe(1);
    expect(end.a).toBe(end.b);
    expect(anchor.update(face, axis(7), 10)).toEqual(end);
  });

  it('reiniciar el reloj descarta la historia de otro instante o paciente', () => {
    const anchor = new ElevationAnchor();
    anchor.update(face, axis(0), 0);
    anchor.update(face, axis(7), 2);
    const reset = anchor.update(face, axis(7), 0);
    expect(reset.w).toBe(1);
    expect(reset.a.parity).toBe(0);
    expect(reset.a).toBe(reset.b);
    anchor.reset();
    expect(anchor.update(face, axis(0), 0).a.e).toEqual(axis(0));
  });

  it('un salto de pose reinicia incluso durante el fundido', () => {
    const anchor = new ElevationAnchor();
    anchor.update(face, axis(0), 0);
    anchor.update(face, axis(7), 1);
    const jumped = anchor.update([20, 0, 0], axis(7), 1.01);
    expect(jumped.w).toBe(1);
    expect(jumped.a).toBe(jumped.b);
    expect(jumped.a.parity).toBe(0);
  });

  it.each([NaN, Infinity, -Infinity, -1])('rechaza tiempo inválido %s sin contaminar el estado', (time) => {
    const anchor = new ElevationAnchor();
    const before = anchor.update(face, axis(0), 0);
    expect(() => anchor.update(face, axis(7), time)).toThrow('Tiempo de moteado inválido');
    expect(anchor.update(face, axis(0), 0)).toEqual(before);
  });
});
