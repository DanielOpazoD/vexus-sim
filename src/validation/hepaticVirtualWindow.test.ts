import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { NORMAL_ADULT, TRICUSPID_REGURGITATION } from '../cases';
import { AnatomyQuery } from '../anatomy/query';
import { AnatomyScene } from '../anatomy/scene';
import { setReferenceBody } from '../anatomy/referenceBody';
import { PhysiologyEngine } from '../physiology/engine';
import { AcousticWindowUnavailableError, VenousSpectralAcquisition } from '../app/venousSpectral';
import { DEFAULT_BMODE } from '../ultrasound/renderer';
const bytes = readFileSync(new URL('../anatomy/reference-body.bin', import.meta.url));
const body = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
afterEach(() => setReferenceBody());

describe('inclinación física de la ventana suprahepática virtual', () => {
  it('la opción habitual conserva la IQ anterior y la inclinación no cambia los otros dos haces', () => {
    const p = { ...NORMAL_ADULT, respiratoryPattern: 'apnea-expiratory' as const };
    const query = new AnatomyQuery(new AnatomyScene(p));
    const engine = new PhysiologyEngine(p, query.scene.vesselAreas());
    for (let i = 0; i < 7500; i++) engine.step();
    const a = new VenousSpectralAcquisition(query, engine.sample, p.seed, p, DEFAULT_BMODE);
    const b = new VenousSpectralAcquisition(query, engine.sample, p.seed, p, DEFAULT_BMODE, 'venous', 'standard');
    const c = new VenousSpectralAcquisition(query, engine.sample, p.seed, p, DEFAULT_BMODE, 'venous', 'tilted');
    expect(a.gateInfo).toEqual(b.gateInfo);
    expect(c.gateInfo.slice(1)).toEqual(a.gateInfo.slice(1));
    expect(c.gate(0, engine.sample).beamDir).not.toEqual(a.gate(0, engine.sample).beamDir);
    const history = Array.from({ length: 100 }, () => engine.step());
    const before = JSON.stringify({ patient: p, history });
    const time = engine.clock.t;
    for (const acquisition of [a, b, c]) acquisition.push(history, engine.clock.dt);
    expect(b.chains.map((x) => x.spectral.columns)).toEqual(a.chains.map((x) => x.spectral.columns));
    expect(c.chains.slice(1).map((x) => x.spectral.columns)).toEqual(a.chains.slice(1).map((x) => x.spectral.columns));
    expect(JSON.stringify({ patient: p, history })).toBe(before);
    expect(engine.clock.t).toBe(time);
  });
  for (const base of [NORMAL_ADULT, TRICUSPID_REGURGITATION])
    it(`${base.id}: +2° recupera una puerta real sin cambiar respiración ni fisiología`, () => {
      setReferenceBody(body);
      const p = { ...base, respiratoryPattern: 'quiet' as const };
      const query = new AnatomyQuery(new AnatomyScene(p));
      const engine = new PhysiologyEngine(p, query.scene.vesselAreas());
      for (let i = 0; i < 500; i++) engine.step();
      expect(() => new VenousSpectralAcquisition(query, engine.sample, p.seed, p, DEFAULT_BMODE)).toThrow(AcousticWindowUnavailableError);
      const a = new VenousSpectralAcquisition(query, engine.sample, p.seed, p, DEFAULT_BMODE, 'venous', 'tilted');
      expect(a.gateInfo[0].vessel).toBe('hvRight');
      expect(a.gateInfo[0].transmission).toBeGreaterThan(0.01);
      const samples = Array.from({ length: 50 }, () => engine.step());
      const before = JSON.stringify(samples);
      a.push(samples, engine.clock.dt);
      expect(a.chains[0].spectral.columns.length).toBeGreaterThan(10);
      expect(a.chains[0].sampleVolume.lastComposition.vessels.hvRight).toBeGreaterThan(0.01);
      expect(JSON.stringify(samples)).toBe(before);
      expect(p.respiratoryPattern).toBe('quiet');
    });
});
