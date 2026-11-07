import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { Interface } from '../anatomy/interfaces';
import { installDefaultCpu } from '../anatomy/people/default/cpu';
import { Tissue, TISSUES } from '../anatomy/tissues';
import { interfaceUniforms } from '../ultrasound/interfaceEcho';

const current = () =>
  installDefaultCpu({
    abdominal: new Uint16Array(gunzipSync(readFileSync('src/anatomy/abdominal-atlas.gzip.bin')).buffer),
    thoracic: new Uint16Array(gunzipSync(readFileSync('src/anatomy/thoracic-atlas.gzip.bin')).buffer),
  });

it('separa grasa y músculo conservando hígado, corteza, seno y medios anecoicos', () => {
  const material = current().cpu.bmodeAcoustics;
  expect(material).toBeDefined();
  const back = (t: Tissue) => material?.backscatter[t] ?? TISSUES[t].backscatter;
  // Contraste de amplitud estimado: grasa > +8 dB, músculo < -12 dB frente a hígado.
  // Mantener ≥4 dB del seno a la grasa evita convertirla en el tejido más brillante del riñón.
  expect(20 * Math.log10(back(Tissue.PerirenalFat) / back(Tissue.Liver))).toBeGreaterThan(8);
  expect(20 * Math.log10(back(Tissue.Psoas) / back(Tissue.Liver))).toBeLessThan(-12);
  expect(20 * Math.log10(back(Tissue.RenalSinus) / back(Tissue.PerirenalFat))).toBeGreaterThan(4);
  for (const t of [Tissue.Liver, Tissue.RenalCortex, Tissue.RenalSinus, Tissue.Fluid, Tissue.Blood])
    expect(back(t)).toBe(TISSUES[t].backscatter);
  expect(installDefaultCpu({}, true).cpu.bmodeAcoustics).toBeUndefined();
});

it('ensancha el lóbulo capsular conservando su energía angular y las demás interfaces', () => {
  const original = interfaceUniforms(14);
  const updated = interfaceUniforms(14, undefined, current().cpu.bmodeAcoustics?.interfaceSlopeRms);
  const i = 4 * Interface.LiverCapsule;
  // Kirchhoff: integral paraxial de A² exp(-theta²/(2s²)) dΩ ∝ A² s².
  expect(updated[i] ** 2 / updated[i + 2]).toBeCloseTo(original[i] ** 2 / original[i + 2], 5);
  const at = (u: Float32Array, angle: number) => u[i] * Math.exp(-(Math.tan(angle) ** 2) * u[i + 2]);
  expect(at(updated, Math.PI / 6)).toBeGreaterThan(2 * at(original, Math.PI / 6));
  expect(at(updated, 0)).toBeLessThan(at(original, 0));
  for (let k = 0; k < original.length; k++) if (k !== i && k !== i + 2) expect(updated[k]).toBe(original[k]);
});
