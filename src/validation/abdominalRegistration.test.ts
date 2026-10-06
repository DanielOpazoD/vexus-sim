import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { setReferenceBody } from '../anatomy/referenceBody';
import { NORMAL_ADULT } from '../cases';
import { abdominalRegistrationAudit } from '../../tools/fidelity/abdominalRegistrationAudit';
import { Tissue } from '../anatomy/tissues';
import { PSOAS_NODES } from '../anatomy/organs/retroperitoneum';

const bytes = readFileSync('src/anatomy/reference-body.bin');
const profile = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
afterEach(() => setReferenceBody());
describe('renal registration and posterior compartment, before tissue precedence', () => {
  for (const reference of [false, true])
    it(`posterior kidneys with a free anterior abdomen (${reference})`, () => {
      setReferenceBody(reference ? profile : undefined);
      const scene = new AnatomyScene(NORMAL_ADULT),
        report = abdominalRegistrationAudit(scene);
      expect(scene.kidneyRight.center[2]).toBeLessThan(scene.kidneyLeft.center[2]);
      for (const k of report.kidneys) {
        expect(k.anteriorSkinGapMm).toBeGreaterThan(90);
        expect(k.posteriorSkinGapMm).toBeLessThan(k.anteriorSkinGapMm / 2);
        expect(k.renalCenterAnteriorToSpineMm).toBeGreaterThan(0);
        expect(k.renalCenterAnteriorToSpineMm).toBeLessThan(12);
        expect(k.sampledWallClearanceMm).toBeGreaterThan(0.5);
        expect(k.sampledPsoasClearanceMm).toBeGreaterThan(5);
        expect(k.capsuleSamplesAheadOfPosteriorPeritoneum).toBe(0);
      }
      // Anatomical landmark in T12-L1: the psoas follows the vertebral frame in the actual classifier.
      const [x, y, z] = PSOAS_NODES[0];
      expect(scene.classify([x, y + scene.spine.y0 + 46, z], BASELINE_CALIBER).tissue).toBe(Tissue.Psoas);
    });
  it('rejects the former reference placement even though kidney precedence still returns renal tissue', () => {
    setReferenceBody(profile);
    const scene = new AnatomyScene(NORMAL_ADULT);
    scene.kidneyRight.center[1] = -38;
    const report = abdominalRegistrationAudit(scene);
    expect(report.kidneys[0].renalCenterAnteriorToSpineMm).toBeGreaterThan(20);
    expect(report.kidneys[0].capsuleSamplesAheadOfPosteriorPeritoneum).toBeGreaterThan(100);
    expect(scene.classify(scene.kidneyRight.center, BASELINE_CALIBER).tissue).toBe(Tissue.RenalSinus);
  });
});
