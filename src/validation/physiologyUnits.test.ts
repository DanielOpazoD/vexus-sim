import { describe, expect, it } from 'vitest';
import { AF_MODERATE_CONGESTION, NORMAL_ADULT } from '../cases';
import { extremeInWindow } from '../core/series';
import { clonePatient } from '../physiology/patientState';
import { RespiratoryModel } from '../physiology/respiratory';
import { RhythmGenerator, type Beat } from '../physiology/rhythm';
import {
  VenousNetwork,
  defaultNetworkParams,
  hepaticPressureFromVolume,
  hepaticVolumeFromPressure,
  ivcDiameterFromPtm,
  ivcPtmFromDiameter,
  type NetworkOutputs,
} from '../physiology/venousNetwork';
import { beatWindows, systolicPeak } from '../vexus/measurements';

/**
 * Unidades fisiológicas en el nivel rápido (sin motor completo): contrato
 * temporal del ritmo, respiración, conservación de masa de la red venosa y las
 * ventanas de medida. Complementa a `physiology.test.ts` (lento, emergente).
 */
describe('Ritmo', () => {
  it('rr es el intervalo hasta la SIGUIENTE R: tR(i+1) − tR(i) = rr(i)', () => {
    const r = new RhythmGenerator(NORMAL_ADULT, NORMAL_ADULT.seed ^ 0x51a7);
    const seen = new Map<number, Beat>();
    for (let t = 0; t <= 180; t += 0.25) for (const b of r.beatsAround(t)) seen.set(b.index, b);
    const bs = [...seen.values()].sort((a, b) => a.index - b.index);
    expect(bs.length).toBeGreaterThan(150);
    for (let i = 0; i + 1 < bs.length; i++) {
      expect(bs[i + 1].tR - bs[i].tR).toBeCloseTo(bs[i].rr, 9);
      expect(bs[i + 1].tR).toBeGreaterThan(bs[i].tR);
      expect(bs[i].rr).toBeGreaterThan(0.6 * r.nominalRR());
    }
    const rrs = bs.map((b) => b.rr);
    const mean = rrs.reduce((a, b) => a + b, 0) / rrs.length;
    const sd = Math.sqrt(rrs.reduce((a, b) => a + (b - mean) ** 2, 0) / rrs.length);
    expect(Math.abs(mean / (60 / 70) - 1)).toBeLessThan(0.01);
    expect(sd / mean).toBeGreaterThan(0.02);
    expect(sd / mean).toBeLessThan(0.045);
    // determinismo bit a bit (generadores frescos: el historial antiguo se olvida)
    const ra = new RhythmGenerator(NORMAL_ADULT, NORMAL_ADULT.seed ^ 0x51a7);
    const rb = new RhythmGenerator(clonePatient(NORMAL_ADULT), NORMAL_ADULT.seed ^ 0x51a7);
    expect(rb.beatsAround(30).map((b) => b.rr)).toEqual(ra.beatsAround(30).map((b) => b.rr));
    expect(ra.beatsAround(30).length).toBeGreaterThan(0);
  });

  it('el ECG tiene el pico R en tR, la T tras ella y la P antes; sin función auricular no hay P', () => {
    const r = new RhythmGenerator(NORMAL_ADULT, 3);
    const b = r.beatsAround(10).find((x) => x.tR > 9)!;
    let tMax = b.tR - 0.3;
    for (let t = b.tR - 0.3; t <= b.tR + 0.6; t += 0.0002) if (r.ecg(t) > r.ecg(tMax)) tMax = t;
    expect(Math.abs(tMax - b.tR)).toBeLessThan(0.003);
    expect(r.ecg(b.tR)).toBeGreaterThan(0.9);
    let tT = b.tR + 0.2;
    for (let t = b.tR + 0.2; t <= b.tR + 0.45; t += 0.0005) if (r.ecg(t) > r.ecg(tT)) tT = t;
    expect(r.ecg(tT)).toBeGreaterThan(0.2);
    expect(r.ecg(tT)).toBeLessThan(0.4);
    let pMax = 0;
    for (let t = b.tP - 0.05; t <= b.tP + 0.09; t += 0.0005) pMax = Math.max(pMax, r.ecg(t));
    expect(pMax).toBeGreaterThan(0.08);
    const noAtrium = new RhythmGenerator({ ...clonePatient(NORMAL_ADULT), atrialFunction: 0 }, 3);
    const b2 = noAtrium.beatsAround(10).find((x) => x.tR > 9)!;
    let p2 = 0;
    for (let t = b2.tP - 0.05; t <= b2.tP + 0.09; t += 0.0005) p2 = Math.max(p2, Math.abs(noAtrium.ecg(t)));
    expect(p2).toBeLessThan(0.01);
  });
});

