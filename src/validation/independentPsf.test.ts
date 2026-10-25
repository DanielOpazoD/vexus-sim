import { describe, expect, it } from 'vitest';
import { compareIndependentPsf, envelopeFwhm, verifyRawReceipt } from '../../tools/fidelity/independentPsf';
import acquiredPoint from '../../tools/fidelity/independentPsf.fixture.json';

const reference = () => ({
  schemaVersion: 1,
  protocolId: 'convex-c35-pymust-point-v2',
  lateralMethod: 'source-offset-fixed-transmit-and-receive-at-nominal-depth',
  origin: 'synthetic',
  engine: { name: 'PyMUST', version: '0.1.9' },
  parameters: {
    frequencyMHz: 3.5,
    samplingFrequencyMHz: 28,
    soundSpeedMS: 1540,
    attenuationDbCmMHz: 0.601,
    pulseEchoBandwidthPercent: 45,
    curvatureRadiusMm: 60,
    activeChordMm: 26,
    elements: 65,
    elementFillFraction: 0.9,
    elevationHeightMm: 13,
    elevationFocusMm: 80,
    txApodization: 'Hann',
    rxApodization: 'uniform',
    rxFNumber: 2.5,
    txCycles: 1,
    spacingScale: 1,
  },
  cases: [
    {
      id: 'focal',
      depthMm: 90,
      focusMm: 90,
      raw: { path: 'focal.npz', sha256: 'a'.repeat(64) },
      fullReceiveControl: { rxFNumber: 0, chordMm: 26, lateral: { positionMm: [-2, -1, 0, 1, 2], envelope: [0, 0.5, 1, 0.5, 0] } },
      profiles: {
        axial: { positionMm: [-2, -1, 0, 1, 2], envelope: [0, 0.25, 1, 0.25, 0] },
        lateral: { positionMm: [-2, -1, 0, 1, 2], envelope: [0, 0.5, 1, 0.5, 0] },
      },
    },
  ],
});

