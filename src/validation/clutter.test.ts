import { describe, expect, it } from 'vitest';
import {
  CLUTTER,
  SIDELOBE_PHASES,
  SIDELOBE_PHASE_GLSL,
  applyComplexKernel,
  clutterParams,
  lateralKernel,
  reverbGains,
  reverbGateWeight,
} from '../ultrasound/clutter';
import { FRAG_AXIAL, FRAG_LATERAL } from '../ultrasound/shaders/passes.glsl';

/**
 * Ecos parásitos del modo fundamental (decisión 76): pedestal de lóbulos laterales con una pantalla de fase fija y
 * antisimétrica, y réplicas de reverberación de la pared que pagan su viaje extra por ella, iguales en TS (gemelos)
 * y en las pasadas C y D.
 */
type K = Array<[number, number]>;
const energy = (w: K): number => w.reduce((a, [re, im]) => a + re * re + im * im, 0);
const coherent = (w: K): number => {
  const [re, im] = w.reduce(([a, b], [x, y]) => [a + x, b + y], [0, 0]);
  return Math.hypot(re, im);
};
const NONE = { sidelobeIslr: 0, sidelobeWidth: CLUTTER.sidelobeWidth };
const SIGMAS = [0.35, 0.5, 0.8, 1.2, 2, 3];
const R = CLUTTER.lateralMaxLines;