describe('Fibrilación auricular', () => {
  it('RR irregular (CV ≈ 22 %), sin P ni contracción auricular, ondas f en la línea de base', () => {
    const r = new RhythmGenerator(AF_MODERATE_CONGESTION, 11);
    const seen = new Map<number, Beat>();
    for (let t = 0; t <= 120; t += 0.25) for (const b of r.beatsAround(t)) seen.set(b.index, b);
    const bs = [...seen.values()].sort((a, b) => a.index - b.index);
    const rrs = bs.map((b) => b.rr);
    const mean = rrs.reduce((a, b) => a + b, 0) / rrs.length;
    const sd = Math.sqrt(rrs.reduce((a, b) => a + (b - mean) ** 2, 0) / rrs.length);
    expect(Math.abs(mean / (60 / 96) - 1)).toBeLessThan(0.06);
    expect(sd / mean).toBeGreaterThan(0.15);
    expect(sd / mean).toBeLessThan(0.3);
    expect(Math.min(...rrs)).toBeGreaterThanOrEqual(0.3); // refractariedad del nodo AV
    for (const b of bs) {
      expect(Number.isNaN(b.tP)).toBe(true);
      expect(Number.isNaN(b.tAtrialContraction)).toBe(true);
      expect(b.atrialAmplitude).toBe(0);
      expect(b.rr).toBeGreaterThan(0);
    }
    // ondas f: la línea de base entre T y el siguiente QRS no es plana pero es pequeña
    const b = bs.find((x) => x.tR > 10 && x.rr > 0.7)!;
    let fMax = 0;
    for (let t = b.tR + 0.5; t < b.tR + b.rr - 0.06; t += 0.001) fMax = Math.max(fMax, Math.abs(r.ecg(t)));
    expect(fMax).toBeGreaterThan(0.02);
    expect(fMax).toBeLessThan(0.1);
    // la ventana auricular es NaN y una medición sobre ella devuelve NaN (no el mínimo global)
    const w = beatWindows(b);
    expect(Number.isNaN(w.aWindow[0])).toBe(true);
    expect(
      Number.isNaN(
        extremeInWindow(
          [{ t: b.tR + 0.1, v: -9 }],
          w.aWindow,
          (x) => x.t,
          (x) => x.v,
          (v) => -v,
        ),
      ),
    ).toBe(true);
  });
});

describe('Respiración', () => {
  it('es C¹, recorre 40/50/10 % del ciclo y las apneas congelan volumen, diafragma y pleura', () => {
    const m = new RespiratoryModel(clonePatient(NORMAL_ADULT));
    const T = 60 / NORMAL_ADULT.respiratoryRateMin;
    expect(m.sample(0).volume).toBe(0);
    expect(m.sample(0.4 * T).volume).toBeCloseTo(1, 9);
    expect(m.sample(0.95 * T).volume).toBe(0);
    expect(m.sample(0.95 * T).volumeRate).toBe(0);
    for (let i = 0; i < 400; i++) {
      const t = -10 + (20 * i) / 399;
      const s = m.sample(t);
      expect(s.volume).toBeGreaterThanOrEqual(0);
      expect(s.volume).toBeLessThanOrEqual(1);
      expect(s.phase).toBeGreaterThanOrEqual(0);
      expect(s.phase).toBeLessThan(1);
      expect(s.diaphragmCaudalMm).toBeCloseTo(m.excursionMm() * s.volume, 9);
      // derivada numérica ≈ volumeRate (continuidad C¹)
      const dv = (m.sample(t + 1e-4).volume - m.sample(t - 1e-4).volume) / 2e-4;
      expect(Math.abs(dv - s.volumeRate)).toBeLessThan(1e-3);
    }
    expect(m.sample(0.2 * T).volumeRate).toBeCloseTo((0.5 * Math.PI) / (0.4 * T), 6);
    expect(m.excursionMm()).toBe(10);
    expect(new RespiratoryModel({ ...clonePatient(NORMAL_ADULT), respiratoryPattern: 'deep' }).excursionMm()).toBe(30);
    const apE = new RespiratoryModel({ ...clonePatient(NORMAL_ADULT), respiratoryPattern: 'apnea-expiratory' });
    const apI = new RespiratoryModel({ ...clonePatient(NORMAL_ADULT), respiratoryPattern: 'apnea-inspiratory' });
    for (let t = 0; t < 10; t += 0.2) {
      const e = apE.sample(t);
      expect(e.volume).toBe(0);
      expect(e.volumeRate).toBe(0);
      expect(e.diaphragmCaudalMm).toBe(0);
      expect(e.pleuralMmHg).toBeCloseTo(apE.pleuralAtEndExpiration(), 12);
      const i = apI.sample(t);
      expect(i.volume).toBe(1);
      expect(i.diaphragmCaudalMm).toBe(30);
      expect(i.diaphragmVelocityMmS).toBe(0);
    }
    // PEEP: solo cuenta en ventilación con presión positiva (40 % transmitido)
    const pp = new RespiratoryModel({ ...clonePatient(NORMAL_ADULT), ventilation: 'positive-pressure', peepCmH2O: 10 });
    expect(pp.pleuralAtEndExpiration() - m.pleuralAtEndExpiration()).toBeCloseTo(10 * 0.73556 * 0.4, 6);
    const spontPeep = new RespiratoryModel({ ...clonePatient(NORMAL_ADULT), peepCmH2O: 10 });
    expect(spontPeep.pleuralAtEndExpiration()).toBe(m.pleuralAtEndExpiration());
  });
});

