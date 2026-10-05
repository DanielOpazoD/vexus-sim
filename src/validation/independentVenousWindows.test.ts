import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { AnatomyQuery } from '../anatomy/query';
import { setReferenceBody } from '../anatomy/referenceBody';
import { NORMAL_ADULT } from '../cases';
import { PhysiologyEngine } from '../physiology/engine';
import { AcousticWindowUnavailableError, VenousSpectralAcquisition } from '../app/venousSpectral';
import { DEFAULT_BMODE } from '../ultrasound/renderer';

afterEach(() => setReferenceBody());
describe('territorios PW independientes, misma cadena física', () => {
  it('separar las tres ventanas conserva puertas, semillas, IQ y replay exactamente', () => {
    const p = { ...NORMAL_ADULT, respiratoryPattern: 'apnea-expiratory' as const };
    const query = new AnatomyQuery(new AnatomyScene(p));
    const engine = new PhysiologyEngine(p, query.scene.vesselAreas());
    for (let i = 0; i < 7500; i++) engine.step();
    const all = new VenousSpectralAcquisition(query, engine.sample, p.seed, p, DEFAULT_BMODE);
    const single = [0, 1, 2].map(
      (i) => new VenousSpectralAcquisition(query, engine.sample, p.seed, p, DEFAULT_BMODE, 'venous', 'standard', i),
    );
    const history = Array.from({ length: 100 }, () => engine.step());
    const source = JSON.stringify({ p, history });
    for (let replay = 0; replay < 2; replay++) {
      if (replay) {
        all.reacquire();
        for (const a of single) a.reacquire();
      }
      all.push(history, engine.clock.dt);
      for (const [i, a] of single.entries()) {
        a.push(history.slice(0, 37), engine.clock.dt);
        a.push(history.slice(37), engine.clock.dt);
        expect(a.chains).toHaveLength(1);
        expect(a.chains[0].spectral.columns.length).toBeGreaterThan(10);
        expect(a.chains[0].spectral.columns).toEqual(all.chains[i].spectral.columns);
        expect(a.gateTracks[0]).toEqual(all.gateTracks[i]);
        expect(a.gateInfo[0]).toEqual(all.gateInfo[i]);
        expect(a.materialCenters[0]).toEqual(all.materialCenters[i]);
        expect(a.scales[0]).toBe(all.scales[i]);
        expect(a.gateLengthMm(0)).toBe(all.gateLengthMm(i));
        expect(a.prfHz(0)).toBe(all.prfHz(i));
      }
    }
    expect(JSON.stringify({ p, history })).toBe(source);
  });
  it('una suprahepática inaccesible no impide adquirir porta y riñón reales', () => {
    const bytes = readFileSync(new URL('../anatomy/reference-body.bin', import.meta.url));
    setReferenceBody(new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
    const p = { ...NORMAL_ADULT, respiratoryPattern: 'quiet' as const };
    const query = new AnatomyQuery(new AnatomyScene(p));
    const engine = new PhysiologyEngine(p, query.scene.vesselAreas());
    for (let i = 0; i < 500; i++) engine.step();
    const create = (i?: number) => new VenousSpectralAcquisition(query, engine.sample, p.seed, p, DEFAULT_BMODE, 'venous', 'standard', i);
    expect(() => create()).toThrow(AcousticWindowUnavailableError);
    expect(() => create(0)).toThrow(AcousticWindowUnavailableError);
    const good = [create(1), create(2)];
    const samples = Array.from({ length: 50 }, () => engine.step());
    for (const a of good) {
      a.push(samples, engine.clock.dt);
      expect(a.gateInfo[0].vessel).not.toBeNull();
      expect(a.chains[0].spectral.columns.length).toBeGreaterThan(10);
      expect(a.chains[0].spectral.columns.every((c) => [...c.powerDb].every(Number.isFinite))).toBe(true);
    }
  });
  it('rechaza índices ajenos al dominio sin inventar una puerta', () => {
    const query = new AnatomyQuery(new AnatomyScene(NORMAL_ADULT));
    const engine = new PhysiologyEngine(NORMAL_ADULT, query.scene.vesselAreas());
    for (const i of [-1, 3, 0.5, NaN, Infinity])
      expect(() => new VenousSpectralAcquisition(query, engine.sample, 1, NORMAL_ADULT, DEFAULT_BMODE, 'venous', 'standard', i)).toThrow(
        RangeError,
      );
  });
});
