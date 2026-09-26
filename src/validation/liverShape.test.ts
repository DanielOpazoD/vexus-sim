// @tier slow
import { describe, expect, it } from 'vitest';
import { liverLobes, visceralHeight } from '../anatomy/organs/liver';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { CASES, NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import type { Vec3 } from '../core/vec3';

/**
 * Forma del hígado (decisión 72): cara visceral en cuña, borde inferior agudo apoyado en la pared, tamaño y lóbulo
 * izquierdo con las medidas de la revisión (`docs/anatomia/revision-normal.md`, § 2): craneocaudal en la línea
 * medioclavicular 14,0 ± 1,7 cm (hepatomegalia > 15,5–16), lóbulo izquierdo sobre la aorta 8,3 ± 1,7 × 5,7 ± 1,5 cm,
 * ángulo del borde izquierdo 30–45° y derecho 45–70° (redondeado en la hepatomegalia).
 */
const scenes = new Map(CASES.map((c) => [c.id, new AnatomyScene(c)]));
const sceneOf = (id: string): AnatomyScene => scenes.get(id)!;
const inLiver = (s: AnatomyScene, m: Vec3): boolean => (s.faceSdf(m, BASELINE_CALIBER, 'liverSurface') ?? 1) < 0;

/**
 * Ángulo del borde inferior en el corte sagital x: la punta es el punto más caudal del hígado; a 12 mm por encima se
 * toma el tramo conexo con ella y el ángulo es el de los vectores punta → sus extremos anterior y posterior.
 */
function sagittalEdge(s: AnatomyScene, x: number): { tip: [number, number]; deg: number } {
  let tip: [number, number] | null = null;
  for (let z = -150; z <= -20 && !tip; z += 0.5)
    for (let y = -40; y <= 90; y += 0.5)
      if (inLiver(s, [x, y, z])) {
        tip = [y, z];
        break;
      }
  if (!tip) throw new Error(`sin hígado en x ${x}`);
  const D = 12;
  const z1 = tip[1] + D;
  let y0 = Number.NaN;
  for (let dy = 0; dy < 40 && Number.isNaN(y0); dy += 0.25) {
    if (inLiver(s, [x, tip[0] - dy, z1])) y0 = tip[0] - dy;
    else if (inLiver(s, [x, tip[0] + dy, z1])) y0 = tip[0] + dy;
  }
  let a = y0;
  let b = y0;
  while (inLiver(s, [x, a - 0.25, z1])) a -= 0.25;
  while (inLiver(s, [x, b + 0.25, z1])) b += 0.25;
  const u = [a - tip[0], D];
  const v = [b - tip[0], D];
  const deg = (Math.acos((u[0] * v[0] + u[1] * v[1]) / Math.hypot(u[0], u[1]) / Math.hypot(v[0], v[1])) * 180) / Math.PI;
  return { tip, deg };
}

/** Lo mismo en el corte coronal y (borde lateral del lóbulo derecho, en el flanco). */
function coronalEdge(s: AnatomyScene, y: number): number {
  let tip: [number, number] | null = null;
  for (let z = -170; z <= -40 && !tip; z += 0.5)
    for (let x = -160; x <= -60; x += 0.5)
      if (inLiver(s, [x, y, z])) {
        tip = [x, z];
        break;
      }
  if (!tip) throw new Error(`sin hígado en y ${y}`);
  const D = 12;
  const z1 = tip[1] + D;
  let x0 = Number.NaN;
  for (let dx = 0; dx < 40 && Number.isNaN(x0); dx += 0.25) {
    if (inLiver(s, [tip[0] + dx, y, z1])) x0 = tip[0] + dx;
    else if (inLiver(s, [tip[0] - dx, y, z1])) x0 = tip[0] - dx;
  }
  let a = x0;
  let b = x0;
  while (inLiver(s, [a - 0.25, y, z1])) a -= 0.25;
  while (inLiver(s, [b + 0.25, y, z1])) b += 0.25;
  const u = [a - tip[0], D];
  const v = [b - tip[0], D];
  return (Math.acos((u[0] * v[0] + u[1] * v[1]) / Math.hypot(u[0], u[1]) / Math.hypot(v[0], v[1])) * 180) / Math.PI;
}

/** Craneocaudal «ecográfico» en el corte sagital x: de lo más alto del hígado (bajo la cúpula) a la punta (mm). */
function craniocaudal(s: AnatomyScene, x: number): number {
  let top: [number, number] | null = null;
  let bot: [number, number] | null = null;
  for (let z = 100; z > -200 && !top; z -= 0.5)
    for (let y = -90; y <= 90; y += 1)
      if (inLiver(s, [x, y, z])) {
        top = [y, z];
        break;
      }
  for (let z = -200; z < 100 && !bot; z += 0.5)
    for (let y = -90; y <= 90; y += 1)
      if (inLiver(s, [x, y, z])) {
        bot = [y, z];
        break;
      }
  return Math.hypot(top![0] - bot![0], top![1] - bot![1]);
}

describe('Forma del hígado (decisión 72)', () => {
  it('sano: borde inferior agudo apoyado en la pared — derecho 40–70°, junto a la línea media ≤ 45°, lateral ≤ 70°', () => {
    const s = sceneOf(NORMAL_ADULT.id);
    const wall = (x: number, z: number): number => {
      for (let y = 120; y > 0; y -= 0.25) if (s.insideWallMm([x, y, z]) > 0) return y;
      return Number.NaN;
    };
    for (const x of [-60, -40, -20]) {
      const e = sagittalEdge(s, x);
      expect(e.deg, `x ${x}`).toBeGreaterThanOrEqual(40);
      expect(e.deg, `x ${x}`).toBeLessThanOrEqual(70);
      // la punta toca la cara interna de la pared: la cara anterior del hígado es la pared hasta el borde
      expect(wall(x, e.tip[1]) - e.tip[0], `x ${x}`).toBeLessThanOrEqual(1.5);
    }
    for (const x of [0, 20]) expect(sagittalEdge(s, x).deg, `x ${x}`).toBeLessThanOrEqual(45);
    for (const y of [-15, 15]) expect(coronalEdge(s, y), `y ${y}`).toBeLessThanOrEqual(70);
  });

  it('congestión grave: hepatomegalia con bordes romos (≥ 75°) en el lóbulo derecho y junto a la línea media', () => {
    const s = sceneOf(SEVERE_CONGESTION.id);
    for (const x of [-40, -20, 0]) expect(sagittalEdge(s, x).deg, `x ${x}`).toBeGreaterThanOrEqual(75);
  });

  it('tamaño: craneocaudal en la medioclavicular 140–165 mm en el sano, ≥ 10 % más en la congestión grave', () => {
    const n = craniocaudal(sceneOf(NORMAL_ADULT.id), -80);
    const g = Math.max(craniocaudal(sceneOf(SEVERE_CONGESTION.id), -80), craniocaudal(sceneOf(SEVERE_CONGESTION.id), -70));
    expect(n).toBeGreaterThanOrEqual(140);
    expect(n).toBeLessThanOrEqual(165);
    expect(g).toBeGreaterThanOrEqual(1.1 * n);
  });

  it('lóbulo izquierdo sobre la aorta (x 10): craneocaudal 66–110 mm y anteroposterior 42–85 mm', () => {
    const s = sceneOf(NORMAL_ADULT.id);
    let ap = 0;
    let zMin = Infinity;
    let zMax = -Infinity;
    for (let z = -120; z < 80; z += 1) {
      let a = Infinity;
      let b = -Infinity;
      for (let y = -20; y <= 90; y += 0.5)
        if (inLiver(s, [10, y, z])) {
          a = Math.min(a, y);
          b = Math.max(b, y);
          zMin = Math.min(zMin, z);
          zMax = Math.max(zMax, z);
        }
      if (b > a) ap = Math.max(ap, b - a);
    }
    expect(zMax - zMin).toBeGreaterThanOrEqual(66);
    expect(zMax - zMin).toBeLessThanOrEqual(110);
    expect(ap).toBeGreaterThanOrEqual(42);
    expect(ap).toBeLessThanOrEqual(85);
  });

  it('el tronco celíaco, la esplénica y la aorta quedan fuera del hígado; las venas del lóbulo izquierdo, dentro', () => {
    const s = sceneOf(NORMAL_ADULT.id);
    const insideFraction = (id: string): number => {
      let n = 0;
      let inside = 0;
      for (const v of s.vessels.filter((q) => q.id === id))
        for (let i = 0; i + 1 < v.tube.nodes.length; i++)
          for (let t = 0; t < 1; t += 0.1) {
            const a = v.tube.nodes[i].p;
            const b = v.tube.nodes[i + 1].p;
            n++;
            if (inLiver(s, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t])) inside++;
          }
      return inside / n;
    };
    for (const id of ['celiacTrunk', 'splenicArtery', 'aorta']) expect(insideFraction(id), id).toBe(0);
    for (const id of ['hvLeft', 'hvLeftTributary', 'hvMiddle', 'pvLeft', 'pvLeftLateral', 'pvLeftMedial'])
      expect(insideFraction(id), id).toBeGreaterThanOrEqual(0.95);
  });

  it('la altura de la cara visceral tiene el gradiente analítico de sus diferencias finitas', () => {
    const s = sceneOf(NORMAL_ADULT.id);
    for (const f of [1, 1.05, 1.1]) {
      const vf = liverLobes(f).visceralFace;
      for (const [x, y] of [
        [-100, 40],
        [-80, 60],
        [-60, 10],
        [-20, 70],
        [0, 50],
        [30, 60],
        [-120, 0],
        [-110, -30],
        [-40, -40],
      ]) {
        const h = 1e-4;
        const [, gx, gy] = visceralHeight(x, y, vf, s.torso, s.wallThickness());
        const fx =
          (visceralHeight(x + h, y, vf, s.torso, s.wallThickness())[0] - visceralHeight(x - h, y, vf, s.torso, s.wallThickness())[0]) /
          (2 * h);
        const fy =
          (visceralHeight(x, y + h, vf, s.torso, s.wallThickness())[0] - visceralHeight(x, y - h, vf, s.torso, s.wallThickness())[0]) /
          (2 * h);
        expect(Math.abs(gx - fx), `f ${f} (${x}, ${y}) ∂x`).toBeLessThan(1e-5);
        expect(Math.abs(gy - fy), `f ${f} (${x}, ${y}) ∂y`).toBeLessThan(1e-5);
      }
    }
  });
});
