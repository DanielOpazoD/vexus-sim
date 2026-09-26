import { describe, expect, it } from 'vitest';
import { ProbeAnimator } from '../app/probeAnimation';
import { START_POINTS, type StartPoint } from '../app/startPoints';
import { clampPose, type ProbePose } from '../probe/probe';

/**
 * La sonda se desliza hasta el punto de partida de una tarjeta (decisión 17) y llega entera: con su basculación, su
 * inclinación y su giro por el arco corto (decisión 83). La pose pasa por `clampPose`, como en el simulador.
 */
const byId = (id: StartPoint['id']) => START_POINTS.find((s) => s.id === id)!;

function slide(from: ProbePose, to: StartPoint, dt = 1 / 60, maxS = 10) {
  let pose = clampPose(from);
  let yawTravel = 0;
  const a = new ProbeAnimator(
    () => pose,
    (p) => {
      const next = clampPose(p);
      yawTravel += Math.abs(Math.atan2(Math.sin(next.yaw - pose.yaw), Math.cos(next.yaw - pose.yaw)));
      pose = next;
    },
  );
  a.goTo(to);
  let s = 0;
  for (; a.active && s < maxS; s += dt) a.tick(dt);
  return { pose, seconds: s, yawTravel, active: a.active };
}

describe('Animación hacia un punto de partida', () => {
  it('termina en la pose exacta de la ventana, también la basculación y la inclinación', () => {
    for (const sp of START_POINTS)
      for (const from of START_POINTS) {
        const r = slide({ phi: from.phi, z: from.z, lift: 3, yaw: from.yaw, rock: from.rock ?? 0, tilt: from.tilt ?? 0 }, sp);
        expect(r.active, `${from.id} → ${sp.id}`).toBe(false);
        expect(r.pose, `${from.id} → ${sp.id}`).toEqual(
          clampPose({ phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 }),
        );
      }
  });

  it('volver a pulsar la tarjeta con la sonda en su punto deshace el abanico', () => {
    // tras abanicar la epigástrica 26° hacia la cabeza, como pide su pista: antes la animación terminaba al primer
    // cuadro (φ, z y giro ya coincidían) y dejaba la inclinación en 0,45
    const epi = byId('epigastric');
    const r = slide({ phi: epi.phi, z: epi.z, lift: 0, yaw: epi.yaw, rock: 0, tilt: 0.45 }, epi);
    expect(r.pose.tilt).toBe(0);
    expect(r.seconds).toBeGreaterThan(0.5);
    // la subcostal desde su punto con la sonda sin bascular ni abanicar: llega a 0,25 y −0,4
    const sub = byId('subcostal');
    const q = slide({ phi: sub.phi, z: sub.z, lift: 0, yaw: sub.yaw, rock: 0, tilt: 0 }, sub);
    expect([q.pose.rock, q.pose.tilt]).toEqual([0.25, -0.4]);
  });

  it('gira por el arco corto: de +172° a la epigástrica (−90°) recorre 98°, no 262°', () => {
    const epi = byId('epigastric');
    const r = slide({ phi: epi.phi, z: epi.z, lift: 0, yaw: 3, rock: 0, tilt: 0 }, epi);
    expect(r.pose.yaw).toBeCloseTo(-Math.PI / 2, 12);
    expect(r.yawTravel).toBeCloseTo(2 * Math.PI - 3 - Math.PI / 2, 2);
  });

  it('un gesto la cancela', () => {
    let pose = clampPose({ phi: Math.PI, z: 0, lift: 0, yaw: 0, rock: 0, tilt: 0 });
    const a = new ProbeAnimator(
      () => pose,
      (p) => (pose = clampPose(p)),
    );
    a.goTo(byId('renal'));
    a.tick(1 / 60);
    a.cancel();
    const frozen = { ...pose };
    a.tick(1 / 60);
    expect(a.active).toBe(false);
    expect(pose).toEqual(frozen);
  });
});
