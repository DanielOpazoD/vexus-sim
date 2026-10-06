// @tier slow
import { describe, expect, it } from 'vitest';
import {
  ABDOMINAL_HYPERTENSION,
  AF_MODERATE_CONGESTION,
  CIRRHOSIS_PULMONARY_HYPERTENSION,
  MECHANICAL_VENTILATION,
  NORMAL_ADULT,
  SEVERE_CONGESTION,
  TRICUSPID_REGURGITATION,
} from '../cases';
import { type START_POINTS } from '../app/startPoints';
import { prfFromNyquistCms } from '../core/units';
import type { CaptureResult } from '../doppler/capture';
import type { PatientState, RespiratoryPattern } from '../physiology/patientState';
import type { VesselId } from '../physiology/vessels';
import { CONVEX_C35 } from '../probe/probe';
import { classifyPortal, classifyVexusC } from '../vexus/classification';
import { measurePhysiologyTruth } from '../vexus/measurements';
import { acquire, openSession, placeGate, probeAt } from './support/studentChain';

/**
 * Cadena completa del ALUMNO (Fase 0): fisiología → puerta PW colocada sobre el vaso
 * desde una ventana real → IQ → filtro → espectro → medición observada (la misma
 * función que usa la pestaña Medir) → grado VExUS. Se compara con la verdad
 * fisiológica del caso. Antes solo la vena hepática del caso sano estaba cubierta; la
 * portal, la renal y el caso de FA no tenían ninguna prueba de extremo a extremo.
 */
interface Territory {
  kind: 'hepatic' | 'portal' | 'renal';
  window: (typeof START_POINTS)[number]['id'];
  vessels: VesselId[];
}
const TERRITORIES: Territory[] = [
  { kind: 'hepatic', window: 'intercostal', vessels: ['hvRight'] },
  // porta principal (la muestra que recomienda VExUS): corre craneocaudal y la respiración la desliza por su eje
  { kind: 'portal', window: 'portalTrunk', vessels: ['pvTrunk'] },
  { kind: 'renal', window: 'renal', vessels: ['interlobarVein1', 'interlobarVein2', 'interlobarVein3'] },
];

/**
 * Examen de los territorios con la técnica del operador (puerta dentro de la luz con el mejor ángulo, sin mirar la ventana
 * acústica, longitud ≤ 2·bd, porta a ±40 cm/s y otros territorios hasta el límite de la profundidad: PRF ≤ 0,9·c/2d, hasta 6 kHz, como sube el
 * operador la escala cuando el flujo se pliega) por la ruta de la aplicación (`support/studentChain.ts`, decisión 93):
 * la puerta de `pwGate`, con la transmisión real, y la captura de «Capturar» tras 8,5 s con la puerta quieta. Hasta la
 * decisión 93 esta prueba usaba una copia de la puerta con la transmisión fija en 0,3 (−10 dB; la real es −29 a −32 dB
 * en la porta): la PF que dependía de la escala no se veía.
 */
