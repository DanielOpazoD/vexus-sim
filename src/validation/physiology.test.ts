// @tier slow
import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import { PhysiologyEngine } from '../physiology/engine';
import { clonePatient, type PatientState } from '../physiology/patientState';
import { classifyVexusC } from '../vexus/classification';
import { measurePhysiologyTruth } from '../vexus/measurements';

function run(patient: PatientState, seconds: number): PhysiologyEngine {
  const scene = new AnatomyScene(patient);
  const engine = new PhysiologyEngine(patient, scene.vesselAreas(), { historySeconds: seconds + 1 });
  const steps = Math.round(seconds / engine.clock.dt);
  for (let i = 0; i < steps; i++) engine.step();
  return engine;
}

/** Estado intermedio: interpolación lineal de los campos numéricos (la semilla y el resto, de `a`). */
function interpolate(a: PatientState, b: PatientState, t: number): PatientState {
  const mix = (x: unknown, y: unknown, key: string): unknown => {
    if (typeof x === 'number' && typeof y === 'number') return key === 'seed' ? x : x + (y - x) * t;
    if (x && y && typeof x === 'object' && typeof y === 'object') {
      const o = x as Record<string, unknown>;
      for (const k of Object.keys(o)) o[k] = mix(o[k], (y as Record<string, unknown>)[k], k);
    }
    return x;
  };
  return mix(clonePatient(a), b, '') as PatientState;
}

