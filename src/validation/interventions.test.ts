// @tier slow
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { ABDOMINAL_HYPERTENSION, AF_MODERATE_CONGESTION, CASES, NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import type { Intervention } from '../physiology/circulation';
import { PhysiologyEngine, nonFiniteFields } from '../physiology/engine';
import { clonePatient, type PatientState, type RespiratoryPattern } from '../physiology/patientState';
import { classifyVexusC } from '../vexus/classification';
import { measurePhysiologyTruth } from '../vexus/measurements';

/**
 * Intervenciones sobre el lazo cerrado (decisión 79), con el motor completo y la verdad fisiológica: la PAD media
 * sale del cruce del retorno venoso con la curva de Starling, y el bolo, el diurético y la PEEP se ven en la VCI,
 * en los Doppler y en el grado sin ninguna regla. Las intervenciones empiezan en t = 10 s; cada medida usa los
 * últimos 8 s.
 */
const T0 = 10;

function engineFor(base: PatientState, respiratoryPattern: RespiratoryPattern = 'quiet'): PhysiologyEngine {
  const p = { ...clonePatient(base), respiratoryPattern };
  return new PhysiologyEngine(p, new AnatomyScene(p).vesselAreas(), { historySeconds: 12 });
}

function runTo(e: PhysiologyEngine, t: number): void {
  while (e.clock.t < t - 1e-9) e.step();
}

/** Verdad de los últimos 8 s, su grado, la PAD media y el retorno venoso medio de la red. */
function observe(e: PhysiologyEngine) {
  const t = e.clock.t;
  const m = measurePhysiologyTruth(e, { fromT: t - 8, toT: t });
  const window = e.samples.filter((s) => s.t >= t - 8);
  const mean = (get: (s: (typeof window)[number]) => number) => window.reduce((a, s) => a + get(s), 0) / window.length;
  const grade = classifyVexusC({
    ivcMaxDiameterMm: m.ivcMaxMm,
    hepatic: m.hepaticPattern,
    portalPulsatilityFraction: m.portalPF,
    renal: m.renalPattern,
  }).grade;
  return { m, grade, rap: mean((s) => s.pRa), venousReturn: mean((s) => s.qHepaticVein + s.qIvcToRa), loop: e.circulation.state };
}

/**
 * Retorno venoso medio de la red a la AD (mL/s) sobre los latidos completos de [t0, t1]: una ventana fija que no sea
 * un número entero de latidos oscila de una a otra (±8–17 % en la congestión grave, con ondas grandes).
 */
function returnOverBeats(e: PhysiologyEngine, t0: number, t1: number): number {
  const beats = e.rhythm.beatsBetween(t0, t1);
  const from = beats[0].tR;
  const to = beats[beats.length - 1].tR + beats[beats.length - 1].rr;
  const w = e.samples.filter((s) => s.t >= from && s.t < to);
  return w.reduce((a, s) => a + s.qHepaticVein + s.qIvcToRa, 0) / w.length;
}

/** Caso con intervenciones en T0, observado a `at` segundos de ellas. */
function scenario(base: PatientState, interventions: Intervention[], at: number, pattern: RespiratoryPattern = 'quiet') {
  const e = engineFor(base, pattern);
  runTo(e, T0);
  const before = observe(e);
  for (const i of interventions) expect(e.intervene(i), JSON.stringify(i)).not.toBeNull();
  runTo(e, T0 + at);
  return { before, after: observe(e), engine: e };
}

describe('Sin intervenciones los casos no cambian (decisión 79)', () => {
  // Medido en main 52354d5, antes del lazo cerrado (respiración tranquila, 4–16 s): la trayectoria es idéntica bit a
  // bit; el requisito es PAD ± 1 mmHg, VCI ± 1 mm y el mismo grado de verdad
  const MAIN = [
    { p: NORMAL_ADULT, rap: 3.955, ivcMax: 18.14, ivcMin: 12.41, grade: 0 },
    { p: SEVERE_CONGESTION, rap: 17.014, ivcMax: 30.97, ivcMin: 28.94, grade: 3 },
    { p: AF_MODERATE_CONGESTION, rap: 11.928, ivcMax: 28.83, ivcMin: 26.43, grade: 1 },
  ];
  for (const ref of MAIN) {
    it(`${ref.p.label}: PAD, VCI y grado de main`, () => {
      const e = engineFor(ref.p);
      runTo(e, 16);
      const w = e.samples.filter((s) => s.t > 4);
      const rap = w.reduce((a, s) => a + s.pRa, 0) / w.length;
      const m = measurePhysiologyTruth(e, { fromT: 4, toT: 16 });
      const grade = classifyVexusC({
        ivcMaxDiameterMm: m.ivcMaxMm,
        hepatic: m.hepaticPattern,
        portalPulsatilityFraction: m.portalPF,
        renal: m.renalPattern,
      }).grade;
      expect(Math.abs(rap - ref.rap)).toBeLessThan(1);
      expect(Math.abs(m.ivcMaxMm - ref.ivcMax)).toBeLessThan(1);
      expect(Math.abs(m.ivcMinMm - ref.ivcMin)).toBeLessThan(1);
      expect(grade).toBe(ref.grade);
      // el lazo en reposo es el caso tal cual
      expect(e.circulation.state.rapMeanMmHg).toBe(ref.p.rapMeanMmHg);
      expect(e.circulation.state.tricuspidRegurgitation).toBe(ref.p.tricuspidRegurgitation);
    });
  }
});

describe('Bolo de líquido', () => {
  it('sube PAD, VCI y gasto del sano, que responde (> 10 %) y pasa a grado 1 con los Doppler normales', () => {
    // medido: PAD de lazo 5 → 7,9 mmHg, VCI máx 18,1 → 24,5 mm, colapso 30 → 18 %, gasto +18 %
    const { before, after } = scenario(NORMAL_ADULT, [{ kind: 'bolus', volumeMl: 500 }], 60);
    expect(before.grade).toBe(0);
    expect(after.loop.rapMeanMmHg - NORMAL_ADULT.rapMeanMmHg).toBeGreaterThan(2);
    expect(after.rap - before.rap).toBeGreaterThan(2);
    expect(after.m.ivcMaxMm).toBeGreaterThan(before.m.ivcMaxMm + 3);
    expect(after.m.ivcMaxMm).toBeGreaterThanOrEqual(20);
    expect(after.m.ivcCollapse).toBeLessThan(before.m.ivcCollapse);
    expect(after.loop.cardiacOutputMlS / before.loop.cardiacOutputMlS).toBeGreaterThan(1.1);
    expect(after.m.hepaticPattern).toBe('normal');
    expect(after.m.portalPF).toBeLessThan(30);
    expect(after.m.renalPattern).toBe('continuous');
    expect(after.grade).toBe(1);
  });

  it('250 mL sube la PAD menos que 500 mL, y ya se ve a los 30 s (tiempo docente acelerado)', () => {
    const small = scenario(NORMAL_ADULT, [{ kind: 'bolus', volumeMl: 250 }], 30).after.loop;
    const large = scenario(NORMAL_ADULT, [{ kind: 'bolus', volumeMl: 500 }], 30).after.loop;
    const late = scenario(NORMAL_ADULT, [{ kind: 'bolus', volumeMl: 500 }], 120).after.loop;
    expect(small.rapMeanMmHg).toBeGreaterThan(NORMAL_ADULT.rapMeanMmHg + 0.5);
    expect(large.rapMeanMmHg).toBeGreaterThan(small.rapMeanMmHg + 0.5);
    // a los 30 s el bolo ha llegado al 95 % y la PAD al 90 % de su subida final
    expect(large.rapMeanMmHg - 5).toBeGreaterThan(0.9 * (late.rapMeanMmHg - 5));
  });

  it('en la congestión grave (meseta de Starling) casi no sube el gasto y la PAD sube más: empeora', () => {
    const n = scenario(NORMAL_ADULT, [{ kind: 'bolus', volumeMl: 500 }], 60).after;
    const { before, after } = scenario(SEVERE_CONGESTION, [{ kind: 'bolus', volumeMl: 500 }], 60);
    expect(after.loop.cardiacOutputMlS / before.loop.cardiacOutputMlS).toBeLessThan(1.05);
    expect(after.loop.rapMeanMmHg - SEVERE_CONGESTION.rapMeanMmHg).toBeGreaterThan(n.loop.rapMeanMmHg - NORMAL_ADULT.rapMeanMmHg);
    // la IT funcional crece con el llenado: la S invertida se hace más honda y la porta más pulsátil
    expect(after.loop.tricuspidRegurgitation).toBeGreaterThan(SEVERE_CONGESTION.tricuspidRegurgitation);
    expect(after.m.hvS).toBeLessThan(before.m.hvS);
    expect(after.m.portalPF).toBeGreaterThan(before.m.portalPF);
    expect(after.grade).toBe(3);
  });
});

describe('Diurético / ultrafiltración', () => {
  it('congestión grave: −500 mL bajan PAD y VCI y el grado de 3 a 2 o 1; la suprahepática deja la S invertida', () => {
    // medido a los 120 s: PAD de lazo 18 → 14,0, IT 0,7 → 0,38, S/D −7/23 → +6/17 (S < D), PF 73 → 33 %, grado 1
    const { before, after } = scenario(SEVERE_CONGESTION, [{ kind: 'diuresis', volumeMl: 500 }], 120);
    expect(before.grade).toBe(3);
    expect(before.m.hepaticPattern).toBe('severe');
    expect(after.loop.rapMeanMmHg).toBeLessThan(SEVERE_CONGESTION.rapMeanMmHg - 3.5);
    expect(after.rap).toBeLessThan(before.rap - 3);
    expect(after.m.ivcMaxMm).toBeLessThan(before.m.ivcMaxMm - 1.5);
    expect(['mild', 'normal']).toContain(after.m.hepaticPattern);
    expect(after.m.hvS).toBeGreaterThan(2);
    expect(after.m.portalPF).toBeLessThan(50);
    expect(after.grade).not.toBeNull();
    expect(after.grade!).toBeLessThanOrEqual(2);
    // la descongestión apenas cuesta gasto en el VD que falla (< 6 %)
    expect(after.loop.cardiacOutputMlS / before.loop.cardiacOutputMlS).toBeGreaterThan(0.94);
  });

  it('el patrón se sostiene: en cada ventana de 8 s entre 80 y 160 s la S es anterógrada', () => {
    const e = engineFor(SEVERE_CONGESTION);
    runTo(e, T0);
    e.intervene({ kind: 'diuresis', volumeMl: 500 });
    for (let t = 80; t <= 160; t += 20) {
      runTo(e, T0 + t);
      const o = observe(e);
      expect(o.m.hvS, `t = ${t} s`).toBeGreaterThan(2);
      expect(o.grade, `t = ${t} s`).toBeLessThanOrEqual(2);
    }
  });

  it('en el sano bajan PAD y VCI y la VCI colapsa más; el gasto cae (hipovolemia relativa)', () => {
    const { before, after } = scenario(NORMAL_ADULT, [{ kind: 'diuresis', volumeMl: 500 }], 120);
    expect(after.loop.rapMeanMmHg).toBeLessThan(NORMAL_ADULT.rapMeanMmHg - 2);
    expect(after.m.ivcMaxMm).toBeLessThan(before.m.ivcMaxMm - 4);
    expect(after.m.ivcCollapse).toBeGreaterThan(before.m.ivcCollapse);
    expect(after.loop.cardiacOutputMlS).toBeLessThan(0.85 * before.loop.cardiacOutputMlS);
    expect(after.grade).toBe(0);
  });
});

describe('PEEP', () => {
  it('sano: sube la PAD, la VCI colapsa menos y baja el retorno venoso, de forma monótona con 0/5/10/15 cmH₂O', () => {
    // medido a los 40 s: PAD 5,0/5,5/6,1/6,6 mmHg, colapso 30/29/28/26 %, gasto 4,5/4,0/3,6/3,2 L/min
    const runs = [0, 5, 10, 15].map((cmH2O) => scenario(NORMAL_ADULT, [{ kind: 'peep', cmH2O }], 40).after);
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i].loop.rapMeanMmHg).toBeGreaterThan(runs[i - 1].loop.rapMeanMmHg);
      expect(runs[i].rap).toBeGreaterThan(runs[i - 1].rap);
      expect(runs[i].m.ivcMaxMm).toBeGreaterThan(runs[i - 1].m.ivcMaxMm);
      expect(runs[i].loop.cardiacOutputMlS).toBeLessThan(runs[i - 1].loop.cardiacOutputMlS);
      expect(runs[i].venousReturn).toBeLessThan(runs[i - 1].venousReturn);
    }
    expect(runs[3].m.ivcCollapse).toBeLessThan(runs[0].m.ivcCollapse - 0.03);
    // la PAD sube menos que la pleural (40 % de 15 cmH₂O = 4,4 mmHg): el retorno venoso cae
    expect(runs[3].loop.rapMeanMmHg - runs[0].loop.rapMeanMmHg).toBeLessThan(4.4);
  });

  it('la PEEP comprime la aurícula pero no cambia sus ondas: la misma amplitud latido a latido', () => {
    // apnea: la PAD es la media del lazo más las ondas; con la misma semilla los latidos caen en los mismos instantes
    const amplitudes = (peep: number) => {
      const e = engineFor(NORMAL_ADULT, 'apnea-expiratory');
      runTo(e, T0);
      if (peep) e.intervene({ kind: 'peep', cmH2O: peep });
      runTo(e, T0 + 30);
      return e.rhythm.beatsBetween(T0 + 22, T0 + 30).map((b) => {
        const w = e.samples.filter((s) => s.t >= b.tR && s.t < b.tR + b.rr).map((s) => s.pRa);
        return Math.max(...w) - Math.min(...w);
      });
    };
    const base = amplitudes(0);
    const peep = amplitudes(15);
    expect(peep.length).toBe(base.length);
    // si la rigidez siguiera a la PAD (6,6 mmHg con PEEP 15) y no al llenado, las ondas crecerían un 6 %; el margen es lo
    // que la PEEP aún se mueve a los 22 s (τ 3 s)
    for (let k = 0; k < base.length; k++) expect(peep[k] / base[k]).toBeCloseTo(1, 3);
  });

  it('en la congestión la PEEP no mejora nada: la PAD sube, la porta es más pulsátil y el grado no baja', () => {
    for (const base of [SEVERE_CONGESTION, AF_MODERATE_CONGESTION]) {
      const { before, after } = scenario(base, [{ kind: 'peep', cmH2O: 10 }], 40);
      expect(after.loop.rapMeanMmHg, base.id).toBeGreaterThan(base.rapMeanMmHg);
      expect(after.loop.tricuspidRegurgitation, base.id).toBe(base.tricuspidRegurgitation);
      expect(after.m.portalPF, base.id).toBeGreaterThan(before.m.portalPF);
      expect(after.grade!, base.id).toBeGreaterThanOrEqual(before.grade!);
    }
  });
});

