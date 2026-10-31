import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { AF_MODERATE_CONGESTION, SEVERE_CONGESTION } from '../cases';
import { velocityFromShiftMmS } from '../core/units';
import { measureObservedHepatic } from '../doppler/spectralMeasure';
import { PhysiologyEngine } from '../physiology/engine';
import { hepaticFlowShares } from '../physiology/vessels';
import { classifyVexusC } from '../vexus/classification';
import { measurePhysiologyTruth, S_REVERSAL_FLOOR_CMS } from '../vexus/measurements';

/**
 * La escala de velocidad suprahepática (decisión 299) no puede cambiar la verdad de la vena derecha: el suelo de la S invertida la sigue, y la inversión
 * real que queda lejos del borde de la banda sigue midiéndose. Los testigos son los de la revisión adversarial de esa decisión.
 */
describe('la calibración de la velocidad suprahepática no cambia la verdad de la vena derecha', () => {
  it('el suelo de la S invertida es el mismo caudal retrógrado que los 2 cm/s de antes', () => {
    const shares = hepaticFlowShares(new AnatomyScene(SEVERE_CONGESTION).vesselAreas());
    expect(S_REVERSAL_FLOOR_CMS).toBeCloseTo((2 * shares.hvRight) / 0.45, 3);
  });

  it.each([
    ['FA tras bolo de 500 mL, apnea', AF_MODERATE_CONGESTION, 'apnea-expiratory', { kind: 'bolus', volumeMl: 500 }, 30],
    ['FA tras bolo de 500 mL, respirando', AF_MODERATE_CONGESTION, 'quiet', { kind: 'bolus', volumeMl: 500 }, 30],
    ['grave tras diuresis de 250 mL, apnea', SEVERE_CONGESTION, 'apnea-expiratory', { kind: 'diuresis', volumeMl: 250 }, 70],
  ] as const)('%s: la inversión apreciable se conserva y el grado sigue en 3', (_, base, respiratoryPattern, intervention, at) => {
    const patient = { ...structuredClone(base), respiratoryPattern };
    const engine = new PhysiologyEngine(patient, new AnatomyScene(patient).vesselAreas(), { historySeconds: 12 });
    while (engine.clock.t < 10 - 1e-9) engine.step();
    engine.intervene(intervention);
    while (engine.clock.t < at - 1e-9) engine.step();
    const m = measurePhysiologyTruth(engine, { fromT: at - 8, toT: at });
    expect(m.hepaticPattern).toBe('severe');
    expect(m.hvS).toBeLessThan(0);
    const grade = classifyVexusC({
      ivcMaxDiameterMm: m.ivcMaxMm,
      hepatic: m.hepaticPattern,
      portalPulsatilityFraction: m.portalPF,
      renal: m.renalPattern,
    });
    expect(grade.grade).toBe(3);
  });
});

describe('una onda en el último 15 % de la banda se excluye por prudencia; una S retrógrada real lejos del borde se mide', () => {
  const N = 128;
  const prfHz = 1600;
  const f0Hz = 2.5e6;
  const beats = Array.from({ length: 4 }, (_, i) => ({
    index: i,
    tR: i,
    rr: 1,
    tP: i - 0.16,
    tAtrialContraction: i + 0.98,
    tX: i + 0.2,
    tV: i + 0.45,
    tY: i + 0.62,
    tTend: i + 0.5,
    atrialAmplitude: 0.8,
  }));
  // Espectro estrecho y sin plegar: S en `fraction` de Nyquist hacia el lado retrógrado y D en +0,3
  const capture = (fraction: number, angle = 0, d = 0.3) => {
    const columns = Array.from({ length: 800 }, (_, i) => {
      const t = i / 200;
      const phase = t % 1;
      const f = ((phase >= 0.1 && phase <= 0.49 ? -fraction : d) * prfHz) / 2;
      const powerDb = Float32Array.from({ length: N }, (_, k) => {
        const binHz = (k / N - 0.5) * prfHz;
        return 10 * Math.log10(1e-8 + 10 ** -1.5 * Math.exp(-0.5 * ((binHz - f) / ((prfHz / N) * 1.2)) ** 2));
      });
      return { t, prfHz, powerDb };
    });
    return measureObservedHepatic(columns, beats, { f0Hz, angleCorrectionRad: angle, invert: false, fftSize: N, wallFilterHz: 20 })!;
  };
  const nyquist = (angle: number) => velocityFromShiftMmS(prfHz / 2, f0Hz, angle) / 10;

  it.each([0.3, 0.6, 0.75])('S retrógrada a %s de Nyquist: se mide y es grave', (fraction) => {
    for (const angle of [0, Math.PI / 3]) {
      const m = capture(fraction, angle);
      expect(m.quality.issue).toBeNull();
      expect(m.pattern).toBe('severe');
      expect(m.sPeak / nyquist(angle)).toBeCloseTo(-fraction, 1);
    }
  });

  // Señales estrechas y sin plegar: el estimador no las separa de un plegado, así que pide subir la escala. No prueba que se hayan plegado.
  it.each([
    ['S retrógrada a −0,825 de Nyquist', 0.825, 0.3],
    ['S retrógrada a −0,9 de Nyquist', 0.9, 0.3],
    ['D real a +0,825 de Nyquist', 0.3, 0.825],
  ])('%s: exclusión prudente, sin dar el pico por bueno', (_, s, d) => {
    expect(capture(s, 0, d).quality.issue).toBe('aliasing');
  });
});
