// @tier slow
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AF_MODERATE_CONGESTION, CASES, CIRRHOSIS_PULMONARY_HYPERTENSION, SEVERE_CONGESTION } from '../cases';
import { prfFromNyquistCms } from '../core/units';
import { maxPrfForDepth } from '../app/equipment';
import type { RespiratoryPattern } from '../physiology/patientState';
import type { Beat } from '../physiology/rhythm';
import { classifyPortal } from '../vexus/classification';
import { measurePhysiologyTruth } from '../vexus/measurements';
import { acquire, openSession, placeGate, probeAt, TR } from './support/studentChain';

/**
 * PF portal del alumno frente a la escala (decisión 94). Un clínico del panel de evaluación midió en la app, con el visto
 * bueno de la calidad, una PF del sano (verdad 13–20 %) de 100 % a ±20 cm/s, 111–114 % a ±40 (la escala por defecto),
 * 79–95 % a ±60 y 18–24 % a ±80; el grave, 133 % (verdad 75 %). Causa: la traza tomaba el semiplano dominante columna a
 * columna y, con la banda débil de un vaso profundo (−30 dB), el clutter junto a la línea de base o su imagen hundían
 * Vmín a 0 o por debajo. La cadena del alumno no lo veía: medía a la PRF máxima con una copia de la puerta de
 * transmisión fija 0,3 (−10 dB).
 *
 * Aquí, por la ruta de la aplicación (`support/studentChain.ts`): las 4 escalas que usa el alumno (±20, ±40, ±60 y
 * ±80 cm/s, limitadas por la profundidad como el deslizador), los 7 casos, apnea y respiración tranquila, 3 semillas;
 * la puerta en el tronco portal desde la ventana «Porta» con la técnica del operador y la longitud por defecto (4 mm).
 * En cada sesión el alumno cambia la escala y espera 8,5 s antes de capturar. Criterios de aceptación de la decisión:
 * |PF − verdad| ≤ 10 puntos en ≥ 95 % de las capturas aceptadas, nunca «grave» con una verdad < 30 % y, en apnea a
 * ±40–±80, la técnica sirve (≥ 80 % medibles). En main a386e5e esta prueba falla en los 7 casos: de 168 capturas, 109
 * aceptadas, solo 31 (28 %) a ≤ 10 puntos y 26 «graves» con la verdad normal.
 */
const SCALES = [20, 40, 60, 80] as const;
const SEEDS = [0, 1, 2] as const;
const RESPIRATIONS: RespiratoryPattern[] = ['apnea-expiratory', 'quiet'];

interface Row {
  caseId: string;
  resp: RespiratoryPattern;
  seed: number;
  scale: number;
  pf: number;
  /** Verdad en los latidos medidos (los de la captura); `truth7`, en los 7 s de espectro. */
  truth: number;
  truth7: number;
  issue: string | null;
}

/**
 * PF de la verdad en los mismos latidos que midió la captura (en los 7 s si no midió ninguno). En la FA la PF cambia de un
 * latido a otro (12–47 % en una misma captura) y la mediana de los 4 latidos de la captura puede quedar a > 10 puntos de la
 * de los ~11 latidos de 7 s: eso es el muestreo del ritmo, no la medición (limitación `af-capture-beat-sampling`).
 */
function truthOf(session: ReturnType<typeof openSession>, m: { measuredBeats: readonly Beat[] } | null): { truth: number; truth7: number } {
  const tNow = session.engine.clock.t;
  const truth7 = measurePhysiologyTruth(session.engine, { fromT: tNow - 7, toT: tNow }).portalPF;
  const b = m?.measuredBeats ?? [];
  if (!b.length) return { truth: truth7, truth7 };
  const last = b[b.length - 1];
  return { truth: measurePhysiologyTruth(session.engine, { fromT: b[0].tR - 1e-6, toT: last.tR + last.rr + 1e-6 }).portalPF, truth7 };
}

function portalRows(caseIndex: number): Row[] {
  const base = CASES[caseIndex];
  const rows: Row[] = [];
  for (const resp of RESPIRATIONS)
    for (const seed of SEEDS) {
      const session = openSession(base, resp, seed);
      const contact = probeAt(session, 'portal');
      const best = placeGate(session, contact, ['pvTrunk']);
      expect(best, `${base.id}: sin tronco portal en la ventana «Porta»`).not.toBeNull();
      for (const scale of SCALES) {
        const prfHz = Math.min(prfFromNyquistCms(scale, TR.f0Doppler), maxPrfForDepth(best!.r + 2, 1_540_000));
        const { captures } = acquire(session, contact, best!, 'portal', { prfHz, seconds: 8.5 });
        const m = captures.at(-1)?.m ?? null;
        rows.push({
          caseId: base.id,
          resp,
          seed,
          scale,
          pf: m ? m.pulsatilityFraction : Number.NaN,
          ...truthOf(session, m),
          issue: m ? m.quality.issue : 'sin medida',
        });
      }
    }
  return rows;
}

