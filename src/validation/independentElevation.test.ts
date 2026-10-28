import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compareIndependentElevation, verifyElevationReceipt } from '../../tools/fidelity/independentElevation';
import acquiredElevation from '../../tools/fidelity/independentElevation.fixture.json';
import { compareIndependentPsf } from '../../tools/fidelity/independentPsf';
import acquiredPoint from '../../tools/fidelity/independentPsf.fixture.json';
import { elevSigmaMm } from '../ultrasound/pleura';
import { CONVEX_C35_PROFILE } from '../ultrasound/transducerProfile';

const reference = () => structuredClone(acquiredElevation);
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function receiptFor(result: ReturnType<typeof compareIndependentElevation>) {
  return {
    protocolId: 'convex-c35-pymust-elevation-v1-verification',
    referenceSha256: digest(acquiredElevation),
    verifiedCases: result.cases.map((c) => ({ id: c.id, rawSha256: c.raw.sha256 })),
    verifiedControls: 13,
    convergence: { ...result.convergence },
  };
}

describe('independent 3-D elevation reference', () => {
  it('measures the real RF-derived fixture and reports discrepancies without fitting an acceptance tolerance', () => {
    const result = compareIndependentElevation(acquiredElevation);
    expect(result.cases.map((c) => c.id)).toEqual(['near', 'focal', 'deep', 'focal-spacing', 'focal-frequency']);
    // Anchors from acquisition-01, not a tolerance on the simulator's reduced Gaussian.
    const measuredWidths = [2.0764117749519437, 2.737372799856354, 5.048850861442848, 2.7370831015434005, 2.7194494116663552];
    for (const [index, c] of result.cases.entries()) {
      expect(c.measurement.widthMm).toBeCloseTo(measuredWidths[index], 10);
      expect(c.measurement.peakPositionMm).toBe(0);
      expect(c.measurement.symmetryRelativeRms).toBeLessThanOrEqual(1e-5);
      expect(c.elevationComparison.referenceMm).toBe(c.measurement.widthMm);
      expect(c.elevationComparison.differenceMm).toBeCloseTo(c.elevationComparison.modelMm - measuredWidths[index], 10);
      expect(c.elevationComparison.relativeDifference).toBeCloseTo(c.elevationComparison.differenceMm / measuredWidths[index], 10);
    }
    const expectedTwoWay = (2 * Math.sqrt(2 * Math.log(2)) * elevSigmaMm(80, CONVEX_C35_PROFILE.geometry.elevationFocusMm)) / Math.SQRT2;
    expect(result.cases[1].elevationComparison.modelMm).toBeCloseTo(expectedTwoWay, 12);
    expect(result.convergence.spacing).toBeCloseTo(0.00010583078525835795, 12);
    expect(result.convergence.frequency).toBeCloseTo(0.006547660658767228, 12);
    expect(result.calibration).toBe('pending');
    expect(result.humanValidation).toBe('pending');
    expect(result.interpretation).toContain('MGBM');
    expect(result.interpretation).toContain('reduced fundamental two-way Gaussian');
    expect(result.authenticityLimit).toContain('not authenticated acquisition');
    expect(result.controls).toHaveLength(13);
  });

  it('keeps the existing v2 reference 2-D and rejects relabelling it as elevation evidence', () => {
    const old = compareIndependentPsf(acquiredPoint);
    expect(old.fieldModel.dimensionality).toBe(2);
    expect(old.fieldModel.elevationFocusing).toBe(false);
    expect(old.interpretation).toContain('No elevation or slice-thickness validation');
    expect(() => compareIndependentElevation(acquiredPoint)).toThrow('Unsupported');
    const r = reference();
    r.fieldModel.dimensionality = 2;
    expect(() => compareIndependentElevation(r)).toThrow('3-D sentinel');
    r.fieldModel.dimensionality = 3;
    r.fieldModel.elevationFocusing = false;
    expect(() => compareIndependentElevation(r)).toThrow('3-D sentinel');
  });

  it('requires synthetic development origin, registered method, engine source and sentinel parameters', () => {
    for (const changed of [
      { ...acquiredElevation, origin: 'physical-phantom' },
      { ...acquiredElevation, role: 'held-out' },
      { ...acquiredElevation, role: undefined },
      { ...acquiredElevation, method: 'source-offset-fixed-transmit-and-receive-at-nominal-depth' },
    ])
      expect(() => compareIndependentElevation(changed)).toThrow('Unsupported');
    const source = reference();
    source.engine.sources['pfield.py'] = 'a'.repeat(64);
    expect(() => compareIndependentElevation(source)).toThrow('engine sources');
    for (const changed of [
      { sentinelReflectivity: 1 },
      { sentinelYMm: 0 },
      { parallel: true },
      { elevationFocusMm: 90 },
      { elevationHeightMm: 6.5 },
      { samplingFrequencyMHz: 3.5 },
      { lateralTxFocusMm: 80 },
      { elements: 64 },
      { txApodization: 'uniform' },
      { rxApodization: 'Hann' },
    ])
      expect(() =>
        compareIndependentElevation({ ...acquiredElevation, parameters: { ...acquiredElevation.parameters, ...changed } }),
      ).toThrow('parameters differ');
  });

  it('requires every offset to witness the serial two-point 3-D acquisition', () => {
    const r = reference();
    r.cases[0].trace[0].elevationFocusing = false;
    expect(() => compareIndependentElevation(r)).toThrow('branch witness');
    const points = reference();
    points.cases[1].trace[1].points = 1;
    expect(() => compareIndependentElevation(points)).toThrow('point count');
    const simus = reference();
    simus.cases[2].trace[2].isSIMUS = false;
    expect(() => compareIndependentElevation(simus)).toThrow('branch witness');
    const missing = reference();
    missing.cases[3].trace.pop();
    expect(() => compareIndependentElevation(missing)).toThrow('sample count');
  });

  it('requires both RF and spectrum for focus/height causality and the zero-addition/central-limit controls', () => {
    for (const id of ['focus3d', 'height3d'] as const) {
      for (const channel of ['rf', 'spectrum'] as const) {
        const r = reference();
        r.controlErrors[id][channel] = 0.001;
        expect(() => compareIndependentElevation(r)).toThrow('Causal control failed');
      }
    }
    for (const id of [
      'focus2d',
      'height2d',
      'sentinelOffplane',
      'sentinelLocation',
      'limit-plus1',
      'limit-minus1',
      'limit-plus2',
      'limit-minus2',
    ] as const) {
      for (const channel of ['rf', 'spectrum'] as const) {
        const r = reference();
        r.controlErrors[id][channel] = id.startsWith('limit-') ? 0.000101 : 0.00000101;
        expect(() => compareIndependentElevation(r)).toThrow('Causal control failed');
      }
    }
    const inactive = reference();
    inactive.controls['focus50-3d'].trace.elevationFocusing = false;
    expect(() => compareIndependentElevation(inactive)).toThrow('branch witness');
    const frequency = reference();
    frequency.controls['height6-3d'].trace.frequencyHash = 'b'.repeat(64);
    expect(() => compareIndependentElevation(frequency)).toThrow('frequency sampling differs');
    const renamed = reference();
    renamed.controls['focus50-3d'].parameters.focus = 80;
    expect(() => compareIndependentElevation(renamed)).toThrow('Control parameters');
  });

  it('rejects incomplete/duplicate inventories, renamed geometry and unsafe or reused original paths', () => {
    const duplicate = reference();
    duplicate.cases[2] = structuredClone(duplicate.cases[0]);
    expect(() => compareIndependentElevation(duplicate)).toThrow('duplicate');
    const missing = reference();
    missing.cases.pop();
    expect(() => compareIndependentElevation(missing)).toThrow('inventory');
    const { 'zero-3d': _removed, ...controls } = acquiredElevation.controls;
    expect(() => compareIndependentElevation({ ...acquiredElevation, controls })).toThrow('inventory');
    expect(() =>
      compareIndependentElevation({ ...acquiredElevation, controls: { ...acquiredElevation.controls, duplicate: _removed } }),
    ).toThrow('inventory');
    const geometry = reference();
    geometry.cases[1].depthMm = 90;
    expect(() => compareIndependentElevation(geometry)).toThrow('geometry');
    const step = reference();
    step.cases[4].frequencyStep = 1;
    expect(() => compareIndependentElevation(step)).toThrow('geometry');
    for (const path of ['../focal.npz', '/tmp/focal.npz', 'raw/focal.npz', 'raw\\focal.npz']) {
      const r = reference();
      r.controls['zero-3d'].raw.path = path;
      expect(() => compareIndependentElevation(r)).toThrow('path');
    }
    const reused = reference();
    reused.controls['zero-3d'].raw.path = reused.cases[0].raw.path;
    expect(() => compareIndependentElevation(reused)).toThrow('Duplicate original');
  });

  it('recomputes widths and rejects malformed, truncated, displaced or asymmetric curves', () => {
    const width = reference();
    width.cases[1].measurement.widthMm += 0.01;
    expect(() => compareIndependentElevation(width)).toThrow('reported measurement');
    const truncated = reference();
    truncated.cases[1].profile.envelope.fill(1);
    expect(() => compareIndependentElevation(truncated)).toThrow('truncated');
    const short = reference();
    short.cases[1].profile.envelope.pop();
    expect(() => compareIndependentElevation(short)).toThrow('sample count');
    const wrongRange = reference();
    wrongRange.cases[1].profile.positionMm[0] = -11.9;
    expect(() => compareIndependentElevation(wrongRange)).toThrow('span exactly');
    for (const value of [NaN, Infinity, -1]) {
      const r = reference();
      r.cases[1].profile.envelope[0] = value;
      expect(() => compareIndependentElevation(r)).toThrow();
    }
    const asymmetric = reference();
    const envelope = asymmetric.cases[1].profile.envelope;
    envelope[25] *= 0.8;
    expect(() => compareIndependentElevation(asymmetric)).toThrow('Asymmetric');
    const displaced = reference();
    displaced.cases[1].profile.envelope.reverse();
    displaced.cases[1].profile.envelope.unshift(displaced.cases[1].profile.envelope.pop() ?? 0);
    expect(() => compareIndependentElevation(displaced)).toThrow('displaced');
  });

  it('recomputes both convergence fractions and refuses a false or failing convergence claim', () => {
    for (const key of ['spacing', 'frequency'] as const) {
      const r = reference();
      r.convergence[key] = 0;
      expect(() => compareIndependentElevation(r)).toThrow('Convergence');
    }
    // Another valid measured curve at the refinement geometry still fails convergence.
    const diverged = reference();
    diverged.cases[4].profile = structuredClone(diverged.cases[0].profile);
    diverged.cases[4].measurement = structuredClone(diverged.cases[0].measurement);
    diverged.convergence.frequency = 0;
    expect(() => compareIndependentElevation(diverged)).toThrow('exceeds 1%');
  });

  it('binds the Python receipt to exact reference bytes, all five raw hashes and thirteen controls', () => {
    const result = compareIndependentElevation(acquiredElevation);
    const receipt = receiptFor(result);
    expect(() => verifyElevationReceipt(receipt, digest(acquiredElevation), result)).not.toThrow();
    const changed = reference();
    changed.controls['zero-3d'].raw.sha256 = 'c'.repeat(64);
    expect(() => verifyElevationReceipt(receipt, digest(changed), compareIndependentElevation(changed))).toThrow('reference bytes');
    expect(() =>
      verifyElevationReceipt({ ...receipt, protocolId: 'convex-c35-pymust-raw-verification-v2' }, digest(acquiredElevation), result),
    ).toThrow('reference bytes');
    expect(() => verifyElevationReceipt({ ...receipt, verifiedControls: 12 }, digest(acquiredElevation), result)).toThrow('inventory');
    const duplicate = receiptFor(result);
    duplicate.verifiedCases[4] = { ...duplicate.verifiedCases[0] };
    expect(() => verifyElevationReceipt(duplicate, digest(acquiredElevation), result)).toThrow('inventory');
    const wrongHash = receiptFor(result);
    wrongHash.verifiedCases[0].rawSha256 = 'd'.repeat(64);
    expect(() => verifyElevationReceipt(wrongHash, digest(acquiredElevation), result)).toThrow('hash');
    const missing = receiptFor(result);
    missing.verifiedCases.pop();
    expect(() => verifyElevationReceipt(missing, digest(acquiredElevation), result)).toThrow('inventory');
    const convergence = receiptFor(result);
    convergence.convergence.frequency = 0;
    expect(() => verifyElevationReceipt(convergence, digest(acquiredElevation), result)).toThrow('convergence');
  });
});
