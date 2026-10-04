/** Reproducible Q/A sensitivity with the same production acquisition/capture route.
 * Effective interlobar reference areas vary only the local velocity scale;
 * anatomy, total renal flow and the pressure-volume network stay unchanged.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../../src/cases';
import { PhysiologyEngine } from '../../src/physiology/engine';
import { INTERLOBAR_FLOW_SHARE, VESSEL_IDS, VESSEL_META } from '../../src/physiology/vessels';
import { PwDopplerChain } from '../../src/doppler/pwChain';
import { prfFromNyquistCms } from '../../src/core/units';
import { acquire, openSession, placeGate, probeAt, TR } from '../../src/validation/support/studentChain';
const results = [];
for (const patient of [NORMAL_ADULT, SEVERE_CONGESTION])
  for (const share of [0.12, 0.06, 0.05, 0.04]) {
    const session = openSession(patient, 'apnea-expiratory');
    const areas = session.scene.vesselAreas();
    for (const id of VESSEL_IDS)
      if (VESSEL_META[id].system === 'interlobarArtery' || VESSEL_META[id].system === 'interlobarVein')
        areas[id] *= INTERLOBAR_FLOW_SHARE / share;
    session.engine = new PhysiologyEngine(session.patient, areas);
    session.chain = new PwDopplerChain(session.anatomy, patient.seed + 7919 * 3);
    for (let i = 0; i < 7500; i++) session.engine.step();
    const start = session.engine.clock.t;
    const contact = probeAt(session, 'renal');
    const gate = placeGate(session, contact, ['interlobarVein1', 'interlobarVein2', 'interlobarVein3']);
    if (!gate) throw new Error(`No renal gate for ${patient.id}`);
    const { captures } = acquire(session, contact, gate, 'renal', {
      prfHz: prfFromNyquistCms(80, TR.f0Doppler),
      wallFilterHz: 15,
      seconds: 8,
    });
    const m = captures.at(-1)?.m;
    const samples = session.engine.samples.filter((s) => s.t > start);
    const summary = (v: number[]) => ({ min: Math.min(...v), max: Math.max(...v), mean: v.reduce((a, b) => a + b, 0) / v.length });
    const r = {
      case: patient.id,
      share,
      representedShare: 3 * share,
      omittedShare: 1 - 3 * share,
      geometryUnchanged: true,
      totalRenalFlowMlS: summary(samples.map((s) => s.qRenalVein)),
      sectionMeanVenousCms: summary(samples.map((s) => s.velocities.interlobarVein2 / 10)),
      sectionMeanArterialCms: summary(samples.map((s) => s.velocities.interlobarArtery2 / 10)),
      observed: m ? { s: m.sPeak, d: m.dPeak, min: m.vMin, pattern: m.pattern, quality: m.quality } : null,
    };
    console.log(JSON.stringify(r));
    results.push(r);
  }
writeFileSync(
  process.argv[2] ?? '/tmp/renal-territory-benchmark.json',
  JSON.stringify(
    {
      clinicalValidation: false,
      sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      sourceTree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim(),
      workingTreeDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()),
      method:
        '30 s warmup; apnea expiration; 8 s actual IQ; axial Nyquist 80 cm/s; 2.5 MHz; wall filter 15 Hz; FFT128. Geometry fixed; effective interlobar reference areas isolate hypothetical perfusion shares, not measured human fractions.',
      results,
    },
    null,
    2,
  ),
);