function examine(base: PatientState, respiratoryPattern: RespiratoryPattern = 'apnea-expiratory', territories: Territory[] = TERRITORIES) {
  const session = openSession(base, respiratoryPattern);
  const observed: Record<Territory['kind'], unknown> = { hepatic: null, portal: null, renal: null };
  let portalTruthPF: number | undefined;
  for (const ter of territories) {
    const contact = probeAt(session, ter.window);
    const best = placeGate(session, contact, ter.vessels, { acoustic: false, maxDepthMm: 170 });
    expect(best, `${base.id}: ${ter.kind} sin vaso en la ventana ${ter.window}`).not.toBeNull();
    // A portal scale of ±40 cm/s resolves slow flow; the depth ceiling is not a useful portal preset.
    const prfHz = Math.min(
      ter.kind === 'portal' ? prfFromNyquistCms(40, CONVEX_C35.f0Doppler) : 6000,
      Math.floor((0.9 * 1_540_000) / (2 * best!.r)),
    );
    const { captures } = acquire(session, contact, best!, ter.kind, { prfHz, seconds: 8.5, gateMm: Math.min(4, 2 * best!.bd) });
    observed[ter.kind] = captures.at(-1)?.m ?? null;
    if (ter.kind === 'portal') {
      const beats = captures.at(-1)?.m?.measuredBeats;
      if (beats?.length) {
        const last = beats.at(-1)!;
        // AF varies by beat: compare this capture, before the subsequent renal acquisition.
        portalTruthPF = measurePhysiologyTruth(session.engine, { fromT: beats[0].tR - 1e-6, toT: last.tR + last.rr + 1e-6 }).portalPF;
      }
    }
  }
  const { engine } = session;
  const truth = measurePhysiologyTruth(engine, { fromT: engine.clock.t - 10, toT: engine.clock.t });
  if (portalTruthPF !== undefined) truth.portalPF = portalTruthPF;
  return {
    truth,
    hepatic: observed.hepatic as CaptureResult['hepatic'] | null,
    portal: observed.portal as CaptureResult['portal'] | null,
    renal: observed.renal as CaptureResult['renal'] | null,
  };
}

/**
 * Capturas sucesivas de la VSH derecha desde la ventana intercostal, cada 2 s, como las hace la pestaña Medir, con la
 * puerta quieta. `window`: la puerta busca además ventana acústica (como los ganchos de la e2e), no solo anatomía.
 */
function hepaticCaptures(base: PatientState, respiratoryPattern: RespiratoryPattern, seconds: number, window: boolean, prfHz?: number) {
  const session = openSession(base, respiratoryPattern, 0, seconds + 4);
  const contact = probeAt(session, 'intercostal');
  const best = placeGate(session, contact, ['hvRight'], { acoustic: window, maxDepthMm: 170 })!;
  const prf = prfHz ?? Math.min(6000, Math.floor((0.9 * 1_540_000) / (2 * best.r)));
  const t0 = session.engine.clock.t;
  const { captures } = acquire(session, contact, best, 'hepatic', {
    prfHz: prf,
    seconds,
    captureEvery: 2,
    firstAt: 8,
    gateMm: Math.min(4, 2 * best.bd),
  });
  const truth = measurePhysiologyTruth(session.engine, { fromT: t0 + 4, toT: session.engine.clock.t });
  return {
    captures: captures.flatMap(({ t, m }) => (m ? [{ t: +t.toFixed(1), pattern: m.pattern, issue: m.quality.issue }] : [])),
    truth,
  };
}

/**
 * Capturas renales sucesivas cada 2 s desde el punto de partida «Renal», con la puerta en la vena
 * interlobar y la PRF por defecto del equipo (2600 Hz), como las hace la pestaña Medir.
 */
function renalCaptures(base: PatientState, seed: number, seconds: number, prfHz = 2600) {
  const session = openSession({ ...base, seed }, 'apnea-expiratory', 0, seconds + 4);
  const contact = probeAt(session, 'renal');
  const best = placeGate(session, contact, ['interlobarVein1', 'interlobarVein2', 'interlobarVein3'], {
    acoustic: false,
    maxDepthMm: 170,
  })!;
  const t0 = session.engine.clock.t;
  const { captures } = acquire(session, contact, best, 'renal', {
    prfHz,
    seconds,
    captureEvery: 2,
    firstAt: 8,
    gateMm: Math.min(4, 2 * best.bd),
  });
  const truth = measurePhysiologyTruth(session.engine, { fromT: t0 + 4, toT: session.engine.clock.t });
  return {
    captures: captures.flatMap(({ t, m }) =>
      m ? [{ t: +t.toFixed(1), pattern: m.pattern, issue: m.quality.issue, vMin: +m.vMin.toFixed(2) }] : [],
    ),
    truth,
  };
}

