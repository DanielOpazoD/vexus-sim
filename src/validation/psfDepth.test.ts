import { describe, expect, it } from 'vitest';
import { Simulator } from '../app/simulator';
import { TISSUES, Tissue } from '../anatomy/tissues';
import { NORMAL_ADULT } from '../cases';
import { clonePatient } from '../physiology/patientState';
import {
  AXIAL_SIGMA_MM,
  CONVEX_BEAM,
  axialSigmaMm,
  beamFwhmMm,
  downshiftPerMm,
  focalReferenceFwhmMm,
  lateralFwhmMm,
  pulseSigmaMm,
  txApertureMm,
} from '../ultrasound/beamModel';
import { focalGain, frequencyRatio } from '../ultrasound/beamEcho';
import {
  FRAG_AXIAL,
  FRAG_COLOR,
  FRAG_LATERAL,
  FRAG_RAWFIELD,
  FRAG_RAWFIELD_STEERED,
  FRAG_TRANSMISSION,
  LATERAL_PSF_GLSL,
} from '../ultrasound/shaders/passes.glsl';
import { refractionBeam } from '../ultrasound/aperture';
import { INTERFACE_ECHO_GLSL } from '../ultrasound/interfaceEcho';
import { bmodeBeam, CONVEX_C35_PROFILE } from '../ultrasound/transducerProfile';
import { DEFAULT_BMODE } from '../ultrasound/renderer';
import { recordingGl } from './support/recordingGl';

/**
 * PSF que cambia con la profundidad (decisión 84): la bajada de la frecuencia central del eco, que ensancha la PSF
 * lateral y alarga el pulso; la emisión apodizada con su número F mínimo; y la ganancia focal de la emisión, la banda
 * algo más clara del foco que se mueve con él. Modelo en TS (`beamModel.ts`, `bmodeBeam`), el mismo en el GLSL y su
 * cableado en el renderizador real sobre un WebGL falso. La imagen en GPU la miden el banco y la e2e («foco»).
 */
const FUND = bmodeBeam(CONVEX_C35_PROFILE, { harmonic: false });
const THI = bmodeBeam(CONVEX_C35_PROFILE, { harmonic: true });
const db = (x: number) => 20 * Math.log10(x);

describe('bajada de la frecuencia central con la profundidad (decisión 84)', () => {
  it('la pendiente en la cara es la del espectro gaussiano, −2·β·σ_f² (Samimi y Varghese 2015)', () => {
    // 60 % de banda a 3,5 MHz en 0,5 dB/cm/MHz: −0,092 MHz/cm
    expect(-downshiftPerMm(0.6, 3.5, 0.5) * 3.5 * 10).toBeCloseTo(-0.0916, 3);
    // la κ de la imagen B es la del hígado del modelo (α1 0,601 dB/cm/MHz) con la banda del eco de cada modo
    const alpha = TISSUES[Tissue.Liver].alpha1;
    expect(FUND.downshiftRxPerMm).toBeCloseTo(downshiftPerMm(0.45, 3.5, alpha), 15);
    expect(THI.downshiftRxPerMm).toBeCloseTo(downshiftPerMm(0.35, 3.5, alpha), 15);
    // el Doppler, de banda estrecha, no baja
    expect(CONVEX_BEAM.downshiftRxPerMm).toBe(0);
    expect(CONVEX_C35_PROFILE.beam).toBe(CONVEX_BEAM);
  });

  it('f(r)/f0 baja de forma monótona, sin pasar por cero, y más en fundamental que en armónica', () => {
    let prev = 1;
    for (let r = 0; r <= 300; r += 10) {
      const f = frequencyRatio(r, FUND);
      expect(f).toBeLessThanOrEqual(prev);
      expect(f).toBeGreaterThan(0.4);
      prev = f;
    }
    expect(frequencyRatio(0, FUND)).toBe(1);
    // a 10 cm: 2,97 MHz en fundamental y 3,16 en armónica
    expect(3.5 * frequencyRatio(100, FUND)).toBeCloseTo(2.97, 2);
    expect(3.5 * frequencyRatio(100, THI)).toBeCloseTo(3.16, 2);
  });

  it('el pulso se alarga en la misma proporción; la armónica, de banda más estrecha, lo tiene más largo', () => {
    // en la cara un 15 % más largo; en lo hondo el fundamental, que baja más, casi lo alcanza
    expect(axialSigmaMm(0, THI)).toBeGreaterThan(axialSigmaMm(0, FUND) * 1.1);
    for (const r of [0, 50, 100, 180]) {
      expect(axialSigmaMm(r, FUND) * frequencyRatio(r, FUND)).toBeCloseTo(AXIAL_SIGMA_MM, 12);
      expect(axialSigmaMm(r, THI)).toBeGreaterThan(axialSigmaMm(r, FUND));
    }
    // el filtro de la imagen se calibra con el fundamental: su banda da el pulso de 0,26 mm
    expect(pulseSigmaMm(0.45, 0.45, 3.5)).toBeCloseTo(AXIAL_SIGMA_MM, 12);
    expect(THI.axialSigma0Mm).toBeCloseTo(0.3, 2);
    // FWHM axial: 0,61 → 0,71 mm a 10 cm en fundamental (≤ 0,9 mm de la AAPM para sondas de < 4 MHz)
    expect(2.3548 * axialSigmaMm(100, FUND)).toBeLessThan(0.9);
  });
});

