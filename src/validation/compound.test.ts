import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../core/vec3';
import {
  COMPOUND,
  COMPOUND_GLSL,
  COMPOUND_STEER_RANGE_DEG,
  CompoundRing,
  LOOK_SALT_STEP,
  compoundActive,
  compoundEnvelope,
  lookSalt,
  lookTheta,
  lookWeight,
  type CompoundFrameInput,
  type CompoundGrid,
  type LookSlot,
} from '../ultrasound/compound';
import { CURTAIN_AIR_GLSL, CURTAIN_MIN_AIR, curtainSteerWeight } from '../ultrasound/pleura';
import { FRAG_COMPOUND, FRAG_RAWFIELD } from '../ultrasound/shaders/passes.glsl';
import { JUMP_DEG, JUMP_MM } from '../ultrasound/speckleField';
import { steerBeta } from '../ultrasound/steering';
import { CONVEX_C35_PROFILE } from '../ultrasound/transducerProfile';
import { rng } from './syntheticSpeckle';

/**
 * Composición espacial (decisión 58, T6): la regla de actividad, el anillo de miradas intercaladas con
 * sus reinicios y el gemelo de la pasada K (media lineal ponderada por cobertura, paso directo exacto).
 */
const deg = Math.PI / 180;
const rot = (v: Vec3, a: number): Vec3 => [v[0] * Math.cos(a) - v[2] * Math.sin(a), v[1], v[0] * Math.sin(a) + v[2] * Math.cos(a)];
const BASE: CompoundFrameInput = {
  active: true,
  depthMm: 180,
  focusMm: 90,
  lines: 192,
  face: [10, -50, 20],
  axial: [0, 1, 0],
  elevation: [1, 0, 0],
};

describe('regla de actividad y parámetros del compuesto', () => {
  it('activo solo con el conmutador encendido y el color apagado; el PW no lo apaga', () => {
    expect(compoundActive({ compound: true }, { enabled: false })).toBe(true);
    expect(compoundActive({ compound: true }, { enabled: true })).toBe(false);
    expect(compoundActive({ compound: false }, { enabled: false })).toBe(false);
    // el PW no está en la regla: con el color apagado, el compuesto sigue aunque haya puerta PW
    const pw = { enabled: false, pwGate: true };
    expect(compoundActive({ compound: true }, pw)).toBe(true);
  });

  it('3 miradas 0, +θ, −θ con θ = 7° dentro de la calibración de 6–8°, en el perfil del transductor', () => {
    expect(COMPOUND.order).toEqual([0, 1, -1]);
    expect(COMPOUND.steerDeg).toBe(7);
    expect(COMPOUND.steerDeg).toBeGreaterThanOrEqual(COMPOUND_STEER_RANGE_DEG[0]);
    expect(COMPOUND.steerDeg).toBeLessThanOrEqual(COMPOUND_STEER_RANGE_DEG[1]);
    expect(COMPOUND.taperLines).toBe(1);
    expect(CONVEX_C35_PROFILE.compound).toBe(COMPOUND);
    expect(lookTheta(0)).toBe(0);
    expect(lookTheta(1)).toBeCloseTo(7 * deg, 15);
    expect(lookTheta(2)).toBeCloseTo(-7 * deg, 15);
  });

  it('la sal del transitorio y de la cola es 0 en la mirada 0 y aleja las otras del periodo del hash', () => {
    expect(lookSalt(0)).toBe(0);
    const fr = (x: number) => x - Math.floor(x);
    // el hash repite cada 1/0,1031 en su coordenada: las diferencias de sal, a ≥ 0,3 de un periodo
    for (const [a, b] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      const f = fr(0.1031 * Math.abs(lookSalt(a) - lookSalt(b)));
      expect(Math.min(f, 1 - f)).toBeGreaterThanOrEqual(0.3);
    }
    expect(LOOK_SALT_STEP).toBeCloseTo(1 / (3 * 0.1031), 12);
  });

  it('el GLSL de K interpola el número de miradas y la rampa, y pesa 1 la mirada 0', () => {
    expect(COMPOUND_GLSL).toContain(`const int COMPOUND_LOOKS = ${COMPOUND.order.length};`);
    expect(COMPOUND_GLSL).toContain('const float COMPOUND_TAPER_LINES = 1.0;');
    expect(COMPOUND_GLSL).toContain('if (theta == 0.0) return 1.0;');
    expect(COMPOUND_GLSL).toContain('lookCoverage(steeredElement(alpha, rho, theta, a), halfSector, linesF, COMPOUND_TAPER_LINES)');
  });
});

