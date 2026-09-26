import { describe, expect, it } from 'vitest';
import { reduceEquipment } from '../app/equipment';
import { Simulator, defaultEquipment } from '../app/simulator';
import { C_RECONSTRUCTION_MM_S } from '../core/units';
import { NORMAL_ADULT } from '../cases';
import { clonePatient } from '../physiology/patientState';
import { CONVEX_BEAM, lateralFwhmMm } from '../ultrasound/beamModel';
import { CLUTTER } from '../ultrasound/clutter';
import {
  HARMONIC,
  HARMONIC_GLSL,
  harmonicBeam,
  harmonicNearGain,
  harmonicNearUniform,
  noiseGain,
  transientGain,
} from '../ultrasound/harmonic';
import { ELEV_RAYLEIGH_MM, ELEV_SIGMA0_MM, elevSigmaMm } from '../ultrasound/pleura';
import { RECEIVER_GLSL, RECEIVER_NOISE } from '../ultrasound/receiver';
import {
  FRAG_AXIAL,
  FRAG_COLOR,
  FRAG_COMPOUND,
  FRAG_LATERAL,
  FRAG_RAWFIELD,
  FRAG_RAWFIELD_STEERED,
  LATERAL_PSF_GLSL,
} from '../ultrasound/shaders/passes.glsl';
import { bmodeBeam, CONVEX_C35_PROFILE } from '../ultrasound/transducerProfile';
import { recordingGl } from './support/recordingGl';

/**
 * Armónica tisular (decisión 77): el haz armónico (emisión a f1 ÷√2, recepción a 2·f1), la σ elevacional
 * equivalente, la acumulación del campo cercano, el transitorio rechazado, el ruido que sube y los ecos
 * parásitos que bajan, en TS y en el GLSL, y su cableado en el renderizador real sobre un WebGL falso. La
 * imagen en GPU la mide la e2e (`harmonicContrast`).
 */
const db = (x: number) => 20 * Math.log10(x);

