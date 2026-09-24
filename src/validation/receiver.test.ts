import { describe, expect, it } from 'vitest';
import {
  RECEIVER_GLSL,
  RECEIVER_NOISE,
  TRANSIENT_AMPLITUDE,
  TRANSIENT_DECAY_MM,
  TRANSIENT_SKIP_MM,
  glslFloat,
  transientScale,
} from '../ultrasound/receiver';
import { FRAG_RAWFIELD } from '../ultrasound/shaders/passes.glsl';
import { scattererField } from '../ultrasound/speckleField';

/** Constantes `const float X = …;` de un trozo de GLSL. */
const glslConsts = (src: string): Map<string, string> =>
  new Map([...src.matchAll(/const float (\w+) = ([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

/**
 * La pasada B omite el transitorio del campo cercano desde TRANSIENT_SKIP_MM (receiver.ts), donde ya vale
 * la décima parte del ruido del receptor: la imagen solo cambia por debajo de ruido/10.
 */
describe('Transitorio del campo cercano bajo el ruido del receptor', () => {
  it('el corte está donde la escala del transitorio vale ruido/10: D·ln(A·10/ruido) = 38,2 mm', () => {
    expect(TRANSIENT_SKIP_MM).toBeCloseTo(TRANSIENT_DECAY_MM * Math.log((TRANSIENT_AMPLITUDE * 10) / RECEIVER_NOISE), 10);
    expect(TRANSIENT_SKIP_MM).toBeCloseTo(38.19, 2);
    expect(transientScale(TRANSIENT_SKIP_MM)).toBeLessThanOrEqual((RECEIVER_NOISE / 10) * (1 + 1e-12));
    // y no antes de lo necesario: medio milímetro antes aún supera ruido/10
    expect(transientScale(TRANSIENT_SKIP_MM - 0.5)).toBeGreaterThan(RECEIVER_NOISE / 10);
  });

  it('lo que se omite es ≤ ruido/10 en rms, con el campo que suma la pasada B (gemelo TS)', () => {
    // B: scattererField(vec3(u·190, 3r, 1), 0,8, uSeed + 7)·A·e^(−r/D)·acoplamiento (≤ 1), frente al ruido
    // uNoise·√(−2 ln n₁)·e^(iφ), de rms uNoise·√2. Todas las líneas, en los 10 mm tras el corte (a más
    // profundidad el transitorio solo baja).
    const noiseRms = RECEIVER_NOISE * Math.SQRT2;
    for (const uSeed of [0, 17 / 7, 999 / 7]) {
      let sum = 0;
      let n = 0;
      for (let line = 0; line < 192; line++)
        for (let r = TRANSIENT_SKIP_MM; r < TRANSIENT_SKIP_MM + 10; r += 180 / 1024) {
          const f = scattererField([((line + 0.5) / 192) * 190, r * 3, 1], 0.8, uSeed + 7);
          sum += (f[0] ** 2 + f[1] ** 2) * transientScale(r) ** 2;
          n++;
        }
      expect(Math.sqrt(sum / n), `semilla ${uSeed.toFixed(2)}`).toBeLessThanOrEqual(noiseRms / 10);
    }
  });

  it('la pasada B toma las constantes de TS y, antes del corte, suma el mismo transitorio que antes', () => {
    expect(FRAG_RAWFIELD).toContain(RECEIVER_GLSL);
    expect(FRAG_RAWFIELD.replace(/\s+/g, ' ')).toContain(
      'if (r < TRANSIENT_SKIP_MM) out2 += scattererField(vec3(vUv.x * 190.0, r * 3.0, 1.0), 0.8, uSeed + 7.0) * TRANSIENT_AMPLITUDE * exp(-r / TRANSIENT_DECAY_MM) * coupling;',
    );
    const consts = glslConsts(RECEIVER_GLSL);
    // el float32 del shader es el de TS
    for (const [name, value] of [
      ['TRANSIENT_AMPLITUDE', TRANSIENT_AMPLITUDE],
      ['TRANSIENT_DECAY_MM', TRANSIENT_DECAY_MM],
      ['TRANSIENT_SKIP_MM', TRANSIENT_SKIP_MM],
    ] as const) {
      const lit = consts.get(name);
      expect(lit, name).toBeDefined();
      expect(Math.fround(Number(lit)), name).toBe(Math.fround(value));
    }
    // un entero sin punto decimal no compila en GLSL ES 3.0 (int / float)
    expect(consts.get('TRANSIENT_DECAY_MM')).toMatch(/\./);
    expect(glslFloat(4)).toBe('4.0');
    expect(glslFloat(0.35)).toBe('0.35');
  });
});
