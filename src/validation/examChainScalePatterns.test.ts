// @tier slow
import { describe, expect, it } from 'vitest';
import { AF_MODERATE_CONGESTION, CASES } from '../cases';
import { maxPrfForDepth } from '../app/equipment';
import { prfFromNyquistCms } from '../core/units';
import type { StartPoint } from '../app/startPoints';
import type { RespiratoryPattern } from '../physiology/patientState';
import type { VesselId } from '../physiology/vessels';
import { measurePhysiologyTruth } from '../vexus/measurements';
import { acquire, openSession, placeGate, probeAt, TR } from './support/studentChain';

/**
 * Suprahepática e interlobar del alumno frente a la escala (decisión 94), por la ruta de la aplicación: los 7 casos, apnea
 * y respiración tranquila, ±20–±80 cm/s. Ninguna captura aceptada puede dar un patrón falso. En main a386e5e la interlobar
 * sí lo daba a ±80 (PRF 5200): el clutter simétrico del riñón llega a ±12 cm/s por encima del filtro de pared y la traza
 * de la vena lo leía como flujo sistólico (grave y cirrosis, monofásicas, salían «continuas»; el sano «bifásico»). Con la
 * envolvente unilateral y la pausa sostenida ≥ 20 ms (la de la verdad) no pasa. La técnica sirve: en apnea la escala
 * adecuada da capturas medibles.
 */
const SCALES = [20, 40, 60, 80] as const;
const RESPIRATIONS: RespiratoryPattern[] = ['apnea-expiratory', 'quiet'];

interface Row {
  resp: RespiratoryPattern;
  scale: number;
  pattern: string;
  truth: string;
  issue: string | null;
  near: boolean;
}

/** Una captura de `kind` con la escala `scale`, tras `seconds` con la puerta quieta en esta sesión. */
function captureRow(
  kind: 'hepatic' | 'renal',
  session: ReturnType<typeof openSession>,
  contact: ReturnType<typeof probeAt>,
  best: NonNullable<ReturnType<typeof placeGate>>,
  resp: RespiratoryPattern,
  scale: number,
  seconds: number,
): Row {
  const prfHz = Math.min(prfFromNyquistCms(scale, TR.f0Doppler), maxPrfForDepth(best.r + 2, 1_540_000));
  const m = acquire(session, contact, best, kind, { prfHz, seconds }).captures.at(-1)?.m ?? null;
  const tNow = session.engine.clock.t;
  const truth = measurePhysiologyTruth(session.engine, { fromT: tNow - 7, toT: tNow });
  const ratio = truth.rvS / truth.rvD;
  return {
    resp,
    scale,
    pattern: m ? m.pattern : 'sin medida',
    truth: kind === 'hepatic' ? truth.hepaticPattern : truth.renalPattern,
    issue: m ? m.quality.issue : 'sin medida',
    // frontera monofásico/bifásico (S = 30 % de D): como la cadena del alumno, se acepta la clase vecina
    near: kind === 'renal' && Math.abs(ratio - 0.3) < 0.1 && ['monophasic', 'biphasic'].includes(truth.renalPattern),
  };
}

/** Una sesión por respiración; el alumno cambia la escala y espera 8,5 s antes de capturar. */
function rows(kind: 'hepatic' | 'renal', caseIndex: number, window: StartPoint['id'], vessels: VesselId[]): Row[] {
  const base = CASES[caseIndex];
  const out: Row[] = [];
  for (const resp of RESPIRATIONS) {
    const session = openSession(base, resp);
    const contact = probeAt(session, window);
    const best = placeGate(session, contact, vessels);
    expect(best, `${base.id}: sin ${kind} en la ventana ${window}`).not.toBeNull();
    for (const scale of SCALES) out.push(captureRow(kind, session, contact, best!, resp, scale, 8.5));
  }
  return out;
}

/**
 * Interlobar en apnea con la escala alta, una sesión nueva por semilla y escala (captura a los 10 s de colocar la puerta):
 * así la midió la revisión de la decisión 94 y así fallaba en main (7 de 49 capturas aceptadas con un patrón falso, 6 de
 * ellas a ±60–±80).
 */
function renalHighScaleRows(caseIndex: number): Row[] {
  const out: Row[] = [];
  for (const seed of [0, 1, 2])
    for (const scale of [60, 80]) {
      const session = openSession(CASES[caseIndex], 'apnea-expiratory', seed);
      const contact = probeAt(session, 'renal');
      const best = placeGate(session, contact, RENAL_VEINS);
      expect(best).not.toBeNull();
      out.push({ ...captureRow('renal', session, contact, best!, 'apnea-expiratory', scale, 10), scale: scale + seed / 10 });
    }
  return out;
}

const RENAL_VEINS: VesselId[] = ['interlobarVein1', 'interlobarVein2', 'interlobarVein3'];

const tagOf = (rs: readonly Row[]) =>
  rs.map((r) => `${r.resp === 'quiet' ? 'resp' : 'apnea'} ±${r.scale}: ${r.pattern}/${r.truth}${r.issue ? ` ${r.issue}` : ''}`).join('; ');
const falsePattern = (r: Row) => r.issue === null && r.pattern !== r.truth && !(r.near && ['monophasic', 'biphasic'].includes(r.pattern));

describe('Patrón de la suprahepática y de la interlobar a las escalas del equipo (decisión 94)', () => {
  for (const [i, base] of CASES.entries()) {
    it(`${base.label}: suprahepática intercostal, ninguna captura aceptada falsa y medible en apnea`, () => {
      const rs = rows('hepatic', i, 'intercostal', ['hvRight']);
      expect(rs.filter(falsePattern), tagOf(rs)).toEqual([]);
      // en apnea a ±40–±80 la técnica sirve (la FA se rechaza de más a propósito: decisión 49)
      const apnea = rs.filter((r) => r.resp === 'apnea-expiratory' && r.scale >= 40);
      const min = base === AF_MODERATE_CONGESTION ? 1 / 3 : 2 / 3;
      expect(apnea.filter((r) => r.issue === null).length / apnea.length, tagOf(rs)).toBeGreaterThanOrEqual(min);
    });

    it(`${base.label}: interlobar, ninguna captura aceptada falsa y medible en apnea a ±80`, () => {
      const rs = [...rows('renal', i, 'renal', RENAL_VEINS), ...renalHighScaleRows(i)];
      expect(rs.filter(falsePattern), tagOf(rs)).toEqual([]);
      // la técnica sirve: en apnea a ±80 casi todas medibles
      const high = rs.filter((r) => r.resp === 'apnea-expiratory' && Math.floor(r.scale) === 80);
      expect(high.filter((r) => r.issue === null).length / high.length, tagOf(rs)).toBeGreaterThanOrEqual(0.75);
    });
  }
});
