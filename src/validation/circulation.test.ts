import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { AF_MODERATE_CONGESTION, CASES, CIRRHOSIS_PULMONARY_HYPERTENSION, NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import {
  BOLUS_TAU_S,
  Circulation,
  DIURESIS_TAU_S,
  FILLING_RAP_LIMITS_MMHG,
  FLUID_LIMITS_ML,
  PEEP_TAU_S,
  afterloadFactor,
  fitStarlingCurve,
  loadDependentTr,
  loopParams,
  solveEquilibrium,
  starlingOutput,
  type AppliedIntervention,
  type CirculationBaseline,
  type LoopParams,
} from '../physiology/circulation';
import { PhysiologyEngine } from '../physiology/engine';
import { clonePatient, type PatientState } from '../physiology/patientState';
import { RhythmGenerator } from '../physiology/rhythm';
import { RightAtriumModel, caseAtrialLoad, raWaveParams } from '../physiology/rightAtrium';
import { peepPleuralShiftMmHg } from '../physiology/respiratory';

/**
 * Lazo cerrado de la media (decisión 79), en el nivel rápido: las dos curvas, su cruce, la IT dependiente de la
 * carga, la cinética de las intervenciones y sus límites. Las respuestas del motor completo (VCI, Doppler y
 * grado) están en `interventions.test.ts` (lento).
 */
const engineFor = (p: PatientState) => new PhysiologyEngine(p, new AnatomyScene(p).vesselAreas(), { historySeconds: 2 });

/** Volumen de una intervención de líquidos aplicada (NaN si no lo es o no se aplicó). */
const volumeOf = (a: AppliedIntervention | null): number => (a && a.kind !== 'peep' ? a.volumeMl : Number.NaN);

/** Punto de trabajo sintético: dos compartimentos y la arteria, sin red. */
const SYNTHETIC: CirculationBaseline = {
  cardiacOutputMlS: 80,
  arterialMeanMmHg: 90,
  compartments: [
    { name: 'arterial', complianceMlPerMmHg: 1.5, pressureMmHg: 90 },
    { name: 'a', complianceMlPerMmHg: 60, pressureMmHg: 10 },
    { name: 'b', complianceMlPerMmHg: 40, pressureMmHg: 8 },
  ],
};

describe('Curva de Frank–Starling ajustada al caso', () => {
  it('pasa por el punto del caso con su pendiente, crece, es cóncava y nunca negativa', () => {
    for (const [co0, ptm0, s0] of [
      [75, 8.7, 5.5],
      [77, 21.7, 0.6],
      [76, 16.7, 2],
      [60, 1, 3],
    ] as const) {
      const c = fitStarlingCurve(co0, ptm0, s0);
      expect(starlingOutput(c, ptm0)).toBeCloseTo(co0, 6);
      expect(c.slopeMlSPerMmHg).toBeCloseTo(s0, 4);
      const d = (p: number) => (starlingOutput(c, p + 1e-4) - starlingOutput(c, p - 1e-4)) / 2e-4;
      expect(d(ptm0)).toBeCloseTo(s0, 3);
      let prevSlope = Infinity;
      for (let p = Math.max(c.offsetMmHg + 0.5, 0.5); p < 40; p += 1) {
        // creciente (en la meseta honda la diferencia finita llega a 0 por redondeo) y cóncava
        expect(d(p)).toBeGreaterThanOrEqual(0);
        if (p <= ptm0 + 5) expect(d(p)).toBeGreaterThan(0);
        expect(d(p)).toBeLessThanOrEqual(prevSlope + 1e-9);
        prevSlope = d(p);
      }
      expect(starlingOutput(c, c.offsetMmHg - 5)).toBe(0);
    }
  });

  it('una pendiente mayor que la secante desde el origen no admite curva cóncava: se recorta a casi recta', () => {
    const c = fitStarlingCurve(50, 10, 20);
    expect(starlingOutput(c, 10)).toBeCloseTo(50, 6);
    // r = S·Ptm/GC = 4 → 0,98: pendiente 0,98·GC/Ptm
    expect(c.slopeMlSPerMmHg).toBeCloseTo((0.98 * 50) / 10, 3);
  });
});

describe('Cruce del retorno venoso con la curva de Starling', () => {
  const k: LoopParams = loopParams(NORMAL_ADULT, -3.68, SYNTHETIC);

  it('el punto de trabajo: Pmsf es la media ponderada por distensibilidad y R_RV lleva el caso a su PAD', () => {
    expect(k.pmsf0).toBeCloseTo((1.5 * 90 + 60 * 10 + 40 * 8) / 101.5, 9);
    expect(k.rvr).toBeCloseTo((k.pmsf0 - NORMAL_ADULT.rapMeanMmHg) / 80, 12);
    const eq = solveEquilibrium(k, 0, 0, 1);
    expect(eq.rap).toBeCloseTo(NORMAL_ADULT.rapMeanMmHg, 8);
    expect(eq.co).toBeCloseTo(80, 6);
  });

  it('si la red diera Pmsf ≤ PAD, R_RV tiene suelo y el cruce sigue en el caso', () => {
    const flat: CirculationBaseline = { ...SYNTHETIC, compartments: [{ name: 'a', complianceMlPerMmHg: 100, pressureMmHg: 4 }] };
    const kf = loopParams(NORMAL_ADULT, -3.68, flat);
    expect(kf.rvr).toBe(0.01);
    expect(kf.pmsf0).toBeCloseTo(5 + 80 * 0.01, 12);
    expect(solveEquilibrium(kf, 0, 0, 1).rap).toBeCloseTo(5, 8);
  });

  it('más volumen sube PAD y gasto; la pleural y la poscarga suben la PAD y bajan el gasto', () => {
    const base = solveEquilibrium(k, 0, 0, 1);
    let prev = base;
    for (const dv of [100, 250, 500, 1000]) {
      const eq = solveEquilibrium(k, dv, 0, 1);
      expect(eq.rap).toBeGreaterThan(prev.rap);
      expect(eq.co).toBeGreaterThan(prev.co);
      // la subida de la PAD nunca supera la de la Pmsf (el corazón se lleva parte en gasto)
      expect(eq.rap - base.rap).toBeLessThan(dv / k.complianceMlPerMmHg + 1e-9);
      prev = eq;
    }
    const pl = solveEquilibrium(k, 0, 3, 1);
    expect(pl.rap).toBeGreaterThan(base.rap);
    expect(pl.rap - base.rap).toBeLessThan(3);
    expect(pl.co).toBeLessThan(base.co);
    const ea = solveEquilibrium(k, 0, 0, 0.9);
    expect(ea.rap).toBeGreaterThan(base.rap);
    expect(ea.co).toBeLessThan(base.co);
    // en equilibrio el retorno venoso es el gasto del corazón
    for (const eq of [pl, ea]) expect(eq.co).toBeCloseTo(((eq.pmsf - eq.rap) / k.rvr) * 1, 9);
  });

  it('un corazón en la meseta pasa casi toda la Pmsf a la PAD; uno en la pendiente la convierte en gasto', () => {
    const steep = { ...k, starling: fitStarlingCurve(80, 8.68, 8) };
    const flat = { ...k, starling: fitStarlingCurve(80, 8.68, 0.3) };
    const dPmsf = 500 / k.complianceMlPerMmHg;
    const riseSteep = solveEquilibrium(steep, 500, 0, 1).rap - solveEquilibrium(steep, 0, 0, 1).rap;
    const riseFlat = solveEquilibrium(flat, 500, 0, 1).rap - solveEquilibrium(flat, 0, 0, 1).rap;
    expect(riseFlat).toBeGreaterThan(0.95 * dPmsf);
    expect(riseSteep).toBeLessThan(0.75 * dPmsf);
    // con la meseta la PEEP apenas mueve la PAD absoluta (el retorno venoso la fija); con la pendiente, más
    expect(solveEquilibrium(flat, 0, 3, 1).rap - 5).toBeLessThan(solveEquilibrium(steep, 0, 3, 1).rap - 5);
  });

  it('sin gasto posible (Pmsf bajo el umbral de llenado) el cruce da PAD = Pmsf y gasto 0', () => {
    const eq = solveEquilibrium(k, -1e5, 0, 1);
    expect(eq.co).toBeCloseTo(0, 6);
    expect(eq.rap).toBeCloseTo(eq.pmsf, 6);
  });

  it('la poscarga de la PEEP deprime más al VD desacoplado', () => {
    expect(afterloadFactor(1.7, 0)).toBe(1);
    expect(afterloadFactor(0.6, 10)).toBeLessThan(afterloadFactor(1.7, 10));
    expect(afterloadFactor(1.7, 10)).toBeLessThan(1);
    expect(afterloadFactor(1.7, -5)).toBeGreaterThan(1);
    expect(Number.isFinite(afterloadFactor(1, -1000))).toBe(true);
  });

  it('la IT funcional sigue al llenado por volumen, es la del caso en su punto y no pasa de 1', () => {
    const ks = loopParams(SEVERE_CONGESTION, -3.68, SYNTHETIC);
    expect(loadDependentTr(ks, 18)).toBeCloseTo(0.7, 12);
    expect(loadDependentTr(ks, 14)).toBeLessThan(0.45);
    expect(loadDependentTr(ks, 20)).toBeGreaterThan(0.85);
    expect(loadDependentTr(ks, 40)).toBe(1);
    expect(loadDependentTr({ ...ks, tr0: 0 }, 30)).toBe(0);
  });
});

describe('Circulation: intervenciones y su cinética', () => {
  const make = (p: PatientState = NORMAL_ADULT) => {
    const c = new Circulation(p, -3.678);
    c.calibrate(SYNTHETIC);
    return c;
  };

  it('sin intervenciones devuelve el caso exacto (los casos calibrados no cambian)', () => {
    for (const p of CASES) {
      const c = make(p);
      for (const t of [0, 1, 100]) {
        const s = c.update(t);
        expect(s.rapMeanMmHg).toBe(p.rapMeanMmHg);
        expect(s.fillingRapMmHg).toBe(p.rapMeanMmHg);
        expect(s.tricuspidRegurgitation).toBe(p.tricuspidRegurgitation);
        expect(s.peepCmH2O).toBe(p.peepCmH2O);
        expect(s.arterialMeanMmHg).toBe(90);
        expect(s.cardiacOutputMlS).toBe(80);
      }
      expect(c.atrialLoad).toEqual(caseAtrialLoad(p));
      // la forma de onda con la carga del caso es la calibrada de siempre
      expect(raWaveParams(p, c.atrialLoad)).toEqual(raWaveParams(p));
    }
  });

  it('antes de calibrar no hay lazo', () => {
    const c = new Circulation(NORMAL_ADULT, -3.678);
    expect(() => c.loop).toThrow(/calibrate/);
    expect(c.update(1).rapMeanMmHg).toBe(NORMAL_ADULT.rapMeanMmHg);
  });

  it('bolo y diurético: primer orden con su constante de tiempo (tiempo docente acelerado)', () => {
    const c = make();
    expect(c.intervene({ kind: 'bolus', volumeMl: 500 }, 10)).toEqual({ kind: 'bolus', volumeMl: 500, t0: 10 });
    // lo pedido se ve al momento; el efecto, con los pasos
    expect(c.state.fluidTargetMl).toBe(500);
    expect(c.state.fluidDeltaMl).toBe(0);
    expect(c.update(10).fluidDeltaMl).toBe(0);
    for (const dt of [5, 10, 30]) expect(c.update(10 + dt).fluidDeltaMl).toBeCloseTo(500 * (1 - Math.exp(-dt / BOLUS_TAU_S)), 9);
    expect(c.state.fluidTargetMl).toBe(500);
    const d = make();
    d.intervene({ kind: 'diuresis', volumeMl: 300 }, 0);
    expect(d.update(DIURESIS_TAU_S).fluidDeltaMl).toBeCloseTo(-300 * (1 - Math.exp(-1)), 9);
    // efecto visible en 1–2 min: el bolo al 95 % en 30 s y el diurético en 2 min
    expect(3 * BOLUS_TAU_S).toBeLessThanOrEqual(30);
    expect(3 * DIURESIS_TAU_S).toBeLessThanOrEqual(120);
  });

  it('tras muchas constantes de tiempo llega todo lo pedido, sin saltos', () => {
    const c = make();
    c.intervene({ kind: 'bolus', volumeMl: 200 }, 0);
    const before = c.update(40 * BOLUS_TAU_S - 1e-6).fluidDeltaMl;
    const after = c.update(40 * BOLUS_TAU_S + 1).fluidDeltaMl;
    expect(after).toBe(200);
    expect(Math.abs(after - before)).toBeLessThan(1e-9);
    c.intervene({ kind: 'diuresis', volumeMl: 200 }, 500);
    expect(c.update(500 + 41 * DIURESIS_TAU_S).fluidDeltaMl).toBeCloseTo(0, 12);
    expect(c.state.fluidTargetMl).toBe(0);
  });

  it('PEEP: la pleural la sigue en unos segundos, sin salto al cambiarla a mitad de camino', () => {
    const c = make();
    c.intervene({ kind: 'peep', cmH2O: 10 }, 0);
    expect(c.state.peepTargetCmH2O).toBe(10);
    expect(c.update(0).peepCmH2O).toBe(0);
    expect(c.update(PEEP_TAU_S).peepCmH2O).toBeCloseTo(10 * (1 - Math.exp(-1)), 9);
    const mid = c.update(2).peepCmH2O;
    c.intervene({ kind: 'peep', cmH2O: 0 }, 2);
    expect(c.update(2).peepCmH2O).toBeCloseTo(mid, 12);
    expect(c.update(60).peepCmH2O).toBeCloseTo(0, 6);
    c.intervene({ kind: 'peep', cmH2O: 15 }, 60);
    const s = c.update(90);
    expect(s.pleuralShiftMmHg).toBeCloseTo(peepPleuralShiftMmHg(15), 3);
    expect(s.peepTargetCmH2O).toBe(15);
    // la PEEP comprime la aurícula: sube la PAD pero no el llenado, ni la IT
    expect(s.rapMeanMmHg).toBeGreaterThan(NORMAL_ADULT.rapMeanMmHg);
    expect(s.fillingRapMmHg).toBe(NORMAL_ADULT.rapMeanMmHg);
    expect(s.tricuspidRegurgitation).toBe(NORMAL_ADULT.tricuspidRegurgitation);
    expect(s.cardiacOutputMlS).toBeLessThan(80);
  });

  it('con volumen y PEEP a la vez, el llenado es el del volumen con la PEEP del caso', () => {
    const c = make();
    c.intervene({ kind: 'bolus', volumeMl: 500 }, 0);
    c.intervene({ kind: 'peep', cmH2O: 10 }, 0);
    const s = c.update(400);
    const k = c.loop;
    expect(s.fillingRapMmHg).toBeCloseTo(solveEquilibrium(k, 500, 0, 1).rap, 6);
    expect(s.rapMeanMmHg).toBeGreaterThan(s.fillingRapMmHg);
    expect(s.tricuspidRegurgitation).toBeCloseTo(loadDependentTr(k, s.fillingRapMmHg), 12);
  });

  it('límites: los líquidos se recortan al dominio del llenado y a los topes; lo inválido lanza', () => {
    const c = make();
    const b = c.fluidBounds();
    expect(b.min).toBeGreaterThanOrEqual(FLUID_LIMITS_ML.min);
    expect(b.max).toBeLessThanOrEqual(FLUID_LIMITS_ML.max);
    expect(b.min).toBeLessThanOrEqual(0);
    expect(b.max).toBeGreaterThanOrEqual(0);
    // el extremo inferior es el volumen que deja el llenado en 2 mmHg (o el tope absoluto)
    if (b.min > FLUID_LIMITS_ML.min) expect(solveEquilibrium(c.loop, b.min, 0, 1).rap).toBeCloseTo(FILLING_RAP_LIMITS_MMHG.min, 6);
    const applied = c.intervene({ kind: 'diuresis', volumeMl: 5000 }, 0);
    expect(volumeOf(applied)).toBeCloseTo(-b.min, 9);
    expect(c.fluidRoom(-1)).toBeCloseTo(0, 9);
    expect(c.intervene({ kind: 'diuresis', volumeMl: 100 }, 1)).toBeNull();
    expect(volumeOf(c.intervene({ kind: 'bolus', volumeMl: 100 }, 1))).toBe(100);
    expect(() => c.intervene({ kind: 'bolus', volumeMl: 0 }, 2)).toThrow(RangeError);
    expect(() => c.intervene({ kind: 'bolus', volumeMl: Number.NaN }, 2)).toThrow(RangeError);
    expect(() => c.intervene({ kind: 'peep', cmH2O: 25 }, 2)).toThrow(RangeError);
    expect(() => c.intervene({ kind: 'peep', cmH2O: Number.NaN }, 2)).toThrow(RangeError);
    expect(c.interventions.map((i) => i.kind)).toEqual(['diuresis', 'bolus']);
  });

  it('un bolo rápido tras un diurético lento no cruza el límite de paso: la holgura cuenta lo que aún falta por llegar', () => {
    const c = make();
    const b = c.fluidBounds();
    c.intervene({ kind: 'diuresis', volumeMl: -b.min }, 0);
    // el diurético todavía no ha quitado nada: el bolo solo cabe hasta el tope, no hasta el tope más el diurético
    expect(c.fluidRoom(1, 0)).toBeCloseTo(b.max, 9);
    expect(volumeOf(c.intervene({ kind: 'bolus', volumeMl: 1e4 }, 0))).toBeCloseTo(b.max, 9);
    let maxSeen = -Infinity;
    for (let t = 0; t < 300; t += 0.5) maxSeen = Math.max(maxSeen, c.update(t).fluidDeltaMl);
    expect(maxSeen).toBeLessThanOrEqual(b.max + 1e-9);
    expect(c.state.fluidTargetMl).toBeCloseTo(b.max + b.min, 9);
  });

  it('clics alternos sin fin: lo que llegaría sin el recorte nunca sale de los límites y el coste no crece', () => {
    const c = make();
    const b = c.fluidBounds();
    const applied: Array<{ t0: number; ml: number; tau: number }> = [];
    let t = 0;
    for (let i = 0; i < 400; i++) {
      t += 0.05;
      const kind = i % 2 ? 'diuresis' : 'bolus';
      const a = c.intervene({ kind, volumeMl: 250 }, t);
      if (a && a.kind !== 'peep')
        applied.push({ t0: t, ml: (kind === 'bolus' ? 1 : -1) * a.volumeMl, tau: kind === 'bolus' ? BOLUS_TAU_S : DIURESIS_TAU_S });
    }
    // el volumen que darían las dosis aplicadas, sumadas sin recorte, en cualquier instante
    const unclamped = (at: number) => applied.reduce((v, d) => v + (at > d.t0 ? -d.ml * Math.expm1(-(at - d.t0) / d.tau) : 0), 0);
    for (let at = 0; at < 400; at += 0.25) {
      expect(unclamped(at)).toBeLessThanOrEqual(b.max + 1e-6);
      expect(unclamped(at)).toBeGreaterThanOrEqual(b.min - 1e-6);
      // el motor solo avanza: desde el último clic, los dos acumuladores dan lo mismo que la suma de las dosis
      if (at >= t) expect(c.update(at).fluidDeltaMl).toBeCloseTo(unclamped(at), 6);
    }
    // los clics de más se recortan a lo que cabe: de los 100 L pedidos solo se aplica una fracción pequeña (antes se
    // aplicaban enteros mientras el total neto cupiera, y el volumen en curso se clavaba en el tope)
    const gross = applied.reduce((a, d) => a + Math.abs(d.ml), 0);
    expect(gross).toBeLessThan(0.1 * 400 * 250);
  });

  it('con una PEEP de caso, el diurético máximo no deja la PAD bajo 2 mmHg al quitar la PEEP', () => {
    const shift = peepPleuralShiftMmHg(15);
    const ppv: PatientState = { ...clonePatient(NORMAL_ADULT), ventilation: 'positive-pressure', peepCmH2O: 15 };
    const c = new Circulation(ppv, -3.678 + shift);
    c.calibrate(SYNTHETIC);
    c.intervene({ kind: 'diuresis', volumeMl: 5000 }, 0);
    c.intervene({ kind: 'peep', cmH2O: 0 }, 0);
    const s = c.update(2000);
    expect(s.peepCmH2O).toBeCloseTo(0, 9);
    // antes el límite se calculaba con la PEEP del caso: con PEEP 0 la PAD caía a −0,6 mmHg
    expect(s.rapMeanMmHg).toBeGreaterThan(FILLING_RAP_LIMITS_MMHG.min - 1e-6);
    expect(s.rapMeanMmHg).toBeLessThan(FILLING_RAP_LIMITS_MMHG.min + 0.01);
  });

  it('un caso ya fuera del dominio del llenado no admite más líquido en ese sentido', () => {
    const low = { ...clonePatient(NORMAL_ADULT), rapMeanMmHg: 1 };
    const c = new Circulation(low, -3.678);
    c.calibrate(SYNTHETIC);
    expect(c.fluidBounds().min).toBe(0);
    expect(c.intervene({ kind: 'diuresis', volumeMl: 500 }, 0)).toBeNull();
  });
});

describe('Forma de onda auricular con la carga del lazo', () => {
  it('la rigidez auricular sigue al llenado por volumen, no a la PAD que sube la PEEP', () => {
    const tr = NORMAL_ADULT.tricuspidRegurgitation;
    const withPeep = raWaveParams(NORMAL_ADULT, { rapMeanMmHg: 9, fillingRapMmHg: 5, tricuspidRegurgitation: tr });
    expect(withPeep).toEqual(raWaveParams(NORMAL_ADULT));
    const filled = raWaveParams(NORMAL_ADULT, { rapMeanMmHg: 9, fillingRapMmHg: 9, tricuspidRegurgitation: tr });
    expect(filled.vAmp / withPeep.vAmp).toBeCloseTo(1 + 0.04 * 4, 12);
  });

  it('cada latido conserva sus amplitudes aunque la carga cambie a mitad de latido (el centrado sigue valiendo)', () => {
    let load = caseAtrialLoad(SEVERE_CONGESTION);
    const rhythm = new RhythmGenerator(SEVERE_CONGESTION, 7);
    const ra = new RightAtriumModel(SEVERE_CONGESTION, rhythm, () => load);
    const t1 = 5.3;
    const before = ra.cardiacComponent(t1);
    load = { rapMeanMmHg: 25, fillingRapMmHg: 25, tricuspidRegurgitation: 1 };
    // los latidos que ya estaban en juego en t1 no cambian: la misma onda en el mismo instante
    expect(ra.cardiacComponent(t1)).toBe(before);
    // y la media de la componente cardíaca sobre muchos latidos, con la carga cambiando cada 0,7 s, sigue en 0
    let acc = 0;
    let n = 0;
    for (let t = 6; t < 40; t += 0.002) {
      if (Math.abs((t % 0.7) - 0.35) < 0.001) load = { ...load, fillingRapMmHg: 10 + ((t * 7) % 15), tricuspidRegurgitation: (t * 3) % 1 };
      acc += ra.cardiacComponent(t);
      n++;
    }
    expect(Math.abs(acc / n)).toBeLessThan(0.05);
  });
});

describe('Lazo del motor en el punto de los casos', () => {
  it('la curva de retorno venoso sale de la red: Pmsf 10–25 mmHg, R_RV ≈ 1,2–1,4 mmHg·min/L, C ≈ 110–130 mL/mmHg', () => {
    // la cirrosis (resistencia intrahepática ≥ 2, decisión 82) va aparte, abajo: su porta está en el camino del retorno
    const withoutPortalHypertension = CASES.filter((c) => c.liver.sinusoidalResistance < 2);
    expect(withoutPortalHypertension.length).toBe(CASES.length - 1);
    for (const p of withoutPortalHypertension) {
      const k = engineFor(p).circulation.loop;
      expect(k.pmsf0).toBeGreaterThan(p.rapMeanMmHg + 4);
      expect(k.pmsf0).toBeLessThan(25);
      const rvrMinPerL = (k.rvr * 1000) / 60; // mmHg·s/mL → mmHg·min/L
      expect(rvrMinPerL).toBeGreaterThan(1.1);
      expect(rvrMinPerL).toBeLessThan(1.5);
      expect(k.complianceMlPerMmHg).toBeGreaterThan(100);
      expect(k.complianceMlPerMmHg).toBeLessThan(140);
    }
  });

  it('cirrosis (decisión 82): la resistencia intrahepática entra en el retorno venoso y sube la Pmsf y la R_RV', () => {
    // El lecho esplácnico, con la mayor parte de la distensibilidad, drena por el hígado: con la resistencia ×5 su presión
    // sube (hipertensión portal) y con ella la Pmsf (media ponderada) y la resistencia al retorno. Medido: Pmsf₀ 28,1
    // frente a 24,2 mmHg y R_RV 2,32 frente a 1,37 mmHg·min/L del mismo corazón sin cirrosis; la distensibilidad no cambia
    const rvr = (k: LoopParams) => (k.rvr * 1000) / 60;
    const cir = engineFor(CIRRHOSIS_PULMONARY_HYPERTENSION).circulation.loop;
    const heart = engineFor(SEVERE_CONGESTION).circulation.loop;
    expect(cir.pmsf0).toBeGreaterThan(heart.pmsf0 + 2);
    expect(cir.pmsf0).toBeLessThan(30);
    expect(rvr(cir)).toBeGreaterThan(rvr(heart) + 0.4);
    expect(rvr(cir)).toBeLessThan(2.5);
    expect(Math.abs(cir.complianceMlPerMmHg - heart.complianceMlPerMmHg)).toBeLessThan(5);
  });

  it('el sano está en la pendiente de Starling y la congestión grave en la meseta', () => {
    const [n, s, af] = [NORMAL_ADULT, SEVERE_CONGESTION, AF_MODERATE_CONGESTION].map((p) => engineFor(p).circulation.loop);
    const coupling = (k: LoopParams) => k.starling.slopeMlSPerMmHg * k.rvr;
    // S·R_RV: fracción de la subida de la Pmsf que el corazón convierte en gasto frente a la que queda en la PAD
    expect(coupling(n)).toBeGreaterThan(0.3);
    expect(coupling(s)).toBeLessThan(0.08);
    expect(coupling(af)).toBeGreaterThan(coupling(s));
    expect(coupling(af)).toBeLessThan(coupling(n));
  });
});