describe('La red sigue al lazo desde el primer latido (el volumen entra en sus compartimentos)', () => {
  // Antes el volumen solo llegaba a la red por sus bordes (PAD y presión arterial) y sus compartimentos se llenaban
  // desde la arteria en tiempo real: tras un bolo el retorno venoso de la red bajaba un 13 % durante 10–40 s mientras
  // el gasto del lazo subía, y tras un diurético subía
  for (const [base, i] of [
    [NORMAL_ADULT, { kind: 'bolus', volumeMl: 500 }],
    [NORMAL_ADULT, { kind: 'diuresis', volumeMl: 500 }],
    [SEVERE_CONGESTION, { kind: 'bolus', volumeMl: 500 }],
    [SEVERE_CONGESTION, { kind: 'diuresis', volumeMl: 500 }],
  ] as const) {
    it(`${base.label}, ${i.kind === 'bolus' ? 'bolo' : 'diurético'}: el retorno de la red va con el gasto del lazo`, () => {
      const e = engineFor(base, 'apnea-expiratory');
      runTo(e, T0);
      const baseReturn = returnOverBeats(e, 4, T0);
      const co0 = e.circulation.state.cardiacOutputMlS;
      e.intervene(i);
      const sign = i.kind === 'bolus' ? 1 : -1;
      // bloques de ~6 s, cada uno medido en cuanto termina (el historial es de 12 s)
      for (const [t0, t1] of [
        [T0, T0 + 6],
        [T0 + 6, T0 + 12],
        [T0 + 12, T0 + 18],
        [T0 + 40, T0 + 46],
      ]) {
        runTo(e, t1);
        const change = returnOverBeats(e, t0, t1) / baseReturn - 1;
        const loopChange = e.circulation.state.cardiacOutputMlS / co0 - 1;
        // mismo sentido que el gasto del lazo (con 1 % de margen) y, lejos del cero, a menos de 5 puntos de él
        expect(sign * change, `${t0}–${t1} s: red ${change}, lazo ${loopChange}`).toBeGreaterThan(-0.01);
        expect(Math.abs(change - loopChange), `${t0}–${t1} s`).toBeLessThan(0.05);
      }
    });
  }
});