describe('PSF lateral de la imagen B (decisión 84)', () => {
  it('1,5–3 mm a 6–10 cm y crece más allá, dentro de la resolución de 78 convexos (Pye y Ellis 2011)', () => {
    for (const b of [FUND, THI]) {
      for (const r of [60, 80, 100]) {
        expect(lateralFwhmMm(r, 90, b), `${r} mm`).toBeGreaterThanOrEqual(1.4);
        expect(lateralFwhmMm(r, 90, b), `${r} mm`).toBeLessThanOrEqual(3.0);
      }
      let prev = lateralFwhmMm(100, 90, b);
      for (let r = 110; r <= 200; r += 10) {
        const w = lateralFwhmMm(r, 90, b);
        expect(w).toBeGreaterThan(prev);
        prev = w;
      }
      expect(lateralFwhmMm(150, 90, b)).toBeGreaterThan(3.3);
      expect(lateralFwhmMm(180, 90, b)).toBeLessThan(5.5);
    }
    // más ancha que la de antes (sin bajada ni apodización) a partir del foco
    for (const r of [90, 120, 150]) expect(lateralFwhmMm(r, 90, FUND)).toBeGreaterThan(lateralFwhmMm(r, 90, CONVEX_BEAM) * 1.05);
  });

  it('la emisión apodizada tiene su número F mínimo: la apertura baja con el foco somero; el Doppler, siempre 26 mm', () => {
    expect(txApertureMm(90, FUND)).toBe(26);
    expect(txApertureMm(50, FUND)).toBeCloseTo(20, 12);
    expect(txApertureMm(20, THI)).toBeCloseTo(8, 12);
    for (const F of [20, 50, 90, 140]) expect(txApertureMm(F, CONVEX_BEAM)).toBe(26);
    // en el foco la emisión de Hann tiene 2,0·λ·F# (Harris 1978); fuera, la mitad del cono
    expect(beamFwhmMm(90, 90, { ...FUND, downshiftTxPerMm: 0 }).tx).toBeCloseTo((2.0 * FUND.lambdaMm * 90) / 26, 9);
    expect(beamFwhmMm(10, 90, { ...FUND, downshiftTxPerMm: 0 }).tx).toBeGreaterThan(0.5 * 26 * (80 / 90));
  });
});

