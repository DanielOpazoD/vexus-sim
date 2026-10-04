/** Sensitivity audit only: modifies an isolated engine, never the application's defaults. */
import { writeFileSync } from 'node:fs';
import { NORMAL_ADULT, SEVERE_CONGESTION, AF_MODERATE_CONGESTION } from '../../src/cases';
import { AnatomyScene } from '../../src/anatomy/scene';
import { PhysiologyEngine } from '../../src/physiology/engine';
const results = [];
for (const base of [NORMAL_ADULT, SEVERE_CONGESTION, AF_MODERATE_CONGESTION]) {
  for (const compliance of [0.5, 1, 2, 4.5, 9, 18]) {
    const patient = { ...base, respiratoryPattern: 'apnea-expiratory' as const };
    const scene = new AnatomyScene(patient),
      engine = new PhysiologyEngine(patient, scene.vesselAreas());
    // Preserve the initial elastic pressure when changing C; do not introduce a preload jump.
    const k = engine.network.k,
      state = engine.network.state;
    state.vRenal = k.v0Renal + ((state.vRenal - k.v0Renal) * compliance) / k.cRenal;
    k.cRenal = compliance;
    for (let i = 0; i < 15000; i++) engine.step();
    const samples = Array.from({ length: 2500 }, () => engine.step());
    const flow = samples.map((s) => s.qRenalVein),
      max = Math.max(...flow),
      min = Math.min(...flow);
    const pressure = samples.map((s) => s.pRenal),
      cava = samples.map((s) => s.pIvc);
    results.push({
      case: base.id,
      compliance,
      meanFlowMlS: flow.reduce((a, b) => a + b, 0) / flow.length,
      minFlowMlS: min,
      maxFlowMlS: max,
      globalPulsatility: (max - min) / max,
      reverseFraction: flow.filter((q) => q < 0).length / flow.length,
      renalPressureSwingMmHg: Math.max(...pressure) - Math.min(...pressure),
      cavaPressureSwingMmHg: Math.max(...cava) - Math.min(...cava),
    });
  }
}
writeFileSync(
  process.argv[2] ?? '/tmp/renal-compliance-audit.json',
  JSON.stringify(
    {
      note: 'Exploratory model sensitivity, not clinical calibration. Global extrema over 10 s include RR variability.',
      results,
    },
    null,
    2,
  ),
);
console.table(results);