describe('Fisiología: el VExUS emerge de la señal, no se asigna (guía §5, §21)', () => {
  it('el PatientState no contiene ningún campo que sea un grado VExUS', () => {
    const keys = JSON.stringify(NORMAL_ADULT).toLowerCase();
    expect(keys.includes('vexus')).toBe(false);
    expect(keys.includes('grade')).toBe(false);
  });

  it('adulto sano: S > D, PF < 30 %, VCI < 20 mm → grado 0 emergente', () => {
    const e = run(NORMAL_ADULT, 14);
    const m = measurePhysiologyTruth(e, { fromT: 5, toT: 14 });
    expect(m.beats).toBeGreaterThan(6);
    expect(m.hvS).toBeGreaterThan(m.hvD);
    expect(m.hvS).toBeGreaterThan(18);
    expect(m.hvA).toBeLessThan(0); // reversión auricular presente
    expect(m.portalPF).toBeLessThan(30);
    expect(m.ivcMaxMm).toBeLessThan(20);
    expect(m.ivcCollapse).toBeGreaterThan(0.25); // respiración tranquila colapsa la VCI
    const g = classifyVexusC({
      ivcMaxDiameterMm: m.ivcMaxMm,
      hepatic: m.hepaticPattern,
      portalPulsatilityFraction: m.portalPF,
      renal: 'not-assessed',
    });
    expect(g.grade).toBe(0);
  });

  it('congestión grave: S invertida, PF ≥ 50 %, VCI ≥ 20 mm → grado 3 con el MISMO motor', () => {
    const e = run(SEVERE_CONGESTION, 14);
    const m = measurePhysiologyTruth(e, { fromT: 5, toT: 14 });
    expect(m.hvS).toBeLessThan(0);
    expect(m.hepaticPattern).toBe('severe');
    expect(m.portalPF).toBeGreaterThanOrEqual(50);
    expect(m.ivcMaxMm).toBeGreaterThanOrEqual(20);
    expect(m.ivcCollapse).toBeLessThan(0.25);
    const g = classifyVexusC({
      ivcMaxDiameterMm: m.ivcMaxMm,
      hepatic: m.hepaticPattern,
      portalPulsatilityFraction: m.portalPF,
      renal: 'not-assessed',
    });
    expect(g.grade).toBe(3);
    // Plétora visible: suprahepáticas ≥ 1,5× el radio basal (12–15 mm de diámetro en el
    // curso medio) frente a ≈ 1× en el sano; el hígado congestivo es un 10 % mayor.
    expect(e.sample.hvRadiusScale).toBeGreaterThan(1.5);
    expect(run(NORMAL_ADULT, 6).sample.hvRadiusScale).toBeLessThan(1.05);
    const sevScene = new AnatomyScene(SEVERE_CONGESTION);
    const normScene = new AnatomyScene(NORMAL_ADULT);
    expect(sevScene.liver.radii[2] / normScene.liver.radii[2]).toBeCloseTo(1.1, 9);
    // la cara visceral y el borde bajan (decisión 72)
    expect(sevScene.visceralFace.inner[0]).toBeLessThan(normScene.visceralFace.inner[0]);
    expect(sevScene.visceralFace.anterior[0]).toBeLessThan(normScene.visceralFace.anterior[0]);
  });

  // Entre el sano y el grave la vena interlobar late (mínimo ≈ 25 % del máximo) sin llegar a la
  // línea de base: en el VExUS eso sigue siendo flujo continuo. Con la regla antigua (mínimo ≥ 30 %
  // del máximo) salía bifásico, y el patrón cambiaba sin que el flujo se interrumpiera.
  it('congestión intermedia: flujo renal pulsátil que no se interrumpe → continuo', () => {
    const e = run(interpolate(NORMAL_ADULT, SEVERE_CONGESTION, 0.6), 16);
    const m = measurePhysiologyTruth(e, { fromT: 6, toT: 16 });
    expect(m.rvMin / Math.max(m.rvS, m.rvD)).toBeLessThan(0.3);
    expect(m.rvMin).toBeGreaterThan(3); // medido: 4,5 cm/s (mínimo resoluble)
    expect(m.renalPattern).toBe('continuous');
    // más cerca del grave el mínimo sí toca la línea de base (medido −0,5 cm/s): hay interrupción
    const late = measurePhysiologyTruth(run(interpolate(NORMAL_ADULT, SEVERE_CONGESTION, 0.9), 16), { fromT: 6, toT: 16 });
    expect(late.rvMin).toBeLessThan(1);
    expect(late.renalPattern).not.toBe('continuous');
  });

  it('la presión media de AD declarada se conserva (ondas centradas)', () => {
    const e = run(NORMAL_ADULT, 12);
    const s = e.samples.filter((x) => x.t > 4);
    const mean = s.reduce((a, x) => a + x.pRa, 0) / s.length;
    // media al final de espiración ± modulación pleural media (< 1,5 mmHg)
    expect(Math.abs(mean - NORMAL_ADULT.rapMeanMmHg)).toBeLessThan(1.5);
  });

  it('conservación de caudal en régimen: Q_hv ≈ Q_pv + Q_ha', () => {
    const e = run(NORMAL_ADULT, 12);
    const m = measurePhysiologyTruth(e, { fromT: 4, toT: 12 });
    expect(Math.abs(m.qHvMean - (m.qPvMean + m.qHaMean)) / m.qHvMean).toBeLessThan(0.05);
  });

  it('ECG y ondas comparten reloj: el pico S ocurre en la sístole mecánica tras cada R', () => {
    const e = run(NORMAL_ADULT, 10);
    const samples = e.samples.filter((x) => x.t > 3);
    const beats = new Set(samples.map((x) => x.beatIndex));
    let checked = 0;
    for (const b of beats) {
      const beat = e.rhythm.currentBeat(samples.find((x) => x.beatIndex === b)!.lastR + 1e-6);
      if (beat.tR + beat.rr > samples[samples.length - 1].t) continue;
      const inBeat = samples.filter((x) => x.t >= beat.tR && x.t < beat.tR + beat.rr);
      const sysMax = inBeat
        .filter((x) => x.t < beat.tV)
        .reduce((best, x) => (x.velocities.hvRight > best.velocities.hvRight ? x : best), inBeat[0]);
      const delay = sysMax.t - beat.tR;
      expect(delay).toBeGreaterThan(0.05);
      expect(delay).toBeLessThan(0.36);
      checked++;
    }
    expect(checked).toBeGreaterThan(4);
  });

  it('AMS en ayunas: trifásica de alta resistencia (IR 0,85–0,9, reflujo protodiastólico breve); el celíaco, de baja', () => {
    // Antes la AMS tenía el pulso de baja resistencia de la hepática (IR ≈ 0,7 sin reflujo diastólico): el de después de
    // comer, no el de un examen en ayunas (decisión 69, revisión)
    const e = run(NORMAL_ADULT, 10);
    const samples = e.samples.filter((x) => x.t > 3);
    const dt = e.clock.dt;
    const beats = new Set(samples.map((x) => x.beatIndex));
    let checked = 0;
    for (const b of beats) {
      const beat = e.rhythm.currentBeat(samples.find((x) => x.beatIndex === b)!.lastR + 1e-6);
      if (beat.tR < samples[0].t || beat.tR + beat.rr > samples[samples.length - 1].t) continue;
      const inBeat = samples.filter((x) => x.t >= beat.tR && x.t < beat.tR + beat.rr);
      const wave = (id: 'sma' | 'celiacTrunk') => {
        const v = inBeat.map((x) => x.velocities[id]);
        const peak = Math.max(...v);
        const edv = v[v.length - 1];
        return { peak, edv, min: Math.min(...v), ri: (peak - edv) / peak, reversedS: v.filter((x) => x < 0).length * dt };
      };
      const sma = wave('sma');
      expect(sma.ri, `latido ${b}`).toBeGreaterThan(0.85);
      expect(sma.ri, `latido ${b}`).toBeLessThan(0.92);
      expect(sma.edv).toBeGreaterThan(0);
      expect(sma.min).toBeLessThan(-0.1 * sma.peak);
      expect(sma.reversedS).toBeGreaterThan(0.04);
      expect(sma.reversedS).toBeLessThan(0.15);
      const celiac = wave('celiacTrunk');
      expect(celiac.min).toBeGreaterThan(0);
      expect(celiac.ri).toBeLessThan(0.75);
      checked++;
    }
    expect(checked).toBeGreaterThan(4);
  });

  it('la apnea espiratoria elimina la variación respiratoria de la VCI sin cambiar la PAD media', () => {
    const apnea = clonePatient(NORMAL_ADULT);
    apnea.respiratoryPattern = 'apnea-expiratory';
    const e = run(apnea, 12);
    const m = measurePhysiologyTruth(e, { fromT: 4, toT: 12 });
    expect(m.ivcCollapse).toBeLessThan(0.15);
  });

  it('determinismo: mismo PatientState + semilla → misma trayectoria', () => {
    const a = run(NORMAL_ADULT, 6);
    const b = run(clonePatient(NORMAL_ADULT), 6);
    const sa = a.sample;
    const sb = b.sample;
    expect(sa.t).toBe(sb.t);
    expect(sa.pRa).toBe(sb.pRa);
    expect(sa.velocities.hvRight).toBe(sb.velocities.hvRight);
    expect(sa.ivc.dApMm).toBe(sb.ivc.dApMm);
    expect(sa.ecgMv).toBe(sb.ecgMv);
  });

  it('otra semilla cambia la variabilidad RR pero no la fisiología media', () => {
    const other = clonePatient(NORMAL_ADULT);
    other.seed = 7;
    const a = run(NORMAL_ADULT, 10);
    const b = run(other, 10);
    const ma = measurePhysiologyTruth(a, { fromT: 3, toT: 10 });
    const mb = measurePhysiologyTruth(b, { fromT: 3, toT: 10 });
    expect(Math.abs(ma.hvS - mb.hvS)).toBeLessThan(4);
    expect(a.sample.lastR).not.toBe(b.sample.lastR);
  });
});

