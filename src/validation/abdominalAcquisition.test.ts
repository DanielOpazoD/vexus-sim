// @tier slow
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { setAbdominalAtlas } from '../anatomy/abdominalAtlas';
import { setAbdominalBody } from '../anatomy/referenceBody';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import { VenousSpectralAcquisition } from '../app/venousSpectral';
import { DEFAULT_BMODE } from '../ultrasound/renderer';
import { openSession } from './support/studentChain';

const raw = gunzipSync(readFileSync('src/anatomy/abdominal-atlas.gzip.bin'));
const profile = readFileSync('src/anatomy/abdominal-body.bin');
beforeEach(() => {
  setAbdominalAtlas(new Uint16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)));
  setAbdominalBody(new Float32Array(profile.buffer.slice(profile.byteOffset, profile.byteOffset + profile.byteLength)));
});
afterEach(() => {
  setAbdominalAtlas();
  setAbdominalBody();
});

describe('VExUS through the actual abdominal atlas', () => {
  for (const patient of [NORMAL_ADULT, SEVERE_CONGESTION])
    it(`${patient.id}: real hepatic, main portal and interlobar venous acoustic gates`, () => {
      const s = openSession(patient, 'apnea-expiratory');
      const a = new VenousSpectralAcquisition(s.anatomy, s.engine.sample, patient.seed, s.patient, DEFAULT_BMODE);
      const depths = a.gateDepthsMm;
      expect(depths).toHaveLength(3);
      for (const d of depths) {
        expect(d).toBeGreaterThan(20);
        expect(d).toBeLessThan(175);
      }
      const history = Array.from({ length: 75 }, () => s.engine.step());
      const before = JSON.stringify(history);
      a.push(history, s.engine.clock.dt);
      expect(JSON.stringify(history)).toBe(before);
      for (const chain of a.chains) {
        expect(chain.sampleVolume.lastComposition.bloodFraction).toBeGreaterThan(0);
        expect(chain.spectral.columns.length).toBeGreaterThan(0);
      }
      for (const [i, ids] of [['hvRight'], ['pvTrunk'], ['interlobarVein1', 'interlobarVein2', 'interlobarVein3']].entries()) {
        expect(Object.keys(a.chains[i].sampleVolume.lastComposition.vessels).some((id) => ids.includes(id))).toBe(true);
      }
    });
});
