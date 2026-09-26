import { describe, expect, it } from 'vitest';
import { CLUTTER, applyComplexKernel, clutterParams, lateralKernel } from '../ultrasound/clutter';
import {
  RECEIVER_GLSL,
  RECEIVER_NOISE,
  TRANSIENT_AMPLITUDE,
  TRANSIENT_DECAY_MM,
  TRANSIENT_SKIP_MM,
  glslFloat,
  transientScale,
} from '../ultrasound/receiver';
import { AXIAL_SIGMA_MM } from '../ultrasound/beamModel';
import { FRAG_AXIAL, FRAG_LATERAL, FRAG_RAWFIELD } from '../ultrasound/shaders/passes.glsl';
import { scattererField } from '../ultrasound/speckleField';
import { FINE, LINES, latSigmaMm, linePitch } from './support/interfaceTwin';

/** Constantes `const float X = …;` de un trozo de GLSL. */
const glslConsts = (src: string): Map<string, string> =>
  new Map([...src.matchAll(/const float (\w+) = ([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

/** Gaussiana de energía unidad (Σw² = 1) de σ muestras, truncada a ±min(tope, ⌈2,5σ⌉): C y D. */
function unitKernel(sigma: number, cap: number): number[] {
  const R = Math.min(cap, Math.ceil(sigma * 2.5));
  const w = Array.from({ length: 2 * R + 1 }, (_, k) => Math.exp(-0.5 * ((k - R) / sigma) ** 2));
  const norm = Math.hypot(...w);
  return w.map((x) => x / norm);
}

/**
 * Lo que la pasada B deja de sumar (campo del transitorio · escala desde el corte, acoplamiento 1) a la
 * profundidad seleccionada `depthMm`, filtrado como la imagen: C axial (σ = max(0,6; AXIAL_SIGMA_MM/dz)
 * muestras, ±12) y D lateral (σ = max(0,35; σ_PSF/paso de línea) líneas, ±14). Devuelve el peor rms sobre las líneas,
 * en cualquier muestra desde el corte, relativo al rms del ruido del receptor, que al ser blanco no cambia
 * con núcleos de energía unidad.
 */
function omittedVsNoise(depthMm: number, seed: number): { summed: number; axial: number; lateral: number } {
  const dz = depthMm / FINE;
  const focus = Math.min(90, depthMm); // foco por defecto, recortado a la profundidad como el equipo
  const wA = unitKernel(Math.max(0.6, AXIAL_SIGMA_MM / dz), 12);
  const RA = (wA.length - 1) / 2;
  const v0 = Math.floor(TRANSIENT_SKIP_MM / dz) - RA;
  const nv = 2 * RA + Math.ceil(6 / dz); // hasta 6 mm tras el corte: el transitorio ya ha caído a e^(−1,5)
  const rOf = (v: number): number => (v0 + v + 0.5) * dz;
  const raw: [number, number][] = [];
  for (let v = 0; v < nv; v++)
    for (let u = 0; u < LINES; u++) {
      const r = rOf(v);
      if (r < TRANSIENT_SKIP_MM) raw.push([0, 0]);
      else {
        const f = scattererField([((u + 0.5) / LINES) * 190, r * 3, 1], 0.8, seed + 7);
        raw.push([f[0] * transientScale(r), f[1] * transientScale(r)]);
      }
    }
  const noiseRms = RECEIVER_NOISE * Math.SQRT2;
  let summed = 0;
  let axial = 0;
  let lateral = 0;
  for (let v = RA; v < nv - RA; v++) {
    const r = rOf(v);
    const ax = Array.from({ length: LINES }, (_, u) => {
      let re = 0;
      let im = 0;
      for (let k = -RA; k <= RA; k++) {
        const [a, b] = raw[(v + k) * LINES + u];
        re += wA[k + RA] * a;
        im += wA[k + RA] * b;
      }
      return [re, im] as const;
    });
    // D con el pedestal de lóbulos laterales del paciente de referencia (decisión 76)
    const wL = lateralKernel(Math.max(0.35, latSigmaMm(r, focus) / linePitch(r)), clutterParams(28, CLUTTER.fatRefMm));
    const RL = (wL.length - 1) / 2;
    let p0 = 0;
    let p1 = 0;
    let p2 = 0;
    let n = 0;
    for (let u = RL; u < LINES - RL; u++) {
      const [a, b] = raw[v * LINES + u];
      p0 += a * a + b * b;
      p1 += ax[u][0] ** 2 + ax[u][1] ** 2;
      const [re, im] = applyComplexKernel(wL, (k) => [ax[u + k][0], ax[u + k][1]]);
      p2 += re * re + im * im;
      n++;
    }
    summed = Math.max(summed, Math.sqrt(p0 / n) / noiseRms);
    axial = Math.max(axial, Math.sqrt(p1 / n) / noiseRms);
    lateral = Math.max(lateral, Math.sqrt(p2 / n) / noiseRms);
  }
  return { summed, axial, lateral };
}

/**
 * La pasada B omite el transitorio del campo cercano desde TRANSIENT_SKIP_MM (receiver.ts), donde su escala
 * vale la décima parte de la del ruido del receptor en el punto en que se suman, antes de la PSF. Tras C y
 * D, que dan ganancia coherente al transitorio (correlacionado) y no al ruido (blanco), lo omitido llega a
 * ≈ ruido/7 a la profundidad mínima: un escalón de ≈ 0,1 dB en el suelo de ruido.
 */
describe('Transitorio del campo cercano bajo el ruido del receptor', () => {
  it('el corte está donde la escala del transitorio vale ruido/10: D·ln(A·10/ruido) = 38,2 mm', () => {
    expect(TRANSIENT_SKIP_MM).toBeCloseTo(TRANSIENT_DECAY_MM * Math.log((TRANSIENT_AMPLITUDE * 10) / RECEIVER_NOISE), 10);
    expect(TRANSIENT_SKIP_MM).toBeCloseTo(38.19, 2);
    expect(transientScale(TRANSIENT_SKIP_MM)).toBeLessThanOrEqual((RECEIVER_NOISE / 10) * (1 + 1e-12));
    // y no antes de lo necesario: medio milímetro antes aún supera ruido/10
    expect(transientScale(TRANSIENT_SKIP_MM - 0.5)).toBeGreaterThan(RECEIVER_NOISE / 10);
  });

  it('al sumarse, antes de la PSF, lo que se omite es ≤ ruido/10 en rms, con el campo de la pasada B (gemelo TS)', () => {
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

  it('tras la PSF (C y D) lo omitido llega a ≈ ruido/7 a 60 mm y ruido/8 a 90 mm: el suelo sube ≤ 0,1 dB', () => {
    // el gemelo filtra como las pasadas C y D (topes del núcleo y σ mínimas)
    expect(FRAG_AXIAL).toContain('for (int k = -12; k <= 12; k++)');
    expect(FRAG_AXIAL).toContain('oField = (acc + uReverb.y * acc1 + uReverb.z * acc2) / sqrt(wsum);');
    expect(FRAG_LATERAL).toContain(`for (int k = -${CLUTTER.lateralMaxLines}; k <= ${CLUTTER.lateralMaxLines}; k++)`);
    expect(FRAG_LATERAL).toContain('max(0.35, sigmaMm / lineSpacing)');
    // la profundidad mínima del equipo (60 mm) es el peor caso: más muestras por celda axial del transitorio
    for (const [depth, bound] of [
      [60, 1 / 6],
      [90, 1 / 7.5],
      [240, 1 / 10],
    ] as const) {
      const worst = { summed: 0, axial: 0, lateral: 0 };
      for (const seed of [0, 17 / 7, 999 / 7]) {
        const m = omittedVsNoise(depth, seed);
        worst.summed = Math.max(worst.summed, m.summed);
        worst.axial = Math.max(worst.axial, m.axial);
        worst.lateral = Math.max(worst.lateral, m.lateral);
      }
      expect(worst.summed, `${depth} mm, al sumarse`).toBeLessThanOrEqual(1 / 10);
      // C gana potencia coherente (en poca profundidad seleccionada, bastante): por eso no es ruido/10
      expect(worst.axial, `${depth} mm, tras C`).toBeGreaterThan(worst.summed);
      expect(worst.lateral, `${depth} mm, tras C y D`).toBeLessThanOrEqual(bound);
      // el ruido y lo omitido son independientes: el suelo de ruido sube 10·log10(1 + x²) dB en el corte
      expect(10 * Math.log10(1 + worst.lateral ** 2), `${depth} mm, escalón del suelo`).toBeLessThanOrEqual(0.1);
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