describe('anillo de miradas intercaladas', () => {
  it('una mirada por cuadro en el orden 0, +θ, −θ; tras 3 cuadros las tres son válidas', () => {
    const ring = new CompoundRing();
    const looks = Array.from({ length: 7 }, () => ring.next(BASE));
    expect(looks.map((l) => l.index)).toEqual([0, 1, 2, 0, 1, 2, 0]);
    expect(looks.map((l) => l.validCount)).toEqual([1, 2, 3, 3, 3, 3, 3]);
    expect(looks[0].reset).toBe(true);
    expect(looks.slice(1).every((l) => !l.reset)).toBe(true);
    expect(looks[1].theta).toBe(lookTheta(1));
    expect(looks[2].theta).toBe(lookTheta(2));
    expect(looks[1].salt).toBe(lookSalt(1));
    expect(ring.state().resets).toBe(1);
    expect(ring.state().last).toBe(looks[6]);
  });

  const resetCases: [string, (ring: CompoundRing) => CompoundFrameInput][] = [
    ['un salto de pose (traslación)', () => ({ ...BASE, face: [BASE.face[0] + JUMP_MM + 1, BASE.face[1], BASE.face[2]] })],
    ['un salto de pose (giro sobre el eje de la sonda)', () => ({ ...BASE, elevation: rot(BASE.elevation, (JUMP_DEG + 1) * deg) })],
    [
      'un salto de pose (basculación del eje axial)',
      () => ({ ...BASE, axial: [Math.sin((JUMP_DEG + 1) * deg), Math.cos((JUMP_DEG + 1) * deg), 0] }),
    ],
    [
      'setScene (invalidate)',
      (ring) => {
        ring.invalidate();
        return BASE;
      },
    ],
    ['un cambio de profundidad', () => ({ ...BASE, depthMm: 160 })],
    ['un cambio de foco', () => ({ ...BASE, focusMm: 70 })],
    ['un cambio de líneas', () => ({ ...BASE, lines: 96 })],
    ['encender el color (cambio de modo)', () => ({ ...BASE, active: false })],
  ];
  for (const [name, change] of resetCases)
    it(`se reinicia con ${name} y el primer cuadro tras el reinicio es la mirada 0`, () => {
      const ring = new CompoundRing();
      ring.next(BASE);
      ring.next(BASE); // +θ: el siguiente sería −θ
      const after = ring.next(change(ring));
      expect(after.reset).toBe(true);
      expect(after.index).toBe(0);
      expect(after.valid).toEqual([true, false, false]);
      expect(ring.state().resets).toBe(2);
    });

  it('un movimiento lento no reinicia; apagado, cada cuadro es la mirada 0 sola', () => {
    const ring = new CompoundRing();
    ring.next(BASE);
    const slow = ring.next({
      ...BASE,
      face: [BASE.face[0] + JUMP_MM - 1, BASE.face[1], BASE.face[2]],
      elevation: rot(BASE.elevation, (JUMP_DEG - 1) * deg),
    });
    expect(slow.reset).toBe(false);
    expect(slow.index).toBe(1);
    const off = new CompoundRing();
    const frames = Array.from({ length: 4 }, () => off.next({ ...BASE, active: false }));
    expect(frames.map((f) => f.index)).toEqual([0, 0, 0, 0]);
    expect(frames.every((f) => f.validCount === 1)).toBe(true);
    // volver a encenderlo es otro cambio de modo: reinicia desde la mirada 0
    const on = off.next(BASE);
    expect(on.reset).toBe(true);
    expect(on.index).toBe(0);
    expect(off.next(BASE).index).toBe(1);
  });
});