describe('Pared viscoelástica de la VCI (decisión 73)', () => {
  /** Componentes del diámetro AP en respiración tranquila: respiratoria (media de un latido) y cardíaca (residuo). */
  const components = (patient: PatientState): { resp: number; card: number; max: number; meanWall: number; meanVol: number } => {
    const scene = new AnatomyScene(patient);
    const e = new PhysiologyEngine(patient, scene.vesselAreas(), { historySeconds: 20 });
    const d: number[] = [];
    let meanWall = 0;
    let meanVol = 0;
    for (let t = 0; t < 18; t += e.clock.dt) {
      const s = e.step();
      if (t < 6) continue;
      d.push(s.ivc.dApMm);
      meanWall += s.ivc.dEqMm;
      meanVol += e.network.last.ivcDiameterEqMm;
    }
    const w = Math.max(1, Math.round(e.sample.rr / e.clock.dt));
    const smooth = d.map((_, i) => {
      let a = 0;
      let n = 0;
      for (let j = Math.max(0, i - (w >> 1)); j < Math.min(d.length, i + (w >> 1)); j++) {
        a += d[j];
        n++;
      }
      return a / n;
    });
    const inner = smooth.slice(w, smooth.length - w);
    const resid = d.map((x, i) => x - smooth[i]).slice(w, d.length - w);
    return {
      resp: Math.max(...inner) - Math.min(...inner),
      card: Math.max(...resid) - Math.min(...resid),
      max: Math.max(...d),
      meanWall: meanWall / d.length,
      meanVol: meanVol / d.length,
    };
  };

  it('el latido mueve la pared ≤ 1,5 mm (antes 2,9 en el sano y 3,5 en la congestión grave) y la respiración no cambia', () => {
    const n = components(NORMAL_ADULT);
    const g = components(SEVERE_CONGESTION);
    expect(n.card).toBeLessThanOrEqual(1.5);
    expect(g.card).toBeLessThanOrEqual(1.5);
    // la colapsabilidad respiratoria del sano sigue en ≈ 24 % y la plétora casi fija (≈ 3 %)
    expect(n.resp / n.max).toBeGreaterThan(0.2);
    expect(g.resp / g.max).toBeLessThan(0.06);
    // la pared sigue al volumen: misma media
    for (const c of [n, g]) expect(Math.abs(c.meanWall - c.meanVol)).toBeLessThan(0.2);
  });
});
