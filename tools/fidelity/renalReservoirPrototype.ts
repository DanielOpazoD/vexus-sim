/** RESEARCH ONLY. A downstream venous reservoir driven by existing engine boundaries.
 * Not installed in production; no feedback to the source circulation. Tests whether
 * separating interlobar and main renal venous flow can explain distal attenuation.
 * All reservoir constants below are exploratory, not measured clinical parameters.
 */
import { writeFileSync } from 'node:fs';
import { NORMAL_ADULT, SEVERE_CONGESTION, AF_MODERATE_CONGESTION } from '../../src/cases';
import { AnatomyScene } from '../../src/anatomy/scene';
import { PhysiologyEngine } from '../../src/physiology/engine';
const results = [];
for (const base of [NORMAL_ADULT, SEVERE_CONGESTION, AF_MODERATE_CONGESTION]) {
  for (const c0 of [2, 6, 10]) {
    for (const capC of [4.5, 9]) {
      const patient = { ...base, respiratoryPattern: 'apnea-expiratory' as const };
      const scene = new AnatomyScene(patient),
        engine = new PhysiologyEngine(patient, scene.vesselAreas());
      const rInter = 0.06,
        rMain = 0.04,
        lInter = 0.001,
        lMain = 0.001,
        stiffnessScale = 4,
        pRef = 3;
      const volume = (p: number) => c0 * stiffnessScale * (1 - Math.exp(-(p - pRef) / stiffnessScale));
      const pressure = (v: number) => pRef - stiffnessScale * Math.log(1 - v / (c0 * stiffnessScale));
      for (let i = 0; i < 7500; i++) engine.step();
      const initial = engine.sample;
      let qInter = initial.qRenalArtery,
        qMain = qInter;
      let capV = capC * (initial.pIvc - initial.pAbd + 0.1 * qInter);
      let venV = volume(initial.pIvc - initial.pAbd + 0.04 * qInter);
      let cumulativeBalance = 0,
        maximumBalanceError = 0;
      const initialVolume = capV + venV;
      const samples: { t: number; qInter: number; qMain: number; pVen: number; pIvc: number; qSource: number; effectiveC: number }[] = [];
      for (let i = 0; i < 17500; i++) {
        const s = engine.step(),
          h = engine.clock.dt / 16;
        for (let k = 0; k < 16; k++) {
          const pCap = s.pAbd + capV / capC,
            pVen = s.pAbd + pressure(venV);
          qInter = (qInter + (h / lInter) * (pCap - pVen)) / (1 + (h * rInter) / lInter);
          qMain = (qMain + (h / lMain) * (pVen - s.pIvc)) / (1 + (h * rMain) / lMain);
          capV += h * (s.qRenalArtery - qInter);
          venV += h * (qInter - qMain);
          cumulativeBalance += h * (s.qRenalArtery - qMain);
          maximumBalanceError = Math.max(maximumBalanceError, Math.abs(capV + venV - initialVolume - cumulativeBalance));
          if (!Number.isFinite(pressure(venV))) throw new Error('Reservoir left its admissible pressure-volume domain');
        }
        if (s.t > 60)
          samples.push({
            t: s.t,
            qInter,
            qMain,
            pVen: s.pAbd + pressure(venV),
            pIvc: s.pIvc,
            qSource: s.qRenalVein,
            effectiveC: c0 * Math.exp(-(pressure(venV) - pRef) / stiffnessScale),
          });
      }
      const stats = (values: number[]) => {
        const min = Math.min(...values),
          max = Math.max(...values);
        return { min, max, mean: values.reduce((a, b) => a + b, 0) / values.length, pulsatility: (max - min) / max };
      };
      results.push({
        case: base.id,
        c0,
        capC,
        maximumBalanceError,
        interlobar: stats(samples.map((s) => s.qInter)),
        mainRenal: stats(samples.map((s) => s.qMain)),
        source: stats(samples.map((s) => s.qSource)),
        effectiveC: stats(samples.map((s) => s.effectiveC)),
        samples,
      });
      console.log(base.id, c0, capC, JSON.stringify({ ...results.at(-1), samples: undefined }));
    }
  }
}
writeFileSync(
  '/tmp/renal-reservoir-prototype.json',
  JSON.stringify({ researchOnly: true, sourceCirculationFeedback: false, parametersClinicallyValidated: false, results }),
);