describe('Cadena completa del alumno: puerta → espectro → medición → grado (Fase 0)', () => {
  for (const [base, expectedGrade] of [
    [NORMAL_ADULT, 0],
    [SEVERE_CONGESTION, 3],
    [AF_MODERATE_CONGESTION, 1],
  ] as const) {
    it(`${base.label}: lo medido sobre el espectro coincide con la verdad y da grado ${expectedGrade}`, () => {
      const { truth, hepatic, portal, renal } = examine(base);
      expect(hepatic, 'medición hepática').not.toBeNull();
      expect(portal, 'medición portal').not.toBeNull();
      expect(renal, 'medición renal').not.toBeNull();
      // en apnea, con la técnica del operador, las tres capturas pasan el control de calidad
      expect(hepatic!.quality.issue, 'calidad hepática').toBeNull();
      expect(portal!.quality.issue, 'calidad portal').toBeNull();
      expect(renal!.quality.issue, 'calidad renal').toBeNull();
      // mismo patrón / clase que la verdad fisiológica en los tres territorios
      expect(hepatic!.pattern).toBe(truth.hepaticPattern);
      expect(classifyPortal(portal!.pulsatilityFraction)).toBe(classifyPortal(truth.portalPF));
      // la PF medida sobre la envolvente queda a ≤ 8 puntos de la verdad (medido: 17/13, 73/75, 35/36 %)
      expect(Math.abs(portal!.pulsatilityFraction - truth.portalPF)).toBeLessThan(8);
      // Frontera monofásico/bifásico (S = 30 % de D): la envolvente sobrestima algo más las
      // velocidades bajas que las altas, así que si la verdad está a < 0,1 del umbral se
      // acepta la clase vecina (como el «próximo al umbral» de la PF portal)
      const ratio = truth.rvS / truth.rvD;
      const nearRenalThreshold = Math.abs(ratio - 0.3) < 0.1 && ['monophasic', 'biphasic'].includes(truth.renalPattern);
      if (nearRenalThreshold) expect(['monophasic', 'biphasic']).toContain(renal!.pattern);
      else expect(renal!.pattern).toBe(truth.renalPattern);
      // y el grado con la VCI de la verdad (el calibrador es manual)
      const grade = classifyVexusC({
        ivcMaxDiameterMm: truth.ivcMaxMm,
        hepatic: hepatic!.pattern,
        portalPulsatilityFraction: portal!.pulsatilityFraction,
        renal: renal!.pattern,
      });
      expect(grade.status).toBe('complete');
      expect(grade.grade).toBe(expectedGrade);
    });
  }

  // La otra ventana hepática del protocolo: la VSH media desde la subcostal (decisión 83), que se curva en su plano (decisión
  // 90: el haz la corta a 32° a 1–2 cm de la VCI en espiración, antes 40°). Una cadena aparte de la de los tres territorios
  // (cada `examine` tiene su propio moteado espectral: sumarla a ellos cambiaría sus lecturas). Medido: S/D y patrón como la
  // verdad en los tres casos, también antes de la decisión 90
  for (const base of [NORMAL_ADULT, SEVERE_CONGESTION, AF_MODERATE_CONGESTION]) {
    it(`${base.label}: la VSH media desde la subcostal, en apnea, da el patrón de la verdad`, () => {
      const { truth, hepatic } = examine(base, 'apnea-expiratory', [{ kind: 'hepatic', window: 'subcostal', vessels: ['hvMiddle'] }]);
      expect(hepatic, 'medición hepática').not.toBeNull();
      expect(hepatic!.quality.issue, 'calidad hepática').toBeNull();
      expect(hepatic!.pattern).toBe(truth.hepaticPattern);
    });
  }

  // Con respiración tranquila el tronco portal (más grueso que la puerta) nunca sale de ella. Antes el volumen de muestra
  // perdía la sangre en la primera inspiración y no la recuperaba: PF 167 % en el sano y 136 % en el grave. Con la
  // transmisión real (decisión 94: −32 dB, no −10) la banda del sano es débil y la calidad puede rechazar la captura
  // (algún latido sin traza: «pida apnea»); si la acepta, la PF es la de la verdad. Medido con esta semilla: el sano,
  // «pocos latidos» (dos trazables en su ventana efectiva); el grave, aceptado y a < 12 puntos. Las escalas y las semillas las cubre `examChainScale.test.ts`.
  for (const base of [NORMAL_ADULT, SEVERE_CONGESTION]) {
    it(`${base.label}: la PF portal con respiración tranquila es no medible o coincide con la verdad`, () => {
      const portalOnly = TERRITORIES.filter((t) => t.kind === 'portal');
      const { truth, portal } = examine(base, 'quiet', portalOnly);
      expect(portal, 'medición portal').not.toBeNull();
      if (portal!.quality.issue !== null) {
        if (portal!.quality.issue === 'few-beats') {
          // La ventana efectiva ya no incluye los latidos anteriores sin traza: solo quedan dos válidos.
          expect(portal!.quality.beats).toBe(2);
          expect(portal!.quality.validBeats).toBe(2);
          expect(portal!.measuredBeats).toHaveLength(2);
        } else expect(['intermittent', 'inconsistent']).toContain(portal!.quality.issue);
        return;
      }
      expect(classifyPortal(portal!.pulsatilityFraction)).toBe(classifyPortal(truth.portalPF));
      expect(Math.abs(portal!.pulsatilityFraction - truth.portalPF)).toBeLessThan(12);
    });
  }

  // A la PRF por defecto (2600 Hz) la envolvente de la vena se hunde 3–6 columnas en su PICO, con la
  // sangre llenando el espectro: el mínimo exacto lo leía como pausa y el sano salía bifásico en
  // todas las capturas de esta semilla (antes, con el cuantil y el 30 %, también). Una columna con
  // sangre en el lado de la vena no puede fijar el mínimo; la vena del sano no se detiene.
  it('Adulto sano, renal a 2600 Hz: el hundimiento del detector en el pico no se lee como pausa', () => {
    const { captures, truth } = renalCaptures(NORMAL_ADULT, 6, 20);
    const tag = JSON.stringify(captures);
    expect(truth.renalPattern).toBe('continuous');
    const valid = captures.filter((c) => c.issue === null);
    expect(valid.length, tag).toBeGreaterThan(4);
    expect(
      valid.filter((c) => c.pattern !== 'continuous'),
      tag,
    ).toEqual([]);
  });

  // Fuerza una escala insuficiente para la calibración renal actual. Al bajar el
  // caudal por rama, el aliasing no debe seguir ligado accidentalmente a 2600 Hz.
  it('Congestión grave, renal a 1300 Hz en apnea: no medible por aliasing, no «intermitente»', () => {
    const { captures } = renalCaptures(SEVERE_CONGESTION, SEVERE_CONGESTION.seed, 20, 1300);
    const tag = JSON.stringify(captures);
    expect(captures.length, tag).toBeGreaterThan(4);
    expect(
      captures.filter((c) => c.issue === 'intermittent'),
      tag,
    ).toEqual([]);
    expect(captures.filter((c) => c.issue === 'aliasing').length, tag).toBeGreaterThan(0);
  });

  it('Congestión grave, renal a 2600 Hz: la escala suficiente conserva el patrón diastólico', () => {
    const { captures, truth } = renalCaptures(SEVERE_CONGESTION, SEVERE_CONGESTION.seed, 20);
    const valid = captures.filter((c) => c.issue === null);
    expect(truth.renalPattern).toBe('monophasic');
    expect(valid.length, JSON.stringify(captures)).toBeGreaterThan(4);
    expect(valid.every((c) => c.pattern === 'monophasic')).toBe(true);
  });

  // La interlobar del caso grave entra y sale de la puerta con la respiración: antes se medía «bifásica» (era
  // monofásica); ahora la captura se declara no medible y no entra en el grado. Con la presencia unilateral de la vena
  // (decisión 93: el clutter simétrico del riñón que respira ya no cuenta como sangre) la vena ocupa < 20 % de las
  // columnas y el motivo pasa de «intermitente» a «no hay flujo en la puerta», que también pide apnea.
  it('Congestión grave, interlobar con respiración tranquila: la captura es no medible', () => {
    const renalOnly = TERRITORIES.filter((t) => t.kind === 'renal');
    const { renal } = examine(SEVERE_CONGESTION, 'quiet', renalOnly);
    expect(renal).not.toBeNull();
    expect(['intermittent', 'no-signal']).toContain(renal!.quality.issue);
  });

  // Capturas sucesivas cada 2 s durante 26 s con la puerta quieta, como las haría el alumno: con
  // respiración tranquila la puerta fija ve moverse el vaso y a ratos sale de él o se cuela otro
  // (S invertida en un latido del sano, D invertida en otro). Ninguna captura con el visto bueno de
  // la calidad puede dar un patrón falso. Sin exigir D anterógrada, el sano con ventana daba
  // «grave» con el visto bueno a los 10 s. En apnea, además, la técnica debe servir: la calidad no
  // puede rechazarlo todo (con respiración tranquila puede, y entonces el alumno pide apnea).
  for (const [base, respiration, window] of [
    [NORMAL_ADULT, 'quiet', true],
    [NORMAL_ADULT, 'quiet', false],
    [AF_MODERATE_CONGESTION, 'quiet', true],
    [SEVERE_CONGESTION, 'quiet', true],
    [NORMAL_ADULT, 'apnea-expiratory', true],
    [AF_MODERATE_CONGESTION, 'apnea-expiratory', true],
  ] as const) {
    const apnea = respiration === 'apnea-expiratory';
    it(`${base.label}${window ? ' (puerta con ventana acústica)' : ''}, ${apnea ? 'en apnea' : 'con respiración tranquila'}: cada captura de la VSH es no medible o verdadera`, () => {
      const { captures, truth } = hepaticCaptures(base, respiration, 26, window);
      const tag = JSON.stringify(captures);
      expect(captures.length, tag).toBeGreaterThan(8);
      expect(
        captures.filter((c) => c.issue === null && c.pattern !== truth.hepaticPattern),
        tag,
      ).toEqual([]);
      // En apnea la técnica debe servir. La FA se rechaza de más a propósito (umbral del signo de S
      // sobre D, decisión 49: su S pequeña tiene puntas de signo contrario y el umbral que las
      // ignoraba dejaba pasar una S invertida falsa): basta con un tercio de capturas válidas.
      // Medido: sano 13/13; FA 5/10–8/13 según la realización del moteado espectral.
      const minMeasurable = base === AF_MODERATE_CONGESTION ? 0.3 : 0.8;
      if (apnea) expect(captures.filter((c) => c.issue === null).length / captures.length, tag).toBeGreaterThanOrEqual(minMeasurable);
    });
  }

  // Trampa clínica clásica (§21: el espectrograma responde a PRF y aliasing): con la escala baja el
  // pico S del sano rebasa ±Nyquist, reaparece al otro lado y la medición lee una S invertida,
  // «grave». La calidad debe declararlo aliasing; con la escala adecuada, medible y normal.
  // Medido: PRF 1000–1800 «grave» (antes con el visto bueno a 1000 y 1400); PRF 5000 normal.
  it('Adulto sano: a PRF baja la VSH se pliega e imita la inversión de S, y la calidad lo declara aliasing', () => {
    const low = hepaticCaptures(NORMAL_ADULT, 'apnea-expiratory', 9, false, 1400).captures.at(-1)!;
    expect(low.pattern).toBe('severe');
    expect(low.issue).toBe('aliasing');
    const high = hepaticCaptures(NORMAL_ADULT, 'apnea-expiratory', 9, false, 5000).captures.at(-1)!;
    expect(high).toEqual(expect.objectContaining({ pattern: 'normal', issue: null }));
  });
});

