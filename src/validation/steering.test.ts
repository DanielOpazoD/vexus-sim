import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { START_POINTS } from '../app/startPoints';
import { NORMAL_ADULT } from '../cases';
import { CONVEX_C35, pointOnLine, pointOnSteeredLine, probeFrame } from '../probe/probe';
import { CONVEX_BEAM } from '../ultrasound/beamModel';
import {
  STEERING_GLSL,
  alongLineMm,
  lookCoverage,
  lookPhase,
  lookPhaseGrad,
  lookPotential,
  lookWavenumber,
  rhoAlongLine,
  steerBeta,
  steeredElement,
} from '../ultrasound/steering';
import { rng } from './syntheticSpeckle';

/**
 * Geometría exacta de las miradas dirigidas del convexo (decisión 58, T1): el cruce del camino dirigido
 * con cada circunferencia de la mirada 0, su inversa cerrada, el potencial de fase y la cobertura.
 */
const R = CONVEX_C35.curvatureRadius;
const H = CONVEX_C35.halfSector;
const LINES = CONVEX_C35.lines;
const deg = Math.PI / 180;
const K2 = lookWavenumber(CONVEX_BEAM);

/** Punto del camino (elemento φ, dirección φ + θ) a distancia s, en (x lateral, z axial) desde el centro. */
const pathPoint = (phi: number, th: number, s: number): [number, number] => [
  R * Math.sin(phi) + s * Math.sin(phi + th),
  R * Math.cos(phi) + s * Math.cos(phi + th),
];

