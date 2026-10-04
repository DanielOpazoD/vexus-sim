import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { CASES, NORMAL_ADULT } from '../cases';
import { PhysiologyEngine } from '../physiology/engine';
import { VENOUS_COMPARISON_CHANNELS, VENOUS_CONTROL_CAPABILITIES, venousComparisonTrace } from '../physiology/venousComparison';

const engineOf = (patient = NORMAL_ADULT) => new PhysiologyEngine(patient, new AnatomyScene(patient).vesselAreas());

describe('contrato del visor venoso comparativo', () => {
  it('proyecta los tres territorios del mismo instante y conserva el reloj y ECG', () => {
    const e = engineOf();
    for (let i = 0; i < 500; i++) e.step();
    const time = e.clock.t,
      state = structuredClone(e.sample),
      input = structuredClone(e.samples);
    const a = venousComparisonTrace(e.samples),
      b = venousComparisonTrace(e.samples);
    expect(a).toEqual(b);
    expect(e.clock.t).toBe(time);
    expect(e.sample).toEqual(state);
    expect(e.samples).toEqual(input);
    expect(a.points).toHaveLength(e.samples.length);
    for (let i = 0; i < a.points.length; i++) {
      const p = a.points[i],
        s = e.samples[i];
      expect([p.t, p.ecgMv, p.beatIndex, p.cardiacPhase, p.respiratoryPhase, p.inspiredFraction, p.respiratoryCycling]).toEqual([
        s.t,
        s.ecgMv,
        s.beatIndex,
        s.cardiacPhase,
        s.resp.phase,
        s.resp.volume,
        s.resp.cycling,
      ]);
      expect(p.meanVelocityCmS).toEqual([s.velocities.hvRight / 10, s.velocities.pvTrunk / 10, s.velocities.interlobarVein1 / 10]);
      expect(p.rightAtrialMmHg).toBe(s.pRa);
      expect(p.abdominalMmHg).toBe(s.pAbd);
    }
  });

  it('es referencia fisiológica de velocidad media, no un espectro adquirido ni una clasificación', () => {
    const r = venousComparisonTrace([engineOf().sample]);
    expect(r.kind).toBe('physiology-reference');
    expect(r.velocityUnit).toBe('cm/s');
    expect(r.channels.map((c) => c.vessel)).toEqual(['hvRight', 'pvTrunk', 'interlobarVein1']);
    expect(r).not.toHaveProperty('grade');
    expect(r).not.toHaveProperty('spectrum');
    expect(r.channels[2].vessel).not.toBe('renalVeinRight');
  });

  it('conserva reversión, ceros y amplitudes sin normalizar ni limitar a una plantilla', () => {
    const s = structuredClone(engineOf().sample);
    s.velocities.hvRight = -321;
    s.velocities.pvTrunk = 0;
    s.velocities.interlobarVein1 = 7.5;
    expect(venousComparisonTrace([s]).points[0].meanVelocityCmS).toEqual([-32.1, 0, 0.75]);
    s.velocities.pvTrunk = -123;
    expect(venousComparisonTrace([s]).points[0].meanVelocityCmS[1]).toBe(-12.3);
  });

  it('devuelve copias sin referencias mutables al motor y acepta un historial vacío', () => {
    const s = structuredClone(engineOf().sample);
    const before = structuredClone(s);
    const trace = venousComparisonTrace([s]);
    s.velocities.hvRight = 999;
    s.resp.volume = 0.123;
    s.ecgMv = 999;
    expect(trace.points[0].meanVelocityCmS[0]).toBe(before.velocities.hvRight / 10);
    expect(trace.points[0].inspiredFraction).toBe(before.resp.volume);
    expect(trace.points[0].ecgMv).toBe(before.ecgMv);
    expect(venousComparisonTrace([]).points).toEqual([]);
    expect(Object.isFrozen(VENOUS_COMPARISON_CHANNELS)).toBe(true);
    expect(VENOUS_COMPARISON_CHANNELS.every(Object.isFrozen)).toBe(true);
  });

  it('rechaza datos no finitos, orden inverso y timestamps duplicados sin corregirlos silenciosamente', () => {
    const e = engineOf();
    const a = e.sample,
      b = e.step();
    expect(() => venousComparisonTrace([b, a])).toThrow(/desordenados/);
    expect(() => venousComparisonTrace([a, a])).toThrow(/duplicados/);
    for (const value of [NaN, Infinity, -Infinity]) {
      const s = structuredClone(a);
      s.velocities.pvTrunk = value;
      expect(() => venousComparisonTrace([s])).toThrow(/no finita/);
      s.velocities.pvTrunk = 1;
      s.pRa = value;
      expect(() => venousComparisonTrace([s])).toThrow(/no finita/);
    }
  });

  it('no expone como implementados el pericardio, la compliance VD ni un control venoso global', () => {
    expect(VENOUS_CONTROL_CAPABILITIES).toEqual({
      rightAtrialPressure: 'steady-state-experiment',
      abdominalPressure: 'steady-state-experiment',
      rvSystolicFunction: 'steady-state-experiment',
      tricuspidRegurgitation: 'steady-state-experiment',
      raCompliance: 'steady-state-experiment',
      systemicVenousCompliance: 'reservoirs-only-experiment',
      rvCompliance: 'not-modeled',
      tamponade: 'not-modeled',
    });
  });

  it('todos los casos mantienen sincronización incluida FA y no se reinicia el estado al observar', () => {
    for (const c of CASES) {
      const e = engineOf(c);
      for (let i = 0; i < 250; i++) e.step();
      const before = structuredClone(e.sample),
        t = e.clock.t;
      const trace = venousComparisonTrace(e.samples);
      expect(trace.points.at(-1)?.t, c.id).toBe(t);
      expect(trace.points.at(-1)?.beatIndex, c.id).toBe(e.sample.beatIndex);
      expect(e.sample, c.id).toEqual(before);
    }
  });
});
