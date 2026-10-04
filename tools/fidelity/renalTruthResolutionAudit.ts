/** Research: distinguish continuous physical flow from a default-equipment threshold.
 * No defaults change. Effective interlobar areas isolate a perfusion-share sensitivity.
 */
import { writeFileSync } from 'node:fs';
import { CASES } from '../../src/cases';
import { AnatomyScene } from '../../src/anatomy/scene';
import { PhysiologyEngine } from '../../src/physiology/engine';
import { clonePatient } from '../../src/physiology/patientState';
import { INTERLOBAR_FLOW_SHARE, VESSEL_IDS, VESSEL_META } from '../../src/physiology/vessels';
import { measurePhysiologyTruth } from '../../src/vexus/measurements';
import { renalPatternFromPeaks, RENAL_INTERRUPTION_FLOOR_CMS } from '../../src/vexus/classification';

const rows = [];
for (const base of CASES)
  for (const share of [0.12, 0.06, 0.05, 0.04])
    for (const offset of [0, 1, 2])
      for (const respiratoryPattern of ['apnea-expiratory', 'quiet'] as const) {
        const patient = { ...clonePatient(base), seed: base.seed + offset, respiratoryPattern };
        const factor = share / INTERLOBAR_FLOW_SHARE;
        const areas = new AnatomyScene(patient).vesselAreas();
        for (const id of VESSEL_IDS)
          if (VESSEL_META[id].system === 'interlobarArtery' || VESSEL_META[id].system === 'interlobarVein') areas[id] /= factor;
        const engine = new PhysiologyEngine(patient, areas, { historySeconds: 20 });
        for (let i = 0; i < 4000; i++) engine.step();
        const m = measurePhysiologyTruth(engine, { fromT: 6, toT: 16 });
        const withoutInstrumentFloor = renalPatternFromPeaks(m.rvS, m.rvD, m.rvMin, 0);
        rows.push({
          case: patient.id,
          share,
          factor,
          seed: patient.seed,
          respiratoryPattern,
          meanSectionVelocityCms: { s: m.rvS, d: m.rvD, min: m.rvMin },
          defaultFloorCms: RENAL_INTERRUPTION_FLOOR_CMS,
          referencePattern: m.renalPattern,
          withoutInstrumentFloor,
          floorChangesPattern: withoutInstrumentFloor !== m.renalPattern,
        });
      }
const result = {
  clinicalValidation: false,
  note: 'Comparison of algorithms on clean section-mean Q/A. floor=0 retains the same relative 10% threshold; it is not adopted as a clinically validated classifier. Modified engine areas are a counterfactual velocity sensitivity, not new vessel anatomy.',
  rows,
};
writeFileSync('/tmp/renal-truth-resolution-audit.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify({ scenarios: rows.length, differing: rows.filter((r) => r.floorChangesPattern) }, null, 2));