/**
 * Casos trampa (decisión 82) por la cadena del alumno: en apnea espiratoria, la técnica que se enseña, lo medido da la
 * discordancia de cada trampa (grado 0 con la PAD alta, 2 y 1 sin congestión, 3 con la porta leve) y ninguna captura de
 * la VSH con el visto bueno de la calidad es falsa. Con el ventilador ciclando no es así: queda como limitación.
 */
describe('Casos trampa por la cadena del alumno (decisión 82)', () => {
  for (const [base, expectedGrade] of [
    [ABDOMINAL_HYPERTENSION, 0],
    [TRICUSPID_REGURGITATION, 2],
    [MECHANICAL_VENTILATION, 1],
    [CIRRHOSIS_PULMONARY_HYPERTENSION, 3],
  ] as const) {
    it(`${base.label}: en apnea lo medido coincide con la verdad y da grado ${expectedGrade}`, () => {
      const { truth, hepatic, portal, renal } = examine(base);
      for (const [name, m] of [
        ['hepática', hepatic],
        ['portal', portal],
        ['renal', renal],
      ] as const) {
        expect(m, `medición ${name}`).not.toBeNull();
        expect(m!.quality.issue, `calidad ${name}`).toBeNull();
      }
      expect(hepatic!.pattern).toBe(truth.hepaticPattern);
      // lo que cuenta para el grado es si la porta es grave; cerca del 30 % la envolvente puede dar la clase vecina (la
      // PIA: verdad 25–26 %, medida 29–31 %)
      expect(classifyPortal(portal!.pulsatilityFraction) === 'severe').toBe(classifyPortal(truth.portalPF) === 'severe');
      expect(Math.abs(portal!.pulsatilityFraction - truth.portalPF)).toBeLessThan(10);
      expect(renal!.pattern === 'monophasic').toBe(truth.renalPattern === 'monophasic');
      const grade = classifyVexusC({
        ivcMaxDiameterMm: truth.ivcMaxMm,
        hepatic: hepatic!.pattern,
        portalPulsatilityFraction: portal!.pulsatilityFraction,
        renal: renal!.pattern,
      });
      expect(grade.grade).toBe(expectedGrade);
    });

    it(`${base.label}: en apnea cada captura de la VSH es no medible o verdadera, y casi todas medibles`, () => {
      const { captures, truth } = hepaticCaptures(base, 'apnea-expiratory', 26, true);
      const tag = JSON.stringify(captures);
      expect(captures.length, tag).toBeGreaterThan(8);
      expect(
        captures.filter((c) => c.issue === null && c.pattern !== truth.hepaticPattern),
        tag,
      ).toEqual([]);
      expect(captures.filter((c) => c.issue === null).length / captures.length, tag).toBeGreaterThanOrEqual(0.8);
    });
  }

  // Regresión de `ppv-hepatic-capture-false-reversal`: la identidad media sigue siendo suprahepática,
  // pero hay un tramo de 320 ms con <1 % de sangre en la puerta. El espectro residual antes daba
  // una S invertida aceptada; se debe rechazar sin consultar la verdad fisiológica al decidir calidad.
  it('rechaza la falsa inversión suprahepática con pérdida sostenida de sangre en la puerta', () => {
    const base = { ...MECHANICAL_VENTILATION, seed: MECHANICAL_VENTILATION.seed + 4 };
    const { captures, truth } = hepaticCaptures(base, 'quiet', 26, true);
    expect(truth.hepaticPattern).toBe('normal');
    expect(
      captures.filter((c) => c.issue === null && c.pattern === 'severe'),
      JSON.stringify(captures),
    ).toEqual([]);
  });
});
