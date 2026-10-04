/** Exact cached/uncached IQ comparison and CPU timing; no clinical calibration. */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { NORMAL_ADULT } from '../../src/cases';
import { SampleVolumeIQ } from '../../src/doppler/sampleVolume';
import { pwGate } from '../../src/app/pwGate';
import { openSession, placeGate, probeAt, PROFILE } from '../../src/validation/support/studentChain';
const results = [];
for (const respiratory of ['apnea-expiratory', 'quiet'] as const)
  for (const renal of [false, true]) {
    const s = openSession(NORMAL_ADULT, respiratory);
    const contact = probeAt(s, renal ? 'renal' : 'portal');
    const best = placeGate(s, contact, renal ? ['interlobarVein1', 'interlobarVein2', 'interlobarVein3'] : ['pvTrunk'])!;
    const samples = Array.from({ length: 1000 }, () => s.engine.step());
    const pair: { cache: boolean; repeat: number; particles: number; ms: number; sha256: string }[] = [];
    for (let repeat = 0; repeat < 4; repeat++) {
      for (const cache of repeat % 2 === 0 ? [false, true] : [true, false]) {
        const iq = new SampleVolumeIQ(s.anatomy, 47, cache);
        iq.setEquipment({ prfHz: 3250, f0Hz: 2.5e6, gain: 1 });
        const re = new Float32Array(13),
          im = new Float32Array(13),
          hash = createHash('sha256');
        const start = performance.now();
        for (const [i, sample] of samples.entries()) {
          if (i % 8 === 0) {
            const { gate } = pwGate(
              s.anatomy,
              contact.frame,
              contact,
              PROFILE,
              65,
              { theta: best.theta, depthMm: best.r, gateMm: 4 },
              sample,
            );
            iq.setGate(gate, sample);
          }
          iq.generate(sample, [0, 0, 0], 13, re, im);
          hash.update(Buffer.from(re.buffer));
          hash.update(Buffer.from(im.buffer));
        }
        pair.push({ cache, repeat, particles: iq.particleCount, ms: performance.now() - start, sha256: hash.digest('hex') });
      }
    }
    if (pair.some((r) => r.sha256 !== pair[0].sha256)) throw new Error(`IQ mismatch ${respiratory}/${renal}`);
    const median = (values: number[]) => {
      const v = values.sort((a, b) => a - b);
      return (v[1] + v[2]) / 2;
    };
    const uncachedMs = median(pair.filter((r) => !r.cache).map((r) => r.ms));
    const cachedMs = median(pair.filter((r) => r.cache).map((r) => r.ms));
    const r = { respiratory, renal, pair, uncachedMs, cachedMs, speedup: uncachedMs / cachedMs };
    console.log(JSON.stringify(r));
    results.push(r);
  }
writeFileSync('/tmp/pw-stationary-weight-benchmark.json', JSON.stringify(results));
