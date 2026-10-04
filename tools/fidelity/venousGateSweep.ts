/** Offline acquisition experiment. No physiological parameter or rendering envelope is fitted. */
import { writeFileSync } from 'node:fs';
import { AnatomyScene } from '../../src/anatomy/scene';
import { AnatomyQuery } from '../../src/anatomy/query';
import { NORMAL_ADULT } from '../../src/cases';
import { PhysiologyEngine } from '../../src/physiology/engine';
import { VenousSpectralAcquisition } from '../../src/app/venousSpectral';
import { DEFAULT_BMODE } from '../../src/ultrasound/renderer';
import { measureObservedHepatic, measureObservedPortal, measureObservedRenal } from '../../src/doppler/spectralMeasure';
const p = { ...NORMAL_ADULT, respiratoryPattern: 'apnea-expiratory' as const };
const scene = new AnatomyScene(p),
  anatomy = new AnatomyQuery(scene),
  engine = new PhysiologyEngine(p, scene.vesselAreas());
for (let i = 0; i < 7500; i++) engine.step();
const initial = engine.sample,
  samples = Array.from({ length: 1625 }, () => engine.step());
const beats = engine.rhythm.beatsBetween(samples[0].t, samples.at(-1)!.t);
const results = [];
for (const widths of [
  [4, 4, 2],
  [4, 6, 3],
  [4, 8, 4],
  [4, 6, 5],
]) {
  const a = new VenousSpectralAcquisition(anatomy, initial, p.seed, p, DEFAULT_BMODE);
  const gate = a.gate.bind(a);
  a.gate = (i, s) => ({ ...gate(i, s), lengthMm: widths[i] });
  a.push(samples, engine.clock.dt);
  const channels = [measureObservedHepatic, measureObservedPortal, measureObservedRenal].map((measure, i) => {
    const columns = a.chains[i].spectral.columns;
    const m = measure(columns, beats, { f0Hz: a.f0Hz, angleCorrectionRad: 0, invert: false, fftSize: 128, wallFilterHz: 15, gainDb: 0 });
    const peaks = (positive: boolean) =>
      columns
        .filter((c) => c.t > samples[0].t + 1)
        .map((c) => Math.max(...c.powerDb.slice(positive ? 68 : 0, positive ? 128 : 60)))
        .sort((a, b) => a - b);
    const pos = peaks(true),
      neg = peaks(false);
    return {
      composition: a.chains[i].sampleVolume.lastComposition,
      quality: m?.quality,
      medianPositivePeakDb: pos[Math.floor(pos.length / 2)],
      medianNegativePeakDb: neg[Math.floor(neg.length / 2)],
      columns: columns.map((c) => ({ ...c, powerDb: [...c.powerDb] })),
    };
  });
  console.log(JSON.stringify({ widths, channels: channels.map(({ columns: _c, ...rest }) => rest) }));
  results.push({ widths, channels });
}
writeFileSync('/tmp/venous-gate-sweep.json', JSON.stringify({ researchOnly: true, results }));
