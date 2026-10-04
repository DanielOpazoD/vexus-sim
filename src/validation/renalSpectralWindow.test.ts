import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { AnatomyQuery } from '../anatomy/query';
import { AnatomyScene } from '../anatomy/scene';
import { setReferenceBody } from '../anatomy/referenceBody';
import { VenousSpectralAcquisition } from '../app/venousSpectral';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import { PhysiologyEngine } from '../physiology/engine';
import { VESSEL_META } from '../physiology/vessels';
import { DEFAULT_BMODE } from '../ultrasound/renderer';

const bytes = readFileSync('src/anatomy/reference-body.bin');
const reference = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
afterEach(() => setReferenceBody());

describe('ventana renal pareada: geometría sin reescalar velocidades', () => {
  for (const body of ['legacy', 'reference'])
    for (const base of [NORMAL_ADULT, SEVERE_CONGESTION])
      it(`${body} · ${base.id}: solo cambia la adquisición renal`, () => {
        setReferenceBody(body === 'reference' ? reference : undefined);
        const patient = { ...base, respiratoryPattern: 'apnea-expiratory' as const };
        const anatomy = new AnatomyQuery(new AnatomyScene(patient));
        const engine = new PhysiologyEngine(patient, anatomy.scene.vesselAreas());
        for (let i = 0; i < 7500; i++) engine.step();
        const venous = new VenousSpectralAcquisition(anatomy, engine.sample, patient.seed, patient, DEFAULT_BMODE);
        const paired = new VenousSpectralAcquisition(anatomy, engine.sample, patient.seed, patient, DEFAULT_BMODE, 'paired');
        expect(VESSEL_META[venous.gateInfo[2].vessel!].system).toBe('interlobarVein');
        expect(VESSEL_META[paired.gateInfo[2].vessel!].system).toBe('interlobarArtery');
        expect(paired.gate(2, engine.sample).center).not.toEqual(venous.gate(2, engine.sample).center);
        expect(paired.scales).toEqual(venous.scales);
        expect(paired.wallFilters).toEqual(venous.wallFilters);
        const samples = Array.from({ length: 60 }, () => engine.step());
        const original = JSON.stringify(samples);
        venous.push(samples, engine.clock.dt);
        paired.push(samples, engine.clock.dt);
        for (const i of [0, 1]) {
          expect(paired.gateInfo[i]).toEqual(venous.gateInfo[i]);
          expect(paired.chains[i].spectral.columns).toEqual(venous.chains[i].spectral.columns);
        }
        const composition = paired.chains[2].sampleVolume.lastComposition.vessels;
        for (const system of ['interlobarArtery', 'interlobarVein'])
          expect(
            Object.entries(composition)
              .filter(([id]) => VESSEL_META[id as keyof typeof VESSEL_META].system === system)
              .reduce((sum, [, w]) => sum + w, 0),
          ).toBeGreaterThan(0);
        expect(JSON.stringify(samples)).toBe(original);
        expect(anatomy.probeCompression).toBeNull();
      });
});
