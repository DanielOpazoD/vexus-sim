import { describe, expect, it } from 'vitest';
import {
  CLUTTER,
  SIDELOBE_PHASES,
  SIDELOBE_PHASE_GLSL,
  axialReverb,
  clutterParams,
  lateralKernel,
  reverbGateWeight,
} from '../ultrasound/clutter';
import { FRAG_AXIAL, FRAG_LATERAL } from '../ultrasound/shaders/passes.glsl';

/**
 * Ecos parásitos del modo fundamental (decisión 76): pedestal de lóbulos laterales con fase fija y réplicas de
 * reverberación de la pared, iguales en TS (gemelos) y en las pasadas C y D.
 */
const energy = (w: ReadonlyArray<readonly [number, number]>): number => w.reduce((a, [re, im]) => a + re * re + im * im, 0);
const coherent = (w: ReadonlyArray<readonly [number, number]>): number => {
  const [re, im] = w.reduce(([a, b], [x, y]) => [a + x, b + y], [0, 0]);
  return Math.hypot(re, im);
};

describe('Ecos parásitos del modo fundamental (decisión 76)', () => {
  const ref = clutterParams(28, CLUTTER.fatRefMm);

  it('el núcleo lateral tiene energía unidad y sin pedestal es la gaussiana de antes', () => {
    for (const sigma of [0.35, 0.8, 1.2, 2]) {
      expect(energy(lateralKernel(sigma, ref))).toBeCloseTo(1, 12);
      const plain = lateralKernel(sigma, { sidelobeAmp: 0, sidelobeWidth: 7 });
      expect(plain.every(([, im]) => im === 0)).toBe(true);
      const R = Math.min(CLUTTER.lateralMaxLines, Math.ceil(sigma * 2.5));
      expect(plain).toHaveLength(2 * R + 1);
    }
  });

  it('el pedestal lleva la energía ISLR fuera del lóbulo principal y casi no cambia un reflector continuo', () => {
    for (const sigma of [0.8, 1.2]) {
      const w = lateralKernel(sigma, ref);
      const R = (w.length - 1) / 2;
      // energía fuera de ±2,5σ del lóbulo principal ≈ ISLR (−24 dB en el paciente de referencia)
      const outside = w.filter((_, i) => Math.abs(i - R) > Math.ceil(sigma * 2.5)).reduce((a, [re, im]) => a + re * re + im * im, 0);
      expect(10 * Math.log10(outside)).toBeGreaterThan(CLUTTER.sidelobeIslrDb - 3);
      expect(10 * Math.log10(outside)).toBeLessThan(CLUTTER.sidelobeIslrDb + 1);
      // la fase aleatoria: la ganancia coherente de un reflector continuo cambia < 3 % (≤ 0,26 dB: el resto del paseo
      // aleatorio de la pantalla de fase)
      const plain = lateralKernel(sigma, { sidelobeAmp: 0, sidelobeWidth: 7 });
      expect(Math.abs(coherent(w) / coherent(plain) - 1)).toBeLessThan(0.03);
    }
  });

  it('una línea sin contacto no recibe lóbulos laterales; más grasa, más ecos parásitos; la armónica los baja', () => {
    expect(lateralKernel(1, ref, 0)).toEqual(lateralKernel(1, { sidelobeAmp: 0, sidelobeWidth: 7 }));
    const obese = clutterParams(40, 30);
    const thin = clutterParams(20, 6);
    expect(obese.sidelobeAmp).toBeGreaterThan(ref.sidelobeAmp);
    expect(thin.sidelobeAmp).toBeLessThan(ref.sidelobeAmp);
    expect(obese.reverb[0]).toBeGreaterThan(ref.reverb[0]);
    const thi = clutterParams(28, CLUTTER.fatRefMm, true);
    expect(20 * Math.log10(ref.reverb[0] / thi.reverb[0])).toBeCloseTo(CLUTTER.harmonicReductionDb, 9);
    expect(20 * Math.log10(ref.sidelobeAmp / thi.sidelobeAmp)).toBeCloseTo(CLUTTER.harmonicReductionDb, 9);
  });

  it('la reverberación: réplicas a W y 2W por debajo de la pared, solo de los ecos fuertes', () => {
    expect(axialReverb(20, ref)).toEqual([]);
    expect(axialReverb(40, ref)).toEqual([[28, ref.reverb[0]]]);
    expect(axialReverb(70, ref)).toEqual([
      [28, ref.reverb[0]],
      [56, ref.reverb[1]],
    ]);
    // el moteado del hígado (módulo medio ≈ 0,89) no reverbera; una fascia brillante sí
    expect(reverbGateWeight(0.9)).toBe(0);
    expect(reverbGateWeight(CLUTTER.reverbGate[1] + 1)).toBe(1);
  });

  it('las pasadas C y D llevan las mismas constantes y la misma pantalla de fase', () => {
    expect(SIDELOBE_PHASES).toHaveLength(2 * CLUTTER.lateralMaxLines + 1);
    expect(FRAG_LATERAL).toContain(SIDELOBE_PHASE_GLSL);
    expect(FRAG_LATERAL).toContain(`for (int k = -${CLUTTER.lateralMaxLines}; k <= ${CLUTTER.lateralMaxLines}; k++)`);
    expect(FRAG_LATERAL).toContain('texture(uCoupling, vec2(vUv.x, 0.5)).r');
    expect(FRAG_AXIAL).toContain(`smoothstep(${CLUTTER.reverbGate[0].toFixed(3)}, ${CLUTTER.reverbGate[1].toFixed(3)}, length(f1))`);
    expect(FRAG_AXIAL).toContain('oField = (acc + uReverb.y * acc1 + uReverb.z * acc2) / sqrt(wsum);');
  });
});
