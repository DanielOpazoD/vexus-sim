import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { START_POINTS } from '../app/startPoints';
import { NORMAL_ADULT } from '../cases';
import { CURRENT_WINDOW_MM, CURRENT_WINDOW_YAW, currentStartPoint, startPointDistanceMm, yawDelta } from '../ui/startPointCards';

/**
 * Tarjetas de ventanas del carril izquierdo: la tarjeta resaltada es la ventana en la que está la sonda
 * (su punto de partida a ≤ `CURRENT_WINDOW_MM` sobre la piel y su plano a < `CURRENT_WINDOW_YAW` de giro), sin
 * ambigüedad entre ventanas vecinas.
 */
const torso = new AnatomyScene(NORMAL_ADULT).torso;

describe('Tarjetas de ventanas: la ventana actual', () => {
  it('cada punto de partida es la ventana actual en su pose (también con φ una vuelta más) y lejos de todos no hay ninguna', () => {
    for (const sp of START_POINTS) {
      expect(currentStartPoint({ phi: sp.phi, z: sp.z, yaw: sp.yaw }, torso)).toBe(sp.id);
      expect(currentStartPoint({ phi: sp.phi + 2 * Math.PI, z: sp.z + 5, yaw: sp.yaw }, torso)).toBe(sp.id);
    }
    // epigastrio alto, a más de 10 cm de todas
    expect(currentStartPoint({ phi: Math.PI / 2, z: 150, yaw: 0 }, torso)).toBeNull();
  });

  it('el radio de la ventana actual es menor que la distancia entre las dos ventanas más próximas', () => {
    let closest = Infinity;
    for (const a of START_POINTS)
      for (const b of START_POINTS) if (a !== b) closest = Math.min(closest, startPointDistanceMm({ phi: a.phi, z: a.z }, b, torso));
    expect(closest).toBeGreaterThan(CURRENT_WINDOW_MM);
  });

  it('la ventana actual es la del giro de la sonda: la subxifoidea (sagital) y la epigástrica (transversa) a 32 mm (decisión 83)', () => {
    // 1,5 cm a la derecha de la línea media, a la altura de las dos: 15 mm de la epigástrica y 17 de la subxifoidea
    const between = { phi: Math.acos(-15 / torso.a), z: -20 };
    expect(currentStartPoint({ ...between, yaw: 0 }, torso)).toBe('subxiphoid');
    expect(currentStartPoint({ ...between, yaw: -Math.PI / 2 }, torso)).toBe('epigastric');
    // en el punto de la epigástrica con la sonda sagital no se está en ninguna (la subxifoidea queda a 32 mm)
    const epi = START_POINTS.find((s) => s.id === 'epigastric')!;
    expect(currentStartPoint({ phi: epi.phi, z: epi.z, yaw: 0 }, torso)).toBeNull();
    // a 45° de giro ya no, ni con la sonda girada 180° (el marcador al otro lado: la imagen en espejo y, en las ventanas
    // basculadas o abanicadas, otro plano: la subcostal girada corta la aorta, la AMS y la vena renal izquierda)
    expect(currentStartPoint({ phi: epi.phi, z: epi.z, yaw: epi.yaw + CURRENT_WINDOW_YAW - 0.01 }, torso)).toBe('epigastric');
    expect(currentStartPoint({ phi: epi.phi, z: epi.z, yaw: epi.yaw + CURRENT_WINDOW_YAW + 0.01 }, torso)).toBeNull();
    for (const sp of START_POINTS) expect(currentStartPoint({ phi: sp.phi, z: sp.z, yaw: sp.yaw + Math.PI }, torso), sp.id).toBeNull();
    // un giro NaN no es ninguna ventana
    expect(currentStartPoint({ phi: epi.phi, z: epi.z, yaw: Number.NaN }, torso)).toBeNull();
    // la diferencia de giro, por el arco corto, simétrica y en 0 … π (también a través de ±π)
    expect(yawDelta(0.1, -0.1)).toBeCloseTo(0.2, 12);
    expect(yawDelta(-0.1, 0.1)).toBeCloseTo(0.2, 12);
    expect(yawDelta(3.1, -3.1)).toBeCloseTo(2 * Math.PI - 6.2, 12);
    expect(yawDelta(Math.PI / 2, -Math.PI / 2)).toBeCloseTo(Math.PI, 12);
    expect(yawDelta(7, 7 - 2 * Math.PI)).toBeCloseTo(0, 12);
  });
});