describe('ganancia focal de la emisión (decisión 84)', () => {
  it('con el foco del preajuste vale 1 en él; su máximo sigue al foco', () => {
    expect(DEFAULT_BMODE.focusMm).toBe(FUND.focalReferenceMm);
    for (const b of [FUND, THI]) {
      expect(focalGain(b.focalReferenceMm, b.focalReferenceMm, b)).toBeCloseTo(1, 12);
      for (const F of [40, 90, 140]) {
        let best = 0;
        let at = 0;
        for (let r = 5; r <= 200; r += 1) {
          const g = focalGain(r, F, b);
          if (g > best) [best, at] = [g, r];
        }
        // el pico queda antes del foco: la λ de la emisión baja con el camino y, con un foco hondo, la recepción (con su
        // apertura máxima desde 65 mm) se ensancha con r (a 122 mm con el foco a 140); la cima es plana, ≤ 0,2 dB sobre
        // el valor en el foco
        expect(at - F, `foco ${F}`).toBeLessThanOrEqual(0);
        expect(at - F, `foco ${F}`).toBeGreaterThanOrEqual(-0.15 * F);
        expect(best / focalGain(F, F, b), `foco ${F}`).toBeLessThan(1.025);
      }
    }
  });

  it('es el eco difuso de haces gaussianos de potencia fija: ∫ I_tx·I_rx a lo ancho, con la fuente p1² en armónica', () => {
    // intensidades gaussianas de FWHM w con la potencia fija (pico ∝ 1/w); en armónica la del armónico va como la de
    // la emisión al cuadrado (pico ∝ 1/w_tx², con la FWHM del haz efectivo, la del modelo)
    const echo2 = (w: { tx: number; rx: number }, harmonic: boolean): number => {
      const g = (x: number, fw: number) => Math.exp((-4 * Math.LN2 * x * x) / (fw * fw));
      const peakTx = harmonic ? 1 / (w.tx * w.tx) : 1 / w.tx;
      let sum = 0;
      for (let x = -80; x <= 80; x += 0.01) sum += peakTx * g(x, w.tx) * (1 / w.rx) * g(x, w.rx) * 0.01;
      return sum;
    };
    for (const [b, harmonic] of [
      [FUND, false],
      [THI, true],
    ] as const) {
      const ref = echo2(focalReferenceFwhmMm(b), harmonic);
      for (const F of [50, 90, 140])
        for (const r of [5, 30, 60, 90, 120, 170]) {
          const want = Math.sqrt(echo2(beamFwhmMm(r, F, b), harmonic) / ref);
          expect(focalGain(r, F, b), `${harmonic ? 'THI' : 'fund'} F ${F} r ${r}`).toBeCloseTo(want, 6);
        }
    }
  });

  it('una banda algo más clara: −3,5 a −5 dB a 2 cm en fundamental y más en armónica, con el foco por defecto', () => {
    expect(db(focalGain(20, 90, FUND))).toBeLessThan(-3.5);
    expect(db(focalGain(20, 90, FUND))).toBeGreaterThan(-5);
    // en armónica la fuente p1² dobla los dB de la emisión, aunque la emisión a f1 enfoque menos
    expect(db(focalGain(20, 90, THI))).toBeLessThan(db(focalGain(20, 90, FUND)) - 0.5);
    expect(db(focalGain(20, 90, THI))).toBeGreaterThan(-6);
    // alrededor del foco (70–110 mm), a menos de 1,5 dB: el hígado a media escala (decisión 53)
    for (const b of [FUND, THI]) for (const r of [70, 90, 110]) expect(db(focalGain(r, 90, b))).toBeGreaterThan(-1.5);
  });

  it('la potencia emitida es fija: un foco somero y estrecho da un pico más claro; uno hondo y ancho, más apagado', () => {
    for (const b of [FUND, THI]) {
      // la banda sigue al foco: 150 mm se aclara con el foco a 140 y 45 mm con el foco a 50 (a 120 mm, no: la cintura del
      // foco hondo, a F/5,4, es tan ancha como el haz del foco por defecto 30 mm después del suyo)
      expect(focalGain(150, 140, b)).toBeGreaterThan(focalGain(150, 90, b));
      expect(focalGain(45, 50, b)).toBeGreaterThan(focalGain(45, 90, b));
      // y lo que queda lejos del foco nuevo se oscurece
      expect(focalGain(40, 140, b)).toBeLessThan(focalGain(40, 90, b));
      expect(focalGain(150, 50, b)).toBeLessThan(focalGain(150, 90, b));
      // el pico, con la cintura de cada foco: F/2,5 a 50 mm (más estrecho) y F/5,4 a 140 mm (más ancho)
      expect(focalGain(50, 50, b)).toBeGreaterThan(1);
      expect(focalGain(140, 140, b)).toBeLessThan(1);
    }
  });

  it('el GLSL lleva la misma PSF, la misma ganancia y el mismo pulso que el modelo', () => {
    const flat = (s: string) => s.replace(/\s+/g, ' ');
    const psf = flat(LATERAL_PSF_GLSL);
    expect(psf).toContain('uniform vec4 uBeamTx;');
    expect(psf).toContain(
      'float tx = uBeamTx.y * length(vec2(uBeamTx.x * (1.0 + uBeamTx.z * rr) * F / uBeam.y, uBeam.y * abs(rr - F) / F));',
    );
    expect(psf).toContain('return vec2(tx, uBeam.x * (1.0 + uBeamTx.w * rr) * rr / max(1.0, dRx));');
    expect(psf).toContain('uniform vec4 uFocus;');
    expect(psf).toContain('float F = max(10.0, uFocus.x);');
    expect(psf).toContain(
      'float focalGain(float r) { vec2 w = beamFwhm(r); return pow(uFocus.y / w.x, uFocus.z) * sqrt(uFocus.w / length(w)); }',
    );
    expect(psf).toContain('float echoFrequency(float r) { return 1.0 / (1.0 + uBeamTx.w * max(r, 0.0)); }');
    expect(flat(FRAG_AXIAL)).toContain('float sT = max(0.6, uSigmaTexels.x + uSigmaTexels.y * row);');
    // la coherencia de curvatura de las caras, con el número de onda del eco en el lateral y en la elevación
    const iface = flat(INTERFACE_ECHO_GLSL);
    expect(iface).toContain('float k = uIfaceK0 * echoFrequency(r);');
    expect(iface).toContain('float al = 2.0 * k * sl * sl * kl;');
    expect(iface).toContain('float ae = 2.0 * k * sE * sE * ke;');
    // la ganancia focal va al eco de la pasada B, en las dos miradas; D y el color no la llevan
    expect(FRAG_RAWFIELD).toContain('out2 *= harmonicNearGain(r) * focalGain(r);');
    expect(FRAG_RAWFIELD_STEERED).toContain('out2 *= harmonicNearGain(s) * focalGain(s);');
    const mainOf = (src: string): string => src.slice(src.lastIndexOf('\nvoid main() {'));
    expect(mainOf(FRAG_LATERAL)).not.toMatch(/focalGain\(/);
    expect(FRAG_COLOR).not.toMatch(/focalGain|uBeamTx/);
  });
});

describe('cableado en el renderizador (WebGL falso, decisión 84)', () => {
  function frameAt(focusMm: number, harmonic: boolean) {
    const rec = recordingGl({ width: 320, height: 240 });
    const sim = new Simulator(clonePatient(NORMAL_ADULT), rec.canvas);
    sim.equipment = { ...sim.equipment, bmode: { ...sim.equipment.bmode, compound: false, harmonic, focusMm } };
    rec.draws.length = 0;
    sim.render();
    const by = (frag: string) => rec.draws.find((x) => x.frag === frag)!.uniforms;
    expect(rec.misuse).toEqual([]);
    return {
      trans: by(FRAG_TRANSMISSION),
      raw: by(FRAG_RAWFIELD),
      axial: by(FRAG_AXIAL),
      lateral: by(FRAG_LATERAL),
      depth: sim.bmode.depthMm,
    };
  }

  it('el cono y la penumbra de la emisión siguen a la apertura del foco y el pulso a la profundidad de cada fila', () => {
    for (const harmonic of [false, true]) {
      const b = harmonic ? THI : FUND;
      for (const F of [50, 90]) {
        const f = frameAt(F, harmonic);
        for (const u of [f.raw, f.lateral]) {
          // el foco y, con el foco del preajuste, las FWHM de referencia de la ganancia focal y el exponente n − ½
          const ref = focalReferenceFwhmMm(b);
          expect(u.uFocus[0]).toBe(F);
          expect(u.uFocus[1]).toBeCloseTo(ref.tx, 12);
          expect(u.uFocus[2]).toBe(harmonic ? 0.5 : 0);
          expect(u.uFocus[3]).toBeCloseTo(Math.hypot(ref.tx, ref.rx), 12);
          expect(u.uBeam[1]).toBeCloseTo(b.txConeFraction * txApertureMm(F, b), 12);
          expect(u.uBeamTx[0]).toBeCloseTo(b.kTx * b.lambdaTxMm * b.txConeFraction, 12);
          expect(u.uBeamTx[3]).toBeCloseTo(b.downshiftRxPerMm, 15);
        }
        // la penumbra de la pasada A, con la apertura de la emisión de ese foco (20 mm con el foco a 50), y su refracción de
        // las luces (decisión 86), con el foco, las manchas y la difracción del haz de ese modo
        expect(f.trans.uAperture[0]).toBeCloseTo(txApertureMm(F, b), 12);
        expect(f.trans.uAperture.slice(1, 3)).toEqual([b.apertureRxMaxMm, b.fNumberRxMin]);
        const refr = refractionBeam(b, F);
        expect(f.trans.uAperture[3]).toBeCloseTo(refr.cRxMm, 6);
        [F, refr.txScale, refr.cTxMm, refr.diffractionMm].forEach((v, i) => expect(f.trans.uRefr[i]).toBeCloseTo(v, 6));
        [refr.kappaTx, refr.kappaRx].forEach((v, i) => expect(f.trans.uRefrK[i]).toBeCloseTo(v, 9));
        expect(refr.txScale).toBe(harmonic ? Math.SQRT1_2 : 1);
        // σ de la fila i = x + y·i, en texeles: la de axialSigmaMm en el centro de cada fila
        const dz = f.depth / 1024;
        const [x, y] = f.axial.uSigmaTexels;
        for (const i of [0, 511, 1023]) expect(x + y * i).toBeCloseTo(axialSigmaMm((i + 0.5) * dz, b) / dz, 9);
      }
    }
  });
});
