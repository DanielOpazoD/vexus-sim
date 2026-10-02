import { describe, expect, it, vi } from 'vitest';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { Tissue, reflectionCoefficient } from '../anatomy/tissues';
import { Interface, interfaceReflectivity } from '../anatomy/interfaces';
import { NORMAL_ADULT } from '../cases';
import { capsuleExteriorGain, liverCapsuleSiteGain, INTERFACE_ECHO_GLSL, CAPSULE_OUTSIDE_MM } from '../ultrasound/interfaceEcho';
import type { Vec3 } from '../core/vec3';

describe('medio exterior real de la cápsula hepática', () => {
  it('deriva el aumento del salto de impedancia, sin una ganancia global arbitraria', () => {
    for (const t of [Tissue.RetroperitonealFat, Tissue.MesentericFat]) {
      const effective = interfaceReflectivity(Interface.LiverCapsule) * capsuleExteriorGain(t);
      expect(effective).toBeCloseTo(Math.abs(reflectionCoefficient(Tissue.LiverCapsule, t)), 12);
      expect(effective).toBeLessThan(1);
    }
    for (const t of [Tissue.Muscle, Tissue.Blood, Tissue.Liver, Tissue.PerirenalFat, Tissue.Diaphragm])
      expect(capsuleExteriorGain(t)).toBe(1);
  });
  it('reconoce grasa al otro lado de los puntos capsulares de la ventana portal', () => {
    const scene = new AnatomyScene(NORMAL_ADULT);
    const points: Vec3[] = [
      [-120.90874072857596, -29.562841418746814, -100.5034323968717],
      [-113.3862506152312, -26.628996588869263, -95.18575917344876],
    ];
    for (const p of points) {
      const c = scene.classify(p, BASELINE_CALIBER);
      expect(c.interface).toBe(Interface.LiverCapsule);
      const g = scene.faceGradient(p, BASELINE_CALIBER, 'liverSurface')!;
      const q = p.map((v, i) => v + g.normal[i] * (c.interfaceDistance / g.norm + CAPSULE_OUTSIDE_MM)) as Vec3;
      const exterior = scene.classify(q, BASELINE_CALIBER).tissue;
      expect([Tissue.MesentericFat, Tissue.RetroperitonealFat]).toContain(exterior);
      expect(liverCapsuleSiteGain(p, scene, BASELINE_CALIBER)).toBe(capsuleExteriorGain(exterior));
    }
  });
  it('no revive una cápsula suprimida ni añade una cara en parénquima', () => {
    const scene = new AnatomyScene(NORMAL_ADULT);
    expect(scene.classify([-14.1, -30.3, 46.9], BASELINE_CALIBER).interface).toBe(Interface.None);
    expect(liverCapsuleSiteGain([-14.1, -30.3, 46.9], scene, BASELINE_CALIBER)).toBe(1);
    expect(liverCapsuleSiteGain([-70, 0, 0], scene, BASELINE_CALIBER)).toBe(1);
  });
  it('no extrapola con un gradiente nulo o una proyección fuera de la banda local', () => {
    const scene = new AnatomyScene(NORMAL_ADULT);
    const p: Vec3 = [-120.90874072857596, -29.562841418746814, -100.5034323968717];
    const gradient = vi.spyOn(scene, 'faceGradient');
    try {
      gradient.mockReturnValue(null);
      expect(liverCapsuleSiteGain(p, scene, BASELINE_CALIBER)).toBe(1);
      gradient.mockReturnValue({ normal: [1, 0, 0], norm: 0, curvature: 0 });
      expect(liverCapsuleSiteGain(p, scene, BASELINE_CALIBER)).toBe(1);
      gradient.mockReturnValue({ normal: [1, 0, 0], norm: 1e-5, curvature: 0 });
      expect(liverCapsuleSiteGain(p, scene, BASELINE_CALIBER)).toBe(1);
    } finally {
      gradient.mockRestore();
    }
  });
  it('el shader consulta hacia fuera pese al signo contrario de liverInner, con los mismos coeficientes', () => {
    expect(INTERFACE_ECHO_GLSL).toContain('int exterior = classifyWith(m - fg.xyz * (offset + 0.5), withCurtain).tissue;');
    expect(INTERFACE_ECHO_GLSL).toContain(`capsuleGain = ${capsuleExteriorGain(Tissue.RetroperitonealFat).toFixed(7)}`);
    expect(INTERFACE_ECHO_GLSL).toContain('wallFaceGain(m, c.iface) : capsuleGain;');
  });
});
