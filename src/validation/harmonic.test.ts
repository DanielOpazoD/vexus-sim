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
    // el haz de la imagen B sigue al conmutador (con la emisión apodizada, la bajada de la frecuencia y, en armónica, el
    // pulso de su banda y la ganancia focal de la fuente p1²: decisión 84); el Doppler no lo lee y conserva el del perfil
    const bF = bmodeBeam(CONVEX_C35_PROFILE, { harmonic: false });
    const bH = bmodeBeam(CONVEX_C35_PROFILE, { harmonic: true });
    const imaging = {
      kTx: 0,
      txConeFraction: 0,
      fNumberTxMin: 0,
      downshiftRxPerMm: 0,
      downshiftTxPerMm: 0,
      axialSigma0Mm: 0,
      focalExponent: 0,
    };
    expect({ ...bF, ...imaging }).toEqual({ ...CONVEX_C35_PROFILE.beam, ...imaging });
    expect({ ...bH, ...imaging }).toEqual({ ...h, ...imaging });
    expect(bF.axialSigma0Mm).toBe(CONVEX_C35_PROFILE.beam.axialSigma0Mm);
    expect(bH.axialSigma0Mm).toBeGreaterThan(bF.axialSigma0Mm);
    // la emisión del armónico baja con la mitad de la pendiente de su eco (la de f1)
    expect(bH.downshiftTxPerMm).toBeCloseTo(bH.downshiftRxPerMm / 2, 15);
    expect(bF.downshiftTxPerMm).toBe(bF.downshiftRxPerMm);
    // fuera del foco la amplitud del eco va como la raíz de la intensidad de la emisión en fundamental y como ella
    // misma en armónica (el armónico nace como p1²)
    expect(bF.focalExponent).toBe(0.5);
    expect(bH.focalExponent).toBe(1);
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
    expect(flat(LATERAL_PSF_GLSL)).toContain(
      'float tx = uBeamTx.y * length(vec2(uBeamTx.x * (1.0 + uBeamTx.z * rr) * F / uBeam.y, uBeam.y * abs(rr - F) / F));',
    );
    expect(flat(LATERAL_PSF_GLSL)).toContain('return vec2(tx, uBeam.x * (1.0 + uBeamTx.w * rr) * rr / max(1.0, dRx));');
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
      const at = frag.lastIndexOf(`out2 *= harmonicNearGain(${v}) * focalGain(${v});`);
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
    const b = bmodeBeam(CONVEX_C35_PROFILE, { harmonic: false });
    // fundamental: la emisión a la λ de la recepción, sin acumulación, transitorio entero y el ruido de siempre; la
    // apodización de la emisión va en el cono c·D y la bajada de la frecuencia en uBeamTx.zw (decisión 84)
    for (const u of [f.raw, f.lateral, f.k]) {
      expect(u.uBeamTx[0]).toBeCloseTo(b.kTx * b.lambdaMm * b.txConeFraction, 12);
      expect(u.uBeamTx.slice(1)).toEqual([1, b.downshiftTxPerMm, b.downshiftRxPerMm]);
      expect(u.uBeam).toEqual([b.k * b.lambdaMm, b.txConeFraction * b.apertureTxMm, b.apertureRxMaxMm, b.fNumberRxMin]);
    }
    expect(f.raw.uElevHarmonic).toEqual([0]);
    expect(f.k.uElevHarmonic).toEqual([0]);
    expect(f.raw.uTransientGain).toEqual([1]);
    expect(f.raw.uNoise).toEqual([RECEIVER_NOISE]);
    expect(f.raw.uHarmonicNear).toEqual([0, 0]);
    expect(f.lateral.uHarmonicNear).toBeUndefined();
    // armónica
    const hb = bmodeBeam(CONVEX_C35_PROFILE, { harmonic: true });
    for (const u of [h.raw, h.lateral, h.k]) {
      expect(u.uBeamTx[0]).toBeCloseTo(hb.kTx * hb.lambdaTxMm * hb.txConeFraction, 12);
      expect(u.uBeamTx.slice(1)).toEqual([Math.SQRT1_2, hb.downshiftTxPerMm, hb.downshiftRxPerMm]);
      expect(u.uBeam[0]).toBeCloseTo(hb.k * hb.lambdaMm, 12);
    }
    // el pulso de la pasada C: el de cada modo, alargado con la profundidad a la pendiente de su eco
    const dz = f.raw.uDepth[0] / 1024;
    for (const [u, beam] of [
      [f.axial, b],
      [h.axial, hb],
    ] as const) {
      expect(u.uSigmaTexels[0]).toBeCloseTo((beam.axialSigma0Mm * (1 + 0.5 * dz * beam.downshiftRxPerMm)) / dz, 9);
      expect(u.uSigmaTexels[1]).toBeCloseTo(beam.axialSigma0Mm * beam.downshiftRxPerMm, 9);
    }
    expect(h.axial.uSigmaTexels[0]).toBeGreaterThan(f.axial.uSigmaTexels[0]);
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
