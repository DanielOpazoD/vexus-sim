/** Constant-flow analytical phantom: diagnose numerical sidebands independently of haemodynamics. */
import { writeFileSync } from 'node:fs';
import { AnatomyScene } from '../../src/anatomy/scene';
import { AnatomyQuery } from '../../src/anatomy/query';
import { NORMAL_ADULT } from '../../src/cases';
import { PhysiologyEngine } from '../../src/physiology/engine';
import { Tissue } from '../../src/anatomy/tissues';
import { PwDopplerChain } from '../../src/doppler/pwChain';
import { dopplerShiftHz } from '../../src/core/units';
const results = [];
for (const u of [100, 300])
  for (const prf of [2000, 4000]) {
    const patient = { ...NORMAL_ADULT, respiratoryPattern: 'apnea-expiratory' as const };
    const scene = new AnatomyScene(patient),
      anatomy = new AnatomyQuery(scene),
      engine = new PhysiologyEngine(patient, scene.vesselAreas());
    const base = engine.sample,
      template = anatomy.classifyWorld([0, 0, 0], base);
    anatomy.classifyWorld = (p) => ({
      ...template,
      tissue: Tissue.Blood,
      vessel: 'hvRight',
      material: p,
      bloodVelocity: [0, 0, u],
      flowBasis: [0, 0, 1],
      tissueVelocity: [0, 0, 0],
    });
    const chain = new PwDopplerChain(anatomy, Number(process.argv[3] ?? 41), undefined, { maxColumns: 4096 });
    const gate = {
      center: [0, 0, 0] as [number, number, number],
      beamDir: [0, 0, -1] as [number, number, number],
      lateral: [1, 0, 0] as [number, number, number],
      elevation: [0, 1, 0] as [number, number, number],
      lengthMm: 2,
      lateralSigmaMm: 0.6,
      elevationSigmaMm: 0.6,
      pulseSigmaMm: 0.25,
      apertureAngleSigmaRad: 0,
      transmission: 1,
    };
    const bloodWeights: number[] = [];
    for (let k = 0; k < 1500; k++) {
      const s = { ...base, t: k * 0.004, velocities: { ...base.velocities, hvRight: u } };
      chain.begin(prf, 2.5e6, 0, 15, s.t);
      chain.setGate(gate, s);
      chain.step(s, [0, 0, 0], 0.004);
      chain.flush();
      if (k > 250) bloodWeights.push(chain.sampleVolume.lastComposition.bloodWeight);
    }
    const expectedHz = dopplerShiftHz(u, 2.5e6),
      widthHz = (4 * u) / gate.lengthMm;
    const columns = chain.spectral.columns.filter((c) => c.t > 1);
    const leakage = columns
      .map((c) => {
        let total = 0,
          out = 0;
        for (let k = 0; k < c.powerDb.length; k++) {
          const p = 10 ** (c.powerDb[k] / 10),
            f = ((k - 64) * prf) / 128;
          const distance = Math.abs(((f - expectedHz + 1.5 * prf) % prf) - prf / 2);
          total += p;
          if (distance > widthHz) out += p;
        }
        return 10 * Math.log10(out / total);
      })
      .sort((a, b) => a - b);
    const result = {
      u,
      prf,
      expectedHz,
      widthHz,
      bloodWeightMean: bloodWeights.reduce((a, b) => a + b, 0) / bloodWeights.length,
      leakageMedianDb: leakage[Math.floor(leakage.length * 0.5)],
      leakageP95Db: leakage[Math.floor(leakage.length * 0.95)],
      leakageMaxDb: leakage.at(-1),
      columns: columns.map((c) => ({ ...c, powerDb: [...c.powerDb] })),
    };
    results.push(result);
    console.log({ ...result, columns: columns.length });
  }
writeFileSync(process.argv[2] ?? '/tmp/pw-continuity-before.json', JSON.stringify({ analyticalPhantom: true, results }));