describe('independent point response measurement', () => {
  it('reads an actual two-way PyMUST acquisition and preserves its receive-aperture control', () => {
    const result = compareIndependentPsf(acquiredPoint);
    const focal = result.cases[0];
    expect(focal.id).toBe('focal');
    expect(focal.receiveAperture?.elementCountAtTarget).toBe(35);
    expect(focal.fullReceiveControl.widthMm).toBeLessThan(focal.lateral.widthMm);
    expect(focal.lateral.peakPositionMm).toBe(0);
    expect(focal.axial.peakPositionMm).toBeCloseTo(0, 2);
    // This is a measured fixture and protocol check, not a tolerance on the production PSF.
    expect(focal.lateral.widthMm).toBeCloseTo(2.6374013514276546, 10);
    expect(focal.fullReceiveControl.widthMm).toBeCloseTo(1.855948240034797, 10);
    expect(result.calibration).toBe('pending');
    expect(result.fieldModel).toEqual({
      dimensionality: 2,
      elevationFocusing: false,
      sourcePlaneYMm: 0,
      provenance: 'inferred-from-registered-v2-engine',
    });
    expect(result.interpretation).toContain('No elevation or slice-thickness validation');
  });
  it('accepts an explicit 2-D declaration but rejects focused 3-D claims under the same protocol', () => {
    const fieldModel = { dimensionality: 2, elevationFocusing: false, sourcePlaneYMm: 0 };
    expect(compareIndependentPsf({ ...acquiredPoint, fieldModel }).fieldModel.provenance).toBe('declared-and-protocol-checked');
    for (const invalid of [
      { ...fieldModel, dimensionality: 3 },
      { ...fieldModel, elevationFocusing: true },
      { ...fieldModel, sourcePlaneYMm: 0.01 },
    ])
      expect(() => compareIndependentPsf({ ...acquiredPoint, fieldModel: invalid })).toThrow('2-D field');
  });
  it('binds the raw-profile verifier to exact JSON bytes and every original', () => {
    const cases = [{ id: 'focal', raw: { sha256: 'a'.repeat(64) } }];
    const receipt = {
      protocolId: 'convex-c35-pymust-raw-verification-v2',
      referenceSha256: 'b'.repeat(64),
      verifiedCases: [{ id: 'focal', rawSha256: 'a'.repeat(64) }],
    };
    expect(() => verifyRawReceipt(receipt, 'b'.repeat(64), cases)).not.toThrow();
    // Altering only JSON profiles, with the same raw hash, invalidates the original receipt.
    expect(() => verifyRawReceipt(receipt, 'c'.repeat(64), cases)).toThrow('reference bytes');
    expect(() => verifyRawReceipt({ ...receipt, verifiedCases: [] }, 'b'.repeat(64), cases)).toThrow('inventory');
    expect(() => verifyRawReceipt(receipt, 'b'.repeat(64), [{ id: 'focal', raw: { sha256: 'd'.repeat(64) } }])).toThrow('hash');
  });
  it('measures envelope half-height with interpolation, not half-power', () => {
    const x = [-2, -1, 0, 1, 2];
    expect(envelopeFwhm(x, [0, 0.25, 1, 0.25, 0]).widthMm).toBeCloseTo(4 / 3, 12);
    expect(envelopeFwhm(x, [0, 0.5, 1, 0.5, 0]).widthMm).toBe(2);
    expect(envelopeFwhm(x, [0, 5, 10, 5, 0]).widthMm).toBe(2);
  });
  it('reports peak location and ignores disconnected sidelobes below half-height', () => {
    const m = envelopeFwhm([-3, -2, -1, 0, 1, 2, 3], [0.3, 0.1, 0.5, 1, 0.5, 0.1, 0.3]);
    expect(m).toEqual({ widthMm: 2, peakPositionMm: 0 });
  });
  it('rejects truncated, empty, non-finite, mismatched and unsorted profiles', () => {
    const x = [-2, -1, 0, 1, 2];
    for (const y of [
      [0, 0, 0, 0, 0],
      [0.8, 0.9, 1, 0.8, 0.7],
      [0, 0.5, NaN, 0.5, 0],
      [0, -1, 1, 0.5, 0],
    ])
      expect(() => envelopeFwhm(x, y)).toThrow();
    expect(() => envelopeFwhm(x, [0, 1])).toThrow();
    expect(() => envelopeFwhm([0, 1, 1, 3, 4], [0, 0.5, 1, 0.5, 0])).toThrow();
  });
  it('keeps synthetic comparison separate from calibration and reports signed discrepancies', () => {
    const r = compareIndependentPsf(reference());
    expect(r.calibration).toBe('pending');
    expect(r.humanValidation).toBe('pending');
    expect(r.cases[0].axialComparison.referenceMm).toBeCloseTo(4 / 3, 12);
    expect(r.cases[0].lateralComparison.referenceMm).toBe(2);
    expect(r.cases[0].axialComparison.differenceMm).toBeLessThan(0);
    expect(r.interpretation).toContain('pulse and aperture');
  });
  it('rejects wrong frequency/units, changed pulse, claimed physical origin and duplicate cases', () => {
    let r = reference();
    r.parameters.frequencyMHz = 3.5e6;
    expect(() => compareIndependentPsf(r)).toThrow('mismatch');
    r = reference();
    r.parameters.txCycles = 2;
    expect(() => compareIndependentPsf(r)).toThrow('acquisition');
    r = reference();
    r.origin = 'physical-phantom';
    expect(() => compareIndependentPsf(r)).toThrow('Unsupported');
    r = reference();
    r.cases.push(r.cases[0]);
    expect(() => compareIndependentPsf(r)).toThrow('duplicate');
  });
  it('rejects renamed geometry and unsafe original paths', () => {
    let r = reference();
    r.cases[0].depthMm = 0.09;
    expect(() => compareIndependentPsf(r)).toThrow('geometry');
    r = reference();
    r.cases[0].raw.path = '../other.npz';
    expect(() => compareIndependentPsf(r)).toThrow('path');
  });
});