describe('Ecos parásitos del modo fundamental (decisión 76)', () => {
  const ref = clutterParams(28, CLUTTER.fatRefMm);

  it('la pantalla de fase es antisimétrica: φ(−k) = φ(k) + π y φ(0) = π/2', () => {
    expect(SIDELOBE_PHASES).toHaveLength(2 * R + 1);
    expect(SIDELOBE_PHASES[R]).toBe(Math.PI / 2);
    for (let k = 1; k <= R; k++) expect(SIDELOBE_PHASES[R - k]).toBeCloseTo(SIDELOBE_PHASES[R + k] + Math.PI, 12);
  });

  it('el núcleo tiene energía unidad y, sin pedestal o sin contacto, es la gaussiana de siempre', () => {
    for (const sigma of SIGMAS) {
      expect(energy(lateralKernel(sigma, ref))).toBeCloseTo(1, 12);
      const plain = lateralKernel(sigma, NONE);
      expect(plain.every(([, im]) => im === 0)).toBe(true);
      expect(plain).toHaveLength(2 * Math.min(R, Math.ceil(sigma * 2.5)) + 1);
      expect(lateralKernel(sigma, ref, 0)).toEqual(plain);
    }
  });

  it('el pedestal lleva exactamente ISLR·c² de energía frente al principal, a cualquier anchura del haz', () => {
    // construcción independiente de la documentada: a² = ISLR·c²·Σgm²/Σgp² sobre el mismo radio
    for (const sigma of SIGMAS)
      for (const c of [1, 0.5]) {
        const w = lateralKernel(sigma, ref, c);
        const Rk = (w.length - 1) / 2;
        const sp = sigma * CLUTTER.sidelobeWidth;
        let sm = 0;
        let spp = 0;
        for (let k = -Rk; k <= Rk; k++) {
          sm += Math.exp(-((k / sigma) ** 2));
          spp += Math.exp(-((k / sp) ** 2));
        }
        const a = c * Math.sqrt((ref.sidelobeIslr * sm) / spp);
        // separa el pedestal: w·n − gm; n sale de la parte real central (φ(0) = π/2: cos = 0)
        const n = 1 / w[Rk][0];
        let ped = 0;
        let main = 0;
        for (let k = -Rk; k <= Rk; k++) {
          const gm = Math.exp(-0.5 * (k / sigma) ** 2);
          const [re, im] = w[k + Rk];
          ped += (re * n - gm) ** 2 + (im * n) ** 2;
          main += gm * gm;
        }
        expect(ped / main, `σ ${sigma}, c ${c}`).toBeCloseTo(ref.sidelobeIslr * c * c, 9);
        expect(Math.hypot(...w[Rk]) * n).toBeCloseTo(Math.hypot(1, a * 1), 9);
      }
  });

  it('un reflector continuo no cambia (≤ 0,5 %) y la luz junto a una cara brillante recibe la energía del pedestal', () => {
    for (const sigma of SIGMAS) {
      const w = lateralKernel(sigma, ref);
      const plain = lateralKernel(sigma, NONE);
      // cara continua: el mismo campo en todas las líneas del núcleo
      expect(Math.abs(coherent(w) / coherent(plain) - 1), `σ ${sigma}`).toBeLessThan(0.005);
      // luz: campo 0 en ±3σ del centro y moteado brillante fuera (potencia unidad por línea, independiente)
      const Rk = (w.length - 1) / 2;
      const leak = (ker: K): number => {
        const Rq = (ker.length - 1) / 2;
        let p = 0;
        for (let k = -Rq; k <= Rq; k++) if (Math.abs(k) > 3 * sigma) p += ker[k + Rq][0] ** 2 + ker[k + Rq][1] ** 2;
        return p;
      };
      if (Rk > 3 * sigma + 1) {
        expect(leak(w), `σ ${sigma}`).toBeGreaterThan(0.3 * ref.sidelobeIslr);
        expect(leak(w), `σ ${sigma}`).toBeLessThan(ref.sidelobeIslr);
        expect(leak(w) / Math.max(leak(plain), 1e-12)).toBeGreaterThan(10);
      }
    }
  });

  it('más grasa, más ecos parásitos; la armónica los baja 12 dB por orden', () => {
    const obese = clutterParams(40, 30);
    const thin = clutterParams(20, 6);
    expect(obese.sidelobeIslr).toBeGreaterThan(ref.sidelobeIslr);
    expect(thin.sidelobeIslr).toBeLessThan(ref.sidelobeIslr);
    expect(10 * Math.log10(obese.sidelobeIslr / ref.sidelobeIslr)).toBeCloseTo(CLUTTER.fatSlopeDbPerMm * 16, 9);
    expect(20 * Math.log10(obese.reverb[0] / ref.reverb[0])).toBeCloseTo(CLUTTER.fatSlopeDbPerMm * 16, 9);
    // la segunda réplica paga la pendiente dos veces (dos rebotes)
    expect(20 * Math.log10(obese.reverb[1] / ref.reverb[1])).toBeCloseTo(2 * CLUTTER.fatSlopeDbPerMm * 16, 9);
    const thi = clutterParams(28, CLUTTER.fatRefMm, true);
    expect(10 * Math.log10(ref.sidelobeIslr / thi.sidelobeIslr)).toBeCloseTo(CLUTTER.harmonicReductionDb, 9);
    expect(20 * Math.log10(ref.reverb[0] / thi.reverb[0])).toBeCloseTo(CLUTTER.harmonicReductionDb, 9);
    expect(20 * Math.log10(ref.reverb[1] / thi.reverb[1])).toBeCloseTo(2 * CLUTTER.harmonicReductionDb, 9);
  });

  it('las réplicas pagan la transmisión de la pared por orden (tras una costilla no hay réplica) y solo de los ecos fuertes', () => {
    expect(reverbGains(ref, 1)).toEqual(ref.reverb);
    const [g1, g2] = reverbGains(ref, 0.5);
    expect(g1).toBeCloseTo(ref.reverb[0] * 0.5, 15);
    expect(g2).toBeCloseTo(ref.reverb[1] * 0.25, 15);
    expect(reverbGains(ref, 0)).toEqual([0, 0]);
    // la compuerta: 0 bajo el umbral (moteado), 1 sobre él (caras fuertes), continua entre medias
    expect(reverbGateWeight(CLUTTER.reverbGate[0])).toBe(0);
    expect(reverbGateWeight(CLUTTER.reverbGate[1])).toBe(1);
    expect(reverbGateWeight((CLUTTER.reverbGate[0] + CLUTTER.reverbGate[1]) / 2)).toBeCloseTo(0.5, 12);
  });

  it('las pasadas C y D llevan las mismas fórmulas, constantes y pantalla de fase', () => {
    expect(FRAG_LATERAL).toContain(SIDELOBE_PHASE_GLSL);
    expect(FRAG_LATERAL).toContain(`for (int k = -${R}; k <= ${R}; k++)`);
    expect(FRAG_LATERAL).toContain('float amp = pedOn ? coupling * sqrt(uSidelobe.x * sm / sp) : 0.0;');
    expect(FRAG_LATERAL).toContain('vec2 f = (accM + amp * accP) * inversesqrt(sm + amp * amp * sp + 2.0 * amp * cx);');
    expect(FRAG_AXIAL).toContain(`smoothstep(${CLUTTER.reverbGate[0].toFixed(3)}, ${CLUTTER.reverbGate[1].toFixed(3)}, length(f1))`);
    expect(FRAG_AXIAL).toContain('float tW = rep1 || rep2 ? texture(uTrans, vec2(vUv.x, uReverb.x * uTexel.y)).x : 0.0;');
    // solo reverbera la pared: la fuente no pasa de su cara interna (uReverb.w = W + reverbSourceMarginMm)
    expect(FRAG_AXIAL).toContain('row >= uReverb.x && row - uReverb.x <= uReverb.w');
    expect(FRAG_AXIAL).toContain('row >= 2.0 * uReverb.x && row - 2.0 * uReverb.x <= uReverb.w');
    expect(FRAG_AXIAL).toContain('oField = (acc + uReverb.y * tW * acc1 + uReverb.z * tW * tW * acc2) / sqrt(wsum);');
    // la tabla GLSL es la de TS con 7 decimales (la antisimetría sobrevive al redondeo)
    const nums = [...SIDELOBE_PHASE_GLSL.matchAll(/vec2\((-?[\d.]+), (-?[\d.]+)\)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(nums).toHaveLength(2 * R + 1);
    nums.forEach(([c, s], i) => {
      expect(c).toBeCloseTo(Math.cos(SIDELOBE_PHASES[i]), 6);
      expect(s).toBeCloseTo(Math.sin(SIDELOBE_PHASES[i]), 6);
    });
    // y el gemelo aplica el núcleo como el producto complejo de la pasada D
    expect(applyComplexKernel([[0, 1]], () => [2, 3])).toEqual([-3, 2]);
  });
});
