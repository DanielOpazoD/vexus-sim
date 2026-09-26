// @tier slow
import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import {
  ABDOMINAL_HYPERTENSION,
  CIRRHOSIS_PULMONARY_HYPERTENSION,
  MECHANICAL_VENTILATION,
  NORMAL_ADULT,
  SEVERE_CONGESTION,
  TRICUSPID_REGURGITATION,
} from '../cases';
import { CASE_TEACHING } from '../cases/teaching';
import { PhysiologyEngine, type PhysiologySample } from '../physiology/engine';
import { clonePatient, type PatientState, type RespiratoryPattern } from '../physiology/patientState';
import { peepPleuralShiftMmHg } from '../physiology/respiratory';
import { classifyModifiedVexus, classifyVexusC, type VexusContext } from '../vexus/classification';
import { measurePhysiologyTruth } from '../vexus/measurements';

/**
 * Casos trampa (decisión 82) con el motor completo y la verdad fisiológica: cada uno da la discordancia que enseña
 * (el grado frente a la PAD) con respiración tranquila y en apnea espiratoria, la técnica con la que se capturan las
 * venas, y un control con el confusor quitado muestra que la causa es el confusor y no el resto del caso. «PAD media» es
 * la media de la ventana, con el ciclo respiratorio; la PAD del caso es la de fin de espiración.
 */
const PATTERNS: RespiratoryPattern[] = ['quiet', 'apnea-expiratory'];

function observe(patient: PatientState, pattern: RespiratoryPattern) {
  const p = { ...clonePatient(patient), respiratoryPattern: pattern };
  const e = new PhysiologyEngine(p, new AnatomyScene(p).vesselAreas(), { historySeconds: 20 });
  while (e.clock.t < 18) e.step();
  const m = measurePhysiologyTruth(e, { fromT: 6, toT: 18 });
  const w = e.samples.filter((s) => s.t >= 6);
  const mean = (get: (s: PhysiologySample) => number) => w.reduce((a, s) => a + get(s), 0) / w.length;
  const veins = { ivcMaxDiameterMm: m.ivcMaxMm, hepatic: m.hepaticPattern, portalPulsatilityFraction: m.portalPF };
  return {
    m,
    rap: mean((s) => s.pRa),
    /** PAD menos la pleural: el llenado del corazón, que la PEEP no cambia. */
    rapTransmural: mean((s) => s.pRa - s.resp.pleuralMmHg),
    grade: (ctx: VexusContext = {}) => classifyVexusC({ ...veins, renal: m.renalPattern }, ctx),
    modified: (ctx: VexusContext = {}) => classifyModifiedVexus(veins, ctx),
    tag: `${patient.id}/${pattern}: ${JSON.stringify({ ivc: m.ivcMaxMm, S: m.hvS, PF: m.portalPF, renal: m.renalPattern })}`,
  };
}

/** El mismo caso con el confusor quitado. */
const without = (p: PatientState, patch: Partial<PatientState>): PatientState => ({ ...clonePatient(p), ...patch });

