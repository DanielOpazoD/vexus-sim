/** Auditoría del motor existente; no genera curvas clínicas de referencia. */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { AnatomyScene } from '../../src/anatomy/scene';
import { NORMAL_ADULT } from '../../src/cases';
import { PhysiologyEngine } from '../../src/physiology/engine';
import { clonePatient, type PatientState } from '../../src/physiology/patientState';
import { venousComparisonTrace } from '../../src/physiology/venousComparison';
import { measurePhysiologyTruth } from '../../src/vexus/measurements';

type ScalarKey = 'rapMeanMmHg' | 'intraAbdominalPressureMmHg' | 'rvFunction' | 'raCompliance' | 'tricuspidRegurgitation';
interface AuditCase {
  parameter: string;
  value: number;
  patch: Partial<PatientState>;
}
export function venousAuditCases(): AuditCase[] {
  const sweeps: Array<[ScalarKey, number[]]> = [
    ['rapMeanMmHg', [2, 5, 10, 15, 20]],
    ['intraAbdominalPressureMmHg', [0, 5, 10, 15, 20]],
    ['rvFunction', [0.2, 0.5, 0.85, 1]],
    ['raCompliance', [0.3, 0.5, 1, 1.5, 2]],
    ['tricuspidRegurgitation', [0, 0.2, 0.5, 0.8, 1]],
  ];
  const cases: AuditCase[] = sweeps.flatMap(([parameter, values]) =>
    values.map((value) => ({ parameter, value, patch: { [parameter]: value } })),
  );
  for (const value of [0.3, 0.5, 1, 2])
    cases.push({ parameter: 'liver.compliance', value, patch: { liver: { ...NORMAL_ADULT.liver, compliance: value } } });
  for (const [rap, ra, tr] of [
    [2, 0.3, 0],
    [18, 0.3, 0],
    [5, 2, 0.8],
    [18, 2, 0.8],
  ])
    cases.push({ parameter: 'interaction', value: rap, patch: { rapMeanMmHg: rap, raCompliance: ra, tricuspidRegurgitation: tr } });
  return cases;
}

export function runVenousModelAudit() {
  return venousAuditCases().map((cfg) => {
    const patient: PatientState = { ...clonePatient(NORMAL_ADULT), ...cfg.patch, rrVariability: 0, respiratoryPattern: 'apnea-expiratory' };
    const engine = new PhysiologyEngine(patient, new AnatomyScene(patient).vesselAreas(), { historySeconds: 20 });
    for (let i = 0; i < 4000; i++) engine.step();
    const m = measurePhysiologyTruth(engine, { fromT: 6, toT: 16 });
    const point = venousComparisonTrace([engine.sample]).points[0];
    return {
      ...cfg,
      pRaRange: [m.pRaMin, m.pRaMax],
      hv: { s: m.hvS, d: m.hvD, a: m.hvA, sd: m.hvSD, pattern: m.hepaticPattern },
      portal: { max: m.pvMax, min: m.pvMin, pf: m.portalPF },
      renal: { s: m.rvS, d: m.rvD, min: m.rvMin, pattern: m.renalPattern },
      qHvMean: m.qHvMean,
      qPortalMean: m.qPvMean,
      coMlS: engine.circulation.state.cardiacOutputMlS,
      comparisonPoint: point,
    };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = {
    sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    kind: 'current-model-audit',
    clinicalValidation: false,
    method:
      '32 independent regenerated cases; sinus rhythm, fixed seed, apnea-expiratory, dt=0.004 s; integrate 16 s and measure 6–16 s; not a causal intervention or a PW acquisition',
    results: runVenousModelAudit(),
  };
  const json = JSON.stringify(report, null, 2) + '\n';
  if (process.argv[2]) writeFileSync(process.argv[2], json);
  else process.stdout.write(json);
}
