/** Research: place a single physical sample volume across the paired interlobar vessels. */
import { writeFileSync } from 'node:fs';
import { AnatomyScene } from '../../src/anatomy/scene';
import { AnatomyQuery } from '../../src/anatomy/query';
import { NORMAL_ADULT } from '../../src/cases';
import { PhysiologyEngine } from '../../src/physiology/engine';
import { VenousSpectralAcquisition } from '../../src/app/venousSpectral';
import { DEFAULT_BMODE } from '../../src/ultrasound/renderer';
import { prfFromNyquistCms } from '../../src/core/units';
import { measureObservedRenal } from '../../src/doppler/spectralMeasure';
import type { Vec3 } from '../../src/core/vec3';
const p = { ...NORMAL_ADULT, respiratoryPattern: 'apnea-expiratory' as const };
const scene = new AnatomyScene(p),
  q = new AnatomyQuery(scene),
  e = new PhysiologyEngine(p, scene.vesselAreas());
for (let i = 0; i < 7500; i++) e.step();
const initial = e.sample,
  samples = Array.from({ length: 1625 }, () => e.step()),
  beats = e.rhythm.beatsBetween(samples[0].t, samples.at(-1)!.t);
const results = [];
for (const lateral of [-1.5, -0.75, 0, 0.75, 1.5])
  for (const axial of [-1.5, 0, 1.5]) {
    const a = new VenousSpectralAcquisition(q, initial, p.seed, p, DEFAULT_BMODE),
      chain = a.chains[2];
    for (let k = 0; k < samples.length; k++) {
      const s = samples[k];
      chain.begin(prfFromNyquistCms(40, a.f0Hz), a.f0Hz, 0, 15, s.t);
      if (k % 8 === 0) {
        const g = a.gate(2, s);
        chain.setGate({ ...g, lengthMm: 3, center: g.center.map((v, j) => v + lateral * g.lateral[j] + axial * g.beamDir[j]) as Vec3 }, s);
      }
      chain.step(s, [0, 0, 0], e.clock.dt);
      chain.flush();
    }
    const m = measureObservedRenal(chain.spectral.columns, beats, {
      f0Hz: a.f0Hz,
      angleCorrectionRad: 0,
      invert: false,
      fftSize: 128,
      wallFilterHz: 15,
      gainDb: 0,
    });
    const peaks = chain.spectral.columns
      .filter((c) => c.t > 31)
      .map((c) => Math.max(...c.powerDb.slice(68)))
      .sort((a, b) => a - b);
    const result = {
      lateral,
      axial,
      composition: chain.sampleVolume.lastComposition,
      quality: m?.quality,
      medianArterialPeakDb: peaks[Math.floor(peaks.length / 2)],
    };
    console.log(JSON.stringify(result));
    results.push({ ...result, columns: chain.spectral.columns.map((c) => ({ ...c, powerDb: [...c.powerDb] })) });
  }
writeFileSync('/tmp/renal-gate-balance-sweep.json', JSON.stringify({ researchOnly: true, results }));