describe('Casos trampa: la discordancia que enseña cada uno (decisión 82)', () => {
  for (const pattern of PATTERNS) {
    it(`presión intraabdominal alta, ${pattern}: VCI pequeña y grado 0 con la PAD alta; con el contexto, intervalo`, () => {
      // medido (tranquila/apnea): VCI 14,4/15,5 mm con la PAD media 13,0/14,0; S −7,5/−7,3 cm/s; PF 27/26 %; renal continuo
      const r = observe(ABDOMINAL_HYPERTENSION, pattern);
      expect(r.rap, r.tag).toBeGreaterThan(12);
      // < 20 mm con margen: fuera también de la zona de ±2 mm del corte
      expect(r.m.ivcMaxMm, r.tag).toBeLessThan(17);
      expect(r.m.hepaticPattern, r.tag).toBe('severe');
      expect(r.grade().grade, r.tag).toBe(0);
      // con «Presión intraabdominal alta» marcada la VCI pequeña no cierra en 0: 0 hasta lo que dan las venas (la S
      // invertida sola, 2)
      const ctx = CASE_TEACHING['abdominal-hypertension'].context;
      const g = r.grade(ctx);
      expect(g.grade, r.tag).toBeNull();
      expect(g.gradeRange, r.tag).toEqual([0, 2]);
      expect(g.warnings.map((w) => w.territory)).toEqual(['ivc']);
      expect(r.modified(ctx).gradeRange, r.tag).toEqual([0, 2]);
      // control: el mismo corazón sin la presión intraabdominal tiene la VCI dilatada y grado 3 (medido 29,3/29,6 mm)
      const c = observe(
        without(ABDOMINAL_HYPERTENSION, { intraAbdominalPressureMmHg: SEVERE_CONGESTION.intraAbdominalPressureMmHg }),
        pattern,
      );
      expect(c.m.ivcMaxMm, c.tag).toBeGreaterThanOrEqual(22);
      expect(c.grade().grade, c.tag).toBeGreaterThanOrEqual(2);
      // la S invertida es de la IT funcional con la PAD alta: sin la IT la suprahepática queda en S < D (medido
      // 13,1/15,3 y 12,1/13,9 cm/s), y con el contexto el intervalo es 0–1
      const t = observe(without(ABDOMINAL_HYPERTENSION, { tricuspidRegurgitation: NORMAL_ADULT.tricuspidRegurgitation }), pattern);
      expect(t.m.hepaticPattern, t.tag).toBe('mild');
      expect(t.grade(ctx).gradeRange, t.tag).toEqual([0, 1]);
    });

    it(`IT grave con PAD casi normal, ${pattern}: grado 2 por la S invertida sin congestión`, () => {
      // medido: PAD media 7,0/8,0 mmHg; VCI 24,3/25,2 mm; S −7,9/−8,2 cm/s; PF 33/34 %; renal continuo
      const r = observe(TRICUSPID_REGURGITATION, pattern);
      // los estudios que comparan el VExUS con la PAD toman > 12 mmHg como congestión
      expect(r.rap, r.tag).toBeLessThan(9);
      // la VCI abre la puerta del grado lejos de la zona de ±2 mm del corte
      expect(r.m.ivcMaxMm, r.tag).toBeGreaterThan(22);
      expect(r.grade().ivcNearThreshold, r.tag).toBe(false);
      // S invertida con margen sobre el umbral de −2 cm/s
      expect(r.m.hvS, r.tag).toBeLessThan(-5);
      expect(r.m.portalPF, r.tag).toBeLessThan(50);
      expect(r.m.renalPattern, r.tag).toBe('continuous');
      expect(r.grade().grade, r.tag).toBe(2);
      // ninguna casilla corrige la IT: el caso no declara confusores
      expect(CASE_TEACHING['tricuspid-regurgitation'].context).toEqual({});
      // control: sin la IT la suprahepática es normal y el grado 1 (la VCI de esa PAD sola)
      const c = observe(without(TRICUSPID_REGURGITATION, { tricuspidRegurgitation: NORMAL_ADULT.tricuspidRegurgitation }), pattern);
      expect(c.m.hepaticPattern, c.tag).toBe('normal');
      expect(c.grade().grade, c.tag).toBe(1);
    });

    it(`ventilación con presión positiva, ${pattern}: VCI dilatada y grado 1 con el llenado de un corazón de VCI pequeña`, () => {
      // medido: VCI 26,4/23,0 mm; PAD media 9,0/7,0 y transmural 7,7 (el sano, 8,7); S/D 1,6/1,8; PF 35/17 %
      const r = observe(MECHANICAL_VENTILATION, pattern);
      expect(r.m.ivcMaxMm, r.tag).toBeGreaterThanOrEqual(21);
      expect(r.m.hepaticPattern, r.tag).toBe('normal');
      expect(r.m.portalPF, r.tag).toBeLessThan(50);
      expect(r.m.renalPattern, r.tag).toBe('continuous');
      expect(r.grade().grade, r.tag).toBe(1);
      // en la pausa espiratoria, donde se miden las venas con el ventilador, también la porta es normal
      if (pattern === 'apnea-expiratory') expect(r.m.portalPF, r.tag).toBeLessThan(30);
      // control: el mismo corazón con el mismo llenado respirando solo (la PAD sin la subida pleural de la PEEP) tiene la
      // VCI pequeña y grado 0 (medido 15,7/16,7 mm): la VCI dilatada es de la PAD absoluta, no del llenado
      const spont = observe(
        without(MECHANICAL_VENTILATION, {
          ventilation: 'spontaneous',
          peepCmH2O: 0,
          respiratoryRateMin: NORMAL_ADULT.respiratoryRateMin,
          rapMeanMmHg: MECHANICAL_VENTILATION.rapMeanMmHg - peepPleuralShiftMmHg(MECHANICAL_VENTILATION.peepCmH2O),
        }),
        pattern,
      );
      expect(Math.abs(spont.rapTransmural - r.rapTransmural), spont.tag).toBeLessThan(0.2);
      expect(spont.m.ivcMaxMm, spont.tag).toBeLessThan(20);
      expect(spont.grade().grade, spont.tag).toBe(0);
      // y menos lleno que el sano de referencia
      expect(r.rapTransmural, r.tag).toBeLessThan(observe(NORMAL_ADULT, pattern).rapTransmural);
      // la ventilación avisa sobre la VCI pero no la quita: el grado no cambia
      const g = r.grade(CASE_TEACHING['mechanical-ventilation'].context);
      expect(g.grade, r.tag).toBe(1);
      expect(g.warnings).toEqual([expect.objectContaining({ territory: 'ivc', excluded: false })]);
    });

    it(`cirrosis con fallo derecho, ${pattern}: la porta subestima con la PAD alta`, () => {
      // medido: PAD media 17,1/18,1; PF 32/35 % (sin cirrosis 69/76); gradiente portal 15,9/14,9 mmHg (sin cirrosis
      // 4,4/4,0); S −7,3/−6,8 cm/s; renal monofásico
      const r = observe(CIRRHOSIS_PULMONARY_HYPERTENSION, pattern);
      const heart = observe(SEVERE_CONGESTION, pattern);
      expect(r.rap, r.tag).toBeGreaterThan(12);
      // no grave con margen: la envolvente del alumno sobrestima 5–13 puntos la PF de una porta lenta (medido 34–42 % en
      // apnea con la verdad en 35)
      expect(r.m.portalPF, r.tag).toBeLessThan(40);
      expect(heart.m.portalPF, heart.tag).toBeGreaterThanOrEqual(60);
      // hipertensión portal clínicamente significativa (≥ 10 mmHg) que el corazón solo no da
      expect(r.m.pSpMean - r.m.pHepMean, r.tag).toBeGreaterThanOrEqual(10);
      expect(heart.m.pSpMean - heart.m.pHepMean, heart.tag).toBeLessThan(6);
      // la suprahepática y el riñón siguen graves: el grado de siempre es 3
      expect(r.m.hepaticPattern, r.tag).toBe('severe');
      expect(r.m.renalPattern, r.tag).toBe('monophasic');
      expect(r.grade().grade, r.tag).toBe(3);
      // con «Cirrosis» marcada la porta deja de contar; la S invertida sí cuenta (la cirrosis aplana la suprahepática,
      // no la invierte) y el grado sigue en 3
      const g = r.grade(CASE_TEACHING['cirrhosis-pulmonary-hypertension'].context);
      expect(g.grade, r.tag).toBe(3);
      expect(g.warnings.filter((w) => w.excluded).map((w) => w.territory)).toEqual(['portal']);
    });
  }
});