describe('geometría de la mirada dirigida (decisión 58)', () => {
  it('el camino dirigido corta ρ a s(ρ) = √(ρ² − a²) − R·cos θ, con inversa cerrada φ = α − θ + β(ρ)', () => {
    const rnd = rng(58);
    let worstS = 0;
    let worstPhi = 0;
    for (let t = 0; t < 20000; t++) {
      const th = (rnd() - 0.5) * 20 * deg;
      const phi = (rnd() - 0.5) * 2 * H;
      const s = 200 * rnd();
      const [x, z] = pathPoint(phi, th, s);
      const rho = Math.hypot(x, z);
      worstS = Math.max(worstS, Math.abs(alongLineMm(rho, th, R) - s));
      worstPhi = Math.max(worstPhi, Math.abs(steeredElement(Math.atan2(x, z), rho, th, R) - phi));
      expect(Math.abs(rhoAlongLine(s, th, R) - rho)).toBeLessThan(1e-9);
    }
    expect(worstS).toBeLessThanOrEqual(1e-9);
    expect(worstPhi).toBeLessThanOrEqual(1e-12);
  });

  it('∇ψ_k es la dirección del haz dirigido en el punto (α + β) y ∇Δ_k = k2·(b_k − b_0)', () => {
    const rnd = rng(7);
    const e = 1e-5;
    let worstPsi = 0;
    let worstPhase = 0;
    for (let t = 0; t < 4000; t++) {
      const th = (rnd() < 0.5 ? -1 : 1) * (2 + 8 * rnd()) * deg;
      const alpha = (rnd() - 0.5) * 2 * H;
      const rho = R + 5 + 175 * rnd();
      const x = rho * Math.sin(alpha);
      const z = rho * Math.cos(alpha);
      const polar = (px: number, pz: number): [number, number] => [Math.hypot(px, pz), Math.atan2(px, pz)];
      const psi = (px: number, pz: number) => lookPotential(...polar(px, pz), th, R);
      const dir = alpha + steerBeta(rho, th, R);
      const gx = (psi(x + e, z) - psi(x - e, z)) / (2 * e);
      const gz = (psi(x, z + e) - psi(x, z - e)) / (2 * e);
      worstPsi = Math.max(worstPsi, Math.hypot(gx - Math.sin(dir), gz - Math.cos(dir)));
      const ph = (px: number, pz: number) => lookPhase(...polar(px, pz), th, R, K2);
      const [ax, az] = lookPhaseGrad(rho, alpha, th, R, K2);
      const fx = (ph(x + e, z) - ph(x - e, z)) / (2 * e);
      const fz = (ph(x, z + e) - ph(x, z - e)) / (2 * e);
      worstPhase = Math.max(worstPhase, Math.hypot(fx - ax, fz - az) / K2);
      // Δ_k = k2·(ψ_k − ρ) salvo la constante −a·π/2
      expect(lookPhase(rho, alpha, th, R, K2)).toBeCloseTo(
        K2 * (lookPotential(rho, alpha, th, R) - rho + (R * Math.sin(th) * Math.PI) / 2),
        8,
      );
    }
    expect(worstPsi).toBeLessThanOrEqual(1e-6);
    expect(worstPhase).toBeLessThanOrEqual(1e-6);
    expect(K2).toBeCloseTo(28.56, 2);
  });

  it('θ = 0 es la identidad exacta: la mirada 0 no cambia', () => {
    for (const rho of [60, 80.5, 150, 240])
      for (const alpha of [-H, -0.2, 0, 0.3]) {
        expect(steerBeta(rho, 0, R)).toBe(0);
        expect(alongLineMm(rho, 0, R)).toBe(rho - R);
        expect(steeredElement(alpha, rho, 0, R)).toBe(alpha);
        expect(lookPhase(rho, alpha, 0, R, K2)).toBe(0);
        expect(lookPhaseGrad(rho, alpha, 0, R, K2)).toEqual([0, 0]);
        expect(lookPotential(rho, alpha, 0, R)).toBe(rho);
      }
    const sp = START_POINTS.find((p) => p.id === 'subxiphoid')!;
    const fr = probeFrame(
      { phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 },
      new AnatomyScene(NORMAL_ADULT).torso,
      CONVEX_C35,
    );
    for (const s of [0, 12.5, 90]) expect(pointOnSteeredLine(fr, CONVEX_C35, 0.21, 0, s)).toEqual(pointOnLine(fr, CONVEX_C35, 0.21, s));
    // con θ ≠ 0, el punto del mundo está a s del elemento y a ρ(s) del centro de curvatura
    const th = 7 * deg;
    const p = pointOnSteeredLine(fr, CONVEX_C35, 0.21, th, 50);
    const e = pointOnLine(fr, CONVEX_C35, 0.21, 0);
    const c = fr.curvatureCenter;
    expect(Math.hypot(p[0] - e[0], p[1] - e[1], p[2] - e[2])).toBeCloseTo(50, 9);
    expect(Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])).toBeCloseTo(rhoAlongLine(50, th, R), 9);
  });

  it('β y las bandas de costura a ±7° (sección 2.1 del plan)', () => {
    const th = 7 * deg;
    const dPhi = (2 * H) / LINES;
    // β (°), costura por lado (R + r)(θ − β) en mm y en líneas del texel (2·H/192)
    const table: [number, number, number, number][] = [
      [20, 5.24, 2.5, 4.96],
      [45, 3.99, 5.5, 8.49],
      [90, 2.79, 11.0, 11.88],
      [150, 2.0, 18.3, 14.13],
      [180, 1.75, 22.0, 14.84],
    ];
    for (const [r, beta, seamMm, seamLines] of table) {
      const b = steerBeta(R + r, th, R);
      expect(b / deg, `β a ${r} mm`).toBeCloseTo(beta, 1);
      expect(Math.abs((R + r) * (th - b) - seamMm), `costura a ${r} mm`).toBeLessThanOrEqual(0.1);
      expect(Math.abs((th - b) / dPhi - seamLines), `costura en líneas a ${r} mm`).toBeLessThanOrEqual(0.1);
      // β tiene el signo de θ
      expect(steerBeta(R + r, -th, R)).toBeCloseTo(-b, 14);
    }
  });

  it('la cobertura es 1 en todo el arreglo, 0 fuera y tiene una rampa de una línea en el borde', () => {
    const dPhi = (2 * H) / LINES;
    const lastCentre = H - 0.5 * dPhi;
    expect(lookCoverage(0, H, LINES, 1)).toBe(1);
    expect(lookCoverage(lastCentre, H, LINES, 1)).toBeCloseTo(1, 12);
    expect(lookCoverage(-lastCentre, H, LINES, 1)).toBeCloseTo(1, 12);
    expect(lookCoverage(H, H, LINES, 1)).toBeCloseTo(0.5, 12);
    expect(lookCoverage(H + 0.5 * dPhi, H, LINES, 1)).toBeCloseTo(0, 12);
    expect(lookCoverage(-(H + dPhi), H, LINES, 1)).toBe(0);
    // monótona en la rampa
    let prev = 1;
    for (let q = 0; q <= 10; q++) {
      const c = lookCoverage(lastCentre + (q / 10) * dPhi, H, LINES, 1);
      expect(c).toBeLessThanOrEqual(prev + 1e-15);
      prev = c;
    }
    // una rampa de 2 líneas es la mitad de empinada
    expect(lookCoverage(H + 0.25 * dPhi, H, LINES, 2)).toBeCloseTo(0.375, 12);
  });

  it('el GLSL lleva las mismas fórmulas (sin constantes de TS sueltas)', () => {
    expect(STEERING_GLSL).toContain('float steerBeta(float rho, float a) { return asin(a / rho); }');
    expect(STEERING_GLSL).toContain('return k2 * (a * (alpha + asin(a / rho)) - a * a / (c + rho));');
    expect(STEERING_GLSL).toContain('return 2.0 * k2 * sin(0.5 * b) * vec2(cos(m), -sin(m));');
    expect(STEERING_GLSL).toContain('return clamp((halfSector - abs(phiK)) / (taperLines * dPhi) + 0.5, 0.0, 1.0);');
    expect(STEERING_GLSL).not.toMatch(/uniform/);
  });
});
