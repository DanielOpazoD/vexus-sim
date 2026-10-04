import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { setReferenceBody } from '../../src/anatomy/referenceBody';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { AnatomyScene } from '../../src/anatomy/scene';
import { AnatomyQuery } from '../../src/anatomy/query';
import { NORMAL_ADULT } from '../../src/cases';
import { PhysiologyEngine } from '../../src/physiology/engine';
import { VenousSpectralAcquisition } from '../../src/doppler/venousSpectral';
import { measureObservedHepatic, measureObservedPortal, measureObservedRenal } from '../../src/doppler/spectralMeasure';
if (process.argv.includes('--reference')) {
  const b = readFileSync('src/anatomy/reference-body.bin');
  setReferenceBody(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
}
const patient = { ...NORMAL_ADULT, respiratoryPattern: 'apnea-expiratory' as const };
const scene = new AnatomyScene(patient),
  query = new AnatomyQuery(scene);
const engine = new PhysiologyEngine(patient, scene.vesselAreas());
for (let i = 0; i < 7500; i++) engine.step();
const acquisition = new VenousSpectralAcquisition(query, engine.sample, NORMAL_ADULT.seed, patient);
const samples = Array.from({ length: 1625 }, () => engine.step());
console.time('three-channel-IQ');
acquisition.push(samples, engine.clock.dt);
console.timeEnd('three-channel-IQ');
const beats = engine.rhythm.beatsBetween(samples[0].t, samples.at(-1)!.t);
const results = [measureObservedHepatic, measureObservedPortal, measureObservedRenal].map((m, i) => {
  const chain = acquisition.chains[i];
  const observed = m(chain.spectral.columns, beats, {
    f0Hz: acquisition.f0Hz,
    angleCorrectionRad: 0,
    invert: false,
    fftSize: 128,
    wallFilterHz: 15,
    gainDb: 0,
  });
  return {
    scale: acquisition.scales[i],
    gate: acquisition.gate(i, engine.sample),
    info: acquisition.gateInfo[i],
    composition: chain.sampleVolume.lastComposition,
    quality: observed?.quality,
    marks: observed?.marks,
    columns: chain.spectral.columns.map((c) => ({ ...c, powerDb: [...c.powerDb] })),
  };
});
console.log(results.map((r) => ({ scale: r.scale, composition: r.composition, quality: r.quality, marks: r.marks?.length })));
const output = process.argv[2] ?? '.validation/venous-spectral-preview.json';
mkdirSync(dirname(output), { recursive: true });
writeFileSync(
  output,
  JSON.stringify({
    sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    clinicalValidation: false,
    method:
      'Experimental fixed anatomical windows, production pwGate PSF/transmission, no angle correction; normal adult in end-expiratory apnea',
    start: samples[0].t,
    end: samples.at(-1)!.t,
    results,
  }),
);