describe('Estabilidad del lazo en los límites de las intervenciones', () => {
  it('cualquier caso con cualquier secuencia de intervenciones da un estado finito y acotado', () => {
    const interventionArb: fc.Arbitrary<Intervention> = fc.oneof(
      fc.record({ kind: fc.constant('bolus' as const), volumeMl: fc.double({ min: 1, max: 3000, noNaN: true }) }),
      fc.record({ kind: fc.constant('diuresis' as const), volumeMl: fc.double({ min: 1, max: 3000, noNaN: true }) }),
      fc.record({ kind: fc.constant('peep' as const), cmH2O: fc.double({ min: 0, max: 20, noNaN: true }) }),
    );
    // los casos (los tres de referencia y las trampas de la decisión 82) y sus variantes con PEEP de caso y ventilación
    // mecánica (un caso con PEEP bajaba la PAD a −0,6 mmHg al quitársela tras el diurético máximo)
    const caseArb = fc
      .record({
        base: fc.constantFrom(...CASES),
        peep: fc.constantFrom(0, 0, 5, 10, 15),
        ventilation: fc.constantFrom('spontaneous' as const, 'positive-pressure' as const),
      })
      .map(({ base, peep, ventilation }) => ({ ...clonePatient(base), peepCmH2O: peep, ventilation }));
    fc.assert(
      fc.property(
        caseArb,
        fc.constantFrom('quiet' as const, 'apnea-expiratory' as const, 'deep' as const, 'apnea-inspiratory' as const),
        fc.array(fc.tuple(fc.double({ min: 0, max: 20, noNaN: true }), interventionArb), { minLength: 1, maxLength: 6 }),
        (base, pattern, plan) => {
          const e = engineFor(base, pattern);
          const schedule = [...plan].sort((a, b) => a[0] - b[0]);
          for (const [at, i] of schedule) {
            runTo(e, 1 + at);
            e.intervene(i);
          }
          const tEnd = e.clock.t + 60;
          let dMin = Infinity;
          let dMax = -Infinity;
          let vMax = 0;
          let vIvcSupra = 0;
          let rapMin = Infinity;
          let fillingMax = -Infinity;
          const bad = new Set<string>();
          while (e.clock.t < tEnd) {
            const s = e.step(); // lanza NonFiniteStateError si algo deja de ser finito
            for (const f of nonFiniteFields(s)) bad.add(f);
            dMin = Math.min(dMin, s.ivc.dApMm);
            dMax = Math.max(dMax, s.ivc.dApMm);
            for (const [id, v] of Object.entries(s.velocities))
              if (id === 'ivcSupra') vIvcSupra = Math.max(vIvcSupra, Math.abs(v));
              else vMax = Math.max(vMax, Math.abs(v));
            rapMin = Math.min(rapMin, e.circulation.state.rapMeanMmHg);
            fillingMax = Math.max(fillingMax, e.circulation.state.fillingRapMmHg);
          }
          expect([...bad]).toEqual([]);
          expect(dMin).toBeGreaterThan(1);
          expect(dMax).toBeLessThan(45);
          // cordura numérica, la misma cota que properties.test.ts (el límite fisiológico de 2 m/s en la VCI
          // colapsada es `no-thoracic-waterfall`). Con la presión intraabdominal alta la VCI retrohepática la supera
          // (`iah-collapsed-ivc-velocity`, el `it.fails` de abajo): ahí solo se exige que no se dispare
          expect(vMax).toBeLessThan(3000);
          expect(vIvcSupra).toBeLessThan(base.intraAbdominalPressureMmHg >= 12 ? 8000 : 3000);
          // en cada paso los líquidos dejan la PAD en el dominio probado del modelo: ≥ 2 mmHg con cualquier PEEP y el
          // llenado ≤ 30
          expect(rapMin).toBeGreaterThan(2 - 1e-6);
          expect(fillingMax).toBeLessThan(30 + 1e-6);
        },
      ),
      { seed: 20260926, numRuns: 30 },
    );
  });

  // Regression for the previously published high-IAP/diuresis counterexample.
  // No velocity clipping: the upper segment now uses its own rendered section (172).
  it('PIA alta con diuresis: la cava superior conserva Q/A regional sin el pico artificial de 3–8 m/s', () => {
    const e = engineFor(ABDOMINAL_HYPERTENSION);
    runTo(e, 1);
    expect(e.intervene({ kind: 'diuresis', volumeMl: 1000 })).not.toBeNull();
    let v = 0;
    while (e.clock.t < 61) {
      const s = e.step();
      v = Math.max(v, Math.abs(s.velocities.ivcSupra));
      const area = (Math.PI * s.ivcSupra!.dApMm * s.ivcSupra!.dLatMm) / 4;
      expect((s.velocities.ivcSupra * area) / 1000).toBeCloseTo(s.qIvcToRa + s.qHepaticVein, 8);
    }
    expect(v).toBeGreaterThan(100);
    expect(v).toBeLessThan(2000);
  });
});