const table = (rows: readonly Row[]) =>
  rows
    .map(
      (r) =>
        `${r.resp === 'quiet' ? 'resp' : 'apnea'} s${r.seed} ±${r.scale}: ${r.pf.toFixed(0)}/${r.truth.toFixed(0)}${r.issue ? ` ${r.issue}` : ''}`,
    )
    .join('; ');

describe('PF portal del alumno a las escalas del equipo (decisión 94)', () => {
  const all: Row[] = [];
  for (const [i, base] of CASES.entries()) {
    it(`${base.label}: la PF aceptada sigue a la verdad a ±20–±80 cm/s, con y sin apnea`, () => {
      const rows = portalRows(i);
      all.push(...rows);
      const tag = table(rows);
      const accepted = rows.filter((r) => r.issue === null);
      // nunca «grave» con una verdad normal (criterio 2 de la misión: el mensaje clínico)
      expect(
        accepted.filter((r) => r.truth < 30 && classifyPortal(r.pf) === 'severe'),
        tag,
      ).toEqual([]);
      // cada captura aceptada cerca de la verdad (el 95 % a ≤ 10 puntos lo exige el agregado)
      expect(
        accepted.filter((r) => Math.abs(r.pf - r.truth) > 15),
        tag,
      ).toEqual([]);
      // la técnica sirve: en apnea, a ±40–±80, casi todas medibles
      const apnea = rows.filter((r) => r.resp === 'apnea-expiratory' && r.scale >= 40);
      expect(apnea.filter((r) => r.issue === null).length / apnea.length, tag).toBeGreaterThanOrEqual(0.8);
    });
  }

  // Revisión adversarial de la decisión 94: justo por debajo del pico (±10–16 cm/s) el pico se recortaba (PF menor) o se
  // plegaba al otro lado y se leía como inversión (cirrosis, verdad 35 %: PF 171–202 % aceptadas), y con el filtro de pared
  // a 300 Hz el valle del grave caía en su banda (PF 30–46 % aceptadas, verdad 76 %). Ahora son aliasing o «filtro de
  // pared»: ninguna captura aceptada se aparta más de 10 puntos.
  for (const base of [CIRRHOSIS_PULMONARY_HYPERTENSION, SEVERE_CONGESTION, AF_MODERATE_CONGESTION]) {
    it(`${base.label}: cerca del Nyquist y con el filtro de pared alto, ninguna PF aceptada falsa`, () => {
      const rows: Row[] = [];
      for (const seed of [1, 4, 8]) {
        const session = openSession(base, 'apnea-expiratory', seed);
        const contact = probeAt(session, 'portal');
        const best = placeGate(session, contact, ['pvTrunk'])!;
        for (const [scale, wallFilterHz] of [
          [10, 25],
          [14, 25],
          [16, 25],
          [40, 300],
        ] as const) {
          const prfHz = Math.min(prfFromNyquistCms(scale, TR.f0Doppler), maxPrfForDepth(best.r + 2, 1_540_000));
          const m = acquire(session, contact, best, 'portal', { prfHz, seconds: 8.5, wallFilterHz }).captures.at(-1)?.m ?? null;
          rows.push({
            caseId: base.id,
            resp: 'apnea-expiratory',
            seed,
            scale: wallFilterHz === 25 ? scale : -scale,
            pf: m ? m.pulsatilityFraction : Number.NaN,
            ...truthOf(session, m),
            issue: m ? m.quality.issue : 'sin medida',
          });
        }
      }
      expect(
        rows.filter((r) => r.issue === null && Math.abs(r.pf - r.truth) > 10),
        table(rows),
      ).toEqual([]);
    });
  }

  it('agregado: |PF − verdad| ≤ 10 puntos en ≥ 95 % de las capturas aceptadas', () => {
    // tabla para el informe de la decisión (PF_TABLE=ruta): una fila por captura
    if (process.env.PF_TABLE) writeFileSync(process.env.PF_TABLE, JSON.stringify(all));
    expect(all.length, 'las pruebas por caso deben correr antes').toBe(CASES.length * RESPIRATIONS.length * SEEDS.length * SCALES.length);
    const accepted = all.filter((r) => r.issue === null);
    const within = accepted.filter((r) => Math.abs(r.pf - r.truth) <= 10);
    expect(accepted.length).toBeGreaterThan(all.length / 2);
    expect(within.length / accepted.length, table(accepted.filter((r) => Math.abs(r.pf - r.truth) > 10))).toBeGreaterThanOrEqual(0.95);
  });
});