describe('Armónica tisular (decisión 77): haz y modelo', () => {
  it('el haz fundamental no cambia: λ de emisión = la de recepción, escala 1 y la fórmula de siempre', () => {
    const p = CONVEX_BEAM;
    expect(p.lambdaTxMm).toBe(p.lambdaMm);
    expect(p.txScale).toBe(1);
    for (const F of [40, 90, 160])
      for (const r of [5, 20, 45, 90, 150, 220]) {
        const tx = Math.hypot((p.k * p.lambdaMm * F) / p.apertureTxMm, (p.apertureTxMm * Math.abs(r - F)) / F);
        const rx = (p.k * p.lambdaMm * r) / Math.max(1, Math.min(p.apertureRxMaxMm, r / p.fNumberRxMin));
        expect(lateralFwhmMm(r, F)).toBe(1 / Math.sqrt(1 / (tx * tx) + 1 / (rx * rx)));
      }
  });

  it('haz armónico: emite a f1 = f/2 con la fuente ∝ p1² (÷√2) y recibe a 2·f1; el principal solo cambia en el foco', () => {
    const h = harmonicBeam(CONVEX_BEAM);
    expect(h.lambdaMm).toBe(CONVEX_BEAM.lambdaMm); // recibe a la frecuencia nominal de la sonda (3,5 MHz)
    expect(h.lambdaMm).toBeCloseTo(1540 / (HARMONIC.rxMHz * 1e3), 12);
    expect(h.lambdaTxMm).toBe(2 * h.lambdaMm);
    expect(h.txScale).toBe(Math.SQRT1_2);
    expect({ ...h, lambdaTxMm: 0, txScale: 0 }).toEqual({ ...CONVEX_BEAM, lambdaTxMm: 0, txScale: 0 });
    const ratio = (r: number, F = 90) => lateralFwhmMm(r, F, h) / lateralFwhmMm(r, F);
    // en el foco la emisión a f1 (difracción ×2, ÷√2) ensancha el principal ~15 % (más con el foco somero: +25–36 % a
    // 20–40 mm, donde la difracción pesa más)
    expect(ratio(90)).toBeGreaterThan(1.1);
    expect(ratio(90)).toBeLessThan(1.2);
    expect(ratio(20, 20)).toBeGreaterThan(1.25);
    expect(ratio(20, 20)).toBeLessThan(1.4);
    // fuera del foco manda el desenfoque (÷√2) o la recepción: igual o más estrecho
    for (const r of [20, 45, 150, 200]) expect(ratio(r)).toBeLessThan(1.02);
    // el haz de la imagen B sigue al conmutador; el Doppler no lo lee
    expect(bmodeBeam(CONVEX_C35_PROFILE, { harmonic: false })).toBe(CONVEX_C35_PROFILE.beam);
    expect(bmodeBeam(CONVEX_C35_PROFILE, { harmonic: true })).toEqual(h);
  });

  it('elevación: la de siempre en fundamental; en armónica, √2 × la de dos vías del par f1² · 2f1', () => {
    for (const r of [5, 40, 80, 150, 220]) {
      expect(elevSigmaMm(r, 80)).toBe(ELEV_SIGMA0_MM * Math.sqrt(1 + ((r - 80) / ELEV_RAYLEIGH_MM) ** 2));
      // de dos vías: 1/σ2² = 1/σtx² + 1/σrx², con σtx = (2σ0/√2)·√(1 + ((r−F)/2zR)²)
      const sRx = ELEV_SIGMA0_MM * Math.sqrt(1 + ((r - 80) / ELEV_RAYLEIGH_MM) ** 2);
      const sTx = ((2 * ELEV_SIGMA0_MM) / Math.SQRT2) * Math.sqrt(1 + ((r - 80) / (2 * ELEV_RAYLEIGH_MM)) ** 2);
      const twoWay = 1 / Math.sqrt(1 / sTx ** 2 + 1 / sRx ** 2);
      expect(elevSigmaMm(r, 80, true)).toBeCloseTo(Math.SQRT2 * twoWay, 12);
    }
    // más gruesa en el foco (+15 %) y más fina lejos de él
    expect(elevSigmaMm(80, 80, true) / elevSigmaMm(80, 80)).toBeCloseTo(1.155, 2);
    expect(elevSigmaMm(180, 80, true)).toBeLessThan(elevSigmaMm(180, 80));
  });

  it('acumulación: 1 en fundamental y desde la referencia; en el campo cercano crece de 0 a 1 sin saltos', () => {
    for (const r of [0, 1, 5, 9.9, 10, 50]) expect(harmonicNearGain(r, false)).toBe(1);
    expect(harmonicNearGain(0, true)).toBe(0);
    expect(harmonicNearGain(HARMONIC.buildUpRefMm, true)).toBe(1);
    expect(harmonicNearGain(HARMONIC.buildUpRefMm - 1e-9, true)).toBeCloseTo(1, 6);
    let prev = -1;
    for (let r = 0; r <= 12; r += 0.25) {
      const g = harmonicNearGain(r, true);
      expect(g).toBeGreaterThanOrEqual(prev);
      expect(g).toBeLessThanOrEqual(1);
      prev = g;
    }
    // solo la piel: ~−7 dB a 1 mm, ~−3 dB a 2 mm y nada desde 4 mm (las líneas de la pared quedan como en fundamental)
    expect(db(harmonicNearGain(1, true))).toBeLessThan(-5);
    expect(db(harmonicNearGain(1, true))).toBeGreaterThan(-9);
    expect(db(harmonicNearGain(2, true))).toBeGreaterThan(-4);
    expect(harmonicNearGain(HARMONIC.buildUpRefMm, true)).toBe(1);
    expect(harmonicNearUniform(false)).toEqual([0, 0]);
    expect(harmonicNearUniform(true)).toEqual([HARMONIC.buildUpMm, HARMONIC.buildUpRefMm]);
  });

  it('el transitorio pierde 20 dB y el ruido sube 3 dB respecto al eco; en fundamental, nada', () => {
    expect(transientGain(false)).toBe(1);
    expect(noiseGain(false)).toBe(1);
    expect(db(transientGain(true))).toBeCloseTo(HARMONIC.fundamentalRejectionDb, 9);
    expect(db(noiseGain(true))).toBeCloseTo(HARMONIC.noiseDb, 9);
  });

  it('el GLSL lleva las mismas fórmulas; el color no lee el haz armónico', () => {
    const flat = (s: string) => s.replace(/\s+/g, ' ');
    expect(flat(LATERAL_PSF_GLSL)).toContain('float tx = uBeamTx.y * length(vec2(uBeamTx.x * F / uBeam.y, uBeam.y * abs(rr - F) / F));');
    for (const frag of [FRAG_RAWFIELD, FRAG_RAWFIELD_STEERED, FRAG_COMPOUND]) {
      expect(flat(frag)).toContain('if (uElevHarmonic < 0.5) return s;');
      // sin pow de base negativa (indefinido en GLSL ES 3.00): (r − F)/(2zR) al cuadrado es 0,25·x²
      expect(flat(frag)).toContain('float sT = 1.41421356 * uElevSigma0 * sqrt(1.0 + 0.25 * x * x);');
      expect(flat(frag)).toContain('return 1.41421356 * s * sT * inversesqrt(s * s + sT * sT);');
      expect(frag).not.toMatch(/pow\(\(r - uElevFocus\)/);
    }
    expect(RECEIVER_GLSL).toContain('uniform float uTransientGain;');
    for (const frag of [FRAG_RAWFIELD, FRAG_RAWFIELD_STEERED]) {
      expect(frag).toContain(RECEIVER_GLSL);
      expect(frag).toContain('TRANSIENT_AMPLITUDE * uTransientGain * exp(');
      expect(frag).not.toMatch(/TRANSIENT_AMPLITUDE \* exp\(/);
    }
    // la acumulación va en la pasada B, al eco del tejido y antes del transitorio y del ruido (no en D)
    for (const [frag, v] of [
      [FRAG_RAWFIELD, 'r'],
      [FRAG_RAWFIELD_STEERED, 's'],
    ] as const) {
      expect(frag).toContain(HARMONIC_GLSL);
      const at = frag.lastIndexOf(`out2 *= harmonicNearGain(${v});`);
      expect(at).toBeGreaterThan(0);
      expect(frag.indexOf('TRANSIENT_AMPLITUDE * uTransientGain', at)).toBeGreaterThan(at);
      expect(frag.indexOf('uNoise * rad', at)).toBeGreaterThan(at);
    }
    expect(FRAG_LATERAL).not.toMatch(/harmonicNearGain|uHarmonicNear/);
    expect(FRAG_COLOR).not.toMatch(/uBeamTx|uElevHarmonic|uTransientGain|uHarmonicNear/);
  });

  it('el comando del equipo la enciende y la apaga, y la normalización la conserva', () => {
    const ctx = { halfSectorRad: 0.5, cMmS: C_RECONSTRUCTION_MM_S };
    const e0 = defaultEquipment();
    expect(e0.bmode.harmonic).toBe(false);
    const on = reduceEquipment(e0, { type: 'harmonic', enabled: true }, ctx);
    expect(on.bmode.harmonic).toBe(true);
    expect(reduceEquipment(on, { type: 'stepDepth', deltaMm: 10 }, ctx).bmode.harmonic).toBe(true);
    expect(reduceEquipment(on, { type: 'harmonic', enabled: false }, ctx).bmode.harmonic).toBe(false);
  });
});

describe('Armónica tisular en el renderizador (WebGL falso)', () => {
  function frameWith(harmonic: boolean) {
    const rec = recordingGl({ width: 320, height: 240 });
    const sim = new Simulator(clonePatient(NORMAL_ADULT), rec.canvas);
    sim.equipment = { ...sim.equipment, bmode: { ...sim.equipment.bmode, compound: false, harmonic } };
    rec.draws.length = 0;
    sim.render();
    const by = (frag: string) => {
      const d = rec.draws.filter((x) => x.frag === frag);
      expect(d.length, 'un dibujo por pasada').toBe(1);
      return d[0].uniforms;
    };
    expect(rec.misuse).toEqual([]);
    return { raw: by(FRAG_RAWFIELD), axial: by(FRAG_AXIAL), lateral: by(FRAG_LATERAL), k: by(FRAG_COMPOUND) };
  }

  it('fundamental: los uniforms de siempre; armónica: haz, elevación, transitorio, ruido, acumulación y ecos parásitos', () => {
    const f = frameWith(false);
    const h = frameWith(true);
    const b = CONVEX_BEAM;
    // fundamental: la emisión es la recepción, sin acumulación, transitorio entero y el ruido de siempre
    for (const u of [f.raw, f.lateral, f.k]) {
      expect(u.uBeamTx).toEqual([b.k * b.lambdaMm, 1]);
      expect(u.uBeam[0]).toBe(b.k * b.lambdaMm);
    }
    expect(f.raw.uElevHarmonic).toEqual([0]);
    expect(f.k.uElevHarmonic).toEqual([0]);
    expect(f.raw.uTransientGain).toEqual([1]);
    expect(f.raw.uNoise).toEqual([RECEIVER_NOISE]);
    expect(f.raw.uHarmonicNear).toEqual([0, 0]);
    expect(f.lateral.uHarmonicNear).toBeUndefined();
    // armónica
    const hb = harmonicBeam(b);
    for (const u of [h.raw, h.lateral, h.k]) {
      expect(u.uBeamTx[0]).toBeCloseTo(hb.k * hb.lambdaTxMm, 12);
      expect(u.uBeamTx[1]).toBe(Math.SQRT1_2);
      expect(u.uBeam[0]).toBeCloseTo(hb.k * hb.lambdaMm, 12);
    }
    expect(h.raw.uElevHarmonic).toEqual([1]);
    expect(h.k.uElevHarmonic).toEqual([1]);
    expect(db(h.raw.uTransientGain[0])).toBeCloseTo(HARMONIC.fundamentalRejectionDb, 9);
    expect(db(h.raw.uNoise[0] / RECEIVER_NOISE)).toBeCloseTo(HARMONIC.noiseDb, 9);
    expect(h.raw.uHarmonicNear).toEqual([HARMONIC.buildUpMm, HARMONIC.buildUpRefMm]);
    // ecos parásitos (decisión 76): pedestal y réplicas bajan lo mismo; el desplazamiento no cambia
    expect(10 * Math.log10(f.lateral.uSidelobe[0] / h.lateral.uSidelobe[0])).toBeCloseTo(CLUTTER.harmonicReductionDb, 9);
    expect(db(f.axial.uReverb[1] / h.axial.uReverb[1])).toBeCloseTo(CLUTTER.harmonicReductionDb, 9);
    expect(h.axial.uReverb[0]).toBe(f.axial.uReverb[0]);
  });
});
