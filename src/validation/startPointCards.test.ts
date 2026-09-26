import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { START_POINTS } from '../app/startPoints';
import { NORMAL_ADULT } from '../cases';
import { CURRENT_WINDOW_MM, currentStartPoint, startPointDistanceMm } from '../ui/startPointCards';

/**
 * Tarjetas de ventanas del carril izquierdo: la tarjeta resaltada es la ventana en la que está la sonda
 * (su punto de partida a ≤ `CURRENT_WINDOW_MM` sobre la piel), sin ambigüedad entre ventanas vecinas.
 */
const torso = new AnatomyScene(NORMAL_ADULT).torso;

describe('Tarjetas de ventanas: la ventana actual', () => {
  it('cada punto de partida es la ventana actual en su pose (también con φ una vuelta más) y lejos de todos no hay ninguna', () => {
    for (const sp of START_POINTS) {
      expect(currentStartPoint({ phi: sp.phi, z: sp.z }, torso)).toBe(sp.id);
      expect(currentStartPoint({ phi: sp.phi + 2 * Math.PI, z: sp.z + 5 }, torso)).toBe(sp.id);
    }
    // epigastrio alto, a más de 10 cm de todas
    expect(currentStartPoint({ phi: Math.PI / 2, z: 150 }, torso)).toBeNull();
  });

  it('el radio de la ventana actual es menor que la distancia entre las dos ventanas más próximas', () => {
    let closest = Infinity;
    for (const a of START_POINTS)
      for (const b of START_POINTS) if (a !== b) closest = Math.min(closest, startPointDistanceMm({ phi: a.phi, z: a.z }, b, torso));
    expect(closest).toBeGreaterThan(CURRENT_WINDOW_MM);
  });
});