describe('Red venosa', () => {
  it('en régimen estacionario cada nodo conserva la masa y la geometría de la VCI es coherente', () => {
    const k = defaultNetworkParams(NORMAL_ADULT);
    const net = new VenousNetwork(k, { pSplanchnic: 10, pHepatic: 7, pLowerBody: 8, pIvcTransmural: 1 });
    let o!: NetworkOutputs;
    for (let i = 0; i < 37500; i++) o = net.step(0.004, 0, 5, 5); // 150 s ≈ 20 τ
    expect(Math.abs(o.qPortal + o.qHepaticArtery - o.qHepaticVein) / o.qHepaticVein).toBeLessThan(1e-3);
    expect(Math.abs(o.qRenalArtery - o.qRenalVein) / o.qRenalArtery).toBeLessThan(1e-3);
    expect(Math.abs(o.qLowerBody + o.qRenalVein - o.qIvcToRa) / o.qIvcToRa).toBeLessThan(1e-3);
    const before = { ...net.state };
    for (let i = 0; i < 250; i++) net.step(0.004, 0, 5, 5);
    expect(Math.abs(net.state.vIvc - before.vIvc) / before.vIvc).toBeLessThan(1e-4);
    expect(Math.abs(net.state.vHepatic - before.vHepatic) / before.vHepatic).toBeLessThan(1e-4);
    expect(Math.abs(net.state.vRenal - before.vRenal) / before.vRenal).toBeLessThan(1e-4);
    expect(o.ivcAreaMm2).toBeCloseTo(Math.PI * (o.ivcDiameterEqMm / 2) ** 2, 6);
    expect(o.pIvc - o.pIvcTransmural).toBeCloseTo(5, 9);
    // inversas numéricas de la ley de tubo y de la distensibilidad sinusoidal
    for (const p of [-5, -1, 0, 2, 6, 12, 25]) {
      expect(ivcPtmFromDiameter(ivcDiameterFromPtm(p, k), k)).toBeCloseTo(p, 4);
      expect(hepaticPressureFromVolume(hepaticVolumeFromPressure(p, k), k)).toBeCloseTo(p, 9);
    }
    expect(ivcDiameterFromPtm(-30, k)).toBe(1.5);
    expect(ivcDiameterFromPtm(10, k)).toBeGreaterThan(ivcDiameterFromPtm(2, k));
  });
});

describe('Ventanas de medida', () => {
  const beat = (tR: number, rr: number): Beat => {
    const s = Math.sqrt(rr / 0.8);
    const tP = tR - 0.16;
    return {
      index: 0,
      tR,
      rr,
      tP,
      tAtrialContraction: tP + 0.12,
      tX: tR + 0.16 * s,
      tV: tR + 0.35 * s,
      tY: tR + 0.46 * s,
      tTend: tR + 0.4 * s,
      atrialAmplitude: 1,
    };
  };

  it('las ventanas S/V/D escalan con √RR, la auricular es fija y D se recorta al final del ciclo', () => {
    const w = beatWindows(beat(10, 0.8));
    expect(w.sWindow[0]).toBeCloseTo(10.1, 12);
    expect(w.sWindow[1]).toBeCloseTo(10.33, 12);
    expect(w.vWindow[0]).toBeCloseTo(10.31, 12);
    expect(w.vWindow[1]).toBeCloseTo(10.39, 12);
    expect(w.dWindow[0]).toBeCloseTo(10.39, 12);
    expect(w.dWindow[1]).toBeCloseTo(10.68, 12);
    expect(w.aWindow[0]).toBeCloseTo(9.88, 12);
    expect(w.aWindow[1]).toBeCloseTo(10.05, 12);
    const fast = beatWindows(beat(10, 0.45));
    expect(fast.sWindow[1] - fast.sWindow[0]).toBeCloseTo(0.75 * (w.sWindow[1] - w.sWindow[0]), 12);
    expect(fast.aWindow[1] - fast.aWindow[0]).toBeCloseTo(0.17, 12);
    const vfast = beatWindows(beat(10, 0.4));
    expect(vfast.dWindow[1]).toBeCloseTo(10.38, 12);
    expect(vfast.dWindow[1]).toBeGreaterThan(vfast.dWindow[0]);
  });

  it('systolicPeak informa S invertida solo si el retrógrado alcanza 2 cm/s y el 25 % del máximo', () => {
    const series = (vmax: number, vmin: number) => [
      { t: 0.2, v: vmax },
      { t: 0.5, v: vmin },
      { t: 0.8, v: 1 },
    ];
    const peak = (vmax: number, vmin: number) => systolicPeak(series(vmax, vmin), [0, 1], (s) => s.v);
    expect(peak(20, -1)).toBe(20);
    expect(peak(20, -4)).toBe(20);
    expect(peak(20, -5)).toBe(-5);
    expect(peak(20, -6)).toBe(-6);
    expect(peak(4, -2)).toBe(-2);
    expect(peak(-3, -8)).toBe(-8);
    expect(Number.isNaN(systolicPeak(series(20, -5), [5, 6], (s) => s.v))).toBe(true);
  });
});