describe('gemelo de la pasada K', () => {
  const G: CompoundGrid = {
    lines: 192,
    samples: 64,
    depthMm: 180,
    halfSector: CONVEX_C35_PROFILE.geometry.halfSector,
    curvatureRadius: CONVEX_C35_PROFILE.geometry.curvatureRadius,
  };
  const random = (seed: number) => {
    const r = rng(seed);
    return Float32Array.from({ length: G.lines * G.samples }, () => Math.fround(0.2 + 2 * r()));
  };

  it('con solo la mirada 0 válida es paso directo exacto (env·1/1, bit a bit)', () => {
    const env0 = random(1);
    const out = compoundEnvelope(
      [
        { theta: 0, data: env0 },
        { theta: lookTheta(1), data: null },
        { theta: lookTheta(2), data: null },
      ],
      G,
    );
    expect(out).toEqual(env0);
  });

  it('media lineal ponderada por cobertura: 1/3 de cada una dentro, sin la dirigida que no cubre', () => {
    const [e0, ep, em] = [random(2), random(3), random(4)];
    const slots: LookSlot[] = [
      { theta: 0, data: e0 },
      { theta: lookTheta(1), data: ep },
      { theta: lookTheta(2), data: em },
    ];
    const out = compoundEnvelope(slots, G);
    const dPhi = (2 * G.halfSector) / G.lines;
    const th = lookTheta(1);
    let covered = 0;
    let seam = 0;
    for (let v = 0; v < G.samples; v++) {
      const r = ((v + 0.5) * G.depthMm) / G.samples;
      const rho = G.curvatureRadius + r;
      for (let u = 0; u < G.lines; u++) {
        const i = v * G.lines + u;
        const alpha = -G.halfSector + (u + 0.5) * dPhi;
        const wp = lookWeight(alpha, rho, th, G);
        const wm = lookWeight(alpha, rho, -th, G);
        const expected = (e0[i] + wp * ep[i] + wm * em[i]) / (1 + wp + wm);
        expect(out[i]).toBeCloseTo(expected, 5);
        if (wp === 1 && wm === 1) covered++;
        if (wp === 0 || wm === 0) seam++;
      }
      // la banda con una sola dirigida a cada lado mide lo que la costura: (θ − β)/dφ líneas por lado
      const perSide = (th - steerBeta(rho, th, G.curvatureRadius)) / dPhi;
      const row = Array.from({ length: G.lines }, (_, u) => lookWeight(-G.halfSector + (u + 0.5) * dPhi, rho, th, G));
      expect(Math.abs(row.filter((w) => w < 1).length - perSide)).toBeLessThanOrEqual(1.5);
    }
    expect(covered).toBeGreaterThan(0.7 * G.lines * G.samples);
    expect(seam).toBeGreaterThan(0);
    // la mirada 0 pesa siempre 1, incluso en el borde del sector
    expect(lookWeight(-G.halfSector + 0.5 * dPhi, G.curvatureRadius + 100, 0, G)).toBe(1);
  });

  // Decisión 61: bajo la pleura de la cortina cada mirada dirigida reverbera a múltiplos de su propio camino y
  // la media dejaba cada línea A partida en tres arcos (capturas con GPU); los equipos no componen en pulmón.
  it('bajo la pleura de la cortina las dirigidas pesan 1 − fAir de la mirada 0: la cortina entera es la mirada 0', () => {
    const [e0, ep, em] = [random(5), random(6), random(7)];
    const slots: LookSlot[] = [
      { theta: 0, data: e0 },
      { theta: lookTheta(1), data: ep },
      { theta: lookTheta(2), data: em },
    ];
    const D = 30;
    // cortina entera en las líneas 60–99, borde blando en 100–119 (fAir de 1 a 0), sin cortina en el resto
    const curtain = Array.from({ length: G.lines }, (_, u) => ({
      D: u >= 60 && u < 120 ? D : -1,
      fAir: u < 60 ? 0 : u < 100 ? 1 : Math.max(0, 1 - (u - 99) / 20),
    }));
    const out = compoundEnvelope(slots, G, COMPOUND.taperLines, curtain);
    const plain = compoundEnvelope(slots, G);
    const dPhi = (2 * G.halfSector) / G.lines;
    let under = 0;
    let soft = 0;
    for (let v = 0; v < G.samples; v++) {
      const r = ((v + 0.5) * G.depthMm) / G.samples;
      const rho = G.curvatureRadius + r;
      for (let u = 0; u < G.lines; u++) {
        const i = v * G.lines + u;
        const c = curtain[u];
        if (c.D < 0 || r <= D || c.fAir < CURTAIN_MIN_AIR) {
          // fuera de la cortina y sobre la pleura, el compuesto de siempre, bit a bit
          expect(out[i]).toBe(plain[i]);
          continue;
        }
        const alpha = -G.halfSector + (u + 0.5) * dPhi;
        const keep = 1 - c.fAir;
        const wp = lookWeight(alpha, rho, lookTheta(1), G) * keep;
        const wm = lookWeight(alpha, rho, lookTheta(2), G) * keep;
        const expected = (e0[i] + wp * ep[i] + wm * em[i]) / (1 + wp + wm);
        expect(out[i]).toBeCloseTo(expected, 5);
        if (c.fAir === 1) {
          // la cortina entera: la mirada 0 sola, bit a bit
          expect(out[i]).toBe(e0[i]);
          under++;
        } else soft++;
      }
    }
    expect(under).toBeGreaterThan(1000);
    expect(soft).toBeGreaterThan(500);
    expect(curtainSteerWeight(D + 1, D, 1)).toBe(0);
    expect(curtainSteerWeight(D - 1, D, 1)).toBe(1);
    expect(curtainSteerWeight(D + 1, D, CURTAIN_MIN_AIR / 2)).toBe(1);
    expect(curtainSteerWeight(D + 1, -1, 1)).toBe(1);
  });

  it('la GLSL de K pesa las dirigidas con la cortina de la mirada 0 (A0 h2 y la fracción de aire de B)', () => {
    for (const line of [
      'vec4 h2 = texelFetch(uHits2, ivec2(c.x, 0), 0);',
      'float fAir = h2.x > 0.0 ? curtainAirFraction(h2.y, h2.x, lineDir(alpha)) : 0.0;',
      'float steerKeep = curtainSteerWeight(rho - uCurvR, h2.x, fAir);',
      'if (uLookSteer[i] != 0.0) w *= steerKeep;',
    ])
      expect(FRAG_COMPOUND, line).toContain(line);
    expect(FRAG_COMPOUND).toContain(CURTAIN_AIR_GLSL);
    expect(CURTAIN_AIR_GLSL).toContain(
      'float curtainSteerWeight(float r, float D, float fAir) { return D > 0.0 && fAir >= CURTAIN_MIN_AIR && r > D ? 1.0 - fAir : 1.0; }',
    );
    // la misma fracción de aire que B
    expect(FRAG_RAWFIELD).toContain(CURTAIN_AIR_GLSL);
    expect(FRAG_RAWFIELD).toContain('float fAir = D > 0.0 ? curtainAirFraction(h2.y, D, dir0) : 0.0;');
  });
});
